# Reliability: Circuit Breakers per AI Provider

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 228–235)
**Phase:** 0 (listed as ACTIVE in master list under "Reliability hardening")
**Status:** NEEDS-REFINEMENT
**Estimate:** 1 week

## Source quote

> Use opossum. Separate breakers for Vertex AI (Gemma), Workers AI (Qwen), Workers AI (BGE). Thresholds:
> - Vertex AI: 5 failures in 60s trips the breaker, 30s recovery timeout, 3 probe requests
> - Workers AI (Qwen): 3 failures in 120s, 15s recovery, 2 probe requests
> - Workers AI (BGE): 5 failures in 60s, 30s recovery, 3 probe requests
> Circuit state in D1 with TTL.

## Why

Without circuit breakers, a failing provider causes cascading pipeline failures and burns retry budget pointlessly. Open circuits route to fallback providers or queue for recovery, preserving throughput during partial outages.

## Refinement needed

**opossum** is a Node.js library. Cloudflare Workers have a limited Node.js compat layer — verify `opossum` actually runs in Workers before committing. If not, implement a lightweight circuit breaker directly using D1 state (failure count + last_failure_at + state enum). The D1-state approach is specified as the storage mechanism regardless, so a custom implementation may be preferable.

## Subtasks (delegable)

### Subtask 1 — Circuit breaker state: D1 migration
**Files:**
- `workers/api/migrations/0048_circuit_breaker_state.sql` (new)

**Spec:**
- Create `circuit_breaker_state` table:
  - `provider TEXT PRIMARY KEY` — `'vertex_ai' | 'workers_ai_qwen' | 'workers_ai_bge' | 'anthropic'`
  - `state TEXT NOT NULL DEFAULT 'closed'` — `'closed' | 'open' | 'half_open'`
  - `failure_count INTEGER NOT NULL DEFAULT 0`
  - `last_failure_at TEXT`
  - `opened_at TEXT`
  - `recovery_probe_count INTEGER NOT NULL DEFAULT 0`
  - `updated_at TEXT NOT NULL DEFAULT (datetime('now'))`
- TTL enforced in application logic (not SQL) — if `opened_at` is older than provider's recovery timeout, transition to `half_open` on next read.

**Status:** ⏳ PENDING

### Subtask 2 — Circuit breaker implementation
**Files:**
- `workers/api/src/lib/ai/circuitBreaker.ts` (new)
- `workers/api/src/lib/ai/circuitBreaker.test.ts` (new)

**Spec:**
- Export `CircuitBreaker` class (or functional equivalent for Workers):
  - `async call<T>(provider, fn, db): Promise<T>` — executes `fn`, records failure/success, enforces breaker state.
  - `async getState(provider, db): CircuitState` — reads D1, applies TTL transition.
- Breaker configs per provider (match strategy thresholds exactly):
  - `vertex_ai`: `failureThreshold=5`, `windowSeconds=60`, `recoveryTimeout=30`, `probeRequests=3`
  - `workers_ai_qwen`: `failureThreshold=3`, `windowSeconds=120`, `recoveryTimeout=15`, `probeRequests=2`
  - `workers_ai_bge`: `failureThreshold=5`, `windowSeconds=60`, `recoveryTimeout=30`, `probeRequests=3`
- `OPEN` state: throw `CircuitOpenError` immediately (do not call `fn`). Caller routes to fallback.
- `HALF_OPEN` state: allow `probeRequests` through; on success → close; on failure → reopen with reset timer.
- Unit tests: closed → open transition, half-open probe success, half-open probe failure, TTL expiry.

**Status:** ⏳ PENDING

### Subtask 3 — Integrate circuit breakers at LLM call sites + fallback routing
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts`
- `workers/api/src/lib/candidateDiscovery/embed.ts`

**Spec:**
- Wrap provider calls inside `CircuitBreaker.call(provider, fn, db)`.
- On `CircuitOpenError` from Qwen: route to Gemma (Vertex AI) with capability degradation flag logged.
- On `CircuitOpenError` from profile-discovery provider (requires Gemma's context window): queue candidate for retry (update `candidate_ingestion.step_status` to `'queued_circuit_open'`), do not error the ingestion run.
- Log circuit state transitions as structured JSON for observability.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `reliability-retry-and-error-classification.md` (retry layer sits beneath circuit breakers)
- Independent of partial materialization and heartbeat plans

## Acceptance criteria

- [ ] D1 migration creates `circuit_breaker_state` table
- [ ] Breaker opens after correct failure count within window per provider spec
- [ ] `OPEN` state throws immediately without calling the wrapped function
- [ ] Half-open probes work: success closes, failure reopens
- [ ] TTL expiry transitions open → half_open on next read
- [ ] Qwen open → fallback to Vertex AI with degradation flag logged
- [ ] `npx tsc --noEmit` passes
