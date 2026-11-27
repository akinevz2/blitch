// Pure core: reducer, the monoidal event transformer, the event bus, and
// the filesystem event-bus filter that projects reported file updates onto
// on-screen state changes. Pure module: no IO tokens (enforced by lint).

import { arrayMonoid, lastMonoid, type Monoid } from './monoid.ts';
import { projectView } from './diff.ts';
import { renderFrame, renderBar } from './render.ts';
import { currentScheme, modalEnter } from './modal.ts';
import type { InputEvent, OutputEvent, State, ViewPatch } from './types.ts';

export interface Transition {
  readonly state: State;
  readonly outputs: readonly OutputEvent[];
}

/** Free-monoid accumulation of published output events. */
export const OUTPUT_MONOID: Monoid<readonly OutputEvent[]> = arrayMonoid<OutputEvent>();

/** The bottom-bar channel: last-write-wins over published bar fragments. */
export const BAR_MONOID: Monoid<string | null> = lastMonoid<string>();

/**
 * The monoidal consumer of the bar channel: folds the bar events of one
 * transformer batch into the bar line to paint (null = nothing published).
 */
export function consumeBar(outputs: readonly OutputEvent[]): string | null {
  let bar: string | null = BAR_MONOID.empty;
  for (const o of outputs) {
    if (o.t === 'bar') bar = BAR_MONOID.concat(bar, o.text);
  }
  return bar;
}

