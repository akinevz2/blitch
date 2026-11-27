// Normal/idle: no mode, no pending operator, no ambient condition. The
// terminal modal — matches everything, so it must sit last in the
// registry. Renders the bare always-prefixed bar plus the view-condition
// suffixes: a bottom-clamped (frozen, non-follow) viewport, temporal
// diff markers, and a non-zero horizontal offset.
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';
import { bar, colSuffix, diffSuffix, eSuffix, type StatusModal } from './modal.ts';

export function matches(_state: State): boolean {
  return true;
}

export function render(state: State): string {
  const maxRow = Math.max(0, state.view.length - state.height);
  const atBottom = !state.follow && state.view.length > state.height && state.row >= maxRow;
  return bar((atBottom ? ' [bottom]' : '') + diffSuffix(state) + eSuffix(state) + colSuffix(state));
}

export const modal: StatusModal = { name: 'normal', matches, render };
