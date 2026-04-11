# Phase 3b: Dev Containers — ECS to Cloudflare Containers

> **Status:** ✅ Implemented — see [ADR-037](../docs/decisions/ADR-037-dev-containers-on-cloudflare.md)
> **Depends on:** Phase 2 (D1 schema, Workers API), Phase 3 (candidate session JWT auth)
> **Replaces:** ECS Fargate cluster, ALB, EventBridge rules, 5 Lambdas, ECR images

> **Authoritative design record:** [ADR-037](../docs/decisions/ADR-037-dev-containers-on-cloudflare.md). The plan below describes the original Sandbox SDK approach; the shipping implementation uses `@cloudflare/containers` `Container` base class with a three-layer TTL resolver and warn-then-expire bisection. When the two disagree, ADR-037 wins.

---

## 1. Overview

Dev containers give candidates a sandboxed VS Code environment (code-server) to complete CODE_IMPLEMENTATION challenges. The current implementation runs on ECS Fargate with an ALB, EventBridge for status updates, and 5 Lambda functions for lifecycle management.

The migration replaces all of this with **Cloudflare Containers** (built on Durable Objects) and the **Sandbox SDK**, keeping everything in the Cloudflare ecosystem with zero AWS dependencies.

### What moves

| AWS (current) | Cloudflare (target) |
|---|---|
| ECS Fargate cluster + task definitions | Cloudflare Container class (Durable Object) |
| `devContainerLaunch` Lambda | Worker route: `POST /rpc/launch-container` |
| `devContainerDestroy` Lambda | Worker route: `POST /rpc/destroy-container` |
| `devContainerStatus` Lambda | Worker route: `GET /rpc/container-status/:sessionId` |
| `getContainerLogs` Lambda | Sandbox SDK stdout/stderr streaming |
| `ecsStatusBridge` Lambda (EventBridge) | Durable Object `onStart`/`onStop`/`onError` lifecycle hooks |
| ALB + per-session listener rules | Worker fetch proxy → `container.fetch(request)` |
| ECR container images | Dockerfile in repo, built by Cloudflare on deploy |
| EventBridge → AppSync subscriptions | Polling or Durable Object WebSocket for status updates |
| CloudWatch Logs | Sandbox SDK log streaming |
| S3 presigned URL for repo archives | R2 presigned URL for repo archives (shared with Phase 2 R2 infra) |
| DynamoDB `DevContainerSession` model | D1 `dev_container_sessions` table |
| Security group (port 8080 from ALB only) | Worker auth middleware (no direct container access from internet) |

### What does NOT move in Phase 3b

- Candidate auth (Phase 3 — session JWT)
- R2 bucket setup (Phase 2 — shared `pipe-assets` bucket)
- Challenge CRUD (Phase 2)
- Code review challenge flow (separate from containers — uses DiffReviewCanvas, not code-server)

---

## 2. Architecture

### Container routing model

```
Browser → Worker (auth check) → Durable Object → Container (code-server)
```

Containers are **never directly addressable from the internet**. All traffic flows through the Worker, which validates the candidate session JWT before proxying to the container. This replaces the ALB + security group model entirely.

### Sandbox SDK vs raw Containers

The Sandbox SDK (`@cloudflare/sandbox`) is purpose-built for code execution environments and provides:
- Command execution with streaming output
- File read/write operations
- Preview URLs for HTTP services running inside the container
- Terminal access via WebSocket
- R2 bucket mounting as local filesystem

This eliminates the need to build container management primitives from scratch.

### Instance sizing

| Instance type | vCPU | Memory | Disk | Use case |
|---|---|---|---|---|
| `standard-1` | 1/2 | 4 GiB | 8 GB | Default for most challenges |
| `standard-2` | 1 | 6 GiB | 12 GB | Heavy build challenges (React, Rust) |

Scale-to-zero via `sleepAfter` — containers sleep after inactivity, wake in sub-second on next request. Cost is ~$0.003/hr when idle.

---

## 3. Security Model

### Layer 1: Worker auth gateway

