#!/usr/bin/env bash
# The custom build of wrangler.jsonc, run by a plain `wrangler deploy` (or
# `wrangler versions upload`): builds the website into dist/client. Inside
# Workers Builds (WORKERS_CI=1) it also gets the account ready (provision.sh),
# so that the deploy that follows finds everything it binds; anywhere else,
# such as `wrangler dev`, it touches no remote account.
set -euo pipefail
cd "$(dirname "$0")/.."

npx --no-install vite build
if [ "${WORKERS_CI:-}" = "1" ]; then
  scripts/provision.sh
fi
