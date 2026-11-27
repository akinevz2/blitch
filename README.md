# Blitch, a diff for each stitch

Blitch is a command line tool that performs pager-like function of viewing a file live in the terminal with the added bonus of performing inotify-livereloading of the file's contents, with automatic ASCII colour-based visualisation of areas of the file that were modified due to addition, deletion, or replacement, kind of like a diff, but displaying temporal markers indicating areas of high entropy, rather than providing a single before/after blob.

## Implementation (Bun + bunli, standalone binary)

The original pure-bash proof of concept was ported to a Bun/bunli project:
`src/index.ts` defines the `view` command via `defineCommand` from
`@bunli/core`; `bun build --compile` produces the standalone `./blitch`
binary. The design is event-driven: effectful code is confined to
`src/runtime.ts` (the interpreter), which publishes plain input events on an
in-process bus; `src/core.ts` folds them through the **monoidal
transformer** (`transduce`), accumulating published output events under the
free-monoid concat; the filesystem event-bus filter (`projectFileEvents`)
matches reported file updates to on-screen state changes. A procedural-style
lint (`bun run src/lint.ts`) forbids untyped functions, `any`/`unknown`,
classes, and IO tokens outside the runtime allowlist.

```
./blitch.sh              # debug launcher: view README.md, trace -> /tmp/blitch-live/trace.log
./blitch view FILE       # compiled binary
bun run src/index.ts view FILE   # dev mode (live source)

keys:  Esc / Ctrl-C / Ctrl-D exit · hjkl + arrows scroll · Ctrl-E/Y vertical
       gg / G motions (count-prefixed: 5j, 42gg, 10G) · / ? search · n/N repeat
```

Colour semantics (the only transformation applied; output is otherwise
cat-identical — no margins, no line numbers): bytes **added** render green;
token-level prefix/suffix of **pure deletions** (including whole deleted
lines, which linger as red ghost rows clustered at the deletion site) render
red; rope-level **replaced** text renders yellow (deleted half + added half
of the rope, both yellow).

Tests: `bun test` — every movement keybinding is individually tested, plus
the diff colour semantics and the event-bus projection.

---

## Historical note: the pure-bash proof of concept

