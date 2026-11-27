// Status-bar registry: an ordered list of status modals, one per status
// condition, dispatched first-match-wins. The order mirrors reduce()'s
// mode precedence (core.ts:290-295) and the pending/ambient conditions
// from the status-condition enumeration:
//
//   command-line > search forward > search backward   (input modes)
//   > editor-suspended                                (runtime suspension)
//   > pending-count / pending-g / pending-z           (half-typed operators)
//   > file-missing                                    (content condition)
//   > follow                                          (viewport condition)
//   > normal/idle                                     (terminal catch-all)
//
// The bar-channel monoidal consumer (consumeBar / BAR_MONOID in core.ts)
// is untouched: modals only shape the string that a published bar event
// carries.
//
// Pure module: no IO tokens (enforced by lint).

import type { State } from '../types.ts';
import * as commandLine from './command-line.ts';
import * as editor from './editor.ts';
import * as fileMissing from './file-missing.ts';
import * as follow from './follow.ts';
import type { StatusModal } from './modal.ts';
import { bar } from './modal.ts';
import * as normal from './normal.ts';
import * as pendingCount from './pending-count.ts';
import * as pendingG from './pending-g.ts';
import * as pendingZ from './pending-z.ts';
import * as searchBackward from './search-backward.ts';
import * as searchForward from './search-forward.ts';

/** Dispatch order: first modal whose matches(state) holds owns the bar. */
export const STATUS_MODALS: readonly StatusModal[] = [
  commandLine.modal,
  searchForward.modal,
  searchBackward.modal,
  editor.modal,
  pendingCount.modal,
  pendingG.modal,
  pendingZ.modal,
  fileMissing.modal,
  follow.modal,
  normal.modal,
];

/** Dispatch: render the first matching modal's bar line for this state. */
export function renderStatusBar(state: State): string {
  for (const modal of STATUS_MODALS) {
    if (modal.matches(state)) return modal.render(state);
  }
  return bar(''); // defensive: normal.modal is the terminal matcher
}
