# Challenge Repository Integration Layer

> **Status:** Proposed
> **Author:** Jory Braun
> **Date:** 2026-03-08
> **Linear Epic:** Challenge Repo Integration
> **Depends on:** [HAS-57: Challenge Repository System](https://linear.app/hash-pipe/issue/HAS-57) (repos exist before integration begins)
> **Relates to:** [HAS-48: PR Review Flow 2.0](https://linear.app/hash-pipe/issue/HAS-48) (this spec replaces HAS-48's implementation details)

---

## Problem

The Challenge Repository System (HAS-57) produces standalone git repos with working codebases and challenge branches. But these repos currently exist only on disk — the pipe-os platform has no way to store them, reference them from challenges, load them into the candidate UI, execute tests against them, or score the results.

This spec designs every piece of the integration: storage, schema changes, UI rendering, test execution, and scoring.

---

## Decision Log

These are the key decisions made in this spec. Each one closes an open question.

| Decision | Choice | Why |
|----------|--------|-----|
| Repo storage | S3 (not GitHub) | Repos are generated artifacts, not collaborative projects. S3 gives us versioning, presigned URLs, and no rate limits. We already have S3 via Amplify Storage. |
| Repo format on S3 | `.tar.gz` archive of the git repo (with `.git/` intact) | Preserves branch structure. Dev container extracts it. Smaller than zip for text files. The `.git/` dir is needed so the candidate can `git diff` against `main`. |
| Candidate editing | Dev container only (not Monaco in-browser) | Repo challenges are multi-file with real dependencies (`npm install`, `prisma migrate`, etc.). Sandpack/Monaco can't run `docker-compose`. Dev containers already work via HAS-46. |
| Challenge config approach | New `RepoChallenge` fields on existing `Challenge` model (not a separate model) | The Shell+Panel system already routes on `challenge.type`. Adding a `repoSource` field keeps the routing simple — if it's set, use the repo layout; if not, use the inline layout. |
| Scoring approach | Hybrid: automated test results + recruiter rubric | Auto-score from `npm test` exit code + parsed test results. Recruiter reviews the diff and scores against the rubric from the YAML config. |
| Repo versioning | S3 object versioning + a `repoVersion` field on Challenge | If we update a challenge repo (fix a bug, improve seed data), old assessments still reference their version. |

---

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    RECRUITER FLOW                        │
│                                                          │
│  pipe-scaffold generate → .tar.gz → S3 bucket            │
│       ↓                                                  │
│  Challenge Studio: select repo + challenge config        │
│       ↓                                                  │
│  Challenge record created with repoSource fields         │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                   CANDIDATE FLOW                         │
│                                                          │
│  ChallengeRegistry detects repoSource → RepoShell        │
│       ↓                                                  │
│  devContainerLaunch: pulls .tar.gz from S3               │
│       ↓                                                  │
│  code-server opens on challenge branch                   │
│       ↓                                                  │
│  Candidate codes in VS Code (full IDE, terminal, git)    │
│       ↓                                                  │
│  Submit: snapshot diff, run tests, upload results        │
│       ↓                                                  │
│  Assessment record: diff + test results + timestamps     │
└──────────────────────────────────────────────────────────┘
                         │
                         ▼
┌──────────────────────────────────────────────────────────┐
│                   RECRUITER REVIEW                       │
│                                                          │
│  DiffReviewCanvas: unified diff of candidate changes     │
│  TestResultsPanel: pass/fail per test with output        │
│  ScoringPanel: rubric items from YAML + auto-scores      │
│  TimelinePanel: commit history + time-per-file           │
└──────────────────────────────────────────────────────────┘
```

---

## 1. Repo Storage (S3)

### Bucket Structure

Use the existing Amplify Storage bucket. Add a path prefix:

```
s3://amplify-storage-bucket/
  challenge-repos/
    storefront/
      sf-impl-1-auth/
        v1.tar.gz          ← current version
        v1.metadata.json   ← challenge config (the YAML, converted to JSON)
      sf-cr-1-coupon/
        v1.tar.gz
        v1.metadata.json
    devhub/
      ...
    teamchat/
      ...
```

### Upload Flow

After `pipe-scaffold generate` produces a repo directory:

```bash
# Package the repo (preserving .git/)
cd output/storefront-auth
tar -czf sf-impl-1-auth-v1.tar.gz .

# Upload to S3 (via Amplify Storage or AWS CLI)
aws s3 cp sf-impl-1-auth-v1.tar.gz \
  s3://bucket/challenge-repos/storefront/sf-impl-1-auth/v1.tar.gz

# Upload metadata
aws s3 cp sf-impl-1-auth.metadata.json \
  s3://bucket/challenge-repos/storefront/sf-impl-1-auth/v1.metadata.json
```

This could also be a `pipe-scaffold publish` command added to the CLI (future).

### Access Control

- **Recruiter (upload):** Cognito-authenticated, write access to `challenge-repos/*`
- **Dev container (download):** Lambda execution role has read access, generates presigned URL, passes to ECS task
- **Candidate (no direct access):** Never touches S3. The dev container fetches and extracts the repo.

### Metadata File Format

```json
{
  "id": "sf-impl-1-auth",
  "app": "storefront",
  "type": "CODE_IMPLEMENTATION",
  "title": "Implement Authentication",
  "difficulty": "intermediate",
  "estimatedMinutes": 35,
  "challengeBranch": "challenge/sf-impl-1-auth",
  "baseBranch": "main",
  "description": "Implement JWT-based auth with registration, login, and route protection.",
  "instructions": "## Your Task\n\nImplement authentication...",
  "stubs": [
    "src/middleware/auth.ts",
    "src/services/auth.service.ts",
    "src/routes/auth.routes.ts",
    "client/src/context/AuthContext.tsx"
  ],
  "tests": [
    { "path": "tests/integration/auth.routes.test.ts", "count": 8 },
    { "path": "tests/unit/auth.service.test.ts", "count": 6 }
  ],
  "scoring": {
    "automated": [
      { "name": "All auth tests pass", "weight": 40, "check": "test-pass" },
      { "name": "TypeScript compiles", "weight": 10, "check": "tsc-noEmit" }
    ],
    "rubric": [
      { "name": "Password hashing uses bcrypt", "weight": 15 },
      { "name": "JWT secret from env, not hardcoded", "weight": 10 },
      { "name": "Error messages don't leak email existence", "weight": 10 },
      { "name": "Constant-time password comparison", "weight": 5 },
      { "name": "Token expiry is set", "weight": 5 },
      { "name": "AuthContext cleans up on logout", "weight": 5 }
    ]
  },
  "version": 1,
  "createdAt": "2026-03-08T00:00:00Z"
}
```

---

## 2. Schema Changes

### Add Fields to Challenge Model

```typescript
// In amplify/data/resource.ts — Challenge model additions

// Repo-based challenge fields (all optional — inline challenges don't use these)
repoS3Key: a.string(),              // e.g., "challenge-repos/storefront/sf-impl-1-auth/v1.tar.gz"
repoVersion: a.integer(),           // e.g., 1 — matches the v{N}.tar.gz
repoBranch: a.string(),             // e.g., "challenge/sf-impl-1-auth"
repoBaseBranch: a.string(),         // e.g., "main" — for diff computation
repoMetadataS3Key: a.string(),      // e.g., "challenge-repos/storefront/sf-impl-1-auth/v1.metadata.json"
```

### Add Fields to Assessment Model

```typescript
// In amplify/data/resource.ts — Assessment model additions

// Repo challenge submission data
diffPatch: a.string(),              // unified diff of candidate's changes (git diff main...HEAD)
testResults: a.json(),              // { passed: 12, failed: 2, total: 14, details: [...] }
autoScore: a.float(),               // automated score from test pass rate + tsc check
rubricScores: a.json(),             // { "Password hashing uses bcrypt": 15, ... } — recruiter fills in
commitHistory: a.json(),            // [{ sha, message, timestamp, filesChanged }] — for timeline view
timePerFile: a.json(),              // { "src/middleware/auth.ts": 420, ... } — seconds spent per file
```

### Add New Model: RepoTemplate

```typescript
// New model — catalog of available repo challenges for the Challenge Picker

RepoTemplate: a.model({
  repoId: a.string().required(),     // e.g., "sf-impl-1-auth" (matches pipe-scaffold config id)
  app: a.enum(['STOREFRONT', 'DEVHUB', 'TEAMCHAT']),
  type: a.enum(['CODE_REVIEW', 'CODE_IMPLEMENTATION']),
  title: a.string().required(),
  description: a.string(),
  difficulty: a.enum(['BEGINNER', 'INTERMEDIATE', 'ADVANCED']),
  estimatedMinutes: a.integer(),
  tags: a.string().array(),
  s3Key: a.string().required(),      // current .tar.gz location
  metadataS3Key: a.string().required(),
  version: a.integer().required(),
  instructions: a.string(),          // full markdown instructions (from metadata)
  scoring: a.json(),                 // scoring config (from metadata)
})
.authorization(allow => [
  allow.owner(),                     // recruiter who uploaded
  allow.groups(['ADMIN']),           // admins can manage all
]),
```

### Why RepoTemplate Is Separate from ChallengeTemplate

`ChallengeTemplate` (in `challengeLibrary.ts`) is a frontend-only, in-memory catalog of inline challenges. It works great for single-file snippets.

`RepoTemplate` is a database-backed catalog because:
- Repos live in S3 and need a reference pointer
- Repos are versioned and may be updated independently of deploys
- We may want recruiter-uploaded custom repos in the future
- The Challenge Picker needs to query both catalogs and merge results

---

## 3. Dev Container Changes

### Current Flow (HAS-46)

```
devContainerLaunch Lambda
  → RunTask (ECS Fargate, code-server image)
  → Container boots with empty workspace
  → Candidate gets blank VS Code
```

### New Flow for Repo Challenges

```
devContainerLaunch Lambda (updated)
  → Generate presigned S3 URL for the .tar.gz
  → RunTask (ECS Fargate, code-server image)
  → Pass environment variables:
      REPO_S3_URL=<presigned URL>
      CHALLENGE_BRANCH=<branch name>
      SESSION_ID=<sessionId>
  → Container entrypoint script:
      1. Download .tar.gz from presigned URL
      2. Extract to /workspace/
      3. cd /workspace && git checkout <CHALLENGE_BRANCH>
      4. npm install (or skip if node_modules is in the archive)
      5. Start code-server pointing at /workspace/
  → Candidate opens code-server, sees the repo on the challenge branch
```

### Changes to devContainerLaunch Handler

```typescript
// handler.ts additions

interface DevContainerLaunchArguments {
  sessionId: string;
  challengeId?: string;  // NEW: if present, fetch challenge to get repo info
}

// In the handler:
if (challengeId) {
  const challenge = await getChallenge(challengeId);
  if (challenge.repoS3Key) {
    // Generate presigned URL (valid 2 hours)
    const presignedUrl = await getPresignedUrl(challenge.repoS3Key);

    // Add to container environment
    containerOverrides.environment.push(
      { name: 'REPO_S3_URL', value: presignedUrl },
      { name: 'CHALLENGE_BRANCH', value: challenge.repoBranch },
      { name: 'REPO_BASE_BRANCH', value: challenge.repoBaseBranch || 'main' },
    );
  }
}
```

### Entrypoint Script (Added to Docker Image)

```bash
#!/bin/bash
# /usr/local/bin/entrypoint.sh

set -e

WORKSPACE="/workspace"

if [ -n "$REPO_S3_URL" ]; then
  echo "Downloading challenge repository..."
  mkdir -p "$WORKSPACE"
  curl -sL "$REPO_S3_URL" | tar -xz -C "$WORKSPACE"

  cd "$WORKSPACE"

  if [ -n "$CHALLENGE_BRANCH" ]; then
    echo "Checking out challenge branch: $CHALLENGE_BRANCH"
    git checkout "$CHALLENGE_BRANCH"
  fi

  # Install dependencies if package.json exists
  if [ -f "package.json" ]; then
    echo "Installing dependencies..."
    npm install --prefer-offline 2>/dev/null || true
  fi

  # Run database setup if prisma exists
  if [ -f "prisma/schema.prisma" ]; then
    echo "Setting up database..."
    npx prisma migrate deploy 2>/dev/null || true
    npx prisma db seed 2>/dev/null || true
  fi

  echo "Repository ready."
fi

# Start code-server
exec code-server "$@"
```

### Docker Image Update

The current code-server image needs:
- `curl` (likely already present)
- `git` (likely already present)
- `node` 18+ and `npm` (likely already present)
- The entrypoint script above
- `docker-compose` or `docker` CLI if we want candidates to run `docker-compose up` for Postgres (alternative: use SQLite in dev containers to avoid Docker-in-Docker)

**Decision: SQLite in dev containers.** Docker-in-Docker is complex and a security surface. The template apps already support SQLite fallback. We set `DATABASE_URL=file:./dev.db` in the container environment. Candidates still see the Prisma schema with PostgreSQL annotations, but the runtime uses SQLite. This is transparent — `npx prisma migrate deploy` works with both.

---

## 4. Candidate UI Changes

### ChallengeRegistry Update

```typescript
// src/components/ChallengeRegistry.tsx

function resolveLayout(challenge: Challenge): LayoutConfig {
  // NEW: Repo-based challenges get a different layout
  if (challenge.repoS3Key) {
    return {
      type: 'repo',
      shells: ['TimerShell', 'AutoSaveShell'],
      panels: {
        left: 'InstructionsPanel',    // markdown instructions from metadata
        center: 'DevContainerPanel',  // iframe to code-server
        right: null,                  // no right panel — code-server has its own file tree
      },
    };
  }

  // Existing inline challenge routing
  switch (challenge.type) {
    case 'CODE_REVIEW':
      return { /* existing */ };
    // ...
  }
}
```

### DevContainerPanel (New Component)

```typescript
// src/components/Panels/DevContainerPanel.tsx

