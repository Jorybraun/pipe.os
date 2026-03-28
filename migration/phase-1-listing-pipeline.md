# Phase 1: Listing + Pipeline Create

## 1. Overview

Migrate the two simplest recruiter-facing pages from AWS Amplify (AppSync + DynamoDB) to Cloudflare (Workers + D1 + Clerk):

| Page | Route | Current data source | What it does |
|------|-------|---------------------|--------------|
| Listing | `/` | `client.models.Pipeline.list()` with nested `stages` and `candidates` | Shows all pipelines with candidate count, stage count, status filters, search, delete |
| Pipeline Create | `/pipeline/new` | `client.models.Pipeline.create()` + `client.models.Stage.create()` + `client.models.Challenge.create()` | Multi-phase form that creates a Pipeline, then Stages + Challenges from a preset |

After this phase:
- A Cloudflare Worker serves a REST API for Pipeline CRUD
- D1 stores Pipeline and Stage rows (Challenge table is scaffolded but not deeply used yet)
- Clerk authenticates recruiters; every API call requires a valid Clerk session
- The React frontend calls the Worker API through a thin provider layer instead of `generateClient<Schema>()`
- Playwright BDD tests cover all six user journeys end-to-end

**Not in scope:** Candidate flow, Assessment, CodeArtifact, video, scheduling, scoring, AI agents. Those are Phase 2+.

---

## 2. BDD User Journeys

### 2.1 Recruiter sees empty state on first visit

```gherkin
Given the recruiter has signed in via Clerk
  And the recruiter has zero pipelines
When they navigate to "/"
Then they see the "NO_ROLES_FOUND" empty state
  And the stats sidebar shows "0 ACTIVE" and "0 CANDIDATES"
  And the "NEW_ROLE" button is visible
```

### 2.2 Recruiter creates a new pipeline with title and level

```gherkin
Given the recruiter is on "/pipeline/new"
When they enter "Senior Frontend Engineer" as the title
  And they select "Senior" as the level
  And they select the "DEFAULT" preset
  And they complete all form phases and submit
Then a Pipeline record is created with status "ACTIVE"
  And Stages and Challenges are created from the DEFAULT preset
  And the recruiter is redirected to "/pipeline/{id}"
```

### 2.3 Recruiter sees pipeline in listing after creation

```gherkin
Given the recruiter has created a pipeline titled "Senior Frontend Engineer"
When they navigate to "/"
Then they see "Senior Frontend Engineer" in the pipeline list
  And the pipeline shows status "ACTIVE"
  And the candidate count shows "0"
  And the stage count matches the preset stage count
```

### 2.4 Recruiter deletes a pipeline

```gherkin
Given the recruiter has a pipeline titled "Obsolete Role"
When they click the delete button on "Obsolete Role"
  And they confirm the deletion dialog
Then the pipeline is removed from the listing
  And the pipeline no longer exists in the database
  And associated Stages and Challenges are cascade-deleted
```

### 2.5 Recruiter sees pipeline count and candidate count in listing

```gherkin
Given the recruiter has 3 pipelines:
  | title                    | status | candidates |
  | Senior Frontend Engineer | ACTIVE | 2          |
  | Junior Backend Developer | DRAFT  | 0          |
  | Staff Platform Engineer  | ACTIVE | 5          |
When they navigate to "/"
Then the sidebar shows "2 ACTIVE"
  And the sidebar shows "7 CANDIDATES"
  And filtering by "ACTIVE" shows 2 pipelines
  And filtering by "DRAFT" shows 1 pipeline
```

### 2.6 Unauthenticated user is redirected to login

```gherkin
Given the user is not signed in
When they navigate to "/"
Then they are redirected to the Clerk sign-in page
When they navigate to "/pipeline/new"
Then they are redirected to the Clerk sign-in page
When they call "GET /api/v1/pipelines" without an auth header
Then they receive a 401 Unauthorized response
```

---

## 3. Acceptance Criteria

