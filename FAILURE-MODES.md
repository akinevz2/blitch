# Blitch failure modes — integration and decomposition audit

Catalog of failure cases arising from integration between modules and from
omissions within each module's functional decomposition. Produced as a test
sequence for interactive verification; sev: **C** crash / spurious-exit,
**W** wrong behaviour, **V** visual, **D** dead code / hygiene.

Module map and allowed dependency edges:

    types.ts ← monoid.ts ← core.ts → diff.ts
                 ↑           ↓        ↓
              render.ts ← (core)     render.ts
                 ↑
             runtime.ts → index.ts (bunli CLI)
             lint.ts  → (scans all)
             core.test.ts → core.ts, diff.ts

---

## A. Within-module failure cases

### A1. diff.ts

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| A1.1 | File content contains a literal NUL byte (`\u0000`) | `diffText` inserts `\u0000` as the replacement-rope separator; render splits on it — a file's own NUL byte is indistinguishable from the separator, splitting an added segment into phantom halves | W |
| A1.2 | Adjacent del+add across a whitespace-only boundary | `mergeReplacements` merges ANY adjacent del/add pair into a yellow repl — a pure insertion followed by an unrelated pure deletion (moved text) is misreported as replacement | W |
| A1.3 | Delete run spanning a token boundary adjacent to `same` run that itself spans tokens | `snapDeletesToTokens` steals chars greedily while both edges are non-space; a deletion adjacent to punctuation (`foo,` del `,`) steals across the comma into the previous token | W |
| A1.4 | Line longer than LCS cap (a.length*b.length > 65536) | falls back to `wholeSpanOps` — common prefix/suffix only; middle churn renders as one huge yellow rope instead of a minimal diff | V |
| A1.5 | `snapDeletesToTokens` position pointer `pa` after a steal | `pa` is decremented by the steal and re-incremented by the enlarged run — correct only if the previous op was `same`; a del-run preceded by a del-run (two runs merged by pushOp so impossible) or by `repl` (produced later, impossible) — safe today, fragile contract | D |
| A1.6 | Multiple unpaired ghosts with distinct anchors | ghosts splice at ascending anchors into a growing array — anchor indices computed in pre-splice coordinates drift left as earlier ghosts insert; ghost lands one row earlier per prior ghost (observed: `['a','b','c','d','e']` grouping is accidental) | W |
| A1.7 | File emptied entirely (nNew = 0) | anchor = `Math.min(i, nNew - 1)` = −1; `splice(-1, …)` clamps to 0 — works by accident, no test covers it | W |
| A1.8 | CRLF file | `\r` retained in lines (split only on `\n`); diff sees `^M` changes on every edited line — noisy ropes | V |
| A1.9 | Multibyte / wide (CJK) characters | diff operates on UTF-16 code units; render `col` slicing cuts surrogate pairs → replacement chars at screen edge | V |
| A1.10 | Duplicate identical lines in the middle (hash-count matching) | survivors matched by count, not position — a duplicated block reordered renders as all-plain even though rows moved (temporal markers lost) — by-design approximation | D |
| A1.11 | Pairing additions to deletions strictly by order | with 2 additions and 2 deletions whose true pairing is crossed, wrong pairs diff → noisy yellow ropes | W |
| A1.12 | Single-line file, no trailing newline | `split('\n')` → 1 row ✓; but appending text WITHOUT trailing newline turns the last line into a repl rope of the whole line | W |

