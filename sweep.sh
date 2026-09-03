#!/bin/bash
# Nightly sweep, run locally by launchd.
#
# No token and no org grants: it reads the repositories already cloned on this
# machine, which also sees every branch rather than only the default one.
#
# launchd gives a job almost no environment, so everything is explicit.
set -euo pipefail

cd "$(cd "$(dirname "$0")" && pwd)"

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
NODE="$(command -v node || true)"
if [ -z "$NODE" ]; then
  echo "$(date -u +%FT%TZ) ERROR: node not found on PATH" >&2
  exit 1
fi

log() { echo "$(date -u +%FT%TZ) $*"; }

log "sweep start"
"$NODE" .waterfall/cli.mjs all

if [ -z "$(git status --porcelain console.svg README.md)" ]; then
  log "no change"
  exit 0
fi

git add console.svg README.md
git commit -q -m "waterfall: $(date -u +%Y-%m-%dT%H:%MZ)"

# A push failure must not look like success: the keychain can be locked, or the
# network down. Report it and let launchd record the non-zero exit.
if ! git push -q origin main; then
  log "ERROR: push failed - commit is local only, will go out on the next run"
  exit 1
fi

log "published"
