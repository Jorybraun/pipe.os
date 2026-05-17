# ADR-037. Dev Containers on Cloudflare — Durable-Object-Backed code-server with Configurable TTL

**Date:** 2026-04-11
**Status:** Accepted
**Supersedes:** [ADR-016](ADR-016-dev-container-architecture.md)
**Related:** ADR-017 (Worker auth model), ADR-018 (D1 schema conventions)
**Author:** Claude Opus 4.6 (with founder)

---

## Context

ADR-016 put the dev container runtime on AWS ECS Fargate with five Amplify Lambdas (`devContainerLaunch`, `devContainerDestroy`, `devContainerStatus`, `ecsStatusBridge`, `getContainerLogs`), an ALB, a NAT gateway, an EventBridge rule, an ECR repo, and a DynamoDB `DevContainerSession` model stitched together by ~200 lines of CDK in `amplify/backend.ts`. Cold start was 30–60s, fixed cost was ~$48/month before the first candidate, and the code was part of the "stale systems" set the founder wanted to prune during the Phase 3 Cloudflare migration.

Three gaps forced a redesign rather than a lift-and-shift:

1. **No configurable TTL.** Containers were hard-destroyed at a fixed cutoff with no per-challenge knob and no warning before expiry. Recruiter queries couldn't distinguish "candidate clicked Destroy" from "TTL ran out."
2. **Five-Lambda sprawl.** The real-time status bridge (`ecsStatusBridge`) existed only because ECS events needed translation into AppSync subscriptions. Consolidating the runtime onto the same platform as the rest of the API would delete that whole layer.
3. **Vendor diffusion.** Fly.io was ~2.4× cheaper per running hour, but the $10–15/month savings at phase-one volume didn't justify adding a sixth vendor to a solo-founder setup. Cloudflare was already hosting Workers, D1, R2, and Pages.

---

## Decision

**Move the dev container runtime to Cloudflare Containers (beta), backed by a single Durable Object per session.** Each session is a `DevContainerDO` instance keyed by `sessionId` (UUID). The DO extends `Container` from `@cloudflare/containers`, runs a `codercom/code-server:4.22.1` image on `standard-1` (1 vCPU / 2 GB), and owns the full lifecycle: launch, status writes to D1, HTTP/WebSocket proxy passthrough, and TTL-driven destroy.

### Architecture

```
Browser (DevContainerSandboxPage + useDevContainerSession)
   │
   │  POST /rpc/dev-container/launch         (candidate JWT)
   │  GET  /rpc/dev-container/:sid/status
   │  POST /rpc/dev-container/:sid/destroy
   │  ALL  /rpc/dev-container/:sid/proxy/*   ← iframe src
   ▼
workers/api (Hono)
  routes/assessment/devContainer.ts
    └─ [candidateAuth] → D1 ownership check → stub.fetch(req)
   │
   ▼
DevContainerDO  (Durable Object, one per sessionId)
  extends Container<Env>     defaultPort = 8080
  sleepAfter = "10m"         instanceType = "standard-1"
    │
    ├─ /__init     → persist config, schedule(warnAt, 'onWarn'),
    │                 markStatus('READY')
    ├─ *           → container.fetch(req)   (proxy passthrough)
    ├─ onWarn()    → markWarned, schedule(expiresAt, 'onExpire')
    └─ onExpire()  → destroy(), markExpired, deleteAll
    │
    ▼
Container (Cloudflare)
  codercom/code-server:4.22.1 + entrypoint (clones repo from R2)
    │
    ▼
D1.dev_container_sessions
  status | ttl_seconds | ttl_source | expires_at | warned_at | url
```

### Three-layer TTL

Resolved once in `computeEffectiveTtl()` (`workers/api/src/lib/devContainerTtl.ts`):

1. **Global default** — `DEV_CONTAINER_DEFAULT_TTL_SECONDS` (wrangler var, default `3600`)
2. **Per-challenge** — `challenges.dev_container_ttl_seconds` INTEGER column (nullable)
3. **Per-launch admin override** — `ttlSecondsOverride` body field, honored only when `X-Pipe-Admin-Override: <secret>` matches `ADMIN_TTL_OVERRIDE_SECRET` (used by E2E tests and founder debugging)

Precedence: `override ?? challengeTtl ?? globalDefault`, clamped to `[MIN_TTL_SECONDS=30, DEV_CONTAINER_MAX_TTL_SECONDS=7200]`. The chosen value AND its source (`'GLOBAL' | 'CHALLENGE' | 'OVERRIDE'`) are persisted on `dev_container_sessions` so the cockpit can answer *"why did this session die at minute 15"*.

### Warn-then-expire bisection

Durable Objects support only one pending alarm at a time, which would normally force a single-handler model. `@cloudflare/containers` provides `this.schedule<T>(when, callback, payload)` which multiplexes named callbacks on top of the underlying sqlite-backed alarm.

`handleInit` schedules `onWarn` at `expiresAt − WARN_BEFORE_SECONDS` (default 60s). When `onWarn` fires it writes `warned_at` to D1 (the frontend hook reads this column to flip `expiringSoon` and render the countdown banner) and reschedules `onExpire` at the real `expiresAt`. If the configured TTL is shorter than the warn window — e.g. admin override = 30s with warn = 60s — the handler skips the warning and schedules `onExpire` directly.

Dispatch is reflective: the scheduler calls `this[row.callback](...)`, so `onWarn` and `onExpire` must be **public** methods. Private or arrow-bound handlers break the dispatch.

### EXPIRED vs STOPPED — the load-bearing distinction

