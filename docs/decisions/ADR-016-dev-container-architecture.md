# ADR-016. Dev Container Architecture — ECS Fargate + AppSync Real-Time Status

**Date:** 2026-03-06
**Status:** Accepted
**Author:** Archer (Principal Architect)
**Stakeholders:** Solo founder / product engineering

---

## Context and Problem Statement

Pipe needs to give candidates a live, browser-based coding environment during technical assessments. The environment must:

1. Spin up on demand (per interview session, not per user)
2. Be isolated — one container per candidate, no shared state
3. Report status back to the frontend in real time (candidates and recruiters need to see when a container is ready, without polling)
4. Tear down automatically when the session ends

The platform already uses AWS Amplify Gen 2 (AppSync, DynamoDB, Lambda, Cognito). Any new infrastructure must fit within that ecosystem or extend it without creating a separate ops surface.

**Trigger:** Phase 7 of the roadmap adds `CODE_IMPLEMENTATION` challenges. Without a live runtime, these cannot be executed or scored server-side.

---

## Decision Drivers

- **Isolation per session** — each candidate must get a clean, sandboxed environment
- **Browser-accessible IDE** — the environment must be reachable over HTTPS from any browser with no local tooling
- **Real-time status** — the UI must update without polling; AppSync subscriptions are the standard push mechanism in this stack
- **Minimal ops overhead** — solo founder, no DevOps team; managed services preferred
- **Cost** — containers run for ~60 minutes max; pay-per-use is essential
- **Must integrate with existing Amplify stack** — no new auth layers, reuse AppSync / DynamoDB

---

## Considered Options

### Option 1: AWS ECS Fargate + code-server (Chosen)

Run a Fargate task per session using `codercom/code-server` as the container image. code-server is VS Code running in a Docker container with a browser-accessible HTTP server on port 8080.

**Architecture:**
- `devContainerLaunch` Lambda → `ECS.RunTask` → Fargate task starts
- EventBridge captures `ECS Task State Change` events → `ecsStatusBridge` Lambda → AppSync `DevContainerSession` model mutation
- Frontend subscribes to `DevContainerSession.onUpdate()` — no polling
- `devContainerDestroy` Lambda → `ECS.StopTask` when session ends

**AWS Amplify Alignment:** High — Lambdas are native Amplify functions; AppSync subscriptions are the platform's real-time primitive; EventBridge integrates via CDK in `backend.ts`.

**Pros:**
- True isolation — Fargate task = VM-level isolation, clean on every launch
- No servers to manage — fully managed compute
- Pay per second — tasks stopped after session; idle cost is zero
- code-server gives full VS Code experience in browser
- ECS events via EventBridge give reliable, push-based lifecycle callbacks
- AppSync subscriptions fit exactly into the existing Amplify auth/data model

**Cons:**
- Cold start latency (~30–60 seconds for Fargate task provisioning)
- Requires ALB for routing session traffic to the correct task (complex routing layer)
- Password management is a future security concern (currently sessionId = password)
- ECS + ALB adds IAM surface area not native to Amplify CDK

**Estimated Effort:** ~2 days for core flow; 1–2 days for ALB routing infra

---

### Option 2: AWS Cloud9 Environments

Use the AWS Cloud9 API to create managed development environments per session.

**Pros:**
- Fully managed, no container ops
- Built-in browser IDE with terminal

**Cons:**
- Cloud9 is deprecated (AWS announced end-of-life; no new environments can be created in most regions)
- No API for programmatic creation of environments at scale
- Not cost-effective for short-lived interview sessions
- Cannot customize the IDE experience (no custom extensions, themes, or pre-loaded code artifacts)

**Verdict:** Eliminated. Cloud9 is deprecated.

---

### Option 3: GitHub Codespaces / external managed environments

Spin up a GitHub Codespace or similar (Gitpod, Replit) per candidate via their APIs.

**Pros:**
- Zero infrastructure management
- Best-in-class IDE experience

**Cons:**
- Requires candidates to have GitHub accounts (breaks zero-friction candidate flow)
- API rate limits and pricing not designed for short-lived programmatic sessions
- No control over branding, challenge pre-loading, or data capture
- Data sovereignty concerns — candidate code lives in a third-party system
- Cannot integrate with AppSync for real-time status updates

**Verdict:** Eliminated. Breaks the zero-signin candidate requirement and data ownership model.

---

### Option 4: AWS Lambda + ephemeral sandbox (e.g., Firecracker/microVMs)