interface DevContainerPanelProps {
  challenge: Challenge;
  candidateId: string;
}

/**
 * Renders the dev container (code-server) in an iframe.
 *
 * Lifecycle:
 * 1. Call devContainerLaunch mutation with challengeId
 * 2. Subscribe to DevContainerSession status updates
 * 3. Show loading state (PROVISIONING → BOOTING → READY)
 * 4. When READY, render iframe pointing to container URL
 * 5. Add "Submit" button that triggers submission flow
 */
```

### Submission Flow (New)

When the candidate clicks "Submit" (or the timer expires):

```typescript
// src/lib/challenge/submitRepoChallenge.ts

async function submitRepoChallenge(sessionId: string, challengeId: string): Promise<void> {
  // 1. Call a new Lambda that SSHes/execs into the container and runs:
  //    git diff <baseBranch>...HEAD    → capture as diffPatch
  //    npm test -- --json              → capture as testResults
  //    npx tsc --noEmit                → capture pass/fail
  //    git log --oneline <baseBranch>..HEAD → capture as commitHistory

  // 2. Upload results to Assessment record
  //    diffPatch, testResults, autoScore, commitHistory

  // 3. Trigger dev container destroy
}
```

This requires a new Lambda: `devContainerSubmit`.

---

## 5. New Lambda: devContainerSubmit

**Purpose:** When a candidate submits, this Lambda executes commands inside the running container, captures results, and saves them to the Assessment.

**How it executes commands in the container:**
- Use ECS `ExecuteCommand` API (requires ECS Exec enabled on the task)
- Alternative: The code-server container exposes a REST API — we can POST commands to it
- Simplest: Add a small HTTP endpoint to the entrypoint script that the Lambda calls

**Decision: Add a submit endpoint to code-server.** We add a tiny Express server on port 8081 (internal only, not exposed via ALB) that the Lambda calls via the task's private IP.

```typescript
// amplify/functions/devContainerSubmit/handler.ts

