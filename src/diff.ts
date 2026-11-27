// Pure diffing: character-level LCS between paired lines, token-snapped
// deletions, replacement merging, and the line-level view projection with
// ghost rows for pure deletions. No IO, no state — functions only.

import type { DiffKind, Seg, ViewLine } from './types.ts';

interface DiffOp {
  readonly kind: DiffKind;
  readonly text: string;
}

const MAX_LCS_CELLS = 65536;

function isSpace(ch: string): boolean {
  return ch === ' ' || ch === '\t';
}

function pushOp(ops: DiffOp[], kind: DiffKind, text: string): void {
  const last = ops[ops.length - 1];
  if (last !== undefined && last.kind === kind) {
    ops[ops.length - 1] = { kind, text: last.text + text };
    return;
  }
  ops.push({ kind, text });
}

/** Merge an adjacent del+add pair (either order) into one replacement rope
 * carrying only the NEW content — the view is a blitted damage map of the
 * file's rope, not a side-by-side diff; previous content is omitted. */
function mergeReplacements(ops: readonly DiffOp[]): readonly DiffOp[] {
  const out: DiffOp[] = [];
  let i = 0;
  while (i < ops.length) {
    const cur = ops[i];
    const next = ops[i + 1];
    if (next && ((cur.kind === 'del' && next.kind === 'add') || (cur.kind === 'add' && next.kind === 'del'))) {
      const addText = cur.kind === 'add' ? cur.text : next.text;
      if (addText.length > 0) {
        out.push({ kind: 'repl', text: addText });
        i += 2;
        continue;
      }
    }
    out.push(cur);
    i += 1;
  }
  return out;
}

/**
 * Expand pure-deletion runs to token boundaries so deleted words render as
 * whole red tokens rather than character fragments. Expansion steals
 * non-space characters from adjacent same-runs only.
 */
function snapDeletesToTokens(ops: readonly DiffOp[], oldText: string): readonly DiffOp[] {
  const out: DiffOp[] = ops.map((op) => ({ kind: op.kind, text: op.text }));
  let pa = 0; // index into oldText consumed so far
  for (let i = 0; i < out.length; i += 1) {
    const op = out[i];
    if (op.kind !== 'del') {
      pa += op.text.length;
      continue;
    }
    const prev = out[i - 1];
    if (prev && prev.kind === 'same' && prev.text.length > 0) {
      const runStart = pa;
      const firstDel = op.text[0] ?? '';
      let steal = 0;
      while (
        steal < prev.text.length &&
        !isSpace(firstDel) &&
        !isSpace(prev.text[prev.text.length - 1 - steal] ?? '')
      ) {
        steal += 1;
      }
      if (runStart - steal >= 0 && steal > 0) {
        const stolen = prev.text.slice(prev.text.length - steal);
        out[i - 1] = { kind: 'same', text: prev.text.slice(0, prev.text.length - steal) };
        out[i] = { kind: 'del', text: stolen + op.text };
        pa -= steal;
      }
    }
    pa += out[i].text.length;
  }
  return out.filter((op) => op.text.length > 0);
}

function wholeSpanOps(a: string, b: string): readonly DiffOp[] {
  const ops: DiffOp[] = [];
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) {
    p += 1;
  }
  if (p > 0) pushOp(ops, 'same', a.slice(0, p));
  let sa = a.length;
  let sb = b.length;
  while (sa > p && sb > p && a[sa - 1] === b[sb - 1]) {
    sa -= 1;
    sb -= 1;
  }
  if (sa > p) pushOp(ops, 'del', a.slice(p, sa));
  if (sb > p) pushOp(ops, 'add', b.slice(p, sb));
  pushOp(ops, 'same', a.slice(sa));
  return mergeReplacements(ops.filter((op) => op.text.length > 0));
}

/** Character-level diff of two strings into same/add/del/repl runs. */
export function diffText(a: string, b: string): readonly Seg[] {
  if (a === b) {
    return a.length > 0 ? [{ text: a, kind: 'same' }] : [];
  }
  // trim the common prefix/suffix FIRST so a substitution becomes an
  // adjacent del+add pair (merged into one replacement rope) instead of a
  // del ... add straddling an unchanged run
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let sa = a.length;
  let sb = b.length;
  while (sa > p && sb > p && a[sa - 1] === b[sb - 1]) {
    sa -= 1;
    sb -= 1;
  }
  const ops: DiffOp[] = [];
  if (p > 0) pushOp(ops, 'same', a.slice(0, p));
  const midA = a.slice(p, sa);
  const midB = b.slice(p, sb);
  if (midA.length === 0 || midB.length === 0 || midA.length * midB.length > MAX_LCS_CELLS) {
    if (midA.length > 0) pushOp(ops, 'del', midA);
    if (midB.length > 0) pushOp(ops, 'add', midB);
  } else {
    for (const op of lcsOps(midA, midB)) ops.push(op);
  }
  if (sa < a.length) pushOp(ops, 'same', a.slice(sa));
  const trimmed = ops.filter((op) => op.text.length > 0);
  return snapDeletesToTokens(trimmed, a).map((op) => ({ text: op.text, kind: op.kind }));
}

