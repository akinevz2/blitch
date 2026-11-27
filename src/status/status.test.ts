// Status-modal tests: one test per modal file asserting its bar rendering
// and its matches() boundary (one condition it owns, one it must not),
// plus the registry dispatch order. All pure — no tty, no IO.

import { describe, expect, test } from 'bun:test';
import { initialState } from '../core.ts';
import type { State } from '../types.ts';
import { modal as commandLine } from './command-line.ts';
import { modal as editor } from './editor.ts';
import { modal as fileMissing } from './file-missing.ts';
import { modal as follow } from './follow.ts';
import { renderStatusBar, STATUS_MODALS } from './index.ts';
import type { StatusModal } from './modal.ts';
import { modal as normal } from './normal.ts';
import { modal as pendingCount } from './pending-count.ts';
import { modal as pendingG } from './pending-g.ts';
import { modal as pendingZ } from './pending-z.ts';
import { modal as searchBackward } from './search-backward.ts';
import { modal as searchForward } from './search-forward.ts';

const LINES: string[] = Array.from({ length: 50 }, (_: undefined, i: number): string => `line${i + 1}`);
const TEXT: string = LINES.join('\n');

function makeState(): State {
  return initialState('file.txt', TEXT, 'sig-a', 10); // 50 rows, viewport 10, maxRow 40
}

function boundary(modal: StatusModal, owned: State, foreign: State): void {
  expect(modal.matches(owned)).toBe(true);
  expect(modal.matches(foreign)).toBe(false);
}

describe('command-line modal', () => {
  test('renders the typed buffer as the ex prompt and owns cmd.active only', () => {
    const typing: State = { ...makeState(), cmd: { active: true, buffer: 'wq' } };
    boundary(commandLine, typing, makeState());
    expect(renderStatusBar(typing)).toBe('\u001b[7mblitch:wq\u001b[0m');
  });

  test('an empty buffer still shows a visible cursor mark (not the idle bar)', () => {
    const opened: State = { ...makeState(), cmd: { active: true, buffer: '' } };
    expect(renderStatusBar(opened)).not.toBe('\u001b[7mblitch:\u001b[0m');
  });
});

describe('search-forward modal', () => {
  test('renders the / prompt with the live query and owns active+forward only', () => {
    const base = makeState();
    const fwd: State = { ...base, search: { ...base.search, active: true, backward: false, query: '150' } };
    const bwd: State = { ...fwd, search: { ...fwd.search, backward: true } };
    boundary(searchForward, fwd, bwd);
    expect(renderStatusBar(fwd)).toBe('\u001b[7mblitch:/150\u001b[0m');
  });
});

describe('search-backward modal', () => {
  test('renders the ? prompt and owns active+backward only', () => {
    const base = makeState();
    const bwd: State = { ...base, search: { ...base.search, active: true, backward: true, query: '150' } };
    const fwd: State = { ...bwd, search: { ...bwd.search, backward: false } };
    boundary(searchBackward, bwd, fwd);
    expect(renderStatusBar(bwd)).toBe('\u001b[7mblitch:?150\u001b[0m');
  });
});

describe('editor modal', () => {
  test('renders the editing suspension and owns state.editing only', () => {
    const editing: State = { ...makeState(), editing: true };
    boundary(editor, editing, makeState());
    expect(renderStatusBar(editing)).toBe('\u001b[7mblitch:[editing]\u001b[0m');
  });
});

describe('pending-count modal', () => {
  test('renders the half-typed count and owns a bare count only', () => {
    const counting: State = { ...makeState(), pendingCount: 42 };
    const withG: State = { ...counting, pendingG: true }; // pending-g owns 5g
    boundary(pendingCount, counting, withG);
    expect(renderStatusBar(counting)).toBe('\u001b[7mblitch:42\u001b[0m');
  });
});

describe('pending-g modal', () => {
  test('renders the half-typed g (with any count) and owns pendingG only', () => {
    const bare: State = { ...makeState(), pendingG: true };
    const counted: State = { ...bare, pendingCount: 5 };
    boundary(pendingG, bare, makeState());
    expect(renderStatusBar(bare)).toBe('\u001b[7mblitch:g\u001b[0m');
    expect(renderStatusBar(counted)).toBe('\u001b[7mblitch:5g\u001b[0m');
  });
});

describe('pending-z modal', () => {
  test('renders the half-typed Z and owns pendingZ only', () => {
    const pending: State = { ...makeState(), pendingZ: true };
    boundary(pendingZ, pending, makeState());
    expect(renderStatusBar(pending)).toBe('\u001b[7mblitch:Z\u001b[0m');
  });
});

