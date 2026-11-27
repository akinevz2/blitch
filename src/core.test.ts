// Unit tests: every movement keybinding individually, plus the event-bus
// projection and the diff colour semantics. All pure — no tty, no IO.

import { describe, expect, test } from 'bun:test';
import { initialState, projectFileEvents, reduce, transduce, consumeBar, createBus, publish, drain } from './core.ts';
import { lastMonoid } from './monoid.ts';
import { diffText, projectView } from './diff.ts';
import { renderFrame, renderBar } from './render.ts';
import type { InputEvent, Key, NamedKey, State } from './types.ts';

const LINES: string[] = Array.from({ length: 50 }, (_: undefined, i: number): string => `line${i + 1}`);
const TEXT: string = LINES.join('\n');
const SIG_A = 'sig-a';

function makeState(): State {
  return initialState('file.txt', TEXT, SIG_A, 10); // 50 rows, viewport 10, maxRow 40
}

function ch(c: string): InputEvent {
  return { t: 'key', key: { t: 'ch', c } };
}

function named(k: NamedKey): InputEvent {
  return { t: 'key', key: { t: 'named', k } };
}

function feed(state: State, events: readonly InputEvent[]): State {
  return transduce(state, events).state;
}

function feedKeys(state: State, events: readonly InputEvent[]): State {
  return feed(state, events);
}

function exitCodes(state: State, events: readonly InputEvent[]): number[] {
  return transduce(state, events).outputs
    .filter((o) => o.t === 'exit')
    .map((o) => (o.t === 'exit' ? o.code : -1));
}

// --- j / k -----------------------------------------------------------------

describe('j (and Down) vertical scroll', () => {
  test('j at the followed tail stays at the tail and unfollows', () => {
    const s = feedKeys(makeState(), [ch('j')]);
    expect(s.row).toBe(40); // maxRow: already at the bottom, j cannot go further
    expect(s.follow).toBe(false);
  });

  test('Down arrow equals j exactly', () => {
    const viaJ = feedKeys(makeState(), [ch('j')]);
    const viaDown = feedKeys(makeState(), [named('down')]);
    expect(viaDown.row).toBe(viaJ.row);
    expect(viaDown.follow).toBe(viaJ.follow);
  });

  test('j clamps at the last viewport row', () => {
    const s = feedKeys(makeState(), [ch('9'), ch('9'), ch('j')]);
    expect(s.row).toBe(40);
  });
});

describe('k (and Up) vertical scroll', () => {
  test('k moves one row up from the followed tail', () => {
    const s = feedKeys(makeState(), [ch('k')]);
    expect(s.row).toBe(39); // maxRow 40, one up
  });

  test('Up arrow equals k exactly', () => {
    const viaK = feedKeys(makeState(), [named('down'), ch('k')]);
    const viaUp = feedKeys(makeState(), [named('down'), named('up')]);
    expect(viaUp.row).toBe(viaK.row);
  });

  test('k clamps at the top row', () => {
    const s = feedKeys(makeState(), [ch('9'), ch('9'), ch('9'), ch('9'), ch('k')]);
    expect(s.row).toBe(0);
  });

  test('scrolling up while following starts from the followed tail, not row 0', () => {
    // regression: initial state is row 0 + follow — the first scroll-up must
    // move one row from the DISPLAYED tail, not jump from row 0
    const s = feedKeys(makeState(), [named('up')]);
    expect(s.row).toBe(39); // maxRow 40, one up
    expect(s.follow).toBe(false);
  });

  test('wheel-up event while following leaves the viewport one row above the tail', () => {
    // the wheel decodes to up/down; same contract as k — the rendered top
    // row must move from the tail
    const before = makeState();
    const maxRow = before.view.length - before.height;
    const after = feedKeys(before, [named('up')]);
    expect(after.row).toBe(maxRow - 1);
    expect(after.follow).toBe(false);
  });
});

// --- h / l (horizontal) ----------------------------------------------------

