// The monoid used by the transformer, plus the free monoid over arrays.

export interface Monoid<T> {
  readonly empty: T;
  readonly concat: (a: T, b: T) => T;
}

/** Free monoid over lists: identity is `[]`, composition is concatenation. */
export function arrayMonoid<T>(): Monoid<readonly T[]> {
  return {
    empty: [],
    concat: (a: readonly T[], b: readonly T[]): readonly T[] => a.concat(b),
  };
}

/**
 * Last-write-wins monoid: identity is `null` (nothing published yet),
 * concat keeps the rightmost publication. This is the monoid of "current
 * status" — exactly what a bottom bar is.
 */
export function lastMonoid<T>(): Monoid<T | null> {
  return {
    empty: null,
    concat: (a: T | null, b: T | null): T | null => (b === null ? a : b),
  };
}
