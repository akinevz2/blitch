// Editor-suspended: ZZ handed the file to $EDITOR (core.ts:206). The
// runtime tears down the TUI and owns the screen while the editor runs,
// so this condition is carried as the `editing` flag on State (set by the
// runtime when it suspends/resumes) rather than being reducer-driven.
// When flagged, the bar names the suspension instead of silently
// reverting to the idle prefix.
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';
import { bar, type StatusModal } from './modal.ts';

export function matches(state: State): boolean {
  return state.editing;
}

export function render(_state: State): string {
  return bar('[editing]');
}

export const modal: StatusModal = { name: 'editor', matches, render };
