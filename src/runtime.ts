// The runtime: the only module allowed to touch the world. It produces
// input events (keypresses, filesystem updates) on the event bus, feeds
// batches through the pure monoidal transformer, and interprets the
// collected output events (write frames, exit). All IO lives here so the
// lint rule can forbid it everywhere else.

import { consumeBar, createBus, drain, initialState, publish, transduce } from './core.ts';
import { renderBar, renderFrame } from './render.ts';
import { editorProgram } from './editor.ts';
import { readFileSync, statSync, watch, type FSWatcher } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { InputEvent, Key, NamedKey } from './types.ts';

const ALT_ENTER = '\u001b[?1049h\u001b[?25l';
const ALT_LEAVE = '\u001b[?25h\u001b[?1006l\u001b[?1000l\u001b[?1049l';
const POLL_MS = 300;
/** Trailing-edge debounce: one logical save fires several inotify events
 *  (modify / close_write / moved_to …); events inside one window coalesce
 *  into a single read+repaint. */
const WATCH_DEBOUNCE_MS = 40;

function decodeNamed(byte: number): NamedKey | null {
  switch (byte) {
    case 3:
      return 'ctrl-c';
    case 4:
      return 'ctrl-d';
    case 5:
      return 'ctrl-e';
    case 25:
      return 'ctrl-y';
    case 8:
    case 127:
      return 'backspace';
    case 13:
    case 10:
      return 'enter';
    default:
      return null;
  }
}

/** Incremental key decoder: buffers partial escape sequences across chunks. */
export interface KeyDecoder {
  readonly feed: (chunk: string) => readonly InputEvent[];
  readonly flush: () => readonly InputEvent[];
  readonly hasPending: () => boolean;
  readonly reset: () => void;
}

interface Cursor { pos: number }

function decodeFrom(pending: string, cursor: Cursor): readonly InputEvent[] {
  const events: InputEvent[] = [];
  const codes: number[] = [];
  for (let i = 0; i < pending.length; i += 1) codes.push(pending.charCodeAt(i));
  let i = cursor.pos;
  while (i < codes.length) {
    const b = codes[i];
    if (b === 27) {
      const b1 = codes[i + 1];
      if (b1 === undefined) break; // lone ESC at chunk end: hold for flush()
      if (b1 === 91 || b1 === 79) {
        const kind = codes[i + 2];
        if (kind === undefined) break; // partial sequence: wait for more
        if (b1 === 91 && kind === 77) {
          // X10 mouse report: ESC [ M cb cx cy (three raw bytes follow)
          if (i + 3 >= codes.length) break; // partial: wait for all three
          const cb = codes[i + 3] - 32;
          if (cb === 64) events.push({ t: 'key', key: { t: 'named', k: 'up' } });
          else if (cb === 65) events.push({ t: 'key', key: { t: 'named', k: 'down' } });
          i += 6;
          continue;
        }
        if (b1 === 91 && kind === 60) {
          // SGR mouse report: ESC [ < b ; x ; y (M|m) — find the terminator
          let end = i + 3;
          while (end < codes.length && codes[end] !== 77 && codes[end] !== 109) end += 1;
          if (end >= codes.length) break; // partial: wait
          const btnField = pending.slice(i + 3, end).split(';')[0] ?? '';
          const btn = Number(btnField);
          if (btn === 64) events.push({ t: 'key', key: { t: 'named', k: 'up' } });
          else if (btn === 65) events.push({ t: 'key', key: { t: 'named', k: 'down' } });
          i = end + 1;
          continue;
        }
        if (kind === 65) events.push({ t: 'key', key: { t: 'named', k: 'up' } });
        else if (kind === 66) events.push({ t: 'key', key: { t: 'named', k: 'down' } });
        else if (kind === 67) events.push({ t: 'key', key: { t: 'named', k: 'right' } });
        else if (kind === 68) events.push({ t: 'key', key: { t: 'named', k: 'left' } });
        i += 3;
        continue;
      }
      events.push({ t: 'key', key: { t: 'named', k: 'escape' } });
      i += 1;
      continue;
    }
    const named = decodeNamed(b);
    if (named) {
      events.push({ t: 'key', key: { t: 'named', k: named } });
      i += 1;
      continue;
    }
    if (b >= 32 && b < 127) {
      events.push({ t: 'key', key: { t: 'ch', c: pending[i] ?? '' } });
      i += 1;
      continue;
    }
    i += 1; // undecodable byte: drop
  }
  cursor.pos = i;
  return events;
}

