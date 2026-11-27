// Pending `g`: the first g of gg is half-typed. Sticks indefinitely until
// the next key (no timeout). A count may be pending alongside it (`5g`),
// and is shown as part of the sequence: `5g` / bare `g`.
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';
import { bar, type StatusModal } from './modal.ts';

export function matches(state: State): boolean {
  return state.pendingG;
}

export function render(state: State): string {
  const count = state.pendingCount === null ? '' : String(state.pendingCount);
  return bar(count + 'g');
}

export const modal: StatusModal = { name: 'pending-g', matches, render };
