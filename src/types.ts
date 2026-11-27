// Shared types. Types-only module: no functions, no effects.

/** Disjoint segment of a diffed line. */
export type DiffKind = 'same' | 'add' | 'del' | 'repl';

export interface Seg {
  readonly text: string;
  readonly kind: DiffKind;
}

/**
 * One rendered row. `ghost` rows are pure deletions that linger in the
 * view (red) even though they are no longer part of the file itself.
 */
export interface ViewLine {
  readonly segs: readonly Seg[];
  readonly ghost: boolean;
}

export type NamedKey =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'enter'
  | 'escape'
  | 'backspace'
  | 'ctrl-c'
  | 'ctrl-d'
  | 'ctrl-e'
  | 'ctrl-y';

/** A decoded logical keypress. */
export type Key = { readonly t: 'ch'; readonly c: string } | { readonly t: 'named'; readonly k: NamedKey };

/**
 * Inputs. Effectful sources (keyboard, filesystem) publish these; they are
 * plain data so the core stays pure.
 */
export type InputEvent =
  | { readonly t: 'key'; readonly key: Key }
  | { readonly t: 'file'; readonly sig: string; readonly text: string };

/** Outputs collected monoidally by the transformer, interpreted by the runtime. */
export type OutputEvent =
  | { readonly t: 'frame'; readonly text: string }
  | { readonly t: 'bar'; readonly text: string }
  | { readonly t: 'editor' }
  | { readonly t: 'exit'; readonly code: number };

export type SearchDir = 'fwd' | 'bwd';

/** The current input scheme (mode): determines event interpretation. */
export type InputScheme = 'normal' | 'search-forward' | 'search-backward' | 'command-line';

export interface SearchState {
  readonly active: boolean;
  readonly query: string;
  readonly backward: boolean;
  readonly lastQuery: string;
  readonly lastDir: SearchDir;
  /** viewport row at the moment the search started; Esc restores it */
  readonly anchor: number;
}

export interface CmdState {
  readonly active: boolean;
  readonly buffer: string;
}

export interface State {
  readonly sig: string;
  readonly oldText: string;
  readonly text: string;
  readonly view: readonly ViewLine[];
  readonly row: number;
  readonly col: number;
  readonly follow: boolean;
  /** editor-suspended: the runtime owns the screen while $EDITOR runs */
  readonly editing: boolean;
  readonly pendingCount: number | null;
  readonly pendingG: boolean;
  readonly pendingZ: boolean;
  readonly pendingZLower: boolean;
  /** cycle index into the session's damaged rows (zz / space cycling) */
  readonly cycle: number;
  readonly search: SearchState;
  readonly cmd: CmdState;
  /** session-long per-line damage memo (blitted across updates) */
  readonly damage: Readonly<Record<string, DiffKind>>;
  /** cached current input scheme; kept in lockstep by the mode transitions */
  readonly scheme: InputScheme;
  /** event generation: bumped on every scheme entry; stale-batch guards */
  readonly generation: number;
  readonly height: number;
}

/**
 * Result of the event-bus projection: a reported file update, deduped by
 * signature, that the reducer will apply to produce on-screen state changes.
 */
export interface ViewPatch {
  readonly t: 'diff-applied';
  readonly sig: string;
  readonly newRowCount: number;
}
