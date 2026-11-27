// Follow-the-tail: live tailing (initial state and bare `G`). The bar
// must distinguish live tailing from a manually clamped-at-bottom
// viewport — identical content, different behaviour on file updates
// (core.ts:285 re-pins only when follow). Carries the temporal-marker and
// horizontal-offset suffixes like the idle bar.
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';
import { bar, colSuffix, diffSuffix, type StatusModal } from './modal.ts';

export function matches(state: State): boolean {
  return state.follow;
}

export function render(state: State): string {
  // green ASCII tick: font-safe (no glyph-set assumptions), green fg over
  // the bar's reverse video, restored with \e[39m so reverse persists
  return bar(' \u001b[32m*\u001b[39mtail' + diffSuffix(state) + colSuffix(state));
}

export const modal: StatusModal = { name: 'follow', matches, render };