interface SubmitResult {
  diffPatch: string;        // unified diff
  testResults: {
    passed: number;
    failed: number;
    total: number;
    details: Array<{
      name: string;
      status: 'pass' | 'fail';
      duration: number;
      error?: string;
    }>;
  };
  tscPasses: boolean;
  commitHistory: Array<{
    sha: string;
    message: string;
    timestamp: string;
    filesChanged: string[];
  }>;
  timePerFile: Record<string, number>;  // seconds per file (from git log --stat)
}
```

**Flow:**
1. Lambda receives `{ sessionId, challengeId, candidateId }`
2. Look up `DevContainerSession` to get the task's private IP
3. POST to `http://<privateIp>:8081/submit` with `{ baseBranch: "main" }`
4. The submit endpoint in the container runs the git/npm commands and returns `SubmitResult`
5. Lambda writes results to `Assessment` record
6. Lambda calls `devContainerDestroy` to tear down the container

---

## 6. Recruiter Review UI

### DiffReviewCanvas Enhancement

The existing `DiffReviewCanvas` component renders diffs. For repo challenges, it needs to handle multi-file diffs.

```typescript
// Updated DiffReviewCanvas props
interface DiffReviewCanvasProps {
  // Existing: single-file diff
  code?: string;
  annotations?: Annotation[];

  // NEW: multi-file diff from repo challenge
  diffPatch?: string;  // unified diff (multiple files)
  mode: 'single-file' | 'multi-file';
}
```