The status enum is `LAUNCHING | READY | SLEEPING | ERROR | STOPPED | EXPIRED`. `STOPPED` is written by `POST /destroy` — candidate clicked the button. `EXPIRED` is written by `onExpire()` — TTL ran out. The cockpit query at `/api/v1/pipelines/:id/dev-container-sessions` exposes both, along with `ttl_source` and `warned_at`, so a recruiter can reconstruct whether a session ended because the candidate submitted early or because they ran out the clock.

### Frontend hook — source-compatible superset

`useDevContainerSession` keeps its existing state machine (`IDLE → LAUNCHING → BOOTING → READY → DESTROYING → ERROR`) and adds two new return fields: `expiresAt: string | null` and `expiringSoon: boolean` (derived from `warned_at`). Legacy callers that ignore those fields continue to work.

Switching between the Cloudflare path and the legacy AppSync path is controlled by `VITE_USE_CLOUDFLARE_DEV_CONTAINERS`. To preserve React's rules of hooks across the flag flip the public `useDevContainerSession()` is a **dispatcher** that always calls both `useDevContainerSessionCloudflare()` and `useDevContainerSessionAppSync()` and returns the flag-selected value. The idle branch stays in `IDLE` with `sessionId === null` and issues no network traffic.

The iframe `src` is `${API_BASE}/rpc/dev-container/${sessionId}/proxy/?token=${candidateJwt}`. The Worker's `candidateAuth` middleware accepts `?token=` as a fallback for WebSocket upgrades, which is the only way to pass a JWT into an iframe (iframes cannot set `Authorization` headers).

---

## Consequences

**Wins:**

- **Five Lambdas → zero.** The launch, destroy, status, EventBridge bridge, and log Lambdas are all deleted. The DO owns everything.
- **No ALB, no NAT, no EventBridge rule, no ECR.** Cloudflare routes to the container via the DO stub.
- **Per-challenge TTL knob** ships as a first-class column with a three-layer resolver, not an ad-hoc env var.
- **60s warning banner** lets candidates save their work instead of losing context to a hard cutoff.
- **EXPIRED vs STOPPED** lets recruiters see whether a candidate ran out the clock or submitted early.
- **Cold start** drops from 30–60s (ECS task boot) to ~2–5s (DO cold start + container start) in the common case.
- **Fixed cost** drops from ~$48/month (ALB + NAT + EventBridge) to ~$0 until the first candidate launches a container.

**Costs:**

- Cloudflare Containers is **beta**. The `@cloudflare/containers` npm package exports a `Container` base class that is still evolving — callback dispatch, image resolution, and local `wrangler dev` ergonomics may change between minor versions. Pin the version in `package.json` and read the changelog before upgrading.
- `wrangler dev` support for container images requires Docker locally. The E2E tests at `e2e/dev-container-happy.spec.ts` and `e2e/dev-container-ttl.spec.ts` are designed to run without a live container (the DO flips D1 to READY before calling `super.fetch`, and `destroy()` is wrapped in try/catch), so the REST-level happy path is exercisable on a laptop without Docker. The full browser-iframe smoke test still needs Docker.
- `max_instances: 50` is an opinionated cap on concurrent dev container sessions. Above that Cloudflare will reject new launches. Adjustable anytime in `wrangler.jsonc`.

**Risks accepted:**

- **Single-region.** Cloudflare Containers pins each DO instance to a region chosen at creation time. Candidates will see 50–150ms extra latency from the other side of the world. Acceptable for an async coding interview; not acceptable for real-time voice.
- **No built-in log streaming yet.** The old `getContainerLogs` Lambda scraped CloudWatch. The replacement path is `wrangler tail` for development and a follow-up `/rpc/dev-container/:sid/logs` stream-proxy route for recruiters. Not in scope for Phase 3b.

---

## Cutover and rollback

Both code paths coexist behind `VITE_USE_CLOUDFLARE_DEV_CONTAINERS`. Flip dev → preview → prod. Rollback is a single env var flip back to `false`; no data migration needed because `submitChallengeResponse` (the endpoint that captures candidate code) is unaffected.

After 7 days of green prod traffic on the Cloudflare path:

1. Delete `amplify/functions/{devContainerLaunch,devContainerDestroy,devContainerStatus,getContainerLogs,ecsStatusBridge}/`
2. Clean `devContainer*` and `ecsStatusBridge` imports/IAM policies/EventBridge wiring from `amplify/backend.ts`
3. Remove the `DevContainerSession` model and `launchDevContainer`/`destroyDevContainer`/`getContainerStatus`/`getContainerLogs` definitions from `amplify/data/resource.ts`
4. Archive `infra/ecs.tf`, `infra/alb.tf`, `infra/networking.tf`, `infra/eventbridge.tf` to `docs/archive-amplify/infra/`
5. `terraform destroy` the ECS cluster, ALB, target groups, SG, EventBridge rule, NAT gateway
6. Manually delete the ECR repo and CloudWatch log group

Steps 1–4 are mechanical and can be scripted. Steps 5–6 are destructive AWS operations and must be run with the founder supervising.

---

## Verification

**Unit tests (green at commit):**

```
workers/api/src/lib/__tests__/devContainerTtl.test.ts     — precedence + clamping (6 cases)
workers/api/src/__tests__/DevContainerDO.test.ts          — alarm scheduling, warn-then-expire (11 cases)
workers/api/src/__tests__/devContainer.rest.test.ts       — launch/status/destroy/TTL/admin override
```

**E2E (requires wrangler dev + frontend dev + admin secret for the TTL spec):**

```
e2e/dev-container-happy.spec.ts      — launch → READY → destroy → STOPPED + cockpit
e2e/dev-container-ttl.spec.ts        — forced 30s TTL → onWarn → onExpire → EXPIRED + cockpit
```

The TTL spec is the primary acceptance gate: it proves the warn alarm fires, the destroy alarm fires, and the cockpit sees `EXPIRED`. Wall clock ~35s.