describe('h / l (and Left / Right) horizontal scroll', () => {
  test('l scrolls right one column', () => {
    const s = feedKeys(makeState(), [ch('l')]);
    expect(s.col).toBe(1);
  });

  test('Right arrow equals l', () => {
    expect(feedKeys(makeState(), [named('right')]).col).toBe(1);
  });

  test('h scrolls left and clamps at column zero', () => {
    const s = feedKeys(makeState(), [ch('l'), ch('l'), ch('l'), ch('h')]);
    expect(s.col).toBe(2);
    const clamped = feedKeys(s, [ch('h'), ch('h'), ch('h')]);
    expect(clamped.col).toBe(0);
  });

  test('Left arrow equals h', () => {
    const moved = feedKeys(makeState(), [ch('l')]);
    const back = feedKeys(moved, [named('left')]);
    expect(back.col).toBe(0);
  });
});

// --- Ctrl-E / Ctrl-Y -------------------------------------------------------

describe('Ctrl-E / Ctrl-Y vertical scroll', () => {
  test('Ctrl-E scrolls down one line', () => {
    const s = feed(makeState(), [named('ctrl-y'), named('ctrl-e')]);
    expect(s.row).toBe(40); // up one from the tail, then back down
    expect(s.follow).toBe(false);
  });

  test('Ctrl-Y scrolls up one line', () => {
    const s = feed(makeState(), [named('ctrl-e'), named('ctrl-e'), named('ctrl-y')]);
    expect(s.row).toBe(39); // up twice from the tail, down once
  });

  test('Ctrl-Y honours a count prefix', () => {
    const s = feed(makeState(), [ch('7'), named('ctrl-y')]);
    expect(s.row).toBe(33); // maxRow 40, seven up
  });
});

// --- vim g motions ---------------------------------------------------------

describe('g motions', () => {
  test('gg goes to the top row', () => {
    const start = feedKeys(makeState(), [ch('j'), ch('j')]);
    const s = feedKeys(start, [ch('g'), ch('g')]);
    expect(s.row).toBe(0);
    expect(s.follow).toBe(false);
  });

  test('32gg jumps to line 32 (row 31)', () => {
    const s = feedKeys(makeState(), [ch('3'), ch('2'), ch('g'), ch('g')]);
    expect(s.row).toBe(31);
  });

  test('gg clamps line requests beyond the tail', () => {
    const s = feedKeys(makeState(), [ch('9'), ch('9'), ch('g'), ch('g')]);
    expect(s.row).toBe(40);
  });

  test('G follows the tail', () => {
    const s = feedKeys(makeState(), [ch('G')]);
    expect(s.row).toBe(40);
    expect(s.follow).toBe(true);
  });

  test('count-prefixed G jumps to that line and unfollows', () => {
    const s = feedKeys(makeState(), [ch('1'), ch('0'), ch('G')]);
    expect(s.row).toBe(9);
    expect(s.follow).toBe(false);
  });

  test('a lone g is pending and other keys cancel it', () => {
    const pending = feedKeys(makeState(), [ch('g')]);
    expect(pending.pendingG).toBe(true);
    const cancelled = feedKeys(pending, [ch('k')]);
    expect(cancelled.pendingG).toBe(false);
    expect(cancelled.row).toBe(39); // plain k from the tail, not gg
  });
});

// --- search ----------------------------------------------------------------

