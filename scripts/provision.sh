#!/usr/bin/env bash
# Gets the Cloudflare account ready for a deploy of Alexandria: checks that the
# API token can manage what the Worker binds, creates the D1 database, the
# queues, the R2 bucket and the Vectorize index when they do not exist yet, and
# applies the D1 migrations. Every step is a no-op when there is nothing to do. Needs
# CLOUDFLARE_API_TOKEN (and CLOUDFLARE_ACCOUNT_ID when the token cannot list
# its accounts).
set -euo pipefail
cd "$(dirname "$0")/.."

QUEUES=(alexandria-fetch alexandria-enrich alexandria-liveness alexandria-account alexandria-index)
BUCKET=alexandria-snapshots
DATABASE=alexandria
# The index of the passages of every user's links, for search by meaning: the
# dimensions are those of the embedding model, @cf/baai/bge-m3.
VECTOR_INDEX=alexandria-passages

wrangler() { npx --no-install wrangler "$@"; }

# Without these the deploy would stop halfway with a bare "Authentication error".
# Each failed check prints wrangler's own error, which says why (a permission
# the token lacks, or R2 not yet enabled on the account).
failed=0
check() {
  local what=$1 permission=$2
  shift 2
  local out
  if ! out=$(wrangler "$@" 2>&1); then
    failed=1
    echo "Cannot reach $what: the token needs $permission." >&2
    echo "$out" | grep -E 'ERROR|\[code:|enable|permission' | sed 's/^/    /' >&2 || true
  fi
}
check D1 "Account > D1 > Edit" d1 list
check Queues "Account > Queues > Edit" queues list
check R2 "Account > Workers R2 Storage > Edit" r2 bucket list
check Vectorize "Account > Vectorize > Edit" vectorize list
if [ "$failed" = 1 ]; then
  echo "(The token also needs Account > Workers Scripts > Edit, and CLOUDFLARE_ACCOUNT_ID set.)" >&2
  exit 1
fi

if ! wrangler d1 info "$DATABASE" >/dev/null 2>&1; then
  echo "Creating the D1 database $DATABASE"
  wrangler d1 create "$DATABASE"
fi

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

if ! wrangler vectorize get "$VECTOR_INDEX" >/dev/null 2>&1; then
  echo "Creating the Vectorize index $VECTOR_INDEX"
  wrangler vectorize create "$VECTOR_INDEX" --dimensions 1024 --metric cosine
fi

# Related links filter the index on the kind of a passage (metadata or reader
# text). Vectorize filters only on a property with a metadata index, and only
# for vectors stored after it exists, so it is created before the migrations
# that queue links for re-indexing.
if ! wrangler vectorize list-metadata-index "$VECTOR_INDEX" 2>/dev/null | grep -qw kind; then
  echo "Creating the metadata index on kind of $VECTOR_INDEX"
  wrangler vectorize create-metadata-index "$VECTOR_INDEX" --propertyName=kind --type=string
fi

# Before the deploy, so that new code never meets an old schema.
wrangler d1 migrations apply "$DATABASE" --remote
