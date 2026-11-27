// The modal monad: tracks the current input scheme (mode) and the event
// generation it produces. Modal<A> is the state monad specialised to the
// viewer: a pure function from State to a value plus the next State.
// Scheme transitions (entering a mode) bump the event generation so stale
// input batches can be detected and dropped.

import type { InputScheme, State } from './types.ts';

export interface Modal<A> {
  readonly run: (s: State) => readonly [A, State];
}

/** lift: a value with no state effect. */
export function modalOf<A>(a: A): Modal<A> {
  return { run: (s: State): readonly [A, State] => [a, s] };
}

/** read the current state into the value position. */
export function modalRead(): Modal<State> {
  return { run: (s: State): readonly [State, State] => [s, s] };
}

export function modalBind<A, B>(m: Modal<A>, f: (a: A) => Modal<B>): Modal<B> {
  return {
    run: (s: State): readonly [B, State] => {
      const [a, s2] = m.run(s);
      return f(a).run(s2);
    },
  };
}

export function modalThen<A>(m: Modal<A>, next: Modal<A>): Modal<A> {
  return modalBind(m, (_: A) => next);
}

/** Derived scheme of a state — the single source of truth for dispatch. */
export function currentScheme(s: State): InputScheme {
  if (s.cmd.active) return 'command-line';
  if (s.search.active) return s.search.backward ? 'search-backward' : 'search-forward';
  return 'normal';
}

/**
 * Enter a scheme: caches it on the state and bumps the event generation.
 * The mode booleans (cmd.active / search.active) are set by the caller's
 * transition data — this helper guarantees scheme and generation move
 * together with them.
 */
export function modalEnter(s: State, scheme: InputScheme): State {
  return { ...s, scheme, generation: s.generation + 1 };
}