1. `GET /api/v1/pipelines` returns all pipelines owned by the authenticated Clerk user, each with `candidateCount` and `stageCount` computed server-side.
2. `POST /api/v1/pipelines` creates a Pipeline plus its preset Stages and Challenges in a single D1 transaction. Returns the created pipeline ID.
3. `DELETE /api/v1/pipelines/:id` deletes the pipeline and cascade-deletes all child Stages and Challenges. Returns 204.
4. Every API route returns 401 if the Clerk session token is missing or invalid.
5. Every API route returns 403 if the authenticated user does not own the requested pipeline.
6. The ListingPage renders pipeline cards with title, status, candidate count, and stage count using data from `GET /api/v1/pipelines`.
7. The PipelineCreatePage submits to `POST /api/v1/pipelines` and redirects to `/pipeline/:id` on success.
8. The D1 schema enforces `NOT NULL` on required fields and uses `FOREIGN KEY` with `ON DELETE CASCADE`.
9. All six BDD scenarios pass as Playwright tests against the deployed Cloudflare Worker + Pages.
10. No Amplify SDK imports remain in `ListingPage.tsx` or `PipeLineCreatePage.tsx`.

---

## 4. D1 Schema

```sql
-- migration/sql/0001_create_pipelines.sql

CREATE TABLE IF NOT EXISTS pipelines (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  clerk_user_id TEXT NOT NULL,            -- Clerk user ID (owner)
  title       TEXT NOT NULL,
  level       TEXT CHECK (level IN (
                'Junior', 'Mid', 'Senior', 'Staff',
                'Principal', 'Lead', 'Manager'
              )),
  stack       TEXT,                       -- JSON array: '["React","TypeScript"]'
  description TEXT,
  status      TEXT NOT NULL DEFAULT 'DRAFT'
              CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  creation_mode TEXT DEFAULT 'BLANK'
              CHECK (creation_mode IN ('BLANK', 'PRESET', 'AI_DRIVEN')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_pipelines_clerk_user_id ON pipelines(clerk_user_id);
CREATE INDEX idx_pipelines_status ON pipelines(status);


CREATE TABLE IF NOT EXISTS stages (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  time_limit  INTEGER,                   -- minutes
  mode        TEXT DEFAULT 'ASYNC'
              CHECK (mode IN ('ASYNC', 'LIVE_VIDEO')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_stages_pipeline_id ON stages(pipeline_id);


CREATE TABLE IF NOT EXISTS challenges (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  stage_id        TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  type            TEXT NOT NULL CHECK (type IN (
                    'CODE_REVIEW', 'CODE_IMPLEMENTATION',
                    'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER', 'FOLLOW_UP'
                  )),
  sort_order      INTEGER NOT NULL DEFAULT 0,
  title           TEXT NOT NULL,
  instructions    TEXT,
  config          TEXT,                  -- JSON: public challenge config
  server_config   TEXT,                  -- JSON: private answer keys (never sent to client)
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_challenges_stage_id ON challenges(stage_id);
```

**Design notes:**
- `id` uses `randomblob(16)` hex — 32 hex chars, equivalent to a UUID without hyphens. No auto-increment leaking row counts.
- `stack` is stored as a JSON text column. D1 supports `json_each()` for querying if needed later.
- `clerk_user_id` on `pipelines` replaces the Amplify owner field. Stages and Challenges inherit ownership through the `pipeline_id` foreign key chain.
- `ON DELETE CASCADE` ensures `DELETE FROM pipelines WHERE id = ?` automatically removes child stages and challenges. D1 enforces foreign key constraints by default (`PRAGMA foreign_keys = ON`).
- Column names use `snake_case` (SQL convention) — the API layer maps to `camelCase` in JSON responses.

> **Schema evolution note:** The `stages` and `challenges` tables defined here are intentionally minimal for Phase 1. Phase 2 adds columns via `ALTER TABLE` migrations (not `CREATE TABLE` redefinitions). See `migration/sql/0002_*.sql` files in Phase 2. Do not redefine these tables — extend them.

---

## 5. Workers API Routes

Base URL: `https://api.pipe.dev` (or `http://localhost:8787` in dev)

> **API path convention:** All routes across all phases use the `/api/v1/` prefix for consistency. Phase 3 candidate-facing RPC routes use `/rpc/` to distinguish unauthenticated/session-token flows from Clerk-authenticated recruiter routes. This is an intentional split — `/api/v1/` = recruiter (Clerk JWT), `/rpc/` = candidate (session JWT or public).

All routes require a `Authorization: Bearer <clerk_session_token>` header. The Worker validates it via `@clerk/backend`.

### 5.1 List Pipelines

```
GET /api/v1/pipelines
```

**Query params** (optional):
- `status` — filter by `DRAFT`, `ACTIVE`, `ARCHIVED`
- `q` — search title (case-insensitive `LIKE '%q%'`)

**Response: 200**