### A2. core.ts

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| A2.1 | Digit count of huge size (hold 9) | pendingCount grows unbounded (999999…) — moveRows clamps, but 42gg-style jumps compute `clamp(pending - 1, 0, maxRow)` fine; no overflow risk in practice, no cap documented | D |
| A2.2 | `pendingG` has no timeout | `g` followed by pause then `j` still means gg-j… no — `g` then `j` = plain j (j consumes). But `g` then a LONG pause then `g` still triggers gg — vim expires pending keys after timeoutlen; ours never does | W |
| A2.3 | Search commit with empty query | Enter with query '' stores lastQuery '' — findMatch guarded, but the search is silently discarded with no feedback (no status line exists) | D |
| A2.4 | Search mode while the file updates | view is replaced mid-typing; Enter finds matches in the NEW view — row jumps may surprise; follow flag interplay untested | W |
| A2.5 | `n`/`N` with no committed search | no-op guarded ✓ (covered by test) | D |
| A2.6 | `findMatch` wrap loops | forward scan r = from..last then 0..from — if EVERY row matches (query ''), not reachable (guard); with 1-row view and match: returns same row — n/N appear dead | W |
| A2.7 | Ghost rows excluded from search but NOT from row accounting | match rows skip ghosts, but jumping sets `row` (top-of-viewport) — a match on a row hidden behind ghosts still lands correctly since ghosts occupy real rows ✓ — but `follow` tail math includes ghosts: a view of ghosts-only (file emptied) has maxRow > 0 with no real content | W |
| A2.8 | `onFileUpdate` when `event.text === s.text` but sig differs | full re-diff runs, view identical, frame suppressed by visualKey ✓ — wasted work only | D |
| A2.9 | `projectFileEvents` dedupes sig but patches are never applied by anything | the projection is advisory metadata only — the reducer re-derives everything (see B2.1) | D |
| A2.10 | `State.oldText` | written on every update, never read — dead state (decomposition leftover from the bash tombstone TTL model) | D |
| A2.11 | `height` frozen at startup | SIGWINCH never handled (see B1.4) — resize renders into stale viewport | W |
| A2.12 | Count-prefixed `G` when target is inside the last viewport | clamp hides that the request was clamped — `99G` silently lands at maxRow | D |
| A2.13 | Event ordering within a batch | keys and file events in one batch fold in arrival order; a file event mid-batch invalidates rows computed by earlier key events in the same batch (jump-then-rediff = stale row) | W |

### A3. render.ts

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| A3.1 | `col` slicing mid-segment of a colored run | each seg re-emits its color after slicing ✓, but the SAME-kind reset logic emits RESET then re-colors — harmless escape noise | V |
| A3.2 | Replacement rope splitting on `\u0000` | halves render sequentially — if the deleted half is scrolled off by `col`, the split point is invisible: fine; but the \u0000 itself counts as a column if a file contains NUL (see A1.1) | W |
| A3.3 | `state.height` ≤ 0 | `Math.max(1, …)` guard ✓ | D |
| A3.4 | Frame does not end with `\e[J` | runtime appends `\e[J` — frame builder and runtime BOTH own cursor/clear policy (split responsibility; moving either breaks the other silently) | D |
| A3.5 | Empty view (no lines) | rows = [] → frame '' → runtime writes `\e[H\e[J` — blank screen, no error ✓ untested | D |

### A4. runtime.ts

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| A4.1 ✅ FIXED | Escape sequence split across two stdin chunks | chunk 1 ends with `\x1b`, chunk 2 begins `[…A` — decodeKeys emits `escape` from chunk 1 → **spurious exit**; the most likely real-world clean-exit violation | C |
| A4.2 ✅ FIXED | SS3 arrow keys (`\x1bOA`, application cursor mode) | only `ESC [ A` parsed → arrows dead in terminals that emit SS3 | W |
| A4.3 | Ctrl-Z (0x1a) | dropped as undecodable byte — no suspend; deliberate omission, undocumented | D |
| A4.4 | `stdin.setRawMode(true)` not in try/catch | throws on exotic stdin → no cleanup path runs (alt screen never entered, but node may leave echo off) | C |
| A4.5 | Lost wakeup race | `waitForEvents` checks `bus.pending.length` then assigns `wake` — single-threaded JS makes this atomic ✓, BUT a second event arriving while the loop processes batch 1 sets `wake` via kick only if the loop is parked; kick during sync processing is a no-op by design — events published during processing are drained next iteration ✓ — safe, but ONLY because processing is fully synchronous; any future await inside the loop introduces the race | D |
| A4.6 | File replaced between `readFileSync` and `statSig` | text from old content + sig from new inode → mismatch pair; next poll corrects — transient wrong frame | W |
| A4.7 | Watcher callback after `watcher.close()` during exit | node delivers no callbacks after close ✓; but `reportFile` → `publish` after `process.exit` inside `interrupted()` — exit wins, harmless | D |
| A4.8 | `restoreTerminal` when stdout is dead (EPIPE) | writeOut catches ✓; raw-mode restore guarded ✓ | D |
| A4.9 | Non-tty stdout, tty stdin (viewer piped) | `isTty` requires BOTH — takes cat path ✓; but piped output on SIGPIPE → process dies silently mid-write (writeOut catches EPIPE as generic error) | W |
| A4.10 | Missing file at startup | non-tty: prints nothing, exit 0 (should error); tty: initialState with '' → blank viewer with no message, poll reports sig 'gone' forever → every report no-ops ('gone' === 'gone') — **file recreated later with same 'gone' sig → dedup hides the resurrection** | C |
| A4.11 | Two producers report the same sig in one batch | reducer no-ops the second ✓; but poll+watch double-fire with DIFFERENT text reads (read at different instants, same sig impossible) — safe | D |
| A4.12 | Frame written during SIGINT handler | `interrupted()` writes restore escapes then exits — if a frame write is mid-flight, interleaved escapes → terminal may need `reset` | C |

