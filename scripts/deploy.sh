#!/usr/bin/env bash
# Deploys Alexandria to Cloudflare from a checkout: builds the website and the
# Worker, gets the account ready (provision.sh: the D1 database, queues, R2
# bucket and migrations) and deploys. Safe to run again. Needs
# CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID when the token cannot list
# its accounts).
set -euo pipefail
cd "$(dirname "$0")/.."

echo "Building the website and the Worker"
npx --no-install vite build
scripts/provision.sh
# The build left .wrangler/deploy/config.json, which points wrangler at the
# configuration and Worker bundle Vite built.
npx --no-install wrangler deploy
