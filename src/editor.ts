// The editor monad: an editor launch is a monadic program over the viewer
// state — it READS the viewport position and produces an invocation
// description (pure data). The runtime is the interpreter: it executes the
// argv and resumes the TUI. Nothing here touches the world.

import { modalBind, modalOf, modalRead, type Modal } from './modal.ts';
import type { State } from './types.ts';

export type EditorKind = 'vim-family' | 'vscode' | 'generic';

/** Known editors that accept a `+line` argument (vi family). */
const VIM_FAMILY: readonly string[] = ['vi', 'vim', 'nvim', 'view', 'vimdiff', 'elvis', 'vile', 'neovim'];

/** Known editors that accept `--goto file:line` (VS Code family). */
const VSCODE_FAMILY: readonly string[] = ['code', 'code-insiders', 'codium', 'vscode'];

function basename(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1] ?? path;
}

/** Classify the editor command name (paths and case tolerated). */
export function editorKind(editor: string): EditorKind {
  const name = basename(editor).toLowerCase();
  if (VIM_FAMILY.includes(name)) return 'vim-family';
  if (VSCODE_FAMILY.includes(name)) return 'vscode';
  return 'generic';
}

/** The argv that opens `file` at `line` (1-based) for this editor kind. */
export function editorCommand(editor: string, file: string, line: number): readonly string[] {
  const kind = editorKind(editor);
  if (kind === 'vim-family') {
    // +line puts the cursor on the line; `normal! zt` then scrolls that
    // line to the TOP of vim's window — preserving blitch's viewport offset
    return [editor, '+' + String(line), '-c', 'normal! zt', file];
  }
  if (kind === 'vscode') {
    return [editor, '--goto', `${file}:${line}`];
  }
  return [editor, file];
}

export interface EditorInvocation {
  readonly kind: EditorKind;
  readonly line: number;
  readonly argv: readonly string[];
}

/**
 * The monadic editor program: reads the current viewer state and produces
 * the invocation — opening the editor at the FILE line under the viewport
 * top. Ghost rows are damage markers that do not exist in the file, so the
 * view row index must be mapped onto the file's line numbering (deletion
 * damage is never forwarded to the editor).
 */
export function editorProgram(editor: string, file: string): Modal<EditorInvocation> {
  return modalBind(modalRead(), (s: State): Modal<EditorInvocation> => {
    const topRow = s.follow ? Math.max(0, s.view.length - s.height) : s.row;
    let fileLine = 0;
    for (let r = 0; r < topRow; r += 1) {
      const vl = s.view[r];
      if (vl && !vl.ghost) fileLine += 1;
    }
    const line = fileLine + 1; // 1-based editor line
    return modalOf({ kind: editorKind(editor), line, argv: editorCommand(editor, file, line) });
  });
}