describe('search: / ? n N', () => {
  test('/ enters search mode', () => {
    const s = feedKeys(makeState(), [ch('/')]);
    expect(s.search.active).toBe(true);
    expect(s.search.backward).toBe(false);
  });

  test('? enters backward search mode', () => {
    const s = feedKeys(makeState(), [ch('?')]);
    expect(s.search.active).toBe(true);
    expect(s.search.backward).toBe(true);
  });

  test('typing then Enter commits and jumps live (incsearch)', () => {
    const s = feedKeys(makeState(), [ch('/'), ch('l'), ch('i'), ch('n'), ch('e'), ch('1'), named('enter')]);
    expect(s.search.active).toBe(false);
    expect(s.search.lastQuery).toBe('line1');
    // anchor is the followed tail (row 40): forward scan wraps to the top,
    // where 'line1' first matches at row 0
    expect(s.row).toBe(0);
  });

  test('incsearch preview moves the viewport per keystroke', () => {
    let s = feedKeys(makeState(), [ch('/')]);
    expect(s.search.anchor).toBe(40); // anchored at the followed tail
    expect(s.row).toBe(0); // row untouched until typing starts
    s = feedKeys(s, [ch('l'), ch('i')]);
    expect(s.row).toBe(41); // line42: first match below the tail anchor
    expect(s.follow).toBe(false); // preview must unfollow to be visible
    expect(s.search.active).toBe(true);
  });

  test('cancelling a search restores the anchored position', () => {
    const start = feedKeys(makeState(), [named('up'), named('up')]); // row 38, unfollowed
    const cancelled = feedKeys(start, [ch('/'), ch('x'), ch('y'), named('escape')]);
    expect(cancelled.search.active).toBe(false);
    expect(cancelled.row).toBe(38); // restored from the anchor
  });

  test('? commits a backward search above the viewport', () => {
    const s = feedKeys(makeState(), [ch('?'), ch('l'), ch('i'), ch('n'), ch('e'), ch('5'), named('enter')]);
    // backward search scans upward from the viewport top (anchor 40):
    // nearest row above containing 'line5' is row 4 (line5)
    expect(s.row).toBe(4);
  });

  test('n advances to the next match', () => {
    const after = feedKeys(makeState(), [ch('/'), ch('l'), ch('i'), ch('n'), ch('e'), ch('1'), named('enter')]);
    const s = feedKeys(after, [ch('n')]);
    expect(s.row).toBe(9); // line10: next match after the committed row 0
  });

  test('N goes to the previous match', () => {
    const after = feedKeys(makeState(), [ch('/'), ch('l'), ch('i'), ch('n'), ch('e'), ch('1'), named('enter')]);
    const next = feedKeys(after, [ch('n')]); // row 9
    const s = feedKeys(next, [ch('N')]);
    expect(s.row).toBe(0); // back to the committed match
  });

  test('Escape cancels search mode without exiting', () => {
    const s = feedKeys(makeState(), [ch('/'), ch('x'), named('escape')]);
    expect(s.search.active).toBe(false);
    expect(s.search.query).toBe('');
  });

  test('Backspace edits the query', () => {
    let s = feedKeys(makeState(), [ch('/'), ch('a'), ch('b')]);
    s = feedKeys(s, [named('backspace')]);
    expect(s.search.query).toBe('a');
  });
});

// --- exit keys -------------------------------------------------------------

describe('exit keys', () => {
  test('Escape exits cleanly in normal mode', () => {
    const codes = exitCodes(makeState(), [named('escape')]);
    expect(codes).toEqual([0]);
  });

  test('Ctrl-C exits cleanly', () => {
    const codes = exitCodes(makeState(), [named('ctrl-c')]);
    expect(codes).toEqual([0]);
  });

  test('Ctrl-D exits cleanly', () => {
    const codes = exitCodes(makeState(), [named('ctrl-d')]);
    expect(codes).toEqual([0]);
  });

  test('Ctrl-C exits cleanly even inside search mode', () => {
    const codes = exitCodes(makeState(), [ch('/'), ch('q'), named('ctrl-c')]);
    expect(codes).toEqual([0]);
  });

  test('gg on startup publishes a frame (follow flip must not be frame-dropped)', () => {
    // regression: startup is row 0 + follow — gg only flips follow, and the
    // frame publisher dropped that transition, leaving a stale tail frame
    const t = transduce(makeState(), [ch('g'), ch('g')]);
    expect(t.state.row).toBe(0);
    expect(t.state.follow).toBe(false);
    expect(t.outputs.some((o) => o.t === 'frame')).toBe(true);
  });

  test('pending operators repaint the bar (pending-g / pending-z modals)', () => {
    const g = transduce(makeState(), [ch('g')]);
    expect(consumeBar(g.outputs) ?? '').toContain('blitch:g');
    const z = transduce(makeState(), [ch('Z')]);
    expect(consumeBar(z.outputs) ?? '').toContain('blitch:Z');
    const count = transduce(makeState(), [ch('5')]);
    expect(consumeBar(count.outputs) ?? '').toContain('blitch:5');
  });

  test('solo q exits viewing mode', () => {
    const codes = exitCodes(makeState(), [ch('q')]);
    expect(codes).toEqual([0]);
  });

  test('ZQ exits cleanly', () => {
    const codes = exitCodes(makeState(), [ch('Z'), ch('Q')]);
    expect(codes).toEqual([0]);
  });

  test('ZZ opens the editor (commit) instead of exiting', () => {
    const outs = transduce(makeState(), [ch('Z'), ch('Z')]).outputs;
    expect(outs.some((o) => o.t === 'editor')).toBe(true);
    expect(outs.some((o) => o.t === 'exit')).toBe(false);
  });

  test('Z followed by an unrelated key cancels pendingZ without exiting', () => {
    const codes = exitCodes(makeState(), [ch('Z'), ch('j')]);
    expect(codes).toEqual([]);
  });

  test(':q exits cleanly', () => {
    const codes = exitCodes(makeState(), [ch(':'), ch('q'), named('enter')]);
    expect(codes).toEqual([0]);
  });

  test(':q! exits cleanly', () => {
    const codes = exitCodes(makeState(), [ch(':'), ch('q'), ch('!'), named('enter')]);
    expect(codes).toEqual([0]);
  });

  test(':wq exits cleanly', () => {
    const codes = exitCodes(makeState(), [ch(':'), ch('w'), ch('q'), named('enter')]);
    expect(codes).toEqual([0]);
  });

  test('an unknown : command closes the line without exiting', () => {
    const codes = exitCodes(makeState(), [ch(':'), ch('f'), ch('o'), ch('o'), named('enter')]);
    expect(codes).toEqual([]);
  });

  test(': buffer is visible in the bar while typing', () => {
    const s = feedKeys(makeState(), [ch(':'), ch('q')]);
    expect(renderBar(s)).toContain('blitch:q');
  });

  test(': Esc cancels the command line without exiting', () => {
    const codes = exitCodes(makeState(), [ch(':'), ch('q'), named('escape')]);
    expect(codes).toEqual([]);
  });

  test(': typed inside a search prompt is query text (vim semantics), no exit', () => {
    const codes = exitCodes(makeState(), [ch('/'), ch('x'), ch(':'), ch('q'), named('enter')]);
    expect(codes).toEqual([]);
  });
});