When `mode === 'multi-file'`:
- Parse the unified diff into per-file sections
- Render a file list sidebar (like GitHub PR view)
- Click a file to see its diff
- Annotations attach to specific files + line numbers

### TestResultsPanel (New Component)

```typescript
// src/components/Panels/TestResultsPanel.tsx

interface TestResultsPanelProps {
  testResults: SubmitResult['testResults'];
}

/**
 * Displays test results in a pass/fail list:
 * ✅ "Should register a new user" (23ms)
 * ✅ "Should reject duplicate email" (15ms)
 * ❌ "Should hash password with bcrypt" (8ms)
 *     → Expected bcrypt hash, got plain text
 *
 * Summary bar: 12/14 passed (85.7%)
 */
```

### ScoringPanel Enhancement

For repo challenges, the scoring panel shows both automated and manual scores:

```
┌─────────────────────────────────────────┐
│ AUTOMATED (50/100)                      │
│ ✅ All auth tests pass         40/40    │
│ ✅ TypeScript compiles         10/10    │
│                                         │
│ RUBRIC (recruiter scores)               │
│ [ ] Password hashing uses bcrypt  _/15  │
│ [ ] JWT secret from env           _/10  │
│ [ ] Error msgs don't leak email   _/10  │
│ [ ] Constant-time comparison      _/5   │
│ [ ] Token expiry is set           _/5   │
│ [ ] AuthContext cleanup           _/5   │
│                                         │
│ TOTAL: 50/100 (automated only so far)   │
└─────────────────────────────────────────┘
```

