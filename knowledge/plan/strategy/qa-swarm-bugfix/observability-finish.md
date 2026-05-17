# Observability Finish — Lane B

**Source:** knowledge/plan/BUILD_AUDIT.md (Reliability & Observability section)
**Phase:** 0
**Status:** PENDING
**Estimate:** 3 hours

## Why

The observability milestone is 60% complete: retry helper, SSE endpoint, and step_duration_samples migration exist. But the retry helper is not wired at any call site, the step tracker has no implementation, the orchestrator doesn't write telemetry, and the SSE terminal states are wrong. This lane finishes the milestone.

## Subtasks (delegable)

### Subtask 1 — Wire retry helper into LLM call sites

**Files:**
- `workers/api/src/lib/ai/embed.ts`
- `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts`
- `workers/api/src/lib/roleAgent/embedRole.ts`
- `workers/api/src/lib/ai/__tests__/retryHelper.test.ts`

**Spec:**
`retryWithBackoff()` exists in `retryHelper.ts` but is NOT imported anywhere. Wire it into all direct LLM/AI calls:
1. `embed.ts`: Wrap `env.AI.run(@cf/baai/bge-large-en-v1.5)` call
2. `candidateSituationFit.ts`: Wrap the `provider.complete()` call
3. `embedRole.ts`: Wrap the embedding call

Use defaults: `maxRetries: 3`, `baseDelayMs: 1000`, jitter enabled.
Add `onRetry` log: `console.warn('[retry] attempt N after Mms delay for <function>')`.

**Status:** ⏳ PENDING

---

### Subtask 2 — Build `stepDurationTracker.ts`

**Files:**
- `workers/api/src/lib/telemetry/stepDurationTracker.ts`
- `workers/api/src/lib/telemetry/__tests__/stepDurationTracker.test.ts`

**Spec:**
Migration 0064 created `step_duration_samples` table with auto-trim trigger (last 500 per step). Build the module that uses it:

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
): Promise<number | null>
```

- `recordStepDuration`: INSERT into `step_duration_samples`; trigger handles retention
- `getP50Duration`: SELECT duration_ms ORDER BY created_at DESC LIMIT 500, compute median in JS
- `estimateCompletion`: Sum p50 for each remaining step; return null if any step has <3 samples

**Status:** ⏳ PENDING

---

### Subtask 3 — Orchestrator telemetry integration

**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Spec:**
Add telemetry writes to `candidate_ingestion` during ingestion pipeline:
1. At start of each major step: `UPDATE candidate_ingestion SET current_step = ?`
2. After each step completes: call `recordStepDuration()` with elapsed time
3. Before starting pipeline: compute `estimated_completion_at = now + estimateCompletion(db, remainingSteps)`
4. On failure: `UPDATE candidate_ingestion SET failure_reason = ?, current_step = ?`

The `current_step` column may not exist yet — if so, add it via a lightweight migration or inline ALTER.

**Status:** ⏳ PENDING

---

### Subtask 4 — Fix terminal states in ingestionStatus.ts

**Files:**
- `workers/api/src/routes/cockpit/ingestionStatus.ts`

**Spec:**
`TERMINAL_STATES = new Set(['completed', 'failed', 'error'])` does not match actual DB statuses.
Actual statuses: `pending | profile_generated | embedded | matched | failed`.
Update to: `TERMINAL_STATES = new Set(['matched', 'failed'])`.
Verify SSE `done` event fires correctly on terminal transition.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: none
- Blocks: none

## Acceptance criteria
- [ ] Retry helper is imported and used at 3+ LLM call sites — evidence: grep for `retryWithBackoff`
- [ ] `stepDurationTracker.ts` exists with all 3 functions and tests pass
- [ ] Orchestrator writes `current_step`, `estimated_completion_at`, `failure_reason` during ingestion
- [ ] `ingestionStatus.ts` terminal states match actual DB (`matched`, `failed`)
- [ ] All existing tests pass: `npx vitest run`
- [ ] Type check passes: `npx tsc --noEmit`