// --- filesystem event-bus projection ----------------------------------------

describe('filesystem event-bus filter and view projection', () => {
  test('projectFileEvents filters to file updates and dedupes signatures', () => {
    const patches = projectFileEvents(
      [
        { t: 'file', sig: 's1', text: 'x' },
        { t: 'file', sig: 's1', text: 'x' }, // duplicate
        { t: 'file', sig: 'sig-a', text: 'x' }, // already on screen
        { t: 'key', key: { t: 'ch', c: 'j' } }, // not a file update
        { t: 'file', sig: 's2', text: 'y' },
      ],
      SIG_A,
    );
    expect(patches.length).toBe(2);
    expect(patches[0]?.sig).toBe('s1');
    expect(patches[1]?.sig).toBe('s2');
  });

  test('same-signature file update is a no-op', () => {
    const t = reduce({ t: 'file', sig: SIG_A, text: TEXT }, makeState());
    expect(t.state).toBe(t.state); // identity: state untouched
    expect(t.outputs.length).toBe(0);
  });

  test('file update re-diffs, emits a frame, and follow keeps the tail', () => {
    const s = makeState();
    const t = transduce(s, [{ t: 'file', sig: 'sig-b', text: TEXT + '\nline51' }]);
    expect(t.state.sig).toBe('sig-b');
    expect(t.state.view.length).toBe(51);
    expect(t.state.follow).toBe(true);
    expect(t.state.row).toBe(41);
    const frames = t.outputs.filter((o) => o.t === 'frame');
    expect(frames.length).toBe(1);
  });

  test('file update unfollowed keeps the scroll row', () => {
    const moved = feedKeys(makeState(), [ch('k'), ch('k')]); // two up from the tail, unfollowed
    const t = reduce({ t: 'file', sig: 'sig-b', text: TEXT + '\nline51' }, moved);
    expect(t.state.follow).toBe(false);
    expect(t.state.row).toBe(38);
  });

  test('bus publish/drain round-trips batches', () => {
    const bus = createBus();
    publish(bus, [{ t: 'file', sig: 's1', text: 'a' }]);
    publish(bus, [{ t: 'file', sig: 's2', text: 'b' }]);
    const batch = drain(bus);
    expect(batch.length).toBe(2);
    expect(drain(bus).length).toBe(0); // drained bus is empty
  });
});

// --- diff colour semantics ---------------------------------------------------

