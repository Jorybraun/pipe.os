# Test Environment Setup

One-time setup for the `test` Cloudflare environment. After this, the
`.github/workflows/e2e-test.yml` workflow runs the full BDD suite against a
real worker + Pages preview + D1 + R2 + Vectorize on every PR.

## 1. Bootstrap Cloudflare resources

```bash
cd workers/api
./scripts/bootstrap-test-env.sh
```

Capture the `database_id` printed for `pipe-db-test`.

## 2. Wire IDs into wrangler.jsonc

Open `workers/api/wrangler.jsonc` and uncomment the `d1_databases`,
`r2_buckets`, and `vectorize` blocks under `env.test`, substituting the
`database_id` from step 1.

## 3. Apply migrations

```bash
cd workers/api
npx wrangler d1 migrations apply pipe-db-test --env test --remote
```

## 4. Set worker secrets

```bash
cd workers/api
npx wrangler secret put CLERK_SECRET_KEY --env test        # Clerk dev instance
npx wrangler secret put SESSION_TOKEN_SECRET --env test    # any 32+ char random string
npx wrangler secret put GOOGLE_AI_API_KEY --env test       # optional, enables real scoring
npx wrangler secret put RESEND_API_KEY --env test          # optional, enables email
```

## 5. Deploy the test worker

```bash
cd workers/api
npx wrangler deploy --env test
```

Note the printed `*.workers.dev` URL — this is `TEST_API_BASE`.

## 6. Create the Pages project

In the Cloudflare dashboard, create a new Pages project named `pipe-app-test`
with no initial build (the workflow uploads artifacts directly). Note the
`*.pages.dev` URL — this is `TEST_APP_BASE`.

## 7. Add GitHub Actions secrets

In the repo settings → Secrets and variables → Actions, add:

- `CLOUDFLARE_API_TOKEN` (if not already present)
- `CLOUDFLARE_ACCOUNT_ID` (if not already present)
- `CLERK_PUBLISHABLE_KEY_TEST` — Clerk dev instance publishable key
- `TEST_API_BASE` — from step 5
- `TEST_APP_BASE` — from step 6

## 8. Trigger the workflow

Open a PR; `e2e-test.yml` applies migrations, deploys worker + Pages, resets
+ seeds the DB, and runs Playwright against the live test env.

## Manual reset + seed

```bash
cd workers/api
npx wrangler d1 execute pipe-db-test --env test --remote --file scripts/reset-test-db.sql
npx wrangler d1 execute pipe-db-test --env test --remote --file scripts/seed-test-db.sql
```
