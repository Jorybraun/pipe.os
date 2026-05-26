#!/usr/bin/env bash
# sync-repos-local.sh — copy qualified_repos + related tables from remote D1 to local.
# Run after pass 1 or pass 2 to make the admin page reflect the latest crawl data.
#
# Usage:
#   cd workers/api && bash scripts/sync-repos-local.sh

set -euo pipefail

# Load CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID from .dev.vars so wrangler
# uses the scoped API token instead of its (expiry-prone) stored OAuth session.
if [ -f .dev.vars ]; then
  set -a
  # shellcheck disable=SC1091
  . .dev.vars
  set +a
fi

WRANGLER="./node_modules/.bin/wrangler"
DB="pipe-db"
TMP=$(mktemp -d)

echo "→ Clearing local repo tables (ignoring missing tables)..."
$WRANGLER d1 execute "$DB" --local --command "DELETE FROM repo_nodes;"              2>/dev/null || true
$WRANGLER d1 execute "$DB" --local --command "DELETE FROM repo_engineering_signals;" 2>/dev/null || true
$WRANGLER d1 execute "$DB" --local --command "DELETE FROM repo_sample_prs;"          2>/dev/null || true
$WRANGLER d1 execute "$DB" --local --command "DELETE FROM repo_constructs;"          2>/dev/null || true
$WRANGLER d1 execute "$DB" --local --command "DELETE FROM qualified_repos;"          2>/dev/null || true

echo "→ Exporting data from remote D1 (data only, no schema)..."
$WRANGLER d1 export "$DB" --remote --no-schema --output="$TMP/repos.sql"      --table=qualified_repos
$WRANGLER d1 export "$DB" --remote --no-schema --output="$TMP/constructs.sql" --table=repo_constructs
$WRANGLER d1 export "$DB" --remote --no-schema --output="$TMP/prs.sql"        --table=repo_sample_prs
$WRANGLER d1 export "$DB" --remote --no-schema --output="$TMP/signals.sql"    --table=repo_engineering_signals
$WRANGLER d1 export "$DB" --remote --no-schema --output="$TMP/nodes.sql"      --table=repo_nodes

echo "→ Importing into local D1..."
$WRANGLER d1 execute "$DB" --local --file="$TMP/repos.sql"
$WRANGLER d1 execute "$DB" --local --file="$TMP/constructs.sql"
$WRANGLER d1 execute "$DB" --local --file="$TMP/prs.sql"
$WRANGLER d1 execute "$DB" --local --file="$TMP/signals.sql"
$WRANGLER d1 execute "$DB" --local --file="$TMP/nodes.sql"

rm -rf "$TMP"

echo "✓ Sync complete."
