# Telemetry and Observability

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §6  
**Blocked by:** None  
**Blocks:** None  

---

## 1. Problem Statement

Current observability for the culture interview is console.error/console.warn tailed via Cloudflare Workers Logs. There is no structured tracing, no step-level latency tracking, and no alerting when the generative planner falls back to static questions. This document specifies what telemetry to add for the redesigned culture agent.

## 2. Current State

**Existing telemetry:**
- `culture_ai_usage_events` — per-LLM-call cost metering
- `culture_compliance_audit` — 13 event types for legal audit
- `console.error` / `console.warn` — unstructured, tailed via Workers Logs

**Missing:**
- Step-level latency (how long does each phase take?)
- Structured tracing across the pipeline
- Alerting on generative planner fallback rate
- Alerting on decomposition validation failure rate
- Coverage metrics per candidate

## 3. Target State

### 3.1 Structured tracing

Add OpenTelemetry spans for the culture interview:

```
TRACE: culture_interview (session_id_hash)
├── SPAN: culture.consent
│   └── SPAN: db.session_create
├── SPAN: culture.rapport_building
│   ├── SPAN: heuristic.evaluate
│   └── SPAN: db.transcript_update
├── SPAN: culture.probing
│   ├── SPAN: heuristic.evaluate
│   ├── SPAN: coverage.compute
│   ├── SPAN: probe.select
│   │   └── SPAN: db.profile_probe_bank_query
│   └── SPAN: db.transcript_update
├── SPAN: culture.drilling
│   ├── SPAN: heuristic.evaluate
│   └── SPAN: db.transcript_update
├── SPAN: culture.wrap_up
│   └── SPAN: db.transcript_update
├── SPAN: culture.termination
│   ├── SPAN: decomposition.batch
│   │   ├── SPAN: llm.decompose
│   │   ├── SPAN: validation.run
│   │   └── SPAN: db.candidate_nodes_insert
│   └── SPAN: scoring.pipeline
│       ├── SPAN: llm.score_competency (×5, parallel)
│       ├── SPAN: llm.score_profile (×5, parallel)
│       ├── SPAN: llm.synthesize
│       └── SPAN: db.score_report_write
└── SPAN: culture.enrichment
    ├── SPAN: embedding.bge (×N)
    ├── SPAN: vectorize.upsert
    └── SPAN: matching.trigger
```

**Implementation:** Use `@microlabs/otel-cf-workers` with OTLP/HTTP export to Grafana Cloud or Axiom.

### 3.2 Metrics

| Metric | Type | Labels | Alert Threshold |
|---|---|---|---|
| `culture_interviews_started` | counter | mode | — |
| `culture_interviews_completed` | counter | mode | — |
| `culture_interviews_abandoned` | counter | mode, phase | >10% abandonment |
| `culture_turn_latency_ms` | histogram | phase | p99 > 5s |
| `culture_generative_planner_fallback_rate` | gauge | — | >20% fallback |
| `culture_decomposition_validation_failure_rate` | gauge | — | >10% failure |
| `culture_scoring_cost_usd` | gauge | mode | >$3 per interview |
| `culture_coverage_completeness` | histogram | dimension | — |

### 3.3 Dashboard

Recruiter-facing dashboard shows:
- Interview completion rate by mode
- Average turns per interview by mode
- Coverage completeness per candidate
- Generative planner fallback rate
- Scoring cost per interview
- Decomposition node count per interview

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/cultureAgent.ts` | **Modify.** Add span creation around each phase. |
| `workers/api/src/lib/cultureGenerativePlanner.ts` | **Modify.** Emit metric on fallback. |
| `workers/api/src/lib/cultureAgentDecomposition.ts` | **Modify.** Emit metric on validation failure. |
| `workers/api/src/lib/cultureScorer.ts` | **Modify.** Add spans around scoring calls. Emit cost metric. |
| `workers/api/src/routes/screening/culture.ts` | **Modify.** Add root span. Emit session-level metrics. |

### 4.2 OpenTelemetry setup

```typescript
// In worker entrypoint
import { initOpenTelemetry } from './telemetry/otel';

const otel = initOpenTelemetry({
  serviceName: 'pipe-culture-agent',
  exporterEndpoint: env.OTEL_EXPORTER_ENDPOINT,
  samplingRate: env.ENV === 'production' ? 0.1 : 1.0,
});
```

## 5. Open Questions

1. **Which observability backend?** Grafana Cloud, Axiom, Honeycomb, or Cloudflare Workers Logs? — **Recommendation:** Start with Workers Logs + structured JSON. Upgrade to OpenTelemetry when budget allows.

2. **Should we trace prompt content?** Prompts contain candidate answers — PII concern. — **Recommendation:** Never log prompt content by default. Trace metadata only (token counts, finish reason, latency).

## 6. Validation Criteria

- **Unit test:** Metrics are emitted for every interview phase.
- **E2E test:** Dashboard shows real data from test interviews.
- **Manual validation:** Alert fires when generative planner fallback rate > 20%.

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| OpenTelemetry adds latency to every request | Low | Medium | Async export; sampling in production |
| Metrics cardinality explodes | Low | High | Limit label values (e.g., bucket phase into 6 values) |
| Observability cost exceeds inference cost | Medium | Medium | Start with Workers Logs (free). Upgrade selectively. |