describe('file-missing modal', () => {
  test('renders the gone-file bar and owns the gone signature only', () => {
    const gone: State = { ...makeState(), sig: 'gone' };
    boundary(fileMissing, gone, makeState());
    expect(renderStatusBar(gone)).toBe('\u001b[7mblitch:<file gone>\u001b[0m');
  });
});

describe('follow modal', () => {
  test('renders the live-tail bar and owns follow only', () => {
    const tailing: State = makeState(); // the initial state follows the tail
    const manual: State = { ...tailing, follow: false };
    boundary(follow, tailing, manual);
    expect(renderStatusBar(tailing)).toBe('\u001b[7mblitch: \u2301tail\u001b[0m');
  });

  test('carries the column suffix while tailing', () => {
    const state: State = { ...makeState(), col: 3 };
    expect(renderStatusBar(state)).toBe('\u001b[7mblitch: \u2301tail \u21923\u001b[0m');
  });
});

describe('normal modal', () => {
  test('renders the bare idle bar for a clean unfollowed viewport', () => {
    const idle: State = { ...makeState(), follow: false };
    // terminal matcher: matches everything, so the boundary is dispatch-level —
    // it must lose the registry walk to every higher modal
    expect(normal.matches(idle)).toBe(true);
    expect(renderStatusBar(idle)).toBe('\u001b[7mblitch:\u001b[0m');
  });

  test('renders the bottom-clamped and column-offset variants', () => {
    const bottom: State = { ...makeState(), follow: false, row: 40 }; // maxRow 40
    expect(renderStatusBar(bottom)).toBe('\u001b[7mblitch: [bottom]\u001b[0m');
    const offset: State = { ...makeState(), follow: false, col: 12 };
    expect(renderStatusBar(offset)).toBe('\u001b[7mblitch: \u219212\u001b[0m');
  });

  test('renders temporal diff markers: additions, ghosts, replacements', () => {
    const base = makeState();
    const changed: State = {
      ...base,
      follow: false,
      view: [
        { segs: [{ text: 'kept', kind: 'same' }], ghost: false },
        { segs: [{ text: 'new', kind: 'add' }], ghost: false },
        { segs: [{ text: 'old', kind: 'del' }], ghost: true },
        { segs: [{ text: 'was\u0000now', kind: 'repl' }], ghost: false },
      ],
    };
    expect(renderStatusBar(changed)).toBe('\u001b[7mblitch: +1 -1 ~1\u001b[0m');
  });
});

describe('status registry dispatch', () => {
  test('mode precedence: command-line beats search beats pendings beats idle', () => {
    const base = makeState();
    const all: State = {
      ...base,
      cmd: { active: true, buffer: 'q' },
      search: { ...base.search, active: true, backward: false, query: 'x' },
      pendingZ: true,
      pendingG: true,
      pendingCount: 7,
      follow: false,
    };
    expect(renderStatusBar(all)).toBe('\u001b[7mblitch:q\u001b[0m');
    const noCmd: State = { ...all, cmd: { active: false, buffer: '' } };
    expect(renderStatusBar(noCmd)).toBe('\u001b[7mblitch:/x\u001b[0m');
    const noSearch: State = { ...noCmd, search: { ...noCmd.search, active: false, query: '' } };
    expect(renderStatusBar(noSearch)).toBe('\u001b[7mblitch:7g\u001b[0m'); // pending-g owns count+g
  });

  test('content conditions: file-missing beats follow; follow beats idle', () => {
    const goneTailing: State = { ...makeState(), sig: 'gone', follow: true };
    expect(renderStatusBar(goneTailing)).toBe('\u001b[7mblitch:<file gone>\u001b[0m');
    const tailing: State = makeState();
    expect(renderStatusBar(tailing)).toBe('\u001b[7mblitch: \u2301tail\u001b[0m');
  });

  test('registry order is fixed and terminates in the always-matching normal modal', () => {
    expect(STATUS_MODALS.length).toBe(10);
    expect(STATUS_MODALS.map((m: StatusModal): string => m.name)).toEqual([
      'command-line',
      'search-forward',
      'search-backward',
      'editor',
      'pending-count',
      'pending-g',
      'pending-z',
      'file-missing',
      'follow',
      'normal',
    ]);
    const last = STATUS_MODALS[STATUS_MODALS.length - 1];
    expect(last !== undefined && last.matches(makeState())).toBe(true);
  });
});