Run each candidate's code in an ephemeral Lambda execution context or a microVM (Firecracker).

**Pros:**
- Extremely fast cold start (ms vs seconds)
- No networking complexity
- Already using Lambda for scoring

**Cons:**
- No persistent IDE — not suitable for open-ended `CODE_IMPLEMENTATION` challenges
- Lambda has a 15-minute execution limit; dev sessions can run longer
- Cannot provide a browser-accessible terminal or file system
- Would require building a custom IDE layer from scratch

**Verdict:** Eliminated for IDE-based challenges. Still valid for executing individual code snippets (Piston API covers this already).

---

## Decision Outcome

**Chosen Option:** Option 1 — ECS Fargate + code-server

**Justification:**

ECS Fargate is the only option that provides:
1. True per-session isolation with a full Linux filesystem
2. A browser-accessible VS Code IDE with no client-side installation
3. Programmatic launch/stop via AWS SDK
4. EventBridge integration for reliable, push-based lifecycle events
5. Pay-per-second billing aligned to session duration

The AppSync subscription model (via `DevContainerSession.onUpdate()`) fits perfectly — the `ecsStatusBridge` Lambda translates ECS events into Amplify Data model mutations, which the frontend receives in real time without any polling.

Cloud9 is deprecated. External services (Codespaces, Gitpod) break the zero-signin candidate flow. Lambda/microVMs cannot provide a persistent IDE session.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                         │
│                                                                 │
│  [Launch] ──► launchDevContainer mutation ──► AppSync          │
│  [Subscribe] DevContainerSession.onUpdate() ◄── AppSync Push   │
│  [iframe] https://env.pipe.dev/session/{sessionId}              │
└───────────────────┬─────────────────────────────────────────────┘
                    │ AppSync mutation
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│               devContainerLaunch Lambda                         │
│                                                                 │
│  ECS.RunTask(cluster, taskDef, env: SESSION_ID, PASSWORD)       │
│  Returns: { taskArn, status: 'PROVISIONING' }                   │
└───────────────────┬─────────────────────────────────────────────┘
                    │ ECS task starts (Fargate, ~30-60s)
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│         ECS Fargate Task (pipe-dev-containers cluster)          │
│                                                                 │
│  Image: codercom/code-server:latest                             │
│  Port: 8080 (code-server HTTP)                                  │
│  Env: SESSION_ID, PASSWORD                                      │
└───────────────────┬─────────────────────────────────────────────┘
                    │ EventBridge: ECS Task State Change
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│               ecsStatusBridge Lambda                            │
│                                                                 │
│  RUNNING → status=READY, url=https://env.pipe.dev/session/...   │
│  STOPPED → status=STOPPING                                      │
│  Writes to: DevContainerSession (Amplify Data / DynamoDB)       │
└───────────────────┬─────────────────────────────────────────────┘
                    │ AppSync mutation → subscription push
                    ▼