describe('diff semantics', () => {
  test('pure byte addition renders green', () => {
    const segs = diffText('hello', 'hello world');
    const kinds = segs.map((s) => s.kind);
    expect(kinds).toContain('same');
    expect(kinds).toContain('add');
    expect(kinds).not.toContain('del');
    expect(kinds).not.toContain('repl');
  });

  test('pure deletion renders red background + black foreground at token granularity', () => {
    const segs = diffText('hello world', 'hello');
    const del = segs.find((s) => s.kind === 'del');
    expect(del?.text).toBe(' world'); // snapped to the token boundary
    expect(segs.map((s) => s.kind)).not.toContain('repl');
    // damage rendering: block-out style, not ink
    const base = initialState('f', 'hello world', 'sig', 10);
    const frame = renderFrame(reduce({ t: 'file', sig: 'sig2', text: 'hello' }, base).state);
    expect(frame).toContain('\u001b[41;30m world');
  });

  test('rope-level replacement renders yellow carrying only new content', () => {
    const segs = diffText('foo bar', 'foo baz');
    const repl = segs.find((s) => s.kind === 'repl');
    expect(repl).toBeDefined();
    expect(repl?.text).toBe('z'); // the rope's new content; previous omitted
  });

  test('unpaired deleted lines linger as red ghosts clustered at the deletion site', () => {
    const view = projectView('a\nb\nc\nd\ne', 'a\nd\ne');
    const texts = view.map((v) => v.segs.map((s) => s.text).join(''));
    expect(texts).toEqual(['a', 'b', 'c', 'd', 'e']); // ghosts of b and c grouped before d
    expect(view[1]?.ghost).toBe(true);
    expect(view[1]?.segs[0]?.kind).toBe('del');
    expect(view[2]?.ghost).toBe(true);
    expect(view[2]?.segs[0]?.kind).toBe('del');
    expect(view[3]?.ghost).toBe(false);
  });

  test('initial projection is cat-plain (no temporal markers)', () => {
    const view = projectView('', 'a\nb');
    expect(view.every((v) => v.segs.every((s) => s.kind === 'same'))).toBe(true);
  });

  test('bottom bar is a monoidal consumer: live prompt, wiped when inactive', () => {
    const base = initialState('f', 'a\nb\nc', 'sig', 10);
    const typing = { ...base, search: { ...base.search, active: true, query: '150', backward: false } };
    expect(renderBar(typing)).toContain('/150'); // reverse-video prompt content
    expect(renderBar(base)).toBe('\u001b[7mblitch: \u001b[32m*\u001b[39mtail\u001b[0m'); // idle follows the tail (follow modal)
    expect(consumeBar(transduce(typing, []).outputs)).toBeNull(); // still batch: no bar published
    const typed = transduce(typing, [ch('c')]);
    expect(consumeBar(typed.outputs)).toContain('/150c'); // folded last-write-wins
  });

  test('lastMonoid laws: null identity, right bias, associativity', () => {
    const M = lastMonoid<string>();
    expect(M.concat(M.empty, 'x')).toBe('x');
    expect(M.concat('x', M.empty)).toBe('x');
    expect(M.concat('a', 'b')).toBe('b');
    expect(M.concat(M.concat('a', 'b'), 'c')).toBe(M.concat('a', M.concat('b', 'c')));
  });

  test('search matches highlight with reverse video like the bar', () => {
    const base = initialState('f', 'a 150 b\nc', 'sig', 10);
    const committed = { ...base, search: { ...base.search, lastQuery: '150', lastDir: 'fwd' as const, anchor: 0 } };
    expect(renderFrame(committed)).toContain('\u001b[7m150\u001b[0m');
    expect(renderFrame(base)).not.toContain('\u001b[7m150');
  });

  test('replacement rope blits only the new content (previous omitted)', () => {
    // edit 3 -> 2 must visualise as yellow 2 over the untouched rope — the
    // view is a damage map of the file, previous content is NOT rendered
    const base = initialState('f', '132', 'sig', 10);
    const edited = reduce({ t: 'file', sig: 'sig2', text: '122' }, base);
    const frame = renderFrame(edited.state);
    expect(frame).toContain('\u001b[33m2'); // yellow new content at the edit site
    const plain = frame.replace(/\u001b\[[0-9;]*m/g, '').replace(/\u001b\[K/g, '');
    expect(plain).not.toContain('3'); // previous content omitted entirely (escape codes excluded)
    expect(plain).not.toContain('\u001b[2m'); // no shadowing, no diff blobs
  });
});