The rubric items come from the challenge's `scoring` config (which was loaded from the metadata JSON).

### TimelinePanel (New Component)

```typescript
// src/components/Panels/TimelinePanel.tsx

/**
 * Shows the candidate's work timeline:
 * - Commit history with timestamps
 * - Time spent per file (bar chart)
 * - Total elapsed time vs. estimated time
 *
 * This helps recruiters understand the candidate's approach:
 * Did they start with tests? Did they spend 80% on one file?
 * Did they commit incrementally or all at once?
 */
```

---

## 7. Challenge Picker Integration

The Challenge Picker modal (used by recruiters when building a pipeline) currently shows `ChallengeTemplate` items from `challengeLibrary.ts`. It needs to also show `RepoTemplate` items from DynamoDB.

### Merged Catalog

```typescript
// src/content/challengeCatalog.ts

interface CatalogEntry {
  id: string;
  source: 'inline' | 'repo';     // distinguishes the two catalogs
  type: ChallengeType;
  title: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  tags: string[];
  topic: string;

  // For inline challenges
  inlineConfig?: ChallengeTemplate['config'];

  // For repo challenges
  repoId?: string;
  app?: string;
  s3Key?: string;
  metadataS3Key?: string;
  version?: number;
}

async function loadCatalog(): Promise<CatalogEntry[]> {
  // 1. Load inline templates from challengeLibrary.ts (sync, in-memory)
  const inlineEntries = CHALLENGE_LIBRARY.map(t => ({
    ...t,
    source: 'inline' as const,
    inlineConfig: t.config,
  }));

  // 2. Load repo templates from DynamoDB (async query)
  const repoTemplates = await listRepoTemplates();
  const repoEntries = repoTemplates.map(r => ({
    id: r.repoId,
    source: 'repo' as const,
    type: r.type,
    title: r.title,
    description: r.description,
    difficulty: r.difficulty,
    estimatedMinutes: r.estimatedMinutes,
    tags: r.tags,
    topic: r.app,
    repoId: r.repoId,
    app: r.app,
    s3Key: r.s3Key,
    metadataS3Key: r.metadataS3Key,
    version: r.version,
  }));

  return [...inlineEntries, ...repoEntries];
}
```

### Challenge Picker UI Changes

- Add a filter toggle: "All / Inline / Repo-Based"
- Repo challenges show an icon badge (e.g., a git branch icon)
- When a recruiter selects a repo challenge, the system:
  1. Reads the metadata JSON from S3
  2. Pre-fills the Challenge record with `repoS3Key`, `repoBranch`, `repoBaseBranch`, `repoVersion`, `instructions`, `config` (scoring rubric)
  3. The recruiter can edit instructions before saving

---

## 8. Seeding RepoTemplates

After `pipe-scaffold generate` + S3 upload, we need to create `RepoTemplate` records in DynamoDB.

### Seed Script

