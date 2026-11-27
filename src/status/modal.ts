// Shared contract for status-bar modals. One modal per status condition
// (see the status-condition enumeration): a modal either owns the bar for
// a given State or it does not. The registry in index.ts walks the modals
// in reduce()-mode precedence order and renders the first match.
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';

/** One status condition that can own the bottom bar. */
export interface StatusModal {
  /** Registry/debug name, e.g. 'pending-g'. */
  readonly name: string;
  /** Whether this modal owns the bar for this state. */
  readonly matches: (state: State) => boolean;
  /** The bar line for this condition. */
  readonly render: (state: State) => string;
}

export const REVERSE = '\u001b[7m';
export const RESET = '\u001b[0m';

/** House-style bar line: reverse-video `blitch:` prefix + payload. */
export function bar(payload: string): string {
  return REVERSE + 'blitch:' + payload + RESET;
}

/**
 * Temporal-marker suffix: ` +a -g ~r` counting green additions, red ghost
 * rows and yellow replacement ropes in the view. Empty when the view is
 * clean.
 */
export function diffSuffix(state: State): string {
  let adds = 0;
  let ghosts = 0;
  let repls = 0;
  for (const line of state.view) {
    if (line.ghost) {
      ghosts += 1;
      continue;
    }
    for (const seg of line.segs) {
      if (seg.kind === 'add') adds += 1;
      if (seg.kind === 'repl') repls += 1;
    }
  }
  let out = '';
  if (adds > 0) out += ' +' + String(adds);
  if (ghosts > 0) out += ' -' + String(ghosts);
  if (repls > 0) out += ' ~' + String(repls);
  return out;
}

/** Horizontal-offset suffix ` →{col}`; empty at column zero. */
export function colSuffix(state: State): string {
  return state.col > 0 ? ' \u2192' + String(state.col) : '';
}