┌─────────────────────────────────────────────────────────────────┐
│         DevContainerSession model (DynamoDB via AppSync)        │
│                                                                 │
│  Fields: taskArn, sessionId, status, url, startedAt            │
└─────────────────────────────────────────────────────────────────┘
```

---

## Consequences

### Positive

- **Low-latency status updates** — AppSync subscription delivers READY within ~2s when active; 5s polling provides a reliable catch-all fallback
- **True isolation** — Fargate tasks are VM-level isolated; no shared filesystem between candidates
- **Elastic scaling** — Fargate launches tasks on demand; no pre-provisioned capacity required
- **Familiar IDE** — code-server provides VS Code, which candidates already know
- **Clean teardown** — `ECS.StopTask` is atomic; `STOPPED` event is reliably emitted
- **Fits Amplify model** — `DevContainerSession` is a standard Amplify Data model with auth rules and subscriptions

### Negative

- **30–60s cold start** — Fargate provisioning is slow relative to Lambda; candidates see a loading screen
- **ALB complexity (outstanding)** — routing `env.pipe.dev/session/{id}` to the correct Fargate task ENI requires an Application Load Balancer with dynamic target group registration or a custom routing Lambda; this is **not yet built**
- **Password in ECS task metadata** — using sessionId as code-server password exposes it in CloudWatch logs and ECS API responses; must be replaced before production
- **Manual ECS IAM** — Amplify CDK does not natively model ECS resources; IAM policies are added via raw `PolicyStatement` blocks in `backend.ts`, creating a maintenance gap

### Neutral

- Container image (`codercom/code-server`) is third-party maintained; must track upstream for security patches
- Task definition revision must be updated manually in `backend.ts` when the image or config changes (`pipe-code-server:1` → `:2`, etc.)
- `ssmEnv = process.env.USER` prefix in `backend.ts` works locally but breaks `pipeline-deploy`; fix to `AWS_BRANCH || USER` is pending

---

## Implementation

**ECS Infrastructure (provisioned 2026-03-06, us-west-2, account 642351122747):**

| Resource | Value |
|---|---|
| Cluster | `arn:aws:ecs:us-west-2:642351122747:cluster/pipe-dev-containers` |
| Task definition | `pipe-code-server:1` |
| IAM execution role | `arn:aws:iam::642351122747:role/pipe-ecs-task-execution` |
| Security group | `sg-03ec946d1d7a814cf` (port 8080 open — lock to ALB before prod) |
| Subnets | 4 default VPC subnets across AZs a/b/c/d in us-west-2 |

**Amplify Resources Affected:**
- `amplify/data/resource.ts` — `DevContainerSession` model, `launchDevContainer` / `destroyDevContainer` / `getContainerStatus` mutations
- `amplify/functions/devContainerLaunch/` — `ECS.RunTask` handler
- `amplify/functions/devContainerDestroy/` — `ECS.StopTask` handler
- `amplify/functions/devContainerStatus/` — `ECS.DescribeTasks` handler
- `amplify/functions/ecsStatusBridge/` — EventBridge → AppSync bridge
- `amplify/backend.ts` — IAM policy wiring, env vars, EventBridge rule

**Outstanding before production:**
1. Provision ALB with session-based routing (path `/session/{id}` → task ENI:8080)
2. Fix `ssmEnv` to `process.env.AWS_BRANCH || process.env.USER || 'default'`
3. Replace sessionId password with Secrets Manager–backed random token
4. Scope ECS IAM resources from `*` to specific cluster/task ARNs
5. Lock security group inbound to ALB source only

**Rollback Plan:**
- Remove the EventBridge rule and `ecsStatusBridge` Lambda → frontend continues to work via `getContainerStatus` polling every 5s (implemented as `POLL_INTERVAL_MS = 5_000` in `useDevContainerSession`)
- The Fargate task itself is stateless — stopping it leaves no residual state
- `DevContainerSession` model can be cleared via `purgeTestData.ts` pattern

---

## Validation

**How we'll measure success:**
- Container READY state delivered to frontend within 90 seconds of `launchDevContainer` mutation
- AppSync subscription delivers READY as fast path; 5s polling catches any missed events (page refresh, multi-auth gap)
- Container URL loads VS Code in browser iframe without authentication friction
- `destroyDevContainer` stops the task within 5 seconds; `DevContainerSession.status` updates to `STOPPING` via subscription

**Confirmed working (2026-03-06):**
- End-to-end test passed: IDLE → LAUNCHING → BOOTING → READY with green status dot and iframe
- Poll confirms PROVISIONING every 5s then flips to READY — no stuck-at-BOOTING regression
- Bugs resolved during prototype phase:
  - ECS execution role missing `logs:CreateLogGroup` → added `CloudWatchLogsPolicy` inline to `pipe-ecs-task-execution`
  - `ecsStatusBridge` upsert failed because Amplify optimistic locking returns "conditional request failed" (not "not found") on missing items → broadened `isNotFound` check
  - UI stuck at BOOTING when AppSync subscription missed the READY event (page refresh, multi-auth delivery gap) → replaced 120s one-shot timeout with 5s periodic polling + immediate first check

**Review Date:** 2026-06-01 (after first production interview using live containers)

---

## References

- [ECS Fargate documentation](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [code-server (Coder)](https://github.com/coder/code-server)
- [AppSync real-time subscriptions](https://docs.aws.amazon.com/appsync/latest/devguide/real-time-data.html)
- [EventBridge ECS events](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/ecs_cwe_events.html)
- [HAS-46 — Production Readiness Audit (Linear)](https://linear.app/hash-pipe/issue/HAS-46/dev-container-production-readiness-audit)

---

## Related Decisions

- [ADR-001](ADR-001-amplify-gen2-backend.md) — Use AWS Amplify Gen 2 as backend platform
- [ADR-005](ADR-005-composable-challenge-system.md) — Composable Shell + Panel challenge architecture (dev container is the runtime for `CODE_IMPLEMENTATION` challenges)
- [ADR-011](ADR-011-video-interview-webrtc.md) — WebRTC + AppSync signaling (same AppSync subscription pattern used here)
