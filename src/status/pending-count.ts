// Pending count prefix: digits 1-9/0 half-typed (e.g. the `5` of `5j`).
// Owns the bar unless a `g` is also pending — pending-g renders the
// count as part of `5g`, so it wins the registry slot when both are set
// (count + g CAN be pending simultaneously: core.ts:231 keeps the count).
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';
import { bar, type StatusModal } from './modal.ts';

export function matches(state: State): boolean {
  return state.pendingCount !== null && !state.pendingG;
}

export function render(state: State): string {
  const count = state.pendingCount === null ? 0 : state.pendingCount;
  return bar(String(count));
}

export const modal: StatusModal = { name: 'pending-count', matches, render };
