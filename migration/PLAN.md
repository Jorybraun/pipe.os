# PIPE-OS Migration Plan: AWS Amplify to Cloudflare

---

## Research integration notice — 2026-04-08

**This document describes infrastructure and migration state. It is NOT the canonical product plan.** For the product design (what we are building and why), read `knowledge/STRATEGY.md` first. For code review and culture agent work specifically, the two research briefs (`knowledge/outputs/code-review-content-sourcing.md` and `knowledge/outputs/behavioral-culture-interview-agent.md`) + ADRs 029–033 are the source of truth.

**Key cross-references:**
- `knowledge/STRATEGY.md` — 78 research findings mapped to a phased plan with a Decision Log and guardrail rule
- `knowledge/INDEX.md` — navigation for the knowledge base
- ADR-032 — code review research integration (updates ADR-024 and ADR-026)
- ADR-033 — research integration strategy + plan guardrails

**Drift flagged for review (see ADR-032 for full list):**
- Phase 3c (implementer agent) — persona reactivity should be productized as versioned YAML; reactivity parameters named in the research brief Part 3.3
- Phase 6 (challenge experience) — needs updating to incorporate the rolling-freshness AIG content pipeline from ADR-032 Phase 3, not just hand-crafted repo presets
- Multi-PR challenge type (not in any phase doc yet) — code review sessions should bundle 3 PRs minimum per ADR-032 §Phase 1
- Gemma 4 12B consistency classifier — new Worker component, not yet represented in any phase doc (ADR-032 Phase 2)

---

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

| Phase | What | Status | Acceptance |
|-------|------|--------|------------|
| 0 | Provider abstraction layer | ✅ Done | `src/providers/{amplify,clerk}` both present; Clerk path is the live one |
| 1 | Listing + Pipeline Create | ✅ Done | `listing.spec.ts` 5/5; `/pipeline/new` now routes to Role Discovery Agent (replaced original PipelineCreatePage) |
| 2 | Stage Detail + Overview + Challenge Editor | 🟡 Done + drifted | All routes live (`pipelines`, `stages`, `challenges`, `overview`); editor BDD specs broken from UI redesign drift |
| 3 | Candidate Profile + Assessment | ✅ Done | `candidate-profile.spec.ts` 22/22, `candidate-resume.spec.ts` 14/14 |
| 3b | Dev Containers (ECS → CF Containers) | ⏸️ Paused | `DevContainerSandboxPage` exists but no `containers` route in Worker; not blocking MVP |
| 3c | Implementer Agent (multi-turn code review) | ✅ Done | `implementerAgent.ts` + `/api/v1/review-sessions` live; Phase E (frontend wiring) shipped — 8/8 E2E green at time of commit |
| 4 | Real-time signaling + Scheduling | ✅ Done (expanded) | Video DO with Hibernation API, WebRTC signaling, Calendly/Cal.com OAuth, scheduling webhooks |
| 5 | CI/CD + Terraform + Cleanup | ❌ Not started | `amplify/`, `amplify_outputs.json`, `amplify.yml` still in repo |
| 6 | Challenge Experience — Real Repo Pipelines | 🟡 Partial | `presets.ts` exists, `github` route imports PRs, but "3 curated pipelines" not assembled |
| 7 | Sourcing & Matching — Two-Lane Candidate Ingestion | ⏸️ Deferred | Autonomous matcher + manual search bar share one backend; one-click invite drops into existing flow. **Deferred until Phases 5–6 ship.** |

Legend: ✅ done · 🟡 partial / drifted · ⏸️ paused or deferred · ❌ not started

---

## Current State — 2026-04-06

The migration is functionally past the original Phase 4 boundary, but several major systems were built mid-stream that the original phase docs never captured. This section is the honest snapshot.

### What's working (verified by route mounts + recent commits)

**Workers backend** — `workers/api/src/index.ts` mounts 17 route modules:
- `pipelines`, `stages` (×3 nested), `challenges`, `github`, `overview`
- `candidates`, `email`, `challengeSubmissions`, `reviewSessions`
- `scheduling` (public + auth — Calendly/Cal.com OAuth + webhooks)
- `phone` (public + auth — Twilio webhooks, recordings, Deepgram transcription)
- `video` (recruiter auth + candidate WS) backed by `VideoRoom` Durable Object
- `roleContexts` (Role Discovery Agent — multi-stakeholder)
- `rpc` (candidate-facing public + auth)

**D1 migrations 0001–0012 applied:**
1. `create_pipelines` 2. `recruiter_core` 3. `candidate_flow` 4. `review_sessions` 5. `comprehension_mode` 6. `stage_config` 7. `scheduling` 8. `phone_screening` 9. `screening_format` 10. `stage_config_columns` 11. `role_contexts` 12. `role_context_participants`

**AI surface** (all server-side Mistral, with mock fallback):
- `roleAgent` — Discovery Agent w/ ReAct + tool calling (research_company, search_technology)
- `scorerAgent` — code review scoring panel
- `implementerAgent` — multi-turn code review pushback/clarify/fix
- `comprehensionScorer` — Ask-tab comprehension scoring
- `explainerAgent` — Ask-tab Q&A
- `jdParser`, `cvParser` — structured extraction from JD/PDF/CV

