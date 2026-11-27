// Command-line mode (`:` typed): the bar is the ex prompt showing the
// buffer as it is typed. Owns the bar whenever cmd.active, mirroring the
// highest-precedence key branch in reduce() (core.ts:292). An empty buffer
// renders a cursor mark so entering the line is visible (the bare `blitch:`
// payload would otherwise be indistinguishable from the idle bar).
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';
import { bar, type StatusModal } from './modal.ts';

export function matches(state: State): boolean {
  return state.cmd.active;
}

export function render(state: State): string {
  return bar(state.cmd.buffer.length > 0 ? state.cmd.buffer : '\u258f');
}

export const modal: StatusModal = { name: 'command-line', matches, render };