```typescript
{
  pipelines: Array<{
    id: string;
    title: string;
    level: string | null;
    status: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    creationMode: string;
    stageCount: number;
    candidateCount: number;
    createdAt: string;   // ISO 8601
    updatedAt: string;
  }>;
}
```

**SQL (single query with counts):**

```sql
-- Phase 1: candidates table does not exist yet, so candidateCount is hardcoded to 0.
-- Phase 2 adds the candidates table; update this query to LEFT JOIN candidates at that point.
SELECT
  p.id,
  p.title,
  p.level,
  p.status,
  p.creation_mode,
  p.created_at,
  p.updated_at,
  COUNT(DISTINCT s.id) AS stage_count,
  0 AS candidate_count
FROM pipelines p
LEFT JOIN stages s ON s.pipeline_id = p.id
WHERE p.clerk_user_id = ?1
GROUP BY p.id
ORDER BY p.created_at DESC;
```

> **Note:** A `LEFT JOIN` on a nonexistent table throws a SQL error in D1/SQLite — it does not silently return 0. The query above hardcodes `candidate_count` to 0. When Phase 2 creates the `candidates` table, update this query to: `LEFT JOIN candidates c ON c.pipeline_id = p.id` and replace `0 AS candidate_count` with `COUNT(DISTINCT c.id) AS candidate_count`.

### 5.2 Create Pipeline

```
POST /api/v1/pipelines
```

**Request body:**

```typescript
{
  title: string;           // required, 1-200 chars
  level: string;           // required, must be valid enum
  stack?: string[];
  description?: string;
  status?: 'DRAFT' | 'ACTIVE';  // default: 'DRAFT'
  creationMode?: 'BLANK' | 'PRESET';
  presetId?: string;       // e.g. 'DEFAULT', 'BLANK'
}
```

**Response: 201**

```typescript
{
  pipeline: {
    id: string;
    title: string;
    level: string;
    status: string;
    stageCount: number;
    createdAt: string;
  };
}
```

**Implementation:** Within a single D1 batch transaction:
1. `INSERT INTO pipelines`
2. For each preset stage: `INSERT INTO stages`
3. For each preset challenge: `INSERT INTO challenges`

If any insert fails, the entire batch rolls back.

### 5.3 Delete Pipeline

```
DELETE /api/v1/pipelines/:id
```

**Response: 204 No Content**

**Implementation:**
1. Verify ownership: `SELECT clerk_user_id FROM pipelines WHERE id = ?`
2. If not owned by caller, return 403.
3. `DELETE FROM pipelines WHERE id = ?` (cascade handles stages + challenges).

### 5.4 Error Responses

All errors follow a consistent shape:

```typescript
{
  error: {
    code: string;      // e.g. 'UNAUTHORIZED', 'NOT_FOUND', 'VALIDATION_ERROR'
    message: string;
  };
}
```

| Status | Code | When |
|--------|------|------|
| 401 | `UNAUTHORIZED` | Missing or invalid Clerk token |
| 403 | `FORBIDDEN` | User does not own the resource |
| 404 | `NOT_FOUND` | Pipeline ID does not exist |
| 422 | `VALIDATION_ERROR` | Bad request body (missing title, invalid level, etc.) |

---

## 6. Task List

### Infrastructure

| # | Task | Files |
|---|------|-------|
| 1 | Initialize Cloudflare Worker project with Hono | `workers/api/package.json`, `workers/api/tsconfig.json`, `workers/api/wrangler.jsonc` |
| 2 | Create D1 database and run migration | `workers/api/wrangler.jsonc` (D1 binding), `migration/sql/0001_create_pipelines.sql` |
| 3 | Install and configure Clerk backend SDK | `workers/api/package.json` (`@clerk/backend`), `workers/api/src/middleware/auth.ts` |
| 4 | Write Clerk auth middleware for Hono | `workers/api/src/middleware/auth.ts` |

### API Routes

| # | Task | Files |
|---|------|-------|
| 5 | Implement `GET /api/v1/pipelines` handler | `workers/api/src/routes/pipelines.ts` |
| 6 | Implement `POST /api/v1/pipelines` handler with preset expansion | `workers/api/src/routes/pipelines.ts` |
| 7 | Implement `DELETE /api/v1/pipelines/:id` handler with ownership check | `workers/api/src/routes/pipelines.ts` |
| 8 | Add request validation (Zod schemas) | `workers/api/src/validation/pipelines.ts` |
| 9 | Add shared error handling middleware | `workers/api/src/middleware/errors.ts` |