/**
 * Stateful decoder factory: feed raw chunks, receive logical key events. A
 * trailing partial escape sequence is held back until more bytes arrive or
 * flush() is called (so a lone ESC is only reported as Escape when it is
 * genuinely alone).
 */
export function createKeyDecoder(): KeyDecoder {
  let pending = '';
  let cursor: Cursor = { pos: 0 };
  const decoder = {
    feed: (chunk: string): readonly InputEvent[] => {
      pending += chunk;
      const events = decodeFrom(pending, cursor);
      pending = pending.slice(cursor.pos);
      cursor = { pos: 0 };
      return events;
    },
    flush: (): readonly InputEvent[] => {
      if (pending.length === 0) return [];
      const events: InputEvent[] = [{ t: 'key', key: { t: 'named', k: 'escape' } }];
      pending = '';
      cursor = { pos: 0 };
      return events;
    },
    hasPending: (): boolean => pending.length > 0,
    reset: (): void => {
      pending = '';
      cursor = { pos: 0 };
    },
  };
  return decoder;
}

export function decodeKeys(chunk: string): readonly InputEvent[] {
  return createKeyDecoder().feed(chunk);
}

function statSig(path: string): string {
  try {
    const st = statSync(path);
    return `${st.ino}:${st.size}:${st.mtimeMs}`;
  } catch {
    return 'gone';
  }
}

async function readFileText(path: string): Promise<string> {
  try {
    return await Bun.file(path).text();
  } catch {
    return '';
  }
}

export function writeOut(text: string): void {
  try {
    process.stdout.write(text);
  } catch {
    // a dead pipe must never lock or crash the viewer
  }
}

export function restoreTerminal(): void {
  try {
    process.stdin.setRawMode(false);
  } catch {
    // already restored or never raw
  }
  writeOut(ALT_LEAVE);
}

