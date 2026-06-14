#!/usr/bin/env bash
# Bootstrap Cloudflare resources for the test environment.
# Run once; capture the printed IDs and paste them into wrangler.jsonc under [env.test].
#
# Requirements: wrangler authenticated against the correct Cloudflare account.
#   wrangler whoami
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> Creating D1 database: pipe-db-test"
npx wrangler d1 create pipe-db-test

echo "==> Creating R2 bucket: pipe-assets-test"
npx wrangler r2 bucket create pipe-assets-test

echo "==> Creating Vectorize indexes"
npx wrangler vectorize create repo-profiles-test --dimensions=1024 --metric=cosine
npx wrangler vectorize create candidate-profiles-test --dimensions=1024 --metric=cosine
npx wrangler vectorize create role-profiles-test --dimensions=1024 --metric=cosine

cat <<'EOF'

==> Next steps:
  1. Copy the database_id printed above into wrangler.jsonc under [env.test].d1_databases.
  2. Uncomment the d1_databases / r2_buckets / vectorize blocks in [env.test].
  3. Apply migrations:
       npx wrangler d1 migrations apply pipe-db-test --env test --remote
  4. Set secrets for the test worker:
       npx wrangler secret put CLERK_SECRET_KEY --env test
       npx wrangler secret put SESSION_TOKEN_SECRET --env test
       npx wrangler secret put GOOGLE_AI_API_KEY --env test        # optional
       npx wrangler secret put RESEND_API_KEY --env test           # optional
  5. Deploy:
       npx wrangler deploy --env test
EOF