### Frontend Provider Layer

| # | Task | Files |
|---|------|-------|
| 10 | Create API client module (fetch wrapper with Clerk token injection) | `src/lib/api/client.ts` |
| 11 | Create `usePipelines` hook (replaces Amplify `Pipeline.list()`) | `src/hooks/usePipelines.ts` |
| 12 | Create `usePipelineCreate` hook (replaces Amplify `Pipeline.create()` + `Stage.create()` + `Challenge.create()`) | `src/hooks/usePipelineCreate.ts` (rewrite) |
| 13 | Create `usePipelineDelete` hook (replaces Amplify `Pipeline.delete()`) | `src/hooks/usePipelineDelete.ts` |

### Page Migration

| # | Task | Files |
|---|------|-------|
| 14 | Rewrite ListingPage to use `usePipelines` and `usePipelineDelete` | `src/pages/ListingPage.tsx` |
| 15 | Rewrite PipeLineCreatePage to use new `usePipelineCreate` | `src/pages/PipeLineCreatePage.tsx` |
| 16 | Remove Amplify SDK imports from both pages | `src/pages/ListingPage.tsx`, `src/pages/PipeLineCreatePage.tsx` |

### Auth Integration

| # | Task | Files |
|---|------|-------|
| 17 | Install `@clerk/clerk-react` and add `<ClerkProvider>` | `src/main.tsx` or `src/App.tsx`, `package.json` |
| 18 | Create `<ProtectedRoute>` component using Clerk's `useAuth` | `src/components/auth/ProtectedRoute.tsx` |
| 19 | Wrap `/` and `/pipeline/new` routes in `<ProtectedRoute>` | `src/App.tsx` (router config) |

### Pipeline Presets (Server-Side)

| # | Task | Files |
|---|------|-------|
| 20 | Move `PIPELINE_PRESETS` to a shared location accessible by the Worker | `workers/api/src/lib/pipelinePresets.ts` (copy from `src/lib/pipelinePresets.ts`) |

### Tests

| # | Task | Files |
|---|------|-------|
| 21 | Write Playwright BDD tests for all 6 scenarios | `e2e/phase-1/listing.spec.ts`, `e2e/phase-1/pipeline-create.spec.ts`, `e2e/phase-1/auth.spec.ts` |
| 22 | Write Worker integration tests (Miniflare) | `workers/api/src/__tests__/pipelines.test.ts` |

---

## 7. BDD Test Specifications