export function initialState(file: string, text: string, sig: string, height: number): State {
  const boot = projectView('', text);
  return {
    sig,
    oldText: '',
    text,
    view: boot.view,
    damage: {},
    lineIds: boot.lineIds,
    row: 0,
    col: 0,
    follow: true,
    editing: false,
    pendingCount: null,
    pendingG: false,
    pendingZ: false,
    pendingZLower: false,
    cycle: -1,
    cursor: Math.max(0, boot.view.length - 1), // ultimate visible line at startup
    search: { active: false, query: '', backward: false, lastQuery: '', lastDir: 'fwd', anchor: 0 },
    cmd: { active: false, buffer: '' },
    scheme: 'normal',
    generation: 0,
    height,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function maxRow(s: State): number {
  return Math.max(0, s.view.length - s.height);
}

function moveRows(s: State, delta: number): State {
  // while following, the effective scroll position is the tail — materialize
  // it so the first scroll away from the tail moves one row from THERE,
  // not from the stale state.row (the jump-to-beginning bug)
  const base = s.follow ? maxRow(s) : s.row;
  const row = clamp(base + delta, 0, maxRow(s));
  // the cursor rides the viewport: it is always the ULTIMATE VISIBLE line
  // of the text file while scrolling (explicit placements come from gg/G/space)
  const cursor = Math.min(row + s.height - 1, s.view.length - 1);
  return { ...s, row, cursor, follow: false };
}

function moveCols(s: State, delta: number): State {
  return { ...s, col: Math.max(0, s.col + delta) };
}

function clearPending(s: State): State {
  return { ...s, pendingCount: null, pendingG: false, pendingZ: false, pendingZLower: false };
}

/**
 * Rows damaged in this session, in file order: ghost rows, rows with live
 * diff damage, and unchanged rows carrying accumulated damage-memo entries.
 */
export function damagedRows(s: State): readonly number[] {
  const out: number[] = [];
  for (let r = 0; r < s.view.length; r += 1) {
    const vl = s.view[r];
    if (!vl) continue;
    if (vl.ghost || vl.segs.some((sg) => sg.kind !== 'same')) {
      out.push(r);
      continue;
    }
    const memo = s.damage[vl.id];
    if (memo && memo !== 'same') out.push(r);
  }
  return out;
}

/** SPACE: jump the modification-event anchor to the NEXT damaged row
 * (wrap-around) and centre the viewport on it. */
function jumpDamage(s: State): State {
  const rows = damagedRows(s);
  if (rows.length === 0) return clearPending(s);
  const cycle = (s.cycle + 1 + rows.length) % rows.length;
  const target = rows[cycle] ?? 0;
  const row = clamp(target - Math.floor((s.height - 1) / 2), 0, maxRow(s));
  return { ...clearPending(s), cycle, row, cursor: target, follow: false };
}

/** ZZ-lower (zz): navigate to the PREVIOUS modification event (reverse
 * direction, wrap-around) and centre the viewport on it. */
function previousDamage(s: State): State {
  const rows = damagedRows(s);
  if (rows.length === 0) return clearPending(s);
  const cycle = s.cycle < 0 ? rows.length - 1 : (s.cycle - 1 + rows.length) % rows.length;
  const target = rows[cycle] ?? 0;
  const row = clamp(target - Math.floor((s.height - 1) / 2), 0, maxRow(s));
  return { ...clearPending(s), cycle, row, cursor: target, follow: false };
}

function countOf(s: State): number {
  return s.pendingCount ?? 1;
}

/** Plain text of a view row (ghosts included; callers may skip ghosts). */
export function lineText(segs: readonly { text: string }[]): string {
  let out = '';
  for (const seg of segs) out += seg.text;
  return out;
}

function findMatch(s: State, query: string, from: number, backward: boolean): number {
  if (query.length === 0) return s.row;
  const last = s.view.length - 1;
  if (backward) {
    for (let r = from; r >= 0; r -= 1) {
      const vl = s.view[r];
      if (vl && !vl.ghost && lineText(vl.segs).includes(query)) return r;
    }
    for (let r = last; r > from && r >= 0; r -= 1) {
      const vl = s.view[r];
      if (vl && !vl.ghost && lineText(vl.segs).includes(query)) return r;
    }
    return s.row;
  }
  for (let r = from; r <= last; r += 1) {
    const vl = s.view[r];
    if (vl && !vl.ghost && lineText(vl.segs).includes(query)) return r;
  }
  for (let r = 0; r <= last && r <= from; r += 1) {
    const vl = s.view[r];
    if (vl && !vl.ghost && lineText(vl.segs).includes(query)) return r;
  }
  return s.row;
}

function onSearchKey(key: InputEvent & { t: 'key' }, s: State): Transition {
  const k = key.key;
  if (k.t === 'named') {
    if (k.k === 'escape') {
      // cancel: restore the anchored position and the normal scheme
      return {
        state: modalEnter(clearPending({ ...s, row: s.search.anchor, search: { ...s.search, active: false, query: '' } }), 'normal'),
        outputs: [],
      };
    }
    if (k.k === 'backspace') {
      const query = s.search.query.slice(0, -1);
      const row = query.length > 0
        ? findMatch(s, query, s.search.backward ? s.search.anchor - 1 : s.search.anchor + 1, s.search.backward)
        : s.search.anchor;
      return { state: { ...s, row, search: { ...s.search, query } }, outputs: [] };
    }
    if (k.k === 'ctrl-c' || k.k === 'ctrl-d') {
      return { state: clearPending(s), outputs: [{ t: 'exit', code: 0 }] };
    }
    if (k.k === 'enter') {
      // live preview already positioned the viewport; just commit the query
      const search = {
        active: false,
        query: '',
        backward: s.search.backward,
        lastQuery: s.search.query,
        lastDir: s.search.backward ? 'bwd' : 'fwd',
        anchor: s.row,
      } as const;
      return { state: modalEnter(clearPending({ ...s, search }), 'normal'), outputs: [] };
    }
    return { state: s, outputs: [] };
  }
  // printable: grow the query and live-preview the closest match
  const query = s.search.query + k.c;
  const from = s.search.backward ? s.search.anchor - 1 : s.search.anchor + 1;
  const row = findMatch(s, query, from, s.search.backward);
  return {
    state: { ...s, row, follow: false, search: { ...s.search, query } },
    outputs: [],
  };
}

function onNormalKey(key: InputEvent & { t: 'key' }, s: State): Transition {
  const k = key.key;
  if (k.t === 'named') {
    switch (k.k) {
      case 'escape':
        return { state: clearPending(s), outputs: [{ t: 'exit', code: 0 }] };
      case 'ctrl-c':
      case 'ctrl-d':
        return { state: clearPending(s), outputs: [{ t: 'exit', code: 0 }] };
      case 'ctrl-e':
        return { state: clearPending(moveRows(s, countOf(s))), outputs: [] };
      case 'ctrl-y':
        return { state: clearPending(moveRows(s, -countOf(s))), outputs: [] };
      case 'down':
        return { state: clearPending(moveRows(s, countOf(s))), outputs: [] };
      case 'up':
        return { state: clearPending(moveRows(s, -countOf(s))), outputs: [] };
      case 'right':
        return { state: clearPending(moveCols(s, countOf(s))), outputs: [] };
      case 'left':
        return { state: clearPending(moveCols(s, -countOf(s))), outputs: [] };
      case 'backspace':
      case 'enter':
        return { state: clearPending(s), outputs: [] };
      default:
        return { state: s, outputs: [] };
    }
  }

  const c = k.c;

  // count prefix (e.g. 5j, 42gg); bare 0 homes the column
  if (c >= '1' && c <= '9') {
    const base = s.pendingCount ?? 0;
    return { state: { ...s, pendingCount: base * 10 + Number(c) }, outputs: [] };
  }
  if (c === '0' && s.pendingCount === null) {
    return { state: clearPending({ ...s, col: 0 }), outputs: [] };
  }
  if (c >= '0' && c <= '9') {
    const base = s.pendingCount ?? 0;
    return { state: { ...s, pendingCount: base * 10 }, outputs: [] };
  }

  switch (c) {
    case 'Z': {
      if (s.pendingZ) {
        // ZZ: vim's "write & quit" — a viewer has nothing to write, so
        // commit means: hand the file to the editor (effect published,
        // interpreted by the runtime)
        return { state: clearPending(s), outputs: [{ t: 'editor' }] };
      }
      return { state: { ...s, pendingZ: true, pendingCount: null, pendingG: false }, outputs: [] };
    }
    case 'Q': {
      if (s.pendingZ) {
        return { state: clearPending(s), outputs: [{ t: 'exit', code: 0 }] };
      }
      return { state: clearPending(s), outputs: [] };
    }
    case ':':
      return { state: modalEnter(clearPending({ ...s, cmd: { active: true, buffer: '' } }), 'command-line'), outputs: [] };
    case 'q':
      return { state: clearPending(s), outputs: [{ t: 'exit', code: 0 }] };
    case 'z': {
      if (s.pendingZLower) {
        return { state: previousDamage(s), outputs: [] };
      }
      return { state: { ...s, pendingZLower: true, pendingCount: null, pendingG: false, pendingZ: false }, outputs: [] };
    }
    case ' ':
      return { state: jumpDamage(s), outputs: [] };
    case 'j':
      return { state: clearPending(moveRows(s, countOf(s))), outputs: [] };
    case 'k':
      return { state: clearPending(moveRows(s, -countOf(s))), outputs: [] };
    case 'h':
      return { state: clearPending(moveCols(s, -countOf(s))), outputs: [] };
    case 'l':
      return { state: clearPending(moveCols(s, countOf(s))), outputs: [] };
    case 'g': {
      if (s.pendingG) {
        const target = s.pendingCount === null ? 0 : clamp(s.pendingCount - 1, 0, maxRow(s));
        return { state: clearPending({ ...s, row: target, cursor: target, follow: false }), outputs: [] };
      }
      return { state: { ...s, pendingCount: s.pendingCount, pendingG: true }, outputs: [] };
    }
    case 'G': {
      if (s.pendingCount !== null) {
        const target = clamp(s.pendingCount - 1, 0, maxRow(s));
        return { state: clearPending({ ...s, row: target, cursor: target, follow: false }), outputs: [] };
      }
      const cursor = s.view.length - 1;
      return { state: clearPending({ ...s, row: maxRow(s), cursor, follow: true }), outputs: [] };
    }
    case 'n': {
      if (s.search.lastQuery.length === 0) return { state: clearPending(s), outputs: [] };
      const row = findMatch(s, s.search.lastQuery, s.row + 1, false);
      return { state: clearPending({ ...s, row, follow: false }), outputs: [] };
    }
    case 'N': {
      if (s.search.lastQuery.length === 0) return { state: clearPending(s), outputs: [] };
      const row = findMatch(s, s.search.lastQuery, s.row - 1, true);
      return { state: clearPending({ ...s, row, follow: false }), outputs: [] };
    }
    case '/':
      return { state: modalEnter(clearPending({ ...s, search: { ...s.search, active: true, query: '', backward: false, anchor: s.follow ? maxRow(s) : s.row } }), 'search-forward'), outputs: [] };
    case '?':
      return { state: modalEnter(clearPending({ ...s, search: { ...s.search, active: true, query: '', backward: true, anchor: s.follow ? maxRow(s) : s.row } }), 'search-backward'), outputs: [] };
    default:
      return { state: clearPending(s), outputs: [] };
  }
}

/**
 * The filesystem event-bus filter: picks out reported file updates and
 * dedupes them against the signature already on screen. Returns the view
 * patches describing which on-screen state changes each update produces.
 */
export function isFileUpdate(event: InputEvent): boolean {
  return event.t === 'file';
}

export function projectFileEvents(events: readonly InputEvent[], currentSig: string): readonly ViewPatch[] {
  const patches: ViewPatch[] = [];
  const seen = new Set<string>();
  for (const ev of events) {
    if (ev.t !== 'file') continue;
    if (ev.sig === currentSig || seen.has(ev.sig)) continue;
    seen.add(ev.sig);
    const newRowCount = ev.text.length > 0 ? ev.text.split('\n').length : 0;
    patches.push({ t: 'diff-applied', sig: ev.sig, newRowCount });
  }
  return patches;
}

function onFileUpdate(event: InputEvent & { t: 'file' }, s: State): Transition {
  if (event.sig === s.sig) return { state: s, outputs: [] };
  const projection = projectView(s.text, event.text, { damage: s.damage, lineIds: s.lineIds });
  const view = projection.view;
  const next: State = {
    ...s,
    sig: event.sig,
    oldText: s.text,
    text: event.text,
    view,
    damage: { ...projection.damage },
    lineIds: projection.lineIds,
  };
  const withFollow: State = next.follow
    ? { ...next, row: Math.max(0, view.length - s.height), cursor: Math.max(0, view.length - 1) }
    : { ...next, row: clamp(next.row, 0, maxRow(next)), cursor: clamp(next.cursor, 0, Math.max(0, view.length - 1)) };
  return { state: withFollow, outputs: [] };
}

/** Pure reducer: one input event -> new state + published output events. */
export function reduce(event: InputEvent, s: State): Transition {
  if (event.t === 'file') return onFileUpdate(event, s);
  // dispatch through the current input scheme (the modal monad's source of
  // truth); search directions share one handler parameterized by the state
  switch (currentScheme(s)) {
    case 'command-line':
      return onCmdKey(event, s);
    case 'search-forward':
    case 'search-backward':
      return onSearchKey(event, s);
    default:
      return onNormalKey(event, s);
  }
}

const QUIT_COMMANDS: readonly string[] = ['q', 'q!', 'wq', 'wq!', 'x', 'exit', 'quit'];

function onCmdKey(event: InputEvent & { t: 'key' }, s: State): Transition {
  const k = event.key;
  if (k.t === 'named') {
    if (k.k === 'escape') {
      return { state: modalEnter(clearPending({ ...s, cmd: { active: false, buffer: '' } }), 'normal'), outputs: [] };
    }
    if (k.k === 'backspace') {
      return { state: { ...s, cmd: { active: true, buffer: s.cmd.buffer.slice(0, -1) } }, outputs: [] };
    }
    if (k.k === 'ctrl-c' || k.k === 'ctrl-d') {
      return { state: clearPending(s), outputs: [{ t: 'exit', code: 0 }] };
    }
    if (k.k === 'enter') {
      const command = s.cmd.buffer.trim();
      if (QUIT_COMMANDS.includes(command)) {
        return { state: clearPending(s), outputs: [{ t: 'exit', code: 0 }] };
      }
      // unknown command: close the line silently (bar wipes), normal scheme
      return { state: modalEnter(clearPending({ ...s, cmd: { active: false, buffer: '' } }), 'normal'), outputs: [] };
    }
    return { state: s, outputs: [] };
  }
  return { state: { ...s, cmd: { active: true, buffer: s.cmd.buffer + k.c } }, outputs: [] };
}

function visualKey(s: State): string {
  // every state dimension that can change what is painted — including the
  // follow flag (a gg on startup only flips follow!) and the pending
  // operators whose modals must repaint the bar
  return `${s.sig}|${s.row}|${s.col}|${s.view.length}|${s.text.length}|${s.follow ? 1 : 0}|${s.search.active ? 1 : 0}|${s.search.query}|${s.cmd.active ? 1 : 0}|${s.cmd.buffer}|${s.pendingCount ?? ''}|${s.pendingG ? 1 : 0}|${s.pendingZ ? 1 : 0}|${s.editing ? 1 : 0}`;
}

/**
 * The monoidal transformer: folds a batch of input events through the
 * reducer, accumulating published output events under the free-monoid
 * concat. When the fold changes what is on screen (content, scroll, or the
 * bar), a frame event plus a bar fragment are published — the runtime
 * interprets the collected outputs through their monoidal consumers.
 */
export function transduce(state: State, events: readonly InputEvent[]): Transition {
  let st = state;
  let outputs: readonly OutputEvent[] = OUTPUT_MONOID.empty;
  for (const ev of events) {
    const t = reduce(ev, st);
    st = t.state;
    outputs = OUTPUT_MONOID.concat(outputs, t.outputs);
  }
  let exiting = false;
  for (const o of outputs) {
    if (o.t === 'exit') exiting = true;
  }
  if (!exiting && visualKey(st) !== visualKey(state)) {
    outputs = OUTPUT_MONOID.concat(outputs, [
      { t: 'frame', text: renderFrame(st) },
      { t: 'bar', text: renderBar(st) },
    ]);
  }
  return { state: st, outputs };
}

// --- event bus -------------------------------------------------------------

/** Minimal in-memory bus; producers enqueue, the runtime loop drains. */
export interface EventBus {
  readonly pending: InputEvent[];
}

export function createBus(): EventBus {
  return { pending: [] };
}

export function publish(bus: EventBus, events: readonly InputEvent[]): number {
  for (const ev of events) bus.pending.push(ev);
  return bus.pending.length;
}

export function drain(bus: EventBus): readonly InputEvent[] {
  const drained = bus.pending.slice();
  bus.pending.length = 0;
  return drained;
}
