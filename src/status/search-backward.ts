// Backward-search typing (`?`): live incremental-search prompt scanning
// upward. Owns the bar whenever search.active with backward=true.
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';
import { bar, type StatusModal } from './modal.ts';

export function matches(state: State): boolean {
  return state.search.active && state.search.backward;
}

export function render(state: State): string {
  return bar('?' + state.search.query);
}

export const modal: StatusModal = { name: 'search-backward', matches, render };