```typescript
// scripts/seedRepoTemplates.ts

import { generateClient } from 'aws-amplify/data';
import metadata from '../pipe-scaffold/challenges/*.metadata.json';

/**
 * Reads all metadata JSON files from the challenges directory
 * and creates/updates RepoTemplate records in DynamoDB.
 *
 * Usage: npx tsx scripts/seedRepoTemplates.ts
 */
async function seed() {
  const client = generateClient();

  for (const meta of metadata) {
    await client.models.RepoTemplate.create({
      repoId: meta.id,
      app: meta.app.toUpperCase(),
      type: meta.type,
      title: meta.title,
      description: meta.description,
      difficulty: meta.difficulty.toUpperCase(),
      estimatedMinutes: meta.estimatedMinutes,
      tags: meta.tags || [],
      s3Key: `challenge-repos/${meta.app}/${meta.id}/v${meta.version}.tar.gz`,
      metadataS3Key: `challenge-repos/${meta.app}/${meta.id}/v${meta.version}.metadata.json`,
      version: meta.version,
      instructions: meta.instructions,
      scoring: meta.scoring,
    });
  }
}
```

---

## Task Breakdown

### Phase A: Storage + Schema (foundation)

1. **Configure S3 storage path for challenge repos** — Add `challenge-repos/` prefix to Amplify Storage access rules. Ensure Lambda execution role has `s3:GetObject` for presigned URL generation.

2. **Add repo fields to Challenge model** — `repoS3Key`, `repoVersion`, `repoBranch`, `repoBaseBranch`, `repoMetadataS3Key`. Run `npx ampx sandbox` to deploy.

3. **Add repo submission fields to Assessment model** — `diffPatch`, `testResults`, `autoScore`, `rubricScores`, `commitHistory`, `timePerFile`. Run sandbox deploy.

4. **Create RepoTemplate model** — New DynamoDB model for the repo challenge catalog. Deploy.

5. **Write seed script for RepoTemplates** — Reads metadata JSON files and populates DynamoDB.

### Phase B: Dev Container Changes (execution)

6. **Update devContainerLaunch Lambda** — Accept `challengeId`, look up repo info, generate presigned URL, pass `REPO_S3_URL` + `CHALLENGE_BRANCH` to ECS task.

7. **Update code-server Docker image** — Add entrypoint script that downloads and extracts repo from S3, checks out challenge branch, runs `npm install` + `prisma migrate`, then starts code-server.

8. **Build devContainerSubmit Lambda** — New function that calls the container's submit endpoint, captures diff/test results/commit history, writes to Assessment record, triggers container destroy.

9. **Add submit endpoint to code-server image** — Small Express server on port 8081 that runs `git diff`, `npm test --json`, `npx tsc --noEmit`, `git log` and returns results as JSON. Not exposed via ALB (internal only).

### Phase C: Candidate UI (rendering)

10. **Update ChallengeRegistry for repo detection** — If `challenge.repoS3Key` is set, use repo layout (InstructionsPanel + DevContainerPanel).

11. **Build DevContainerPanel component** — Iframe wrapper for code-server with loading states (PROVISIONING → BOOTING → READY), submit button, timer integration.

12. **Build submission flow** — "Submit" button calls `devContainerSubmit` Lambda, shows processing state, transitions to completion screen.

### Phase D: Recruiter UI (review + scoring)

13. **Enhance DiffReviewCanvas for multi-file diffs** — Parse unified diff into per-file sections, render file list sidebar, support file-scoped annotations.

14. **Build TestResultsPanel component** — Pass/fail list with test names, durations, error messages, summary bar.

15. **Enhance ScoringPanel for hybrid scoring** — Show automated scores (from test results) + rubric items (from metadata). Recruiter fills in rubric scores. Total computed.

16. **Build TimelinePanel component** — Commit history timeline, time-per-file bar chart, total elapsed vs estimated.

### Phase E: Challenge Picker (recruiter setup)

17. **Build merged challenge catalog** — `loadCatalog()` function that combines inline `ChallengeTemplate` items with DynamoDB `RepoTemplate` items.

18. **Update ChallengePicker UI** — Add "Inline / Repo" filter toggle, git branch icon for repo challenges, pre-fill Challenge record from repo metadata on selection.

### Phase F: Upload + Seed Pipeline

19. **Add `pipe-scaffold publish` command** — Packages the generated repo as `.tar.gz`, uploads to S3 with correct path, creates/updates metadata JSON.

20. **Seed all 9 repo templates** — Run seed script to populate `RepoTemplate` records for all 9 challenges.

21. **End-to-end test: recruiter creates pipeline with repo challenge, candidate completes it, recruiter reviews** — Full flow verification.