### A3b. render.ts — live finding

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| A3.6 ✅ FIXED | typing a search query | no transient feedback (query invisible until commit) — render now draws a reverse-video `/?query` prompt on the spare bottom row while `search.active` | W |
| A3.7 ✅ FIXED | incremental search absent | query had no effect until Enter — now live incsearch: per-keystroke preview from the search anchor, Esc restores the anchor, Enter commits; `/` and `?` are the same machine parameterized by direction | W |
| A2.14 ✅ FIXED | first scroll while `follow` (B1.3 root cause) | display showed the followed tail while `state.row` was still 0 — first scroll-up jumped to the top of the file; `moveRows` now materializes the follow position before scrolling | C |

### A3c. quit motions + toolchain gaps — live findings

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| A3.8 ✅ FIXED | quitting | no vim quit motions — `ZQ`/`ZZ` and `:q`/`:q!`/`:wq` command line implemented (command line is a third input mode, precedence cmd > search > normal; `:` typed inside a search prompt is query text, per vim) | W |
| A3.7b ✅ FIXED | search matches | matches had no background highlight — reverse-video highlight (same style as the bar) now applied to the live query and the committed `lastQuery` | W |
| A5.8 ✅ FIXED | missing import in runtime.ts | lint is token-based and `bun build --compile` accepts unresolved globals — neither caught `consumeBar` being un-imported; only the pty smoke test did. `tsc --noEmit` added as a build gate (`bun run typecheck`) | C |

### A5. lint.ts

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| A5.1 | Multi-line function signature | line-based scan never sees `function f(` + params on following lines — untyped params escape LINT001 entirely | D (false clean) |
| A5.2 | `let`-bound arrow (`let f = (x) => …`) | only `const`-bound arrows scanned — let/var arrows unchecked | D |
| A5.3 | Object-literal method shorthand (`{ foo(x) { … } }`) | not a `function` decl, not a const arrow — invisible | D |
| A5.4 | `any`/`unknown` inside stripped string lost | template `${…}` expressions are stripped with the string — a violating expression inside a template escapes LINT002 | D |
| A5.5 | Purity scan is token-based | `process` reachable via `globalThis["proc"+"ess"]`, `import()`, or a re-export alias — trivially bypassable; heuristic, not soundness | D |
| A5.6 | lint.ts runs at import (`process.exit(main())`) | importing the module as a library kills the process — decomposition: should export main and only exit under `import.meta.main` | D |
| A5.7 | Allowlist by filename | a second `runtime.ts` in a subdirectory is allowlisted by basename — allowlist is not path-scoped | D |

### A6. monoid.ts

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| A6.1 | Shared `empty` array identity | `OUTPUT_MONOID.empty` is ONE array instance; concat copies, so safe today — but any future `push` on the monoid's empty corrupts every subsequent fold (contract is convention-only, untested) | D |
| A6.2 | concat asymmetric cost | `a.concat(b)` O(a+b) per fold — quadratic in batch size for long event batches (batch sizes are tiny; noted) | D |

### A7. index.ts (bunli CLI)

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| A7.1 | `blitch view` with no positional | throws Error → bunli formats — message says `usage:`; exit code non-zero ✓ | D |
| A7.2 | positional is a directory | runView proceeds: readFileSync throws → '' text; watch on a DIRECTORY fires on every file inside — viewer renders blank and reacts to unrelated events | C |
| A7.3 | `process.exit(code)` in handler | truncates any pending async stdout from bunli internals — exit before cli.run() completes its own teardown | W |
| A7.4 | Unhandled rejection from cli.run() | top-level await — binary exits with stack trace; no friendly message | D |

