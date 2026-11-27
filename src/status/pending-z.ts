// Pending `Z`: the first Z of ZZ (editor) / ZQ (quit) is half-typed.
// Setting it wipes count and pendingG (core.ts:208), so it always renders
// bare.
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';
import { bar, type StatusModal } from './modal.ts';

export function matches(state: State): boolean {
  return state.pendingZ;
}

export function render(_state: State): string {
  return bar('Z');
}

export const modal: StatusModal = { name: 'pending-z', matches, render };
