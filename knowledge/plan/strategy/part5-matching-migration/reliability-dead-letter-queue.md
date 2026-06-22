# Reliability: Dead-Letter Queue for Permanent Failures

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part5-matching-migration.md (lines 251–254)
**Phase:** 0 (listed as ACTIVE in master list under "Reliability hardening")
**Status:** PENDING
**Estimate:** 1 week

## Source quote

> Extended beyond the current opaque "failed" status to structured diagnostic objects. Each failure captures: failed_step, error_type classification, error_code (provider-specific), retry_count, retry_exhausted, checkpoint_preserved flag, recovery_endpoint for manual retry, recruiter-friendly error_message. Cloudflare Queues handles the DLQ with at-least-once semantics. Consumer worker runs automatic retries for transient failures, routes permanent failures to the admin queue with full context, and emits operational alerts on failure category trends.

## Why

The current `'failed'` status is opaque — there's no way to distinguish a transient Vertex quota blip from a permanent content-filter rejection without reading raw logs. Structured DLQ entries make failures triageable, enable automatic retry of transients, and surface cost anomalies (e.g., a spike in `VERTEX_AI_429` indicating quota planning needed).

## Subtasks (delegable)

### Subtask 1 — Structured failure schema + Cloudflare Queue binding
**Files:**
- `workers/api/migrations/0051_structured_failures.sql` (new)
- `workers/api/wrangler.jsonc`

**Spec:**
- Create `ingestion_failures` table for durable failure records:
  - `id TEXT PRIMARY KEY`
  - `candidate_id TEXT NOT NULL`
  - `failed_step TEXT NOT NULL`
  - `error_type TEXT NOT NULL` — from `classifyError`: `'TRANSIENT' | 'DEGRADED' | 'PERMANENT'`
  - `error_code TEXT` — provider-specific (e.g., `'VERTEX_429'`, `'CONTENT_FILTER'`, `'WORKERS_3050'`)
  - `retry_count INTEGER NOT NULL DEFAULT 0`
  - `retry_exhausted INTEGER NOT NULL DEFAULT 0`
  - `checkpoint_preserved INTEGER NOT NULL DEFAULT 0`
  - `recovery_endpoint TEXT` — URL for manual retry trigger
  - `error_message_recruiter TEXT NOT NULL` — human-readable, no PII
  - `created_at TEXT NOT NULL DEFAULT (datetime('now'))`
  - `resolved_at TEXT`
- Add Cloudflare Queue binding to `wrangler.jsonc`:
  - Queue name: `ingestion-dlq`
  - Producer binding on the main API worker.
  - Consumer binding on a new `dlq-consumer` Worker (or same Worker if feasible with Cloudflare's model).

**Status:** ⏳ PENDING

### Subtask 2 — DLQ producer: route failures to queue
**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`
- `workers/api/src/lib/ai/dlqProducer.ts` (new)

**Spec:**
- Export `sendToDeadLetterQueue(failure: IngestionFailure, env): Promise<void>`:
  - Inserts row into `ingestion_failures` D1 table.
  - Sends message to `ingestion-dlq` Cloudflare Queue with same payload.
- In `orchestrate.ts`: on step failure after retries exhausted, call `sendToDeadLetterQueue` instead of raw status update to `'failed'`.
- `checkpoint_preserved = 1` if per-step status shows earlier steps completed (candidate can resume from checkpoint).
- `recovery_endpoint` = `/api/v1/candidates/:id/reingest` with idempotency key hint.

**Status:** ⏳ PENDING

### Subtask 3 — DLQ consumer: auto-retry transients, route permanents to admin
**Files:**
- `workers/api/src/cron/dlqConsumer.ts` (new)

**Spec:**
- Consumer receives messages from `ingestion-dlq`.
- `TRANSIENT` + `retry_count < 3`: trigger re-ingestion via internal fetch to `recovery_endpoint`. Increment `retry_count`.
- `TRANSIENT` + `retry_count >= 3`: reclassify as effectively `PERMANENT`, route to admin notification.
- `PERMANENT`: log to admin queue (structured JSON), mark `retry_exhausted = 1`.
- `DEGRADED`: attempt fallback model path, log result.
- Emit aggregate metric log per batch: `{ event: 'dlq_batch', transient_count, permanent_count, degraded_count }` — spikes in specific categories signal quota or model issues.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `reliability-retry-and-error-classification.md` (uses `classifyError`)
- Depends on: `reliability-heartbeats-and-stale-detection.md` (stale runs become the input to DLQ)
- Depends on: `reliability-idempotency-and-partial-materialization.md` (re-ingestion uses idempotency keys)

## Acceptance criteria

- [ ] `ingestion_failures` table records all required diagnostic fields
- [ ] DLQ producer sends structured message to Cloudflare Queue on step failure
- [ ] Consumer auto-retries TRANSIENT failures (up to 3 attempts)
- [ ] PERMANENT failures route to admin log, `retry_exhausted = 1`
- [ ] Aggregate batch metrics emitted per consumer run
- [ ] `npx tsc --noEmit` passes
