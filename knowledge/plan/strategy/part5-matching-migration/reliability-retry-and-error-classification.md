# Reliability: Retry with Exponential Backoff and Error Classification

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 218–226)
**Phase:** 0 (listed as ACTIVE in master list under "Reliability hardening")
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote

> Wrap every Gemma and BGE call in a retry helper. Provider-specific parameters:
> - Vertex AI Gemma 4 26B: base_delay=2s, max_delay=120s, max_retries=5, jitter=1s. Retries on 429/500/502/503.
> - Workers AI Qwen/Gemma: base_delay=30s fixed (cold-start pattern), max_delay=300s, max_retries=3. Retries on 3050 errors.
> - Workers AI BGE embedding: base_delay=2s, max_retries=5.
> Error classification helper: `classifyError(err) → 'TRANSIENT' | 'DEGRADED' | 'PERMANENT'`.

## Why

Transient provider failures currently fail candidate ingestion pipelines entirely. Exponential backoff with per-provider tuning dramatically reduces false failures from quota bursts and cold starts, while error classification enables intelligent routing: transient errors retry, degraded errors fallback, permanent errors fail fast without burning retries.

## Subtasks (delegable)

### Subtask 1 — `classifyError` helper and retry middleware
**Files:**
- `workers/api/src/lib/ai/retryHelper.ts` (new)
- `workers/api/src/lib/ai/retryHelper.test.ts` (new)

**Spec:**
- Export `classifyError(err: unknown): 'TRANSIENT' | 'DEGRADED' | 'PERMANENT'`:
  - `TRANSIENT`: HTTP 429, 500, 502, 503, Workers AI 3050 error.
  - `DEGRADED`: context-length-exceeded, content-filter — switch to fallback model.
  - `PERMANENT`: HTTP 400, 401, 422 — fail fast, no retry.
- Export `withRetry<T>(fn: () => Promise<T>, config: RetryConfig): Promise<T>`:
  ```typescript
  type RetryConfig = {
    baseDelay: number;      // ms
    maxDelay: number;       // ms
    maxRetries: number;
    jitter?: number;        // ms random addition
    retryOn?: RetryPredicate;
  }
  ```
- Full jitter: actual delay = `min(maxDelay, baseDelay * 2^attempt) + random(0, jitter)`.
- Provider-specific configs exported as constants:
  - `VERTEX_AI_RETRY`: base=2000, max=120000, retries=5, jitter=1000
  - `WORKERS_AI_QWEN_RETRY`: base=30000, max=300000, retries=3
  - `WORKERS_AI_BGE_RETRY`: base=2000, max=60000, retries=5
  - `ANTHROPIC_RETRY`: standard exponential, retries=3
- Unit tests: verify retry count, delay progression, PERMANENT error does not retry.

**Status:** ⏳ PENDING

### Subtask 2 — Wrap all LLM call sites with retry
**Files:**
- `workers/api/src/lib/candidateDiscovery/embed.ts`
- `workers/api/src/lib/roleDiscovery/embedRole.ts`
- `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts`

**Spec:**
- Import `withRetry` and appropriate config constant at each call site.
- Wrap `env.AI.run(...)` BGE calls with `WORKERS_AI_BGE_RETRY`.
- Wrap Vertex AI Gemma calls with `VERTEX_AI_RETRY`.
- Wrap Workers AI Qwen/Gemma calls with `WORKERS_AI_QWEN_RETRY`.
- On `DEGRADED` classification: log structured warning and invoke fallback model (Anthropic) before exhausting retries.
- Do not change function signatures — only wrap the inner call.

**Status:** ⏳ PENDING

## Dependencies

- Blocks: `reliability-circuit-breakers.md` (circuit breakers sit atop the retry layer)
- Independent of all other plan files

## Acceptance criteria

- [ ] `classifyError` correctly maps 429/5xx to TRANSIENT, context-exceeded to DEGRADED, 400/401 to PERMANENT
- [ ] `withRetry` uses full jitter and respects `maxDelay` cap
- [ ] PERMANENT errors do not retry
- [ ] All 3 LLM call sites wrapped with provider-specific config
- [ ] Unit tests cover retry progression and early-exit on permanent
- [ ] `npx tsc --noEmit` passes
