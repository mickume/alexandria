#!/usr/bin/env bash
# Deploys Alexandria to Cloudflare: builds the website and the Worker, creates
# the queues and the R2 bucket the Worker needs when they do not exist yet,
# applies the D1 migrations and deploys. Safe to run again: every step is a
# no-op when there is nothing to do. Needs CLOUDFLARE_API_TOKEN (and
# CLOUDFLARE_ACCOUNT_ID when the token can see more than one account, or
# cannot list its accounts).
set -euo pipefail
cd "$(dirname "$0")/.."

QUEUES=(alexandria-fetch alexandria-enrich alexandria-liveness alexandria-account)
BUCKET=alexandria-snapshots
DATABASE=alexandria

wrangler() { npx --no-install wrangler "$@"; }

echo "Building the website and the Worker"
npx --no-install vite build

for queue in "${QUEUES[@]}"; do
  if ! wrangler queues info "$queue" >/dev/null 2>&1; then
    echo "Creating the queue $queue"
    wrangler queues create "$queue"
  fi
done

if ! wrangler r2 bucket info "$BUCKET" >/dev/null 2>&1; then
  echo "Creating the R2 bucket $BUCKET"
  wrangler r2 bucket create "$BUCKET"
fi

# Migrations go first, so that new code never meets an old schema. On the
# first deploy the database does not exist yet: the deploy creates it, and the
# migrations follow it.
migrated=false
if wrangler d1 info "$DATABASE" >/dev/null 2>&1; then
  wrangler d1 migrations apply "$DATABASE" --remote
  migrated=true
fi

wrangler deploy

if [ "$migrated" = false ]; then
  wrangler d1 migrations apply "$DATABASE" --remote
fi
