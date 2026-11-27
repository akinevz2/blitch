// The editor monad: an editor launch is a monadic program over the viewer
// state — it READS the viewport position and produces an invocation
// description (pure data). The runtime is the interpreter: it executes the
// argv and resumes the TUI. Nothing here touches the world.

import { modalBind, modalOf, type Modal } from './modal.ts';
import { cursorMonad, type Cursor } from './cursor.ts';
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

/** The argv that opens `file` at `line` (1-based) for this editor kind,
 * aligning vim's viewport so the cursor line sits at the same SCREEN row
 * blitch showed it at (`z{count}<CR>` — count = 1-based screen line). */
export function editorCommand(editor: string, file: string, line: number, screenRow: number = 1): readonly string[] {
  const kind = editorKind(editor);
  if (kind === 'vim-family') {
    return [editor, '+' + String(line), '-c', 'normal! z' + String(Math.max(1, screenRow)) + '\r', file];
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

export type { Cursor } from './cursor.ts';

/**
 * The monadic editor program: reads the current viewer state and produces
 * the invocation — opening the editor at the FILE line under the viewport
 * top. Ghost rows are damage markers that do not exist in the file, so the
 * view row index must be mapped onto the file's line numbering (deletion
 * damage is never forwarded to the editor).
 */
export function editorProgram(editor: string, file: string): Modal<EditorInvocation> {
  return modalBind(cursorMonad(), (cursor: Cursor): Modal<EditorInvocation> => {
    const screenRow = cursor.viewRow - cursor.viewportTop + 1; // 1-based screen line
    return modalOf({
      kind: editorKind(editor),
      line: cursor.fileLine,
      argv: editorCommand(editor, file, cursor.fileLine, screenRow),
    });
  });
}
