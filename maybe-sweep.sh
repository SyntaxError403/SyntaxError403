#!/bin/bash
# Called from an interactive shell. Sweeps at most once a day, in the
# background, and stays silent unless you go looking in the log.
#
# This runs in your terminal's permission context, so it needs no Full Disk
# Access grant the way a launchd agent would.
set -uo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
CACHE="$HOME/.cache"
STAMP="$CACHE/waterfall-last-sweep"
LOCK="$CACHE/waterfall-sweep.lock"
LOG="$HOME/Library/Logs/waterfall.log"
INTERVAL="${WATERFALL_INTERVAL:-86400}"     # once a day
RETRY=3600                                   # after a failure, retry in an hour

mkdir -p "$CACHE" "$(dirname "$LOG")"

now=$(date +%s)
last=0
[ -f "$STAMP" ] && last=$(cat "$STAMP" 2>/dev/null || echo 0)
[ $(( now - last )) -lt "$INTERVAL" ] && exit 0

# Atomic lock: several terminals opening at once must not all sweep.
mkdir "$LOCK" 2>/dev/null || exit 0
trap 'rmdir "$LOCK" 2>/dev/null' EXIT

# Claim the slot before working, so a long sweep does not let another shell in.
echo "$now" > "$STAMP"

if ! "$DIR/sweep.sh" >> "$LOG" 2>&1; then
  # Back off rather than burning a full day on a transient failure.
  echo $(( now - INTERVAL + RETRY )) > "$STAMP"
  echo "$(date -u +%FT%TZ) sweep failed, retrying in $(( RETRY / 60 ))m" >> "$LOG"
fi
