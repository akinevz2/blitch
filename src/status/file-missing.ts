// File-missing: the watched file is gone — statSig's sentinel signature
// 'gone' (runtime.ts:146) with the read falling back to '' (the view
// shows red ghosts of the last content). The bar must say so instead of
// pretending everything is idle.
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';
import { bar, type StatusModal } from './modal.ts';

/** The sentinel statSig reports when statSync fails (runtime.ts). */
export const GONE_SIG = 'gone';

export function matches(state: State): boolean {
  return state.sig === GONE_SIG;
}

export function render(_state: State): string {
  return bar('<file gone>');
}

export const modal: StatusModal = { name: 'file-missing', matches, render };
