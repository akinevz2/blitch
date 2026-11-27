// Unit tests for the modal monad: monad laws, scheme detection, generation
// bumps on scheme entry, and dispatch parity with the boolean transitions.

import { describe, expect, test } from 'bun:test';
import { initialState, reduce, transduce } from './core.ts';
import { currentScheme, modalBind, modalOf, modalRead, modalThen, modalEnter, type Modal } from './modal.ts';
import type { InputEvent, State } from './types.ts';

const LINES: string[] = Array.from({ length: 50 }, (_: undefined, i: number): string => `line${i + 1}`);

function makeState(): State {
  return initialState('f', LINES.join('\n'), 'sig', 10);
}

function ch(c: string): InputEvent {
  return { t: 'key', key: { t: 'ch', c } };
}

function feed(state: State, events: readonly InputEvent[]): State {
  return transduce(state, events).state;
}

describe('modal monad laws', () => {
  test('left identity: modalOf(a) then f === f(a)', () => {
    const f = (x: number): Modal<number> => modalOf(x * 2);
    const [left] = modalBind(modalOf(21), f).run(makeState());
    const [right] = f(21).run(makeState());
    expect(left).toBe(right);
  });

  test('right identity: m then modalOf === m', () => {
    const left = modalBind(modalRead(), (a: State): Modal<State> => modalOf(a));
    const [lv, ls] = left.run(makeState());
    const [rv, rs] = modalRead().run(makeState());
    expect(lv).toEqual(rv);
    expect(ls).toEqual(rs);
  });

  test('associativity: (m then f) then g === m then (f then g)', () => {
    const f = (x: number): Modal<number> => modalOf(x + 1);
    const g = (x: number): Modal<number> => modalOf(x * 3);
    const left = modalBind(modalBind(modalOf(1), f), g);
    const right = modalBind(modalOf(1), (x: number) => modalBind(f(x), g));
    const [lv, ls] = left.run(makeState());
    const [rv, rs] = right.run(makeState());
    expect(lv).toBe(rv);
    expect(ls).toEqual(rs);
  });
});

describe('input scheme tracking', () => {
  test('startup is the normal scheme, generation 0', () => {
    const s = makeState();
    expect(currentScheme(s)).toBe('normal');
    expect(s.scheme).toBe('normal');
    expect(s.generation).toBe(0);
  });

  test('"/" enters search-forward and bumps generation by one', () => {
    const s = feed(makeState(), [ch('/')]);
    expect(currentScheme(s)).toBe('search-forward');
    expect(s.scheme).toBe('search-forward');
    expect(s.generation).toBe(1);
  });

  test('"?" enters search-backward', () => {
    const s = feed(makeState(), [ch('?')]);
    expect(currentScheme(s)).toBe('search-backward');
  });

  test('":" enters command-line', () => {
    const s = feed(makeState(), [ch(':')]);
    expect(currentScheme(s)).toBe('command-line');
  });

  test('committing or cancelling returns to normal and bumps again', () => {
    const committed = feed(makeState(), [ch('/'), ch('x'), { t: 'key', key: { t: 'named', k: 'enter' } }]);
    expect(currentScheme(committed)).toBe('normal');
    expect(committed.generation).toBe(2);
    const cancelled = feed(makeState(), [ch(':'), { t: 'key', key: { t: 'named', k: 'escape' } }]);
    expect(currentScheme(cancelled)).toBe('normal');
    expect(cancelled.generation).toBe(2);
  });

  test('keys within a scheme do not bump the generation', () => {
    const s = feed(makeState(), [ch('/'), ch('a'), ch('b'), ch('c')]);
    expect(s.generation).toBe(1);
    expect(s.search.query).toBe('abc');
  });

  test('modalEnter leaves all other state untouched', () => {
    const s = makeState();
    const entered = modalEnter(s, 'search-backward');
    expect(entered.row).toBe(s.row);
    expect(entered.col).toBe(s.col);
    expect(entered.view).toBe(s.view);
    expect(entered.search).toBe(s.search);
    expect(entered.generation).toBe(s.generation + 1);
  });

  test('reduce dispatch honours the scheme: q is exit in normal but text in search', () => {
    const exited = reduce(ch('q'), makeState());
    expect(exited.outputs.some((o) => o.t === 'exit')).toBe(true);
    const inSearch = feed(makeState(), [ch('/')]);
    const typed = reduce(ch('q'), inSearch);
    expect(typed.outputs.some((o) => o.t === 'exit')).toBe(false);
    expect(typed.state.search.query).toBe('q');
  });
});
