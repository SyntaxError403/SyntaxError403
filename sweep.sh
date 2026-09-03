#!/bin/bash
# Nightly sweep, run locally. No token, no org grants: it reads the repos
# already cloned on this machine, which also sees every branch rather than
# just the default one.
set -euo pipefail
cd "$(dirname "$0")"

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

node .waterfall/cli.mjs all

if [ -z "$(git status --porcelain console.svg README.md)" ]; then
  echo "$(date -u +%FT%TZ) no change"
  exit 0
fi

git add console.svg README.md
git commit -q -m "waterfall: $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q origin main
echo "$(date -u +%FT%TZ) published"
