# Reliability: Idempotency Keys and Partial Step Materialization

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part5-matching-migration.md (lines 237–245)
**Phase:** 0 (listed as ACTIVE in master list under "Reliability hardening")
**Status:** PENDING
**Estimate:** 1 week

## Source quote

> `POST /:candidateId/reingest` currently lacks idempotency protection. Add `Idempotency-Key` header requirement. Client generates UUID per submission. Server stores the key + cached response in D1 with 24h TTL; duplicate requests within TTL return cached response.
> The 11-step candidate ingestion currently marks the whole row failed on any step's transient error. Extend `candidate_ingestion` with per-step status columns and transition the pipeline to resume from the first failed step rather than restart from pending.

## Why

Without idempotency, concurrent re-ingestion requests corrupt candidate state (race condition). Without partial step materialization, a transient failure in step 8 forces steps 1–7 to recompute unnecessarily, burning LLM tokens and delaying recovery. Both fixes directly reduce operational cost and improve pipeline reliability.

## Subtasks (delegable)

### Subtask 1 — D1 migration: idempotency keys table + per-step status columns
**Files:**
- `workers/api/migrations/0049_idempotency_and_step_status.sql` (new)

**Spec:**
- Create `ingestion_idempotency_keys` table:
  - `idempotency_key TEXT PRIMARY KEY`
  - `candidate_id TEXT NOT NULL`
  - `response_body_json TEXT` — cached response, null until request completes
  - `status TEXT NOT NULL DEFAULT 'in_flight'` — `'in_flight' | 'complete' | 'failed'`
  - `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `expires_at TEXT NOT NULL` — `datetime('now', '+24 hours')`
- Add columns to `candidate_ingestion`:
  - `profile_step_status TEXT NOT NULL DEFAULT 'pending'`
  - `embed_step_status TEXT NOT NULL DEFAULT 'pending'`
  - `match_step_status TEXT NOT NULL DEFAULT 'pending'`
  - `situation_fit_step_status TEXT NOT NULL DEFAULT 'pending'`
  - `enrichment_step_status TEXT NOT NULL DEFAULT 'pending'`
  - `resume_parse_step_status TEXT NOT NULL DEFAULT 'pending'`
  - Each status: `'pending' | 'in_progress' | 'complete' | 'failed' | 'skipped'`
  - `step_versions_json TEXT NOT NULL DEFAULT '{}'` — tracks version stamp per step for staleness detection

**Status:** ⏳ PENDING

### Subtask 2 — Idempotency enforcement on `POST /:candidateId/reingest`
**Files:**
- `workers/api/src/routes/cockpit/ingestion.ts` (re-ingestion route handler at line ~353)

**Spec:**
- Read `Idempotency-Key` header. If missing, return 400 with error message explaining requirement.
- Lookup key in `ingestion_idempotency_keys`:
  - `in_flight` (created < 24h ago): return 202 with `{ status: 'in_flight' }` — do not start second run.
  - `complete` (within TTL): return cached `response_body_json` with original status code.
  - `failed` (within TTL): return cached failure response.
  - Not found or expired: insert new row as `in_flight`, proceed with ingestion.
- On ingestion completion: update row to `complete` + store `response_body_json`.
- On ingestion failure: update row to `failed` + store error body.

**Status:** ⏳ PENDING

### Subtask 3 — Pipeline resume-from-step logic
**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Spec:**
- At pipeline start, read per-step statuses from `candidate_ingestion`.
- Skip steps where `step_status = 'complete'` AND step version stamp matches current version.
- Resume from first step where status is `'pending'` or `'failed'`.
- If `embed_step_status = 'complete'` but `EMBEDDING_MODEL_VERSION` has bumped since stamp, reset embed step to `'pending'` and recompute from there.
- Update per-step status before and after each step: `in_progress` → `complete` or `failed`.
- Unit test: pipeline with steps 1–5 complete resumes at step 6; stale version stamp triggers recompute.

**Status:** ⏳ PENDING

## Dependencies

- Independent of retry and circuit breaker plans (orthogonal concern)
- Blocks: `reliability-heartbeats-and-stale-detection.md` (per-step status columns this plan adds are the source of truth for the staleness scanner)

## Acceptance criteria

- [ ] `Idempotency-Key` header missing → 400 error
- [ ] Duplicate key within 24h TTL → returns cached response, does not start second run
- [ ] Per-step status columns added to `candidate_ingestion`
- [ ] Pipeline skips completed steps on resume
- [ ] Version stamp mismatch triggers recompute from stale step
- [ ] `npx tsc --noEmit` passes
