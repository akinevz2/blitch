#!/usr/bin/env bash
# blitch.sh — debug launcher (supersedes the bash proof-of-concept).
#
# Runs the TypeScript blitch on README.md (or $1) with the event-trace
# debug parameter enabled, capturing stderr (filesystem reports + decoded
# keypresses) to a trace file so the TUI stays clean. Prefers dev mode
# (live source) so tests always exercise current code; falls back to the
# compiled binary when bun is unavailable.
#
#   ./blitch.sh                 # view README.md, trace -> /tmp/blitch-live/trace.log
#   ./blitch.sh FILE            # view FILE
#   BLITCH_TRACE=path ./blitch.sh FILE
#   BLITCH_DEBUG=0 ./blitch.sh  # launch without the trace parameter

set -u

DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
FILE=${1:-$DIR/README.md}
TRACE=${BLITCH_TRACE:-/tmp/blitch-live/trace.log}
mkdir -p "$(dirname "$TRACE")"

export BLITCH_DEBUG=${BLITCH_DEBUG:-1}
cd "$DIR"

if [[ ! -e $FILE ]]; then
  printf '[blitch.sh] file does not exist: %s\n' "$FILE" >&2
  exit 1
fi

printf '[blitch.sh] session %s  file=%s  debug=%s  trace=%s\n' \
  "$(date -Is)" "$FILE" "$BLITCH_DEBUG" "$TRACE" > "$TRACE"

if command -v bun > /dev/null 2>&1; then
  exec bun run src/index.ts view "$FILE" 2>> "$TRACE"
elif [[ -x $DIR/blitch ]]; then
  printf '[blitch.sh] bun not found; using compiled binary (may be stale)\n' >> "$TRACE"
  exec "$DIR/blitch" view "$FILE" 2>> "$TRACE"
else
  printf '[blitch.sh] no bun runtime and no compiled ./blitch binary\n' >&2
  exit 1
fi