/** Entry: returns a process exit code. */
export async function runView(file: string): Promise<number> {
  const isTty = Boolean(process.stdout.isTTY) && Boolean(process.stdin.isTTY);
  if (!isTty) {
    // cat-compatible non-interactive path: plain dump, no livereload
    writeOut(await readFileText(file));
    return 0;
  }

  const bus = createBus();
  const decoder = createKeyDecoder();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let wake: (() => void) | null = null;
  const kick = (): void => {
    const w = wake;
    wake = null;
    if (w) w();
  };
  const waitForEvents = (): Promise<void> =>
    new Promise<void>((resolve) => {
      if (bus.pending.length > 0) {
        resolve();
        return;
      }
      wake = resolve;
    });

  const dbg = process.env.BLITCH_DEBUG === '1'
    ? (msg: string): void => {
        process.stderr.write(`[blitch] ${msg}\n`);
      }
    : null;
  const reportFile = (): void => {
    let text = '';
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      text = '';
    }
    const sig = statSig(file);
    dbg?.(`reportFile sig=${sig} len=${text.length}`);
    publish(bus, [{ t: 'file', sig, text }]);
    kick();
  };

  // ZZ effect interpreter: suspend TUI, run $EDITOR, resume + repaint
  let editing = false;
  const runEditor = async (): Promise<void> => {
    editing = true;
    stdin.pause(); // stop racing $EDITOR for tty bytes
    writeOut('\u001b[?1006l\u001b[?1000l\u001b[?25h\u001b[?1049l');
    try {
      stdin.setRawMode(false);
    } catch {
      // already cooked
    }
    const editor = process.env.EDITOR ?? 'vim';
    const [invocation] = editorProgram(editor, file).run(live);
    const proc = Bun.spawn([...invocation.argv], { stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' });
    await proc.exited;
    stdin.resume();
    decoder.reset(); // editor-era bytes must not leak into the viewer
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    try {
      stdin.setRawMode(true);
    } catch {
      // keep going regardless
    }
    writeOut(ALT_ENTER);
    editing = false;
    reportFile(); // edits diff in through the transformer (green/red/yellow)
    // force a repaint even when the editor changed nothing — vim left the
    // alt screen blank and the signature dedup would otherwise drop the frame
    writeOut(`\u001b[H${renderFrame(live)}\u001b[J\u001b[${live.height + 1};1H${barLine ?? renderBar(live)}\u001b[K`);
  };

  const stdin = process.stdin;
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  stdin.on('data', (chunk: string) => {
    if (editing) return; // keystrokes belong to $EDITOR while it runs
    dbg?.(`stdin raw: ${JSON.stringify(chunk)}`);
    const keys = decoder.feed(chunk);
    dbg?.(`stdin decoded: ${JSON.stringify(keys)}`);
    if (keys.length > 0) publish(bus, keys);
    if (decoder.hasPending()) {
      // hold a trailing partial escape briefly; a lone ESC flushes as Escape
      if (flushTimer) clearTimeout(flushTimer);
      flushTimer = setTimeout(() => {
        flushTimer = null;
        if (editing) return; // stale vim-era bytes: never publish across the editor boundary
        const flushed = decoder.flush();
        if (flushed.length > 0) {
          publish(bus, flushed);
          kick();
        }
      }, 25);
    }
    kick();
  });
  stdin.on('error', () => {
    // keep the viewer alive if the pipe hiccups
  });

  // SGR mouse wheel reporting: the wheel scrolls instead of leaking arrows
  writeOut('\u001b[?1000h\u001b[?1006h');

  let watcher: FSWatcher | null = null;
  // Debounced reporting: coalesce an event burst into ONE read+repaint.
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleReport = (): void => {
    if (debounceTimer) return; // a burst is already pending: one report per window
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      reportFile();
    }, WATCH_DEBOUNCE_MS);
  };
  try {
    // Watch the PARENT DIRECTORY filtered by basename: editors doing
    // atomic saves (temp file + rename over the target) replace the
    // file's inode, killing any watch registered on the file itself
    // after the first save; the directory's inode is stable across
    // renames, so the watch survives the swap (FAILURE-MODES A4.10
    // family). The 300ms poll stays as the no-inotify fallback.
    const base = basename(file);
    const isTargetEvent = (name: string | Buffer | null): boolean => {
      if (name === null) return true; // unknown name: report conservatively
      return (typeof name === 'string' ? name : name.toString('utf8')) === base;
    };
    watcher = watch(dirname(file), { persistent: false }, (event: string, name: string | Buffer | null) => {
      if (isTargetEvent(name)) scheduleReport();
    });
  } catch {
    watcher = null; // poll interval keeps livereload working without inotify
  }
  const poll = setInterval(reportFile, POLL_MS);

  const interrupted = (): void => {
    if (flushTimer) clearTimeout(flushTimer);
    if (debounceTimer) clearTimeout(debounceTimer);
    restoreTerminal();
    watcher?.close();
    clearInterval(poll);
    process.exit(0);
  };
  process.on('SIGINT', interrupted);
  process.on('SIGTERM', interrupted);

  writeOut(ALT_ENTER);
  const height = process.stdout.rows > 4 ? process.stdout.rows - 1 : 23;
  const sig = statSig(file);
  const state = initialState(file, await readFileText(file), sig, height);
  const initialBar = renderBar(state);
  writeOut(`\u001b[H${renderFrame(state)}\u001b[J\u001b[${height + 1};1H${initialBar}\u001b[K`); // first paint: cat-plain + always-prefixed bar
  let live = state;
  let barLine: string | null = initialBar;

  let code = 0;
  let running = true;
  while (running) {
    await waitForEvents();
    const batch = drain(bus);
    if (batch.length === 0) continue;
    const t = transduce(live, batch);
    live = t.state;
    const bar = consumeBar(t.outputs);
    if (bar !== null) barLine = bar;
    let editorRequested = false;
    for (const out of t.outputs) {
      if (out.t === 'frame') {
        const barPart = barLine === null ? '' : `\u001b[${live.height + 1};1H${barLine}\u001b[K`;
        writeOut('\u001b[H' + out.text + '\u001b[J' + barPart);
      } else if (out.t === 'bar') {
        writeOut(`\u001b[${live.height + 1};1H${barLine ?? ''}\u001b[K`);
      } else if (out.t === 'editor') {
        editorRequested = true;
      } else {
        code = out.code;
        running = false;
      }
    }
    if (editorRequested && running) {
      await runEditor();
    }
  }

  if (flushTimer) clearTimeout(flushTimer);
  if (debounceTimer) clearTimeout(debounceTimer);
  watcher?.close();
  clearInterval(poll);
  restoreTerminal();
  stdin.removeAllListeners('data');
  return code;
}

export type { Key };
