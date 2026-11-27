// The cursor monad: the cursor is always at the ULTIMATE VISIBLE line of
// the text file — the last row of the viewport — and serves as the anchor
// for opening the editor. Pure: reads State, yields the cursor position
// (view row + ghost-mapped file line). The runtime interprets it.

import { modalBind, modalOf, modalRead, type Modal } from './modal.ts';
import type { State } from './types.ts';

export interface Cursor {
  /** view row (includes ghosts) the cursor sits on */
  readonly viewRow: number;
  /** 1-based FILE line number — ghost rows are skipped (they do not exist
   * in the file; deletion damage is never forwarded to the editor) */
  readonly fileLine: number;
  /** viewport top view row — for computing the cursor's screen row */
  readonly viewportTop: number;
}

/** The cursor's view row: the tracked cursor, clamped into the viewport. */
export function cursorRow(s: State): number {
  const maxRow = Math.max(0, s.view.length - s.height);
  const top = s.follow ? maxRow : Math.min(s.row, maxRow);
  const cursor = s.cursor >= 0 ? s.cursor : top + s.height - 1;
  return Math.max(top, Math.min(cursor, Math.min(top + s.height - 1, s.view.length - 1)));
}

/** Map a view row onto the file's 1-based line numbering, skipping ghosts. */
function fileLineOf(s: State, viewRow: number): number {
  let n = 0;
  for (let r = 0; r <= viewRow; r += 1) {
    const vl = s.view[r];
    if (vl && !vl.ghost) n += 1;
  }
  return n;
}

/** The modal monad reading the cursor out of the viewer state. */
export function cursorMonad(): Modal<Cursor> {
  return modalBind(modalRead(), (s: State): Modal<Cursor> => {
    const maxRow = Math.max(0, s.view.length - s.height);
    const viewportTop = s.follow ? maxRow : Math.min(s.row, maxRow);
    const viewRow = Math.max(viewportTop, Math.min(s.cursor >= 0 ? s.cursor : viewportTop + s.height - 1, Math.min(viewportTop + s.height - 1, s.view.length - 1)));
    return {
      run: (): readonly [Cursor, State] => [{ viewRow, fileLine: fileLineOf(s, viewRow), viewportTop }, s],
    };
  });
}