### 7.1 `e2e/phase-1/listing.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Listing Page', () => {
  test.describe('Empty state', () => {
    test('shows NO_ROLES_FOUND when recruiter has no pipelines', async ({ page }) => {
      // Sign in via Clerk test helper
      // Navigate to /
      // Assert: "NO_ROLES_FOUND" text visible
      // Assert: sidebar shows "0 ACTIVE", "0 CANDIDATES"
      // Assert: "NEW_ROLE" button visible
    });
  });

  test.describe('With existing pipelines', () => {
    test.beforeEach(async () => {
      // Seed 3 pipelines via API:
      //   "Senior Frontend Engineer" (ACTIVE, 2 candidates)
      //   "Junior Backend Developer" (DRAFT, 0 candidates)
      //   "Staff Platform Engineer" (ACTIVE, 5 candidates)
    });

    test('displays all pipelines with correct counts', async ({ page }) => {
      // Navigate to /
      // Assert: 3 pipeline cards visible
      // Assert: sidebar shows "2 ACTIVE"
      // Assert: sidebar shows "7 CANDIDATES"
    });

    test('filters by status', async ({ page }) => {
      // Navigate to /
      // Click "ACTIVE" filter
      // Assert: 2 pipeline cards visible
      // Click "DRAFT" filter
      // Assert: 1 pipeline card visible ("Junior Backend Developer")
    });

    test('searches by title', async ({ page }) => {
      // Navigate to /
      // Type "Frontend" in search
      // Assert: 1 pipeline card visible ("Senior Frontend Engineer")
    });
  });

  test.describe('Delete pipeline', () => {
    test('removes pipeline from listing after confirmation', async ({ page }) => {
      // Seed 1 pipeline "Obsolete Role"
      // Navigate to /
      // Click delete on "Obsolete Role"
      // Accept confirmation dialog
      // Assert: "Obsolete Role" no longer in listing
      // Assert: GET /api/v1/pipelines returns 0 pipelines
    });
  });
});
```

### 7.2 `e2e/phase-1/pipeline-create.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Pipeline Create Page', () => {
  test('creates pipeline with preset and redirects', async ({ page }) => {
    // Sign in via Clerk test helper
    // Navigate to /pipeline/new
    // Fill in title: "Senior Frontend Engineer"
    // Select level: "Senior"
    // Select preset: "DEFAULT"
    // Complete all phases, submit
    // Assert: redirected to /pipeline/{id}
    // Assert: GET /api/v1/pipelines returns 1 pipeline
    //   with title "Senior Frontend Engineer"
    //   and stageCount > 0
  });

  test('shows validation error for missing title', async ({ page }) => {
    // Navigate to /pipeline/new
    // Attempt to submit without title
    // Assert: validation error visible
  });
});
```

### 7.3 `e2e/phase-1/auth.spec.ts`

```typescript
import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('redirects unauthenticated user from / to Clerk sign-in', async ({ page }) => {
    // Clear all auth state
    // Navigate to /
    // Assert: URL contains Clerk sign-in path
  });

  test('redirects unauthenticated user from /pipeline/new to Clerk sign-in', async ({ page }) => {
    // Clear all auth state
    // Navigate to /pipeline/new
    // Assert: URL contains Clerk sign-in path
  });

  test('returns 401 for API call without auth header', async ({ request }) => {
    const response = await request.get('/api/v1/pipelines');
    expect(response.status()).toBe(401);
    const body = await response.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });
});
```

### 7.4 `workers/api/src/__tests__/pipelines.test.ts` (Integration)

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
// Uses Miniflare for local D1 + Worker execution

describe('GET /api/v1/pipelines', () => {
  it('returns empty array for new user', async () => {
    // Assert: { pipelines: [] }
  });

  it('returns pipelines with stage and candidate counts', async () => {
    // Seed pipeline + 2 stages
    // Assert: stageCount === 2, candidateCount === 0
  });

  it('filters by status query param', async () => {
    // Seed 1 ACTIVE, 1 DRAFT
    // GET /api/v1/pipelines?status=ACTIVE
    // Assert: 1 result
  });

  it('returns 401 without auth', async () => {
    // No Authorization header
    // Assert: 401
  });
});

describe('POST /api/v1/pipelines', () => {
  it('creates pipeline with stages from preset in a single transaction', async () => {
    // POST with presetId: 'DEFAULT'
    // Assert: 201
    // Assert: pipeline exists in D1
    // Assert: stages exist in D1
    // Assert: challenges exist in D1
  });

  it('rejects missing title with 422', async () => {
    // POST without title
    // Assert: 422, error.code === 'VALIDATION_ERROR'
  });

  it('rejects invalid level with 422', async () => {
    // POST with level: 'Wizard'
    // Assert: 422
  });
});

describe('DELETE /api/v1/pipelines/:id', () => {
  it('cascade-deletes stages and challenges', async () => {
    // Create pipeline with stages + challenges
    // DELETE /api/v1/pipelines/:id
    // Assert: 204
    // Assert: no stages remain in D1
    // Assert: no challenges remain in D1
  });

  it('returns 403 for pipeline owned by another user', async () => {
    // Create pipeline as user A
    // DELETE as user B
    // Assert: 403
  });

  it('returns 404 for nonexistent pipeline', async () => {
    // DELETE /api/v1/pipelines/nonexistent
    // Assert: 404
  });
});
```

---

## 8. Definition of Done

- [ ] D1 migration `0001_create_pipelines.sql` applied successfully
- [ ] `GET /api/v1/pipelines` returns correct data with counts, scoped to Clerk user
- [ ] `POST /api/v1/pipelines` creates pipeline + stages + challenges transactionally
- [ ] `DELETE /api/v1/pipelines/:id` cascade-deletes with ownership guard
- [ ] All API routes return 401 for unauthenticated requests
- [ ] All API routes return 403 for cross-user access attempts
- [ ] `ListingPage.tsx` has zero Amplify SDK imports
- [ ] `PipeLineCreatePage.tsx` has zero Amplify SDK imports
- [ ] All 6 BDD Playwright scenarios pass
- [ ] All Worker integration tests pass (Vitest + Miniflare)
- [ ] No regression in pages not yet migrated (they still use Amplify)
- [ ] `wrangler deploy` succeeds and the Worker is live on Cloudflare
