# QA Swarm Specification — PIPE-OS Bug Fix + Observability Finish

**Date:** 2026-05-01
**Branch:** `claude-dev`
**Swarm Mode:** 3 lanes, parallel execution
**Goal:** Fix 15 bugs, finish observability wiring, close 3 long-standing stubs

---

## Lane A — Bug Crusher (Backend API Fixes)

**Owner:** Agent A
**Files:** `workers/api/src/routes/cockpit/candidates.ts`, migrations, tests
**Est:** 3–4 hours

### A1: H3 — `GET /api/v1/candidates/:id` returns `ingestion: null`
**Problem:** LEFT JOIN on `candidate_ingestion` produces all-NULL columns when ingestion row exists but columns are NULL; `.first()` returns null.
**File:** `workers/api/src/routes/cockpit/candidates.ts` ~line 556
**Fix:**
- Check if the `candidate_ingestion` row exists separately from the candidate query
- OR coalesce/validate the LEFT JOIN result so `ingestion` is populated when a row exists
- Add test verifying `ingestion` object present when DB row exists

### A2: H4 — XSS payload accepted in candidate name
**Problem:** `POST /api/v1/candidates` stores raw HTML `<script>alert(1)</script>` with no sanitization.
**File:** `workers/api/src/routes/cockpit/candidates.ts`
**Fix:**
- Strip/sanitize `name` field on create AND update using a lightweight sanitizer (DOMPurify-like or regex strip of `<>` tags)
- Reject names containing `<script` or other obvious XSS vectors with 400
- Add test for XSS rejection

### A3: H5 — Duplicate candidate emails in same pipeline
**Problem:** No unique constraint on `(pipeline_id, email)`.
**Files:**
- New migration: add UNIQUE constraint or composite index
- `workers/api/src/routes/cockpit/candidates.ts`: reject duplicate with 409 "email already exists in pipeline"
**Fix:**
- Migration: `CREATE UNIQUE INDEX idx_candidates_pipeline_email ON candidates(pipeline_id, email)`
- API: check before insert, return 409 with clear message
- Add test for duplicate rejection

### A4: M8 — `DELETE /api/v1/candidates/:id` returns `INTERNAL_ERROR`
**Problem:** Endpoint exists but crashes.
**File:** `workers/api/src/routes/cockpit/candidates.ts`
**Fix:**
- Find the DELETE handler, identify the crash (likely cascade delete order or missing FK handling)
- Fix the query logic
- Add test verifying delete succeeds and cleans up related rows

### A5: M1 — INTELLIGENCE tab unresponsive
**Problem:** Clicking INTELLIGENCE tab on candidate profile does nothing.
**Investigation:**
- Check if the tab content component exists but isn't rendered due to `ingestion: null` (H3 fix may resolve)
- OR check if the tab route/state handler is missing
- **File to inspect:** Candidate profile page component, tab state machine
**Fix:** Wire tab click to content switch. If blocked by H3, this becomes trivial after A1.

---

## Lane B — Observability Finish (Backend Infrastructure)

**Owner:** Agent B
**Files:** `workers/api/src/lib/ai/`, `workers/api/src/lib/telemetry/`, `workers/api/src/lib/candidateDiscovery/`, `workers/api/src/routes/cockpit/ingestionStatus.ts`
**Est:** 3–4 hours

### B1: Wire retry helper into LLM call sites
**Problem:** `retryWithBackoff()` exists but is NOT imported at any LLM call site.
**Files to wire:**
- `workers/api/src/lib/ai/embed.ts` — wrap `env.AI.run()` call
- `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts` — wrap the LLM completion call
- `workers/api/src/lib/roleAgent/embedRole.ts` — wrap the embedding call
**Fix:**
- Import `retryWithBackoff` from `../ai/retryHelper` (adjust path per file)
- Wrap the async LLM call with `retryWithBackoff(async () => { ... })`
- Use sensible defaults: `maxRetries: 3`, `baseDelayMs: 1000`
- Add `onRetry` console.warn for observability
- Ensure `classifyError` correctly handles the specific errors from each provider

### B2: Build `stepDurationTracker.ts`
**Problem:** `step_duration_samples` table exists (migration 0064) but no code reads/writes it.
**New file:** `workers/api/src/lib/telemetry/stepDurationTracker.ts`
**Required functions:**
```ts
export async function recordStepDuration(
  db: D1Database,
  stepName: string,
  durationMs: number,
  candidateId?: string
): Promise<void>

export async function getP50Duration(
  db: D1Database,
  stepName: string
): Promise<number | null>

export async function estimateCompletion(
  db: D1Database,
  remainingSteps: string[]
): Promise<number | null> // estimated ms from now
```
**Behavior:**
- `recordStepDuration` inserts into `step_duration_samples` (trigger auto-trims to last 500 per step)
- `getP50Duration` computes median duration for a step from last 500 samples
- `estimateCompletion` sums p50 durations for remaining steps
**Tests:** Add `stepDurationTracker.test.ts` with in-memory D1 mock

