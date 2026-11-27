// Unit tests for the monadic editor program: kind detection, argv shaping
// (vi/vim/neovim +line, vscode --goto), and reading the viewport position.

import { describe, expect, test } from 'bun:test';
import { editorCommand, editorKind, editorProgram } from './editor.ts';
import { initialState } from './core.ts';

const LINES: string[] = Array.from({ length: 50 }, (_: undefined, i: number): string => `line${i + 1}`);

describe('editor kind detection', () => {
  test('vi family detected across names and paths', () => {
    for (const name of ['vim', 'vi', 'nvim', '/usr/bin/vim', 'view', 'VIM']) {
      expect(editorKind(name)).toBe('vim-family');
    }
  });

  test('vscode family detected', () => {
    for (const name of ['code', 'code-insiders', 'codium', '/usr/bin/code']) {
      expect(editorKind(name)).toBe('vscode');
    }
  });

  test('unknown editors are generic', () => {
    expect(editorKind('nano')).toBe('generic');
    expect(editorKind('emacs')).toBe('generic');
  });
});

describe('editor argv shaping', () => {
  test('vim-family opens at +line', () => {
    expect(editorCommand('vim', 'f.txt', 42)).toEqual(['vim', '+42', 'f.txt']);
    expect(editorCommand('nvim', 'f.txt', 7)).toEqual(['nvim', '+7', 'f.txt']);
  });

  test('vscode opens via --goto file:line', () => {
    expect(editorCommand('code', 'f.txt', 42)).toEqual(['code', '--goto', 'f.txt:42']);
  });

  test('generic editors receive just the file', () => {
    expect(editorCommand('nano', 'f.txt', 42)).toEqual(['nano', 'f.txt']);
  });
});

describe('monadic editor program', () => {
  test('reads the followed tail as the target line', () => {
    const s = initialState('f', LINES.join('\n'), 'sig', 10); // follows: viewport top row 40
    const [invocation] = editorProgram('vim', 'f.txt').run(s);
    expect(invocation.line).toBe(41); // 1-based
    expect(invocation.argv).toEqual(['vim', '+41', 'f.txt']);
  });

  test('reads a manual scroll position unfollowed', () => {
    const s = initialState('f', LINES.join('\n'), 'sig', 10);
    const moved = { ...s, row: 12, follow: false };
    const [invocation] = editorProgram('code', 'f.txt').run(moved);
    expect(invocation.line).toBe(13);
    expect(invocation.argv).toEqual(['code', '--goto', 'f.txt:13']);
  });
});
