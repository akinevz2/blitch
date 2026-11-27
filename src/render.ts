// Pure frame builder: cat-identical output, colour codes are the only
// transformation. Green = added bytes, red = deleted tokens/ghost ropes,
// yellow = replaced ropes. No margins, no line numbers, no chrome.

import type { Seg, State } from './types.ts';
import { renderStatusBar } from './status/index.ts';

const GREEN = '\u001b[32m';
const RED = '\u001b[31m';
const YELLOW = '\u001b[33m';
/** deleted damage: red background, black foreground (block-out, not ink) */
const DEL_STYLE = '\u001b[41;30m';
const DIM = '\u001b[2m';
const REVERSE = '\u001b[7m';
const RESET = '\u001b[0m';
const CLEAR_EOL = '\u001b[K';

function colorFor(kind: Seg['kind']): string {
  if (kind === 'add') return GREEN;
  if (kind === 'del') return DEL_STYLE; // boundary tokens: red bg, black fg
  if (kind === 'repl') return YELLOW;
  return '';
}

function pushPiece(push: (s: string) => void, text: string, color: string, highlight: string | null): void {
  if (text.length === 0) return;
  if (!highlight || !text.includes(highlight)) {
    push(color + text + (color.length > 0 ? RESET : ''));
    return;
  }
  // match highlight: reverse-video background, same style as the bar
  const parts = text.split(highlight);
  for (let i = 0; i < parts.length; i += 1) {
    if (i > 0) push(color + REVERSE + highlight + RESET);
    const part = parts[i] ?? '';
    if (part.length > 0) push(color + part + (color.length > 0 ? RESET : ''));
  }
}

function renderRow(segs: readonly Seg[], col: number, highlight: string | null): string {
  let out = '';
  const push = (s: string): void => {
    out += s;
  };
  let skip = col; // horizontal scroll: drop this many leading columns
  for (const seg of segs) {
    if (skip >= seg.text.length) {
      skip -= seg.text.length;
      continue;
    }
    const text = seg.text.slice(Math.max(0, skip));
    skip = 0;
    if (text.length === 0) continue;
    if (seg.kind === 'repl') {
      // replacement rope: the rope's NEW content, yellow — previous content
      // is omitted (this is a blitted damage map, not a side-by-side diff)
      pushPiece(push, text, YELLOW, highlight);
      continue;
    }
    pushPiece(push, text, colorFor(seg.kind), highlight);
  }
  return out + CLEAR_EOL;
}

/** The bottom bar: dispatches to the status-modal registry (see
 * src/status/index.ts). The name and signature are stable — the runtime
 * consumes this through the bar output channel unchanged. */
export function renderBar(state: State): string {
  return renderStatusBar(state);
}

/** Build the visible frame: exactly `height` rows of the view, cat-style. */
export function renderFrame(state: State): string {
  const height = Math.max(1, state.height);
  const maxRow = Math.max(0, state.view.length - height);
  const row = state.follow ? maxRow : Math.min(state.row, maxRow);
  const highlight = state.search.active
    ? (state.search.query.length > 0 ? state.search.query : null)
    : (state.search.lastQuery.length > 0 ? state.search.lastQuery : null);
  const rows: string[] = [];
  for (let i = row; i < row + height && i < state.view.length; i += 1) {
    const vl = state.view[i];
    if (!vl) continue;
    rows.push(renderRow(vl.segs, state.col, highlight));
  }
  return rows.join('\n');
}
