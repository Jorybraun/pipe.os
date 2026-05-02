# API Correctness — Bug Fix Lane A

**Source:** knowledge/plan/bugs.md (lines 11–29)
**Phase:** 0
**Status:** PENDING
**Estimate:** 3 hours

## Why

Candidate API has 4 confirmed backend bugs that break recruiter workflows: ingestion data missing from detail endpoint, XSS vulnerability, duplicate email acceptance, and broken delete. These are data integrity and security issues that must be fixed before any feature work.

## Subtasks (delegable)

### Subtask 1 — Fix H3: `GET /api/v1/candidates/:id` returns `ingestion: null`

**Files:**
- `workers/api/src/routes/cockpit/candidates.ts`
- `workers/api/src/routes/cockpit/candidates.test.ts`

**Spec:**
The candidate detail endpoint does a LEFT JOIN on `candidate_ingestion`. When the ingestion row exists but columns are NULL, `.first()` returns null because all JOINed columns are NULL. Fix by:
1. Separating the ingestion query from the candidate query, OR
2. Using COALESCE/IS NOT NULL checks on the ingestion row id to distinguish "no row" from "row with null columns"
3. Ensure `ingestion` object is populated when a `candidate_ingestion` row exists

**Repro:**
1. Create candidate with ingestion row in DB
2. `GET /api/v1/candidates/:id` → observe `ingestion: null`

**Expected:**
`ingestion` object with status, scores, dimensions even when some score columns are null.

**Status:** ⏳ PENDING

---

### Subtask 2 — Fix H4: XSS payload accepted in candidate name

**Files:**
- `workers/api/src/routes/cockpit/candidates.ts`
- `workers/api/src/routes/cockpit/candidates.test.ts`

**Spec:**
The API accepts raw HTML/JS in the `name` field with no sanitization. Fix by:
1. Strip `<` and `>` characters from `name` on create AND update
2. Reject names containing `<script` or `javascript:` with 400 `VALIDATION_ERROR`
3. Ensure frontend rendering is safe (check if React already escapes — if not, sanitize at display time too)

**Repro:**
`POST /api/v1/pipelines/:id/candidates` with body `{"name": "<script>alert(1)</script>", "email": "xss@test.com"}`

**Expected:**
400 error or sanitized name stored as `scriptalert(1)/script`.

**Status:** ⏳ PENDING

---

### Subtask 3 — Fix H5: Duplicate candidate emails in same pipeline

**Files:**
- `workers/api/migrations/0065_candidates_unique_email.sql`
- `workers/api/src/routes/cockpit/candidates.ts`
- `workers/api/src/routes/cockpit/candidates.test.ts`

**Spec:**
No unique constraint on `(pipeline_id, email)` allows duplicate invites. Fix by:
1. Migration: `CREATE UNIQUE INDEX idx_candidates_pipeline_email ON candidates(pipeline_id, email)`
2. API: Before insert, check if email exists in pipeline; return 409 with message "email already exists in pipeline"
3. Handle the unique index violation gracefully as fallback

**Repro:**
Create two candidates with same email in one pipeline.

**Expected:**
Second creation rejected with 409.

**Status:** ⏳ PENDING

---

### Subtask 4 — Fix M8: `DELETE /api/v1/candidates/:id` returns `INTERNAL_ERROR`

**Files:**
- `workers/api/src/routes/cockpit/candidates.ts`
- `workers/api/src/routes/cockpit/candidates.test.ts`

**Spec:**
The DELETE endpoint exists but crashes. Fix by:
1. Find the DELETE handler in `candidates.ts`
2. Identify the crash (likely foreign key cascade order or missing WHERE clause)
3. Ensure deletion cleans up related rows in correct order: `candidate_challenge_assignment` → `candidate_nodes` → `candidate_coverage` → `candidate_ingestion` → `candidates`
4. Or use `ON DELETE CASCADE` if FKs are already configured
5. Return 204 on success, 404 if candidate not found

**Repro:**
`DELETE /api/v1/candidates/:id`

**Expected:**
204 No Content on success.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: none
- Blocks: none

## Acceptance criteria
- [ ] H3: `GET /api/v1/candidates/:id` returns `ingestion` object when DB row exists — evidence: unit test
- [ ] H4: `POST` candidate with `<script>` in name returns 400 or sanitizes — evidence: unit test
- [ ] H5: Second candidate with same email in pipeline returns 409 — evidence: unit test
- [ ] M8: `DELETE /api/v1/candidates/:id` returns 204 and removes candidate — evidence: unit test
- [ ] All existing tests still pass: `npx vitest run`
- [ ] Type check passes: `npx tsc --noEmit`