Every request to a container flows through the Worker, which validates the candidate session JWT (from Phase 3). No container is reachable without a valid session.

```typescript
// Worker fetch handler
app.all('/container/:sessionId/*', candidateAuth, async (c) => {
  const sessionId = c.req.param('sessionId');
  const candidateId = c.var.candidateId;

  // Verify this candidate owns this session
  const session = await c.env.DB.prepare(
    'SELECT * FROM dev_container_sessions WHERE session_id = ? AND candidate_id = ?'
  ).bind(sessionId, candidateId).first();

  if (!session) return c.json({ error: 'Not found' }, 404);

  // Proxy to container
  const container = c.env.DEV_CONTAINER.getByName(sessionId);
  return container.fetch(c.req.raw);
});
```

### Layer 2: Domain restriction

Container preview URLs are scoped to the application domain. The Worker only proxies requests from allowed origins (same CORS config as the API).

### Layer 3: Network isolation

- Containers have **no inbound ports exposed** — all access goes through the Worker proxy
- Outbound HTTP can be intercepted via `interceptAllOutboundHttp()` to log, filter, or inject credentials
- No SSH, no raw TCP — all access is HTTP/WebSocket only
- Each container runs in its own VM (Cloudflare's isolation guarantee)

### Layer 4: Repo access control

- Repo archives are served via R2 presigned URLs with 2-hour TTL
- The presigned URL is injected as an environment variable at container start — never exposed to the candidate's browser
- R2 keys use opaque identifiers, not internal entity IDs

### Layer 5: Time-boxing

- Containers have a configurable `sleepAfter` timeout (default: 60 minutes of inactivity)
- Worker enforces a hard session duration limit (e.g., 2 hours) — destroys the container after expiry regardless of activity
- Expired session JWTs cannot access containers

---

## 4. BDD User Journeys

### 4.1 Candidate launches a dev container for CODE_IMPLEMENTATION challenge

```gherkin
Feature: Dev Container Launch

  Scenario: Candidate starts a CODE_IMPLEMENTATION challenge
    Given the candidate has a valid session token
    And the current challenge is type CODE_IMPLEMENTATION with a repo archive in R2
    When the candidate clicks "Start Coding Environment"
    Then a POST /rpc/launch-container is sent with { sessionId, challengeId }
    And the Worker creates a Cloudflare Container with:
      | env var            | value                                      |
      | SESSION_ID         | <sessionId>                                |
      | CHALLENGE_ID       | <challengeId>                              |
      | REPO_R2_URL        | <presigned R2 GET URL, 2-hour TTL>         |
      | CHALLENGE_BRANCH   | <branch to check out>                      |
      | REPO_BASE_BRANCH   | <base branch for diff>                     |
    And a dev_container_sessions record is created with status LAUNCHING
    And the UI shows a loading indicator

  Scenario: Container becomes ready
    Given a container has been launched
    When the container starts listening on port 8080
    Then the Durable Object onStart hook fires
    And the dev_container_sessions status is updated to READY
    And the UI renders the code-server IDE in an iframe
    And the candidate can edit code, run terminal commands, and see file changes

  Scenario: Container launch failure
    Given a container launch is requested
    When the container fails to start (image pull error, resource limit)
    Then the Durable Object onError hook fires
    And the dev_container_sessions status is updated to ERROR
    And the UI shows "Environment failed to start. Please try again."
```

### 4.2 Candidate works in the container with branch context

```gherkin
Feature: Branch-Aware Container

  Scenario: Container initializes with the correct branch
    Given the container has started with CHALLENGE_BRANCH="feature/checkout-flow"
    And REPO_BASE_BRANCH="main"
    When the container initialization script runs
    Then the repo archive is downloaded from the R2 presigned URL
    And extracted to /workspace
    And git checkout feature/checkout-flow is executed
    And code-server opens with /workspace as the root

  Scenario: Candidate cannot access other branches or repos
    Given the container is running with a specific repo
    When the candidate attempts to git clone a different repository
    Then the operation may succeed (outbound HTTP allowed for package installs)
    But no other R2 objects or internal services are accessible
    And the candidate's session JWT only authorizes their own container
```

### 4.3 Container lifecycle and cleanup

```gherkin
Feature: Container Lifecycle

  Scenario: Container sleeps after inactivity
    Given a container has been idle for 10 minutes (no HTTP requests)
    Then the container enters sleep state
    And the next request wakes it in sub-second time
    And the candidate sees no interruption

  Scenario: Candidate explicitly destroys environment
    Given the candidate has finished the challenge
    When the candidate clicks "Destroy Environment"
    Then a POST /rpc/destroy-container is sent with { sessionId }
    And the container is stopped (SIGTERM → 15s → SIGKILL)
    And dev_container_sessions status is updated to STOPPED
    And the UI returns to the challenge submission view

  Scenario: Session timeout destroys container
    Given the candidate's session JWT expires (2-hour limit)
    When the candidate makes a request to the container
    Then the Worker returns 401
    And the container is destroyed automatically
    And any unsaved work is lost (ephemeral disk)

  Scenario: Candidate submits work before container is destroyed
    Given the candidate has made code changes in the container
    When the candidate clicks "Submit"
    Then the submission endpoint captures the candidate's work
    And the container can be safely destroyed after submission
```

### 4.4 Security enforcement

```gherkin
Feature: Container Security

  Scenario: Unauthenticated request to container is rejected
    Given a container is running for session "abc-123"
    When an unauthenticated HTTP request is sent to the container route
    Then the Worker returns 401
    And the request never reaches the container

  Scenario: Different candidate cannot access another's container
    Given candidate A has a container running for session "abc-123"
    And candidate B has a valid session token for a different session
    When candidate B requests /container/abc-123/
    Then the Worker returns 404 (session not owned by this candidate)

  Scenario: Container is not directly addressable
    Given a container is running
    Then there is no public IP or hostname for the container
    And the only access path is Worker → Durable Object → Container
```

---

## 5. D1 Schema

```sql
CREATE TABLE dev_container_sessions (
  id              TEXT PRIMARY KEY,           -- ULID
  session_id      TEXT NOT NULL UNIQUE,       -- UUID, used in URLs and container naming
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  challenge_id    TEXT REFERENCES challenges(id) ON DELETE SET NULL,
  pipeline_id     TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'LAUNCHING'
                  CHECK (status IN ('LAUNCHING', 'READY', 'SLEEPING', 'ERROR', 'STOPPED')),
  instance_type   TEXT NOT NULL DEFAULT 'standard-1',
  container_name  TEXT,                       -- Durable Object name (= session_id)
  repo_r2_key     TEXT,                       -- R2 key for repo archive
  challenge_branch TEXT,                      -- Git branch to check out
  base_branch     TEXT,                       -- Base branch for diff
  started_at      TEXT,
  stopped_at      TEXT,
  expires_at      TEXT NOT NULL,              -- Hard session expiry (2 hours from launch)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_container_sessions_candidate ON dev_container_sessions(candidate_id);
CREATE INDEX idx_container_sessions_status ON dev_container_sessions(status);
```

---

## 6. Workers API Routes

| Method | Route | Auth | Description |
|---|---|---|---|
| `POST` | `/rpc/launch-container` | Candidate JWT | Launch a new container for a challenge |
| `GET` | `/rpc/container-status/:sessionId` | Candidate JWT | Get container status |
| `POST` | `/rpc/destroy-container` | Candidate JWT | Stop and destroy a container |
| `ALL` | `/container/:sessionId/*` | Candidate JWT | Proxy all traffic to the running container |

### Launch handler

```typescript
// POST /rpc/launch-container
// Body: { challengeId: string }
app.post('/rpc/launch-container', candidateAuth, async (c) => {
  const candidateId = c.var.candidateId;
  const { challengeId } = await c.req.json();
  const sessionId = crypto.randomUUID();

  // 1. Load challenge to get repo info
  const challenge = await c.env.DB.prepare(
    'SELECT * FROM challenges WHERE id = ?'
  ).bind(challengeId).first();

  if (!challenge) return apiError(c, 'NOT_FOUND', 'Challenge not found');

  // 2. Generate R2 presigned URL for repo archive (if applicable)
  let repoR2Url: string | null = null;
  if (challenge.repo_r2_key) {
    repoR2Url = await generatePresignedGetUrl(c.env, challenge.repo_r2_key, 7200);
  }

  // 3. Create D1 session record
  const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
  await c.env.DB.prepare(`
    INSERT INTO dev_container_sessions
      (id, session_id, candidate_id, challenge_id, pipeline_id, status,
       repo_r2_key, challenge_branch, base_branch, expires_at)
    VALUES (?, ?, ?, ?, ?, 'LAUNCHING', ?, ?, ?, ?)
  `).bind(
    generateUlid(), sessionId, candidateId, challengeId,
    challenge.pipeline_id, challenge.repo_r2_key,
    challenge.challenge_branch, challenge.base_branch, expiresAt
  ).run();

  // 4. Launch container via Durable Object
  const container = c.env.DEV_CONTAINER.getByName(sessionId);
  // Container starts automatically on first fetch
  // Pass config via Durable Object storage or env vars

  return c.json({ sessionId, status: 'LAUNCHING', expiresAt }, 201);
});
```

---

## 7. Container Definition

```typescript
// workers/api/src/containers/dev-container.ts
import { Container } from '@cloudflare/containers';

export class DevContainer extends Container {
  defaultPort = 8080;
  sleepAfter = '10m';
  instanceType = 'standard-1'; // 0.5 vCPU, 4 GiB RAM, 8 GB disk

  override async onStart(): Promise<void> {
    // Update D1 session status to READY
    // The container name is the session_id
    console.log('[DevContainer] Started:', this.name);
  }

  override async onStop(): Promise<void> {
    console.log('[DevContainer] Stopped:', this.name);
  }

  override async onError(error: unknown): Promise<void> {
    console.error('[DevContainer] Error:', this.name, error);
  }
}
```

### Wrangler configuration

```jsonc
// wrangler.jsonc additions
{
  "containers": [
    {
      "class_name": "DevContainer",
      "image": "./containers/code-server/Dockerfile",
      "instances": 10
    }
  ],
  "durable_objects": {
    "bindings": [
      {
        "class_name": "DevContainer",
        "name": "DEV_CONTAINER"
      }
    ]
  }
}
```

### Container image (Dockerfile)

```dockerfile
# containers/code-server/Dockerfile
FROM codercom/code-server:4.22.1

# Install common tools
RUN sudo apt-get update && sudo apt-get install -y \
    git curl wget jq \
    && sudo rm -rf /var/lib/apt/lists/*

# Install Node.js 20 LTS
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash - \
    && sudo apt-get install -y nodejs

# Startup script: download repo, checkout branch, start code-server
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
```

### Entrypoint script

```bash
#!/bin/bash
# containers/code-server/entrypoint.sh

set -euo pipefail

WORKSPACE="/home/coder/workspace"
mkdir -p "$WORKSPACE"

# Download and extract repo if REPO_R2_URL is set
if [ -n "${REPO_R2_URL:-}" ]; then
  echo "[entrypoint] Downloading repo archive..."
  curl -sL "$REPO_R2_URL" | tar xz -C "$WORKSPACE"

  cd "$WORKSPACE"

  # Checkout the challenge branch
  if [ -n "${CHALLENGE_BRANCH:-}" ]; then
    echo "[entrypoint] Checking out branch: $CHALLENGE_BRANCH"
    git checkout "$CHALLENGE_BRANCH" 2>/dev/null || git checkout -b "$CHALLENGE_BRANCH"
  fi
fi

# Start code-server (no password — auth handled by Worker proxy)
exec code-server \
  --bind-addr 0.0.0.0:8080 \
  --auth none \
  --disable-telemetry \
  "$WORKSPACE"
```

**Key security note:** `--auth none` is safe because the container is never directly accessible. All requests flow through the Worker, which enforces candidate JWT auth.

---

## 8. Data Migration

### ECS → Cloudflare Containers

No data migration needed — dev container sessions are ephemeral. Active ECS tasks are destroyed when the old system is decommissioned.

### ECR → Cloudflare image registry

The Dockerfile is committed to the repo. Cloudflare builds the image on deploy from `wrangler.jsonc`. No ECR dependency.

### S3 repo archives → R2

Repo archives (`challenge-repos/`) are copied from S3 to R2 using `rclone` or `aws s3 sync` (same as Phase 2 media migration). The `challenges.repo_r2_key` column replaces `repoS3Key`.

### DynamoDB DevContainerSession → D1

Historical session records are not migrated (ephemeral data). The D1 `dev_container_sessions` table starts fresh.

---

## 9. What Gets Deleted

| AWS Resource | Action |
|---|---|
| `amplify/functions/devContainerLaunch/` | Delete |
| `amplify/functions/devContainerDestroy/` | Delete |
| `amplify/functions/devContainerStatus/` | Delete |
| `amplify/functions/getContainerLogs/` | Delete |
| `amplify/functions/ecsStatusBridge/` | Delete |
| `infra/ecs.tf` | Archive to `docs/archive-amplify/infra/` |
| `infra/alb.tf` | Archive |
| `infra/networking.tf` | Archive |
| `infra/eventbridge.tf` | Archive |
| `infra/iam.tf` | Archive |
| ECS cluster (`pipe-dev-containers`) | Tear down after migration verified |
| ALB + target groups | Tear down |
| EventBridge rule | Tear down |
| ECR repository (`code-server`) | Tear down after image migrated |
| CloudWatch log group | Tear down |
| Security groups | Tear down |

---

## 10. Task List

### 10.1 Infrastructure

- [ ] **T3b-01**: Create Cloudflare Container class `DevContainer` with lifecycle hooks
- [ ] **T3b-02**: Write `containers/code-server/Dockerfile` + `entrypoint.sh`
- [ ] **T3b-03**: Add container + Durable Object bindings to `wrangler.jsonc`
- [ ] **T3b-04**: Write D1 migration for `dev_container_sessions` table
- [ ] **T3b-05**: Copy repo archives from S3 to R2 (`challenge-repos/` prefix)

### 10.2 Worker Routes

- [ ] **T3b-06**: Implement `POST /rpc/launch-container` (create session, launch container)
- [ ] **T3b-07**: Implement `GET /rpc/container-status/:sessionId` (poll status)
- [ ] **T3b-08**: Implement `POST /rpc/destroy-container` (stop + cleanup)
- [ ] **T3b-09**: Implement `ALL /container/:sessionId/*` (auth proxy to container)
- [ ] **T3b-10**: Implement session expiry enforcement (reject expired JWTs, auto-destroy)

### 10.3 Frontend

- [ ] **T3b-11**: Migrate `useDevContainerSession.ts` from AppSync subscriptions to polling `/rpc/container-status`
- [ ] **T3b-12**: Update iframe URL to use Worker proxy path (`/container/:sessionId/`)
- [ ] **T3b-13**: Remove all ECS/AppSync/EventBridge references from frontend

### 10.4 Security

- [ ] **T3b-14**: Verify candidate JWT auth on container proxy route (only session owner can access)
- [ ] **T3b-15**: Verify container is not directly addressable (no public IP/hostname)
- [ ] **T3b-16**: Configure outbound HTTP interception if needed (block access to internal services)
- [ ] **T3b-17**: Enforce 2-hour hard session expiry with auto-destroy

### 10.5 Cleanup

- [ ] **T3b-18**: Archive `infra/` Terraform files to `docs/archive-amplify/infra/`
- [ ] **T3b-19**: Delete 5 Lambda functions (`devContainerLaunch`, `devContainerDestroy`, `devContainerStatus`, `getContainerLogs`, `ecsStatusBridge`)
- [ ] **T3b-20**: Tear down AWS resources (ECS cluster, ALB, EventBridge, ECR, CloudWatch, security groups)

---

## 11. Acceptance Criteria

1. Candidate can launch a dev container from a CODE_IMPLEMENTATION challenge
2. Container starts in < 5 seconds (cold) or < 1 second (warm)
3. Code-server IDE loads in an iframe with the correct repo and branch checked out
4. Candidate can edit code, run terminal commands, install packages
5. Unauthenticated requests to the container proxy return 401
6. A different candidate's session token cannot access another candidate's container
7. Container sleeps after 10 minutes of inactivity, wakes on next request
8. Container is auto-destroyed after 2-hour session expiry
9. No AWS resources are required (zero ECS, ALB, EventBridge, ECR, CloudWatch)
10. All BDD scenarios from Section 4 have passing test specs

---

## 12. Cost Comparison

| | AWS (current) | Cloudflare (target) |
|---|---|---|
| **Per session (60 min)** | ~$0.05 (Fargate on-demand) | ~$0.003 (scale-to-zero idle) |
| **Fixed infra** | ALB ($16/mo) + NAT Gateway ($32/mo) + CloudWatch | $0 (Worker proxy, no ALB) |
| **Image registry** | ECR ($0.10/GB/mo) | Included in Workers plan |
| **Complexity** | 5 Lambdas + EventBridge + ALB + Terraform | 1 Container class + 4 Worker routes |
| **Cold start** | 30-60s (Fargate pull + boot) | 2-3s (pre-cached image) |

---

## 13. Limitations & Risks

| Limitation | Impact | Mitigation |
|---|---|---|
| HTTP/WebSocket only (no raw TCP/SSH) | Candidates can't use SSH or raw git protocol | code-server provides web terminal; git over HTTPS works |
| Ephemeral disk (lost on restart) | Candidate work lost if container crashes | Auto-save to R2 on interval; submit captures work |
| 20 GB max disk (`standard-4`) | Tight for heavy `node_modules` | Pre-install deps in Dockerfile; use `standard-1` (8 GB) for most challenges |
| Beta product | May have breaking changes | Pin Cloudflare SDK versions; monitor changelog |
| No persistent volumes | Can't resume from where candidate left off | Snapshot workspace to R2 before sleep (future enhancement) |

---

## 14. Future Feature: Open CODE_REVIEW repo in dev container

> **User story:** As a candidate in a CODE_REVIEW challenge, I want the ability to open the repo I'm reviewing in a dev container so I can run it, see if it compiles, and understand the codebase before submitting my review.

Currently CODE_REVIEW challenges use `DiffReviewCanvas` (static diff viewer in the browser). The candidate reads the diff and submits inline annotations — they never run the code. This feature bridges CODE_REVIEW and CODE_IMPLEMENTATION by letting the candidate optionally spin up a full dev environment for the same repo.

### How it works

1. Candidate is on a CODE_REVIEW challenge viewing the diff
2. A "Open in Editor" button appears alongside the diff viewer
3. Clicking it calls `POST /rpc/launch-container` with the same `challengeId`
4. The container launches with the PR branch checked out (same `CHALLENGE_BRANCH` / `REPO_BASE_BRANCH` env vars)
5. Candidate can `npm install && npm run build` to verify the code compiles, run tests, explore the codebase
6. Candidate switches back to the diff view to write their review with deeper understanding
7. The container is destroyed when the candidate submits or the session expires

### Why this matters

- Code review quality improves dramatically when the reviewer can actually run the code
- Catches issues that are invisible in a static diff (missing dependencies, broken builds, runtime behavior)
- Differentiates Pipe from competitors that only show diffs
- Reuses 100% of the Phase 3b container infrastructure — no new backend work, just a frontend button on the CODE_REVIEW challenge view

### Implementation notes

- The `challenges` table already has `repo_r2_key`, `challenge_branch`, and `base_branch` — same fields used for CODE_IMPLEMENTATION
- The launch flow is identical; only the UI entry point differs (button on DiffReviewCanvas vs button on CODE_IMPLEMENTATION challenge page)
- This is a **post-migration feature** — implement after Phase 3b core is working and tested
