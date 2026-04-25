# Reliability: Heartbeats and Stale Run Detection

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 247–249)
**Phase:** 0 (listed as ACTIVE in master list under "Reliability hardening")
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote

> Cron-triggered Worker scans for in-flight `ingestion_runs` with `heartbeat_at` older than 5 minutes, marks them failed, enables re-ingestion. Heartbeat updates happen after each step completes. Cloudflare Workers can be terminated without notification; heartbeats make interrupted runs detectable.

## Why

Cloudflare Workers can be terminated silently (CPU/memory limits, deployment rollouts). Without heartbeats, a terminated run stays `in_flight` forever, blocking the candidate from re-ingesting. The cron scanner converts invisible failures into detectable, recoverable state.

## Subtasks (delegable)

### Subtask 1 — `heartbeat_at` column + cron scanner Worker
**Files:**
- `workers/api/migrations/0050_ingestion_heartbeat.sql` (new)
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Spec:**
- Migration: add `heartbeat_at TEXT` to `candidate_ingestion` table. Nullable — null means never pulsed (new rows or rows from before this migration).
- In `orchestrate.ts`: after each step completes, update `candidate_ingestion SET heartbeat_at = datetime('now') WHERE candidate_id = ?`.
- Scan query for stale runs:
  ```sql
  SELECT candidate_id FROM candidate_ingestion
  WHERE status = 'processing'
    AND (heartbeat_at IS NULL OR heartbeat_at < datetime('now', '-5 minutes'))
  ```
- On detection: update status → `'failed'`, set `error_message = 'stale_run_no_heartbeat'`.

**Status:** ⏳ PENDING

### Subtask 2 — Cron Worker handler
**Files:**
- `workers/api/src/cron/staleRunDetector.ts` (new)
- `workers/api/wrangler.jsonc` (add cron trigger)

**Spec:**
- Export `handleStaleRunScan(env): Promise<void>`:
  - Runs the stale scan query above.
  - For each stale run: mark failed, log structured JSON: `{ event: 'stale_run_detected', candidate_id_hash, last_heartbeat, stale_minutes }`. Hash the candidate ID for logging (no PII in logs).
  - Emits count of stale runs found as a metric log line.
- Register in `wrangler.jsonc` cron triggers: `"0/5 * * * *"` (every 5 minutes).
- Unit test: mock D1 with 2 stale rows and 1 healthy row; verify only stale rows are marked failed.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `reliability-idempotency-and-partial-materialization.md` (per-step status and the `ingestion_runs` table changes context for which rows to scan)
- Blocks: `reliability-dead-letter-queue.md` (DLQ consumer ingests the permanently-failed rows this plan produces)

## Acceptance criteria

- [ ] `heartbeat_at` updated after each pipeline step
- [ ] Cron scanner marks runs stale after 5 minutes without heartbeat
- [ ] Stale detection logs structured JSON with hashed candidate ID (no PII)
- [ ] Newly failed runs are detectable and re-ingestable after stale detection
- [ ] `npx tsc --noEmit` passes
- [ ] Cron trigger registered in `wrangler.jsonc`