### A8. types.ts

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| A8.1 | `Key` union drift | runtime decodes `{t:'ch'}`, core switches on `k.t` — adding a third variant compiles silently; core's `default` swallow path hides it | D |
| A8.2 | `ViewPatch` shape churn | fields already changed once (addedRows/deletedRows/ghostRows → newRowCount) — projection metadata is consumed by tests only, so type churn is invisible to the runtime | D |

---

## B. Integration failure cases (module × module)

| ID | Edge | Trigger | Failure | Sev |
|----|------|---------|---------|-----|
| B1.1 | runtime→core | producer publishes `{t:'file'}` with text but sig equal | reducer no-op — correct; but with sig 'gone' both sides (A4.10) updates are permanently invisible | C |
| B1.2 | runtime→core | stdin chunk decoded to keys with `c: ''` (byte 32 pushed with `chunk[i] ?? ''` under surrogate boundary) | empty-char key reaches onNormalKey default → silently clears pending count — count typed then lost | W |
| B1.3 | core→render | reducer replaces `view` but leaves `row` > new maxRow | render clamps (`Math.min(row, maxRow)`) but STATE row stays stale — next scroll starts from the stale row (double-jump) | W |
| B1.4 | runtime→core→render | terminal resized | state.height stale; render draws rows-1 of the OLD height — bottom rows left with stale content (no `\e[J` full clear per line beyond frame) | V |
| B2.1 | core→runtime (projectFileEvents unused) | the event-bus filter is defined, tested, but the runtime calls `transduce` directly — the projection layer is dead code; the "match reported updates to on-screen state changes" contract is enforced nowhere at runtime | D |
| B2.2 | diff→render (rope separator) | `\u0000` contract known only to both sides implicitly — no shared constant; changing one silently breaks the other (A1.1/A3.2) | D |
| B2.3 | diff→core (ghost rows vs row accounting) | projectView returns view including ghosts; core's maxRow/follow math must account for ghosts — A2.7 | W |
| B2.4 | monoid→core | transduce accumulates via `OUTPUT_MONOID.concat` — if a reducer ever returns outputs containing a frame AND the visualKey check also fires, duplicate frames per batch (double render cost, flicker) | V |
| B2.5 | runtime→render (first frame path) | initial frame written directly by runtime, bypassing transduce — a render-contract change (e.g. suffix escapes) applies to later frames only if runtime's wrapper is updated in lockstep (A3.4) | D |
| B2.6 | index→runtime | `process.exit` truncation (A7.3) and error propagation — runView never throws today; if it does, bunli prints, but terminal is left in raw mode + alt screen | C |
| B2.7 | lint↔all | lint allowlist basenames (A5.7) vs new modules — a future `src/io.ts` doing IO is rejected ✓; a future `src/runtime/` dir bypasses | D |
| B2.8 | test↔core | tests drive `transduce` with hand-built Key/InputEvent objects — decodeKeys (runtime) is the module that PRODUCES those shapes; a decode regression (A4.1/A4.2) passes all 41 tests | D |
| B2.9 | test↔types | tests assert on concrete strings ('line1') — view row indices include ghosts; any projectView anchor change (A1.6) shifts indices and breaks tests cosmetically | D |

---

## C. Lifecycle / environment

| ID | Trigger | Failure | Sev |
|----|---------|---------|-----|
| C1 | Trace file path unwritable (/tmp/blitch-live permission) | launcher `mkdir -p` fails → set -u exit without message clarity | W |
| C2 | bun version skew (Bun.watch/Bun.statSync incidents — BOTH already bitten) | API guarded by try/catch today; silent feature degradation instead of loud minimum-version check | W |
| C3 | Compiled binary staleness | `./blitch` rebuilt only manually — launcher warns, but the binary is what `blitch view` runs — dev/test and binary drift | W |
| C4 | Concurrent viewers on one file | two watchers, no lock — harmless reads, but trace files interleave if same BLITCH_TRACE | D |

---

## Priority to fix on next pass

1. **A4.1** ✅ fixed (decoder buffers partial sequences, 25 ms flush).
2. **A4.10** sig 'gone' dedup hides file resurrection (compare content too, or make 'gone' never dedup).
3. **A7.2** directory positional (validate `statSync().isFile()` in index.ts).
4. **B2.1** wire `projectFileEvents` into the runtime loop (or delete it honestly).
5. **A1.6/A1.7** ghost anchoring (compute anchors in new coordinates, one-pass build).
6. **A2.2** pendingG timeout; **B1.4** SIGWINCH (B1.3 fixed with the follow-materialization).
