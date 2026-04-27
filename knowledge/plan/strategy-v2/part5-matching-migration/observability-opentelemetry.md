# Observability: OpenTelemetry for AI Pipeline

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 258–285)
**Phase:** 0 (listed as ACTIVE in master list)
**Status:** NEEDS-REFINEMENT
**Estimate:** 1.5 weeks

## Source quote

> `@microlabs/otel-cf-workers` provides Workers-compatible OpenTelemetry SDK. OTLP/HTTP export to Grafana Cloud, Axiom, or Honeycomb via Cloudflare Destinations.
> `gen_ai` semantic conventions for LLM calls: capture `gen_ai.request.model`, `gen_ai.request.max_tokens`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reason`. Never log prompt content by default — candidate privacy concern.

## Why

The current observability is console.error tailing with no structured tracing or latency breakdown. Without step-level spans, diagnosing a slow match or a silent scoring anomaly requires log archaeology. OTel spans make "where did the time go" and "which LLM call produced this" answerable in seconds.

## Refinement needed

Destination choice (Grafana Cloud, Axiom, or Honeycomb) is unresolved. Pick before implementing — the OTLP endpoint URL and auth config differ. Axiom has a generous free tier suitable for a solo-founder project. Confirm `@microlabs/otel-cf-workers` compatibility with the current Workers runtime version before committing.

## Subtasks (delegable)

### Subtask 1 — OTel SDK setup and instrumentation middleware
**Files:**
- `workers/api/src/lib/telemetry/otel.ts` (new)
- `workers/api/wrangler.jsonc` (add OTLP_ENDPOINT secret)
- `workers/api/package.json` (add `@microlabs/otel-cf-workers`)

**Spec:**
- Install `@microlabs/otel-cf-workers`.
- Export `initOtel(env): TracerProvider`:
  - OTLP/HTTP exporter to `env.OTLP_ENDPOINT` with `env.OTLP_AUTH_HEADER`.
  - Service name: `pipe-api`, service version from `env.WORKER_VERSION`.
- Export `getTracer(): Tracer` — singleton tracer for use across pipeline.
- Sampling strategy:
  - Dev: 100%.
  - Production success: 5–10% (read from `env.OTEL_SAMPLE_RATE`, default 0.05).
  - Errors: 100% tail-based (always sample spans that contain errors).
  - High-token requests (>2K output tokens): 100%.
- Export `withSpan<T>(name, fn, attributes?): Promise<T>` — thin wrapper for creating a span around an async operation.

**Status:** ⏳ PENDING

### Subtask 2 — Instrument candidate ingestion pipeline with span hierarchy
**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`
- `workers/api/src/lib/candidateDiscovery/embed.ts`
- `workers/api/src/lib/candidateDiscovery/candidateSituationFit.ts`

**Spec:**
- Wrap the top-level ingestion run in a parent span: `ingestion_pipeline` with attribute `candidate_id_hash` (hashed for privacy).
- Per step, create child spans matching the hierarchy in strategy:
  - `ingestion.discover_profile` → child: `llm.call.vertex_ai` (with gen_ai attributes), `profile.persist_d1`
  - `ingestion.embed` → child: `embedding.bge_large`, `vectorize.upsert`
  - `ingestion.match_repos` → children: `sql.graph_query`, `vectorize.semantic_recall`, `gemma.rerank`
  - `ingestion.triangulate` → child: `gemma.situation_fit`
- `gen_ai` attributes on all LLM spans: `gen_ai.request.model`, `gen_ai.request.max_tokens`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.response.finish_reason`.
- Never set `gen_ai.prompt` or `gen_ai.completion` attributes — candidate privacy.
- Errors set span status to ERROR with message (no PII in message).

**Status:** ⏳ PENDING

### Subtask 3 — Instrument matching pipeline spans
**Files:**
- `workers/api/src/lib/match/matchOrchestrator.ts` (depends on per-element-matching-algorithm.md)
- `workers/api/src/lib/match/triangulateMatch.ts`

**Spec:**
- Add `TRACE: matching_pipeline` parent span with `role_context_id_hash`, `candidate_count`, `philosophy` attributes.
- Child spans: `match.shortlist`, `match.evidence_gather` (per-candidate), `match.dimension_aggregate`, `match.dealbreaker_gate`, `match.score_synthesis`.
- `match.evidence_gather` should carry: `requirement_count`, `evidence_items_found`, `above_threshold_count` — no embedding content.
- Duration on `match.shortlist` exposes the ANN query cost directly.

**Status:** ⏳ PENDING

## Dependencies

- Independent of all reliability plans (different concern)
- Subtask 3 depends on: `per-element-matching-algorithm.md` (needs `matchOrchestrator.ts` to exist)

## Acceptance criteria

- [ ] OTel SDK initialized with correct sampling strategy per environment
- [ ] Ingestion pipeline emits full span hierarchy matching strategy diagram
- [ ] All LLM spans carry `gen_ai.*` attributes with no prompt content
- [ ] Error spans set ERROR status with non-PII message
- [ ] Matching pipeline spans added once `matchOrchestrator.ts` exists
- [ ] `npx tsc --noEmit` passes
- [ ] Traces visible in chosen destination (Axiom/Grafana Cloud/Honeycomb)