### B3: Orchestrator telemetry
**Problem:** `orchestrate.ts` doesn't write step progress to `candidate_ingestion`.
**File:** `workers/api/src/lib/candidateDiscovery/orchestrate.ts`
**Fix:**
- At the start of each major step, `UPDATE candidate_ingestion SET current_step = ?`
- After each step, call `recordStepDuration()` with elapsed time
- Before starting, compute `estimated_completion_at = now + estimateCompletion(db, remainingSteps)`
- On failure, `UPDATE candidate_ingestion SET failure_reason = ?, current_step = ?`
- Ensure these updates are non-blocking (fire-and-forget via `waitUntil` if possible, or inline if fast)

### B4: Fix terminal states in ingestionStatus.ts
**Problem:** `TERMINAL_STATES = new Set(['completed', 'failed', 'error'])` doesn't match actual DB.
**File:** `workers/api/src/routes/cockpit/ingestionStatus.ts`
**Fix:**
- Actual statuses: `pending | profile_generated | embedded | matched | failed`
- Update `TERMINAL_STATES` to `new Set(['matched', 'failed'])`
- Verify `done` event fires correctly on terminal transition

---

## Lane C — Stub-to-Real (Close Long-Standing TODOs)

**Owner:** Agent C
**Files:** `workers/api/src/lib/cultureAgentDecomposition.ts`, `workers/api/src/lib/roleAgent.ts`, `workers/api/src/lib/roleAgentPrompts.ts`, `workers/api/src/lib/repoDiscovery/discover.ts`
**Est:** 3–4 hours

### C1: Persist screener answer decomposition
**Problem:** `persistDecomposition()` in `cultureAgentDecomposition.ts` is a TODO stub that logs and returns.
**File:** `workers/api/src/lib/cultureAgentDecomposition.ts`
**Fix:**
- Remove stub comment
- Import `insertCandidateNode` from `candidateDiscovery/candidateNodes`
- For each decomposed element (`culturalSignals`, `newExperiences`, `newProjects`), call `insertCandidateNode()` with correct `node_type`, `source_type='culture_interview'`, `captured_at=now`
- Handle `clarificationNeeded` flag by NOT persisting and returning a signal to the caller
- Add test verifying decomposition results are written to `candidate_nodes`

### C2: Delete legacy roleAgent.ts
**Problem:** `roleAgent.ts` (606 lines) and `roleAgentPrompts.ts` still exist despite new state machine.
**Files:**
- `workers/api/src/lib/roleAgent.ts`
- `workers/api/src/lib/roleAgentPrompts.ts`
**Pre-check before delete:**
- Grep for ALL imports of these files
- `roleAgent.ts` imported by `__tests__/roleDiscovery.test.ts` — update or delete tests
- `roleAgentPrompts.ts` imported by `roleContexts.ts` — verify NOT used in active path
**Fix:**
- Remove imports from active code paths
- Delete both files
- Update any remaining tests to use new architecture or delete obsolete tests
- Run full test suite to confirm no breakage

### C3: RCD cutover in discover.ts
**Problem:** `discover.ts` still reads `persona.mustHaveSkills` instead of `rcd_json.technical_context.stack`.
**File:** `workers/api/src/lib/repoDiscovery/discover.ts`
**Fix:**
- Load `rcd_json` from `role_contexts` table at start of `discover()`
- Derive `mustHaveSkills` from `rcd_json.technical_context.stack`
- Derive `seniority` from `rcd_json.technical_context.seniority_band`
- Derive `domain` from `rcd_json.domain_matrix.primary`
- Keep `persona` as fallback when `rcd_json` is null
- Add log line: `console.error('[discover] rcd path taken | persona fallback', { roleContextId })`
- Update `discover.ts` tests or verify existing tests still pass

---

## Cross-Cutting Requirements

1. **All changes on `claude-dev` branch**
2. **Type check:** `cd workers/api && npx tsc --noEmit` must pass
3. **Tests:** `cd workers/api && npx vitest run` — all existing tests must still pass; new tests must be added for each fix
4. **No new dependencies** unless absolutely necessary (Lane A4 XSS may need a sanitizer — prefer built-in or regex)
5. **Commit message format:** `fix(bug|observability|cleanup): <description>`

---

## Sign-off Checklist

- [ ] Lane A: H3, H4, H5, M8, M1 all verified fixed
- [ ] Lane B: retry helper wired at 3+ call sites, stepDurationTracker tests pass, orchestrator writes telemetry
- [ ] Lane C: decomposition persists to DB, roleAgent.ts deleted, discover.ts uses RCD primary
- [ ] Full typecheck: zero errors
- [ ] Full test suite: zero regressions
- [ ] `BUILD_AUDIT.md` updated to reflect changes