function lcsOps(a: string, b: string): readonly DiffOp[] {
  const n = a.length;
  const m = b.length;
  const w = m + 1;
  const dp = new Int32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i * w + j] = a[i] === b[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
    }
  }
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      pushOp(ops, 'same', a[i]);
      i += 1;
      j += 1;
    } else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) {
      pushOp(ops, 'del', a[i]);
      i += 1;
    } else {
      pushOp(ops, 'add', b[j]);
      j += 1;
    }
  }
  while (i < n) {
    pushOp(ops, 'del', a[i]);
    i += 1;
  }
  while (j < m) {
    pushOp(ops, 'add', b[j]);
    j += 1;
  }
  return mergeReplacements(ops.filter((op) => op.text.length > 0));
}

/**
 * Line-level projection of oldText -> newText. Changed line pairs are
 * diffed inline; unpaired deletions linger as red ghost rows anchored at
 * the line that now precedes them. An empty oldText renders as the initial
 * cat-like view: plain, no temporal markers.
 *
 * Damage accumulates across the session: `prior` maps line content to the
 * most recent damage kind seen since blitch launched; the returned `damage`
 * carries it forward so saving/reentering the editor never fades markers.
 */
export function projectView(
  oldText: string,
  newText: string,
  prior: { damage: Readonly<Record<number, DiffKind>>; lineIds: readonly number[] } = { damage: {}, lineIds: [] },
): { view: readonly ViewLine[]; damage: Readonly<Record<number, DiffKind>>; lineIds: readonly number[] } {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  if (oldText.length === 0) {
    return {
      view: newLines.map((line: string, id: number): ViewLine => ({ segs: [{ text: line, kind: 'same' }], ghost: false, id })),
      damage: {},
      lineIds: newLines.map((_l: string, i: number): number => i),
    };
  }
  let nextId = 0;
  for (const id of prior.lineIds) {
    if (id !== undefined && id >= nextId) nextId = id + 1;
  }

  const nOld = oldLines.length;
  const nNew = newLines.length;
  let p = 0;
  while (p < nOld && p < nNew && oldLines[p] === newLines[p]) p += 1;
  let sfx = 0;
  while (sfx < nOld - p && sfx < nNew - p && oldLines[nOld - 1 - sfx] === newLines[nNew - 1 - sfx]) sfx += 1;
  const om = nOld - sfx; // exclusive end of old middle
  const nm = nNew - sfx; // exclusive end of new middle

  const oldCounts = new Map<string, number>();
  for (let i = p; i < om; i += 1) {
    const key = oldLines[i] ?? '';
    oldCounts.set(key, (oldCounts.get(key) ?? 0) + 1);
  }

  // new middle: survivors stay plain; the rest are additions
  const keepAt = new Map<string, number>();
  const added: number[] = [];
  for (let i = p; i < nm; i += 1) {
    const line = newLines[i] ?? '';
    const used = keepAt.get(line) ?? 0;
    const total = oldCounts.get(line) ?? 0;
    if (used < total) {
      keepAt.set(line, used + 1);
    } else {
      added.push(i);
    }
  }

  // old middle: unconsumed lines are deletions
  const usedOld = new Map<string, number>();
  const deleted: number[] = [];
  for (let i = p; i < om; i += 1) {
    const line = oldLines[i] ?? '';
    const used = usedOld.get(line) ?? 0;
    const kept = keepAt.get(line) ?? 0;
    if (used < kept) {
      usedOld.set(line, used + 1);
    } else {
      deleted.push(i);
    }
  }

  // build new-side rows with identity: kept lines INHERIT their old id,
  // changed lines get fresh ids
  const rows: ViewLine[] = [];
  const addedSet = new Set(added);
  const idByNew = new Map<number, number>();
  for (let i = 0; i < nNew; i += 1) {
    const line = newLines[i] ?? '';
    let id: number;
    if (i < p) id = prior.lineIds[i] ?? nextId++;               // prefix: direct
    else if (i >= nm) id = prior.lineIds[i + (nOld - nNew)] ?? nextId++; // suffix: end-aligned
    else id = nextId++;                                          // middle: refined below
    idByNew.set(i, id);
    rows.push({ segs: [{ text: line, kind: addedSet.has(i) ? 'add' : 'same' }], ghost: false, id });
  }
  // middle survivors inherit the old middle's surviving ids in order
  const oldMiddleKept: number[] = [];
  for (let i = p; i < om; i += 1) if (!deleted.includes(i)) oldMiddleKept.push(i);
  let ptr = 0;
  for (let i = p; i < nm; i += 1) {
    if (addedSet.has(i)) continue;
    const oldIdx = oldMiddleKept[ptr] ?? i;
    ptr += 1;
    const id = prior.lineIds[oldIdx] ?? nextId++;
    idByNew.set(i, id);
    rows[i] = { segs: rows[i]?.segs ?? [], ghost: false, id };
  }

  // pair additions with deletions by POSITION PROXIMITY (nearest unused
  // index) — mid-line edits pair with their own previous version and never
  // spawn ghosts for other lines' deletions
  const pairCount = Math.min(added.length, deleted.length);
  const usedDeleted = new Set<number>();
  const pairs: Array<readonly [number, number]> = [];
  for (const addIdx of added.slice(0, pairCount)) {
    let best = -1;
    let bestDist = Number.MAX_SAFE_INTEGER;
    for (const delIdx of deleted) {
      if (usedDeleted.has(delIdx)) continue;
      const dist = Math.abs(delIdx - addIdx);
      if (dist < bestDist) {
        best = delIdx;
        bestDist = dist;
      }
    }
    if (best >= 0) usedDeleted.add(best);
    pairs.push([addIdx, best]);
  }
  for (const [addIdx, delIdx] of pairs) {
    const delLine = delIdx >= 0 ? (oldLines[delIdx] ?? '') : '';
    const addLine = newLines[addIdx] ?? '';
    // a paired (edited) line IS the same logical line: inherit the previous
    // identity so repeated edits never stack in the damage memo
    const inherited = delIdx >= 0 ? prior.lineIds[delIdx] : undefined;
    const id = inherited ?? idByNew.get(addIdx) ?? nextId++;
    idByNew.set(addIdx, id);
    rows[addIdx] = { segs: diffText(delLine, addLine), ghost: false, id };
  }
  const unpairedDeleted = deleted.filter((d: number): boolean => !usedDeleted.has(d));

  // ghosts splice in (ascending anchors), carrying their dead line's id
  const ghostsByAnchor = new Map<number, ViewLine[]>();
  for (const delIdx of unpairedDeleted) {
    const anchor = Math.min(delIdx, nNew - 1);
    const ghost: ViewLine = {
      segs: [{ text: oldLines[delIdx] ?? '', kind: 'del' }],
      ghost: true,
      id: prior.lineIds[delIdx] ?? nextId++,
    };
    const list = ghostsByAnchor.get(anchor) ?? [];
    list.push(ghost);
    ghostsByAnchor.set(anchor, list);
  }
  for (const [anchor, ghosts] of ghostsByAnchor) {
    rows.splice(anchor, 0, ...ghosts);
  }

  // damage accumulation: session-long memo keyed by STABLE LINE ID — one
  // entry per line; edits on the same line merge (never stack). Paired
  // lines record a single repl on their new id: the replacement subsumes
  // the deletion of its previous version.
  const damage: Record<number, DiffKind> = { ...prior.damage };
  const mergeKind = (a: DiffKind, b: DiffKind): DiffKind => {
    if (a === 'same') return b;
    if (b === 'same') return a;
    return 'repl'; // any overlap of add/del/repl escalates to repl
  };
  const accumulate = (id: number, kind: DiffKind): void => {
    damage[id] = mergeKind(damage[id] ?? 'same', kind);
  };
  for (const delIdx of unpairedDeleted) {
    accumulate(prior.lineIds[delIdx] ?? nextId++, 'del');
  }
  const pairedAdds = new Set(pairs.map(([a]: readonly [number, number]) => a));
  for (const [addIdx] of pairs) {
    accumulate(idByNew.get(addIdx) ?? nextId++, 'repl');
  }
  for (const addIdx of added) {
    if (!pairedAdds.has(addIdx)) accumulate(idByNew.get(addIdx) ?? nextId++, 'add');
  }

  const lineIds = newLines.map((_l: string, i: number): number => idByNew.get(i) ?? nextId++);
  return { view: rows, damage, lineIds };
}
