# PIPE-OS Migration Plan: AWS Amplify to Cloudflare

## Why

AWS froze Lambda access on account 051912473486 due to unresolved business verification.
Amplify Gen 2 depends entirely on Lambda — no Lambda, no deploys.
This migration eliminates single-vendor lock-in permanently.

## Target Architecture

```
Frontend:  Cloudflare Pages (React + Vite + TypeScript)
API:       Cloudflare Workers (Hono router, V8 isolates)
Database:  Cloudflare D1 (SQLite at edge)
Storage:   Cloudflare R2 (S3-compatible, zero egress)
Auth:      Clerk Pro ($25/mo — auth + billing + feature gating)
Billing:   Clerk Billing (Stripe under the hood, 3.6% + $0.30/txn)
Email:     Resend (3K emails/mo free)
Realtime:  Cloudflare Durable Objects + WebSockets (video signaling)
           Polling for non-latency-sensitive updates (scheduling, interviews)
Containers: Cloudflare Containers (Beta) — replaces Fly.io for dev sandboxes
IaC:       Terraform (deterministic, multi-provider)
CI/CD:     GitHub Actions + Cloudflare Wrangler + Terraform
```

## Design Principles

1. **Provider-agnostic data layer** — Frontend never imports a cloud SDK directly
2. **Page-by-page migration** — Each page migrates independently with BDD tests
3. **No big bang** — Every phase produces a working, tested app
4. **Deterministic deployments** — Terraform + GitHub Actions, no magic
5. **Zero vendor lock-in** — Swap any service by writing a new provider

## Migration Phases

| Phase | What | Pages | Acceptance |
|-------|------|-------|------------|
| 0 | Provider abstraction layer | None (infrastructure) | All existing functionality works through abstraction |
| 1 | Listing + Pipeline Create | `/`, `/pipeline/new` | BDD tests pass on Cloudflare |
| 2 | Stage Detail + Overview + Challenge Editor | `/pipeline/:id/stages/:stageId`, `/pipeline/:id`, `/pipeline/:id/challenges/:challengeId` | BDD tests pass on Cloudflare |
| 3 | Candidate Profile + Assessment | `/candidates/:id`, `/assess/:token` | BDD tests pass on Cloudflare |
| 4 | Real-time signaling + Scheduling | `/schedule` | WebSocket signaling works, BDD tests pass |
| 5 | CI/CD + Terraform + Cleanup | N/A | Deterministic deploys, delete `amplify/` |

## Pricing Model

| Plan | Price | Candidates/month | Features |
|------|-------|-------------------|----------|
| Free | $0 | 3 | Basic scoring only |
| Pro | $40/month | Unlimited | Full AI scoring + intelligence reports + follow-ups |

Clerk handles billing via `<PricingTable />` component + `has()` feature gating.

## Cost at Scale

| Monthly volume | Fixed costs | AI cost | Revenue (Pro) | Margin |
|---------------|-------------|---------|---------------|--------|
| 1 customer, 10 candidates | $30 (CF $5 + Clerk $25) | $0.30 | $40 | $9.70 |
| 5 customers, 50 candidates | $30 | $1.50 | $200 | $168.50 |
| 50 customers, 500 candidates | $30 | $15 | $2,000 | $1,955 |

Per-candidate AI cost: ~$0.02-0.05 (Mistral). Could upgrade to Claude for ~$0.20/candidate with room in the margin.

## Cross-Cutting Conventions

These apply across all phases. Validated against Cloudflare official documentation (2026-03-28).

### Auth Strategy
- **Recruiter auth:** Clerk Pro — `@clerk/clerk-react` on frontend, `@clerk/backend` JWT verification in Workers
- **Candidate auth:** Custom JWT session tokens (no Clerk, no sign-in required)
- **Billing:** Clerk Billing — `<PricingTable />` for pricing page, `has()` for feature gating
- **Exit strategy:** Clerk auth is isolated behind the provider abstraction (`src/providers/amplify/auth.tsx` → `src/providers/clerk/auth.tsx`). User data (email, password hash) lives in D1 if we ever need to migrate off Clerk — export users via Clerk API, switch to DIY auth, one provider file change.

### API Path Convention
- **`/api/v1/*`** — Recruiter-facing routes, authenticated via Clerk JWT
- **`/rpc/*`** — Candidate-facing routes, authenticated via custom session JWT or public
- All phases use this split consistently. Phase 1 routes are `/api/v1/pipelines`, not `/api/pipelines`.

### Wrangler Configuration
- Use **`wrangler.jsonc`** (not `wrangler.toml`). Cloudflare recommends `.jsonc` for comment support and documentation.

### D1 Schema Evolution
- Phase 1 creates initial tables (`pipelines`, `stages`, `challenges`).
- Subsequent phases extend tables via `ALTER TABLE ADD COLUMN` migrations, **not** `CREATE TABLE` redefinitions.
- Each phase's migration files are numbered sequentially: `0001_create_pipelines.sql`, `0002_recruiter_core.sql`, etc.
- D1 enforces foreign key constraints by default (`PRAGMA foreign_keys = ON`).

### Workers CPU Time Limits
- Workers have a **30-second CPU time limit** on the paid plan. Network wait time (AI API calls) does not count toward this.
- For fire-and-forget operations (scoring, report generation), use `ctx.waitUntil()` to avoid blocking the HTTP response.
- Chain at most one external AI call per request handler.

### R2 Presigned URLs
- Presigned URLs use the S3-compatible endpoint (`<ACCOUNT_ID>.r2.cloudflarestorage.com`), not custom domains.
- R2 object keys visible in presigned URLs must use opaque random identifiers, not internal entity IDs (security requirement).

### Frontend Deployment
- Currently planned as Cloudflare Pages. Cloudflare is consolidating Pages into Workers with static assets — monitor for deprecation signals and be prepared to migrate.

---

## Detailed Phase Plans

Each phase has its own document with:
- BDD user journeys (Given/When/Then)
- Strict acceptance criteria
- Implementation task list
- Files to create/modify/delete

See:
- [Phase 0: Provider Abstraction](./phase-0-abstraction.md)
- [Phase 1: Listing + Pipeline Create](./phase-1-listing-pipeline.md)
- [Phase 2: Stage Detail + Overview + Challenge Editor](./phase-2-recruiter-core.md)
- [Phase 3: Candidate Profile + Assessment](./phase-3-candidate-flow.md)
- [Phase 4: Real-time Signaling + Scheduling](./phase-4-realtime.md)
- [Phase 5: CI/CD + Terraform + Cleanup](./phase-5-cicd-terraform.md)