**Frontend pages live:** ListingPage, OverviewPage (with role profile tabs), RoleDiscoveryPage (replaces PipelineCreatePage at `/pipeline/new`), StageDetailPage (with config wizard), PipelineBuilderPage, ChallengeEditorPage, CandidateProfilePage (with phone drawer + call log), CandidateAssessmentPage.

### Systems added since the original PLAN was written

These were not in any phase doc when this plan was authored. They are now production code and need to be reflected in roadmap thinking:

| System | Where it lives | Status |
|--------|----------------|--------|
| **Role Discovery Agent** (ADR-027) | `workers/api/src/{routes/roleContexts,lib/roleAgent,lib/roleAgentPrompts,lib/jdParser}` + `RoleDiscoveryPage` | ✅ Live, replaces manual pipeline create |
| **Multi-Stakeholder Discovery** (ADR-028) | Same + `participantAuth` middleware + `0012` migration | ✅ Live |
| **Voice-first interview UI** | `RoleDiscoveryPage` + Workers AI Whisper transcribe route | ✅ Live |
| **Phone screening** (Twilio + Deepgram) | `routes/phone`, `lib/twilioAuth`, `lib/transcribe`, `PhoneCallDrawer`, `useTwilioDevice` | ✅ Live |
| **Scheduling** (Calendly/Cal.com OAuth) | `routes/scheduling`, `SchedulingDashboard` (migrated off Amplify) | ✅ Live |
| **Video infrastructure** (DO Hibernation API + WebRTC) | `durable-objects/VideoRoom`, `routes/video`, `useVideoRoom` | ✅ Live |
| **Code Review "Ask" tab** (comprehension + explainer) | `lib/comprehensionScorer`, `lib/explainerAgent` | ✅ Live |
| **Stage config wizard** (multi-step) | `StageConfigPanel`, `PipelineBuilderPage` | ✅ Live |
| **Theme system** (light/dark, per-recruiter) | CSS variable tokens across 50+ components, settings panel | ✅ Live |
| **AI agent mocking** | `lib/mockResponses` + agent fallback when API key missing | ✅ Live |

### Known issues and unfinished work

**Migration cleanup (Phase 5 — blocking "done"):**
- `amplify/` directory still present (auth/data/functions/storage)
- `amplify_outputs.json` (82KB) still in repo root
- `amplify.yml` still in repo root
- No Terraform yet
- No GitHub Actions deployment workflow committed

**Test drift (blocks confidence in shipping):**
- `TEST_STATUS.md` (2026-03-31) says 61/7 files verified; commit messages from same day claim 159 BDD tests passing — these need reconciling
- `bug-regression.spec.ts` and `bug-regression-2.spec.ts` — 27 failing each, likely UI regressions from theme/wizard rework
- Editor specs (`challenge-editor`, `code-impl-editor`, `code-review-editor`, `short-answer-editor`) — locator drift from UI redesign
- `multi-turn-api.spec.ts` — 10 failing, likely DB schema or 502 Worker errors
- `pipeline-create.spec.ts` — 6/9, 3 timing flakes
- `bug-regression*` specs may be obsolete entirely now that Role Discovery Agent replaces the old create flow — needs triage

**Phase 6 (Challenge Experience) — partially built:**
- `lib/presets.ts` exists but small (5.7KB)
- `routes/github` can fetch PRs
- The "3 curated pipeline presets" deliverable is not assembled
- No documented "one repo → review → follow-up → implement" end-to-end demo

**Phase 3b (Dev Containers) — paused:**
- `DevContainerSandboxPage.tsx` and `DevContainerTestPage.tsx` exist
- No `containers` route in `workers/api/src/index.ts`
- No Cloudflare Containers binding in `wrangler.jsonc` (last verified)
- Decision needed: ship without dev containers (use Phase 7 instead) or revive

### What this means for sequencing

The honest read: **the system is feature-rich but unstable at the seams.** Too many half-finished integrations. Before Phase 7 (Sourcing & Matching) can even be contemplated, the following must close:

1. **Test triage week** — reconcile TEST_STATUS.md vs. commit claims; delete obsolete bug-regression specs; fix or quarantine editor locator drift; get to a green baseline that reflects the current UI.
2. **Phase 5 cleanup** — Terraform, GitHub Actions deploy, delete `amplify/` once Workers parity is verified end-to-end.
3. **Phase 6 closeout** — assemble at least 1 (not 3) curated repo preset with the full review→follow-up→implement loop, prove it end-to-end with a real recruiter.
4. **Phase 3b decision** — explicitly kill or revive dev containers. No more limbo.

Only then does Phase 7 (Sourcing) become a sane next bet. **No new integrations until the existing ones stabilize.**

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
- [Phase 3b: Dev Containers — ECS to Cloudflare Containers](./phase-3b-dev-containers.md)
- [Phase 4: Real-time Signaling + Scheduling](./phase-4-realtime.md)
- [Phase 5: CI/CD + Terraform + Cleanup](./phase-5-cicd-terraform.md)
- [Phase 6: Challenge Experience — Real Repo Pipelines](./phase-6-challenge-experience.md)
- [Phase 7: Sourcing & Matching — Two-Lane Candidate Ingestion](./phase-7-sourcing-matching.md) *(deferred)*
