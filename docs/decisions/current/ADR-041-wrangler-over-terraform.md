# ADR-041: Cloudflare-Native Deployment (Wrangler over Terraform)

**Status:** Accepted
**Date:** 2026-04-22
**Deciders:** Solo founder
**Supersedes:** `migration/PLAN.md` Phase 5 (CI/CD + Terraform + Cleanup)

## Context

The original migration plan specified Terraform as the infrastructure-as-code tool for the Cloudflare stack, in service of Design Principle #5: "Zero vendor lock-in — Swap any service by writing a new provider."

Upon review, this principle is already violated by the architecture itself:
- D1 (SQLite at edge) is Cloudflare-only
- Durable Objects are Cloudflare-only
- Workers (V8 isolates) are Cloudflare-only
- Cloudflare Containers (beta) are Cloudflare-only

Terraform provides state management and multi-provider portability, but it does not make D1 portable. The added complexity (state files, provider plugins, `terraform plan` overhead) yields no practical benefit for a 100% Cloudflare-native stack.

## Decision

Drop Terraform. Use Wrangler as the single deployment tool for all Cloudflare primitives (Workers, Pages, D1, R2, Durable Objects, Vectorize, Containers).

Deploy via GitHub Actions + `cloudflare/wrangler-action`.

## Consequences

### Positive
- **Simpler mental model:** One tool (Wrangler) instead of two (Wrangler + Terraform)
- **Faster deploys:** `wrangler deploy` is one command vs. Terraform plan/apply cycle
- **Native D1 migrations:** `wrangler d1 migrations apply` is the supported path
- **No state file management:** No S3 backend or state locking to maintain
- **First-class containers support:** Wrangler will be the GA path for Cloudflare Containers

### Negative
- **No drift detection:** Terraform's `plan` shows what will change. Wrangler deploy is imperative.
- **No multi-provider future:** If we ever add AWS/GCP resources, we'd need to adopt Terraform or a second tool at that time.
- **Vendor lock-in acknowledged:** We are explicitly choosing Cloudflare-native deployment for a Cloudflare-native stack.

## Migration

1. Delete `infra/` directory (all Terraform files)
2. Delete `amplify/` directory and artifacts
3. Create `.github/workflows/ci.yml`, `deploy-staging.yml`, `deploy-production.yml`
4. Update `workers/api/wrangler.jsonc` with `env.staging` and `env.production`
5. Set secrets via `wrangler secret put` for each environment

## Open Questions

- Should staging use separate D1/R2 resources? (Recommended: yes, to avoid polluting production data during E2E tests)
- How do we disable cron triggers in staging? (Either per-env cron config or runtime guard)
- Do we need a manual approval gate for production deploys? (Not for MVP; add later if team grows)
