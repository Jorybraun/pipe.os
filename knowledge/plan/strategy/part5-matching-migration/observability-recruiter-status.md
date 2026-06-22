# Observability: Structured Recruiter-Facing Pipeline Status

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part5-matching-migration.md (lines 292–297)
**Phase:** 0 (listed as ACTIVE in master list)
**Status:** PENDING
**Estimate:** 1 week

## Source quote

> Replace the current opaque "failed" with structured status reflecting pipeline progress: pending, profile_generated, embedded, matching, matched, failed_step_X (with reason + ETA), failed_permanent (with action recommendation). D1 schema extension to `candidate_ingestion`: `step_timestamps` JSON, `current_step` enum, `estimated_completion` (from historical p50 per step), `recovery_options` JSON array. Recruiter dashboard polls via Server-Sent Events for real-time updates.

## Why

Recruiters currently see "failed" with no context — no indication of which step failed, no ETA, no recommended action. Structured status converts a recruiter frustration into an actionable signal: "Embedding failed due to provider issue, estimated retry in 3 minutes" vs. "Matching: 45s remaining based on typical p50."

## Subtasks (delegable)

### Subtask 1 — D1 migration: status enrichment columns
**Files:**
- `workers/api/migrations/0052_structured_ingestion_status.sql` (new)

**Spec:**
- Add to `candidate_ingestion`:
  - `current_step TEXT` — enum: `'pending' | 'profile_discovery' | 'embedding' | 'repo_matching' | 'triangulation' | 'situation_fit' | 'complete' | 'failed_transient' | 'failed_permanent'`
  - `step_timestamps_json TEXT NOT NULL DEFAULT '{}'` — JSON object: `{ step_name: iso_timestamp }` per completed step
  - `estimated_completion_at TEXT` — nullable, computed from p50 duration of remaining steps
  - `recovery_options_json TEXT NOT NULL DEFAULT '[]'` — JSON array of `{ action, label, endpoint }` for recruiter-visible recovery actions
  - `failure_step TEXT` — which step failed (for `failed_*` statuses)
  - `failure_reason TEXT` — recruiter-friendly message (no PII, no internal error codes)
- Note: `step_timestamps_json` is populated by the orchestrator after each step.

**Status:** ⏳ PENDING

### Subtask 2 — p50 step duration tracker
**Files:**
- `workers/api/src/lib/telemetry/stepDurationTracker.ts` (new)
- `workers/api/migrations/0053_step_duration_samples.sql` (new)

**Spec:**
- Create `step_duration_samples` table:
  - `step_name TEXT NOT NULL`
  - `duration_ms INTEGER NOT NULL`
  - `sampled_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - Retain last 500 rows per step (delete oldest on insert).
- Export `recordStepDuration(step: string, durationMs: number, db): Promise<void>`.
- Export `getP50Duration(step: string, db): Promise<number | null>` — median of last 500 samples.
- Export `estimateCompletion(currentStep: string, db): Promise<string | null>` — sums p50 of remaining steps, returns ISO timestamp.
- Orchestrator calls `recordStepDuration` and `estimateCompletion` after each step to keep `candidate_ingestion.estimated_completion_at` current.

**Status:** ⏳ PENDING

### Subtask 3 — SSE endpoint for real-time status polling
**Files:**
- `workers/api/src/routes/cockpit/ingestionStatus.ts` (new)

**Spec:**
- `GET /api/v1/candidates/:id/ingestion-status/stream` — Clerk JWT required.
- Returns Server-Sent Events stream.
- Polls `candidate_ingestion` every 3 seconds; sends event when `current_step` or `status` changes.
- Event shape:
  ```json
  {
    "candidate_id": "...",
    "current_step": "embedding",
    "status": "processing",
    "estimated_completion_at": "2026-04-25T10:32:00Z",
    "step_timestamps": { "profile_discovery": "2026-04-25T10:30:00Z" },
    "failure_reason": null,
    "recovery_options": []
  }
  ```
- On terminal state (`complete` or `failed_permanent`): send final event then close stream.
- `failed_transient` status: include `recovery_options` with a "Retry" option.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `reliability-idempotency-and-partial-materialization.md` (per-step status columns overlap — coordinate migration numbering)
- Independent of OTel plan (parallel concern, same pipeline)

## Acceptance criteria

- [ ] `current_step` enum updated by orchestrator at each step transition
- [ ] `step_timestamps_json` records accurate timestamps per step
- [ ] `estimated_completion_at` updated using p50 of remaining steps
- [ ] SSE stream emits events on step changes, closes on terminal state
- [ ] `failure_reason` is recruiter-readable, no internal error codes or PII
- [ ] `recovery_options` populated for transient failures
- [ ] `npx tsc --noEmit` passes
