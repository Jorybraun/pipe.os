# Part 5: Matching Architecture and Infrastructure Migration — Plan Index

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md  
**Updated:** 2026-05-16

---

## Neo4j migration (current primary workstream)

See [`neo4j-MASTER-PLAN.md`](neo4j-MASTER-PLAN.md) for the cohesive summary.

| File | Phase | Status |
|---|---|---|
| [`neo4j-03-phase-1-dead-code-removal.md`](neo4j-03-phase-1-dead-code-removal.md) | Phase 1 | PENDING |
| [`neo4j-02-schema-design.md`](neo4j-02-schema-design.md) | Phase 2 | PENDING |
| [`neo4j-04-phase-2-write-path-migration.md`](neo4j-04-phase-2-write-path-migration.md) | Phase 2 | PENDING |
| [`neo4j-05-phase-3-matching-cypher-queries.md`](neo4j-05-phase-3-matching-cypher-queries.md) | Phase 3 | PENDING |
| [`neo4j-06-phase-4-matching-ux-overhaul.md`](neo4j-06-phase-4-matching-ux-overhaul.md) | Phase 4 | PENDING |
| [`neo4j-07-phase-5-repo-backfill.md`](neo4j-07-phase-5-repo-backfill.md) | Phase 5 | PENDING |
| [`neo4j-08-implementation-sequencing.md`](neo4j-08-implementation-sequencing.md) | Sequencing | PENDING |
| [`neo4j-00-executive-summary.md`](neo4j-00-executive-summary.md) | Reference | PENDING |
| [`neo4j-01-neo4j-vector-search-deep-dive.md`](neo4j-01-neo4j-vector-search-deep-dive.md) | Reference | PENDING |
| [`neo4j-09-concrete-graph-example.md`](neo4j-09-concrete-graph-example.md) | Reference | PENDING |
| [`neo4j-11-how-similarity-works.md`](neo4j-11-how-similarity-works.md) | Reference | PENDING |

**Open decision:** Cultural matching model (Option A/B/C) — gates Phase 3 Cypher finalization. See [`neo4j-MASTER-PLAN.md` §5](neo4j-MASTER-PLAN.md).

---

## Other matching work (parallel track)

| File | Status |
|---|---|
| [`skill-adjacency-table.md`](skill-adjacency-table.md) | PENDING |
| [`match-reports-schema.md`](match-reports-schema.md) | PENDING |

---

## Reliability and observability (cross-cutting)

| File | Status |
|---|---|
| [`reliability-retry-and-error-classification.md`](reliability-retry-and-error-classification.md) | PENDING |
| [`reliability-circuit-breakers.md`](reliability-circuit-breakers.md) | NEEDS-REFINEMENT |
| [`reliability-idempotency-and-partial-materialization.md`](reliability-idempotency-and-partial-materialization.md) | PENDING |
| [`reliability-heartbeats-and-stale-detection.md`](reliability-heartbeats-and-stale-detection.md) | PENDING |
| [`reliability-dead-letter-queue.md`](reliability-dead-letter-queue.md) | PENDING |
| [`observability-opentelemetry.md`](observability-opentelemetry.md) | NEEDS-REFINEMENT |
| [`observability-recruiter-status.md`](observability-recruiter-status.md) | PENDING |

---

## Dependency graph

```
Phase 2 (Neo4j-first):
  phase1-dead-code-removal → phase2-schema-design → phase2-write-path
    → phase3-matching-cypher → phase4-ux-overhaul
    → phase5-repo-backfill
  
  phase3-matching-cypher → phase6-cultural-matching (gated on model decision)
  
  culture-agent-redesign (Part 4) → phase6-cultural-matching

Parallel (any time):
  skill-adjacency-table
  match-reports-schema
  reliability-retry → reliability-circuit-breakers → reliability-dead-letter-queue
  reliability-idempotency → reliability-heartbeats → reliability-dead-letter-queue
  observability-opentelemetry
  observability-recruiter-status
```

---

## Ambiguous items flagged

1. **`reliability-circuit-breakers.md`** — `NEEDS-REFINEMENT`: `opossum` library compatibility with Cloudflare Workers unverified. Must spike before committing. Fallback: custom D1-state circuit breaker (fully specified as fallback in the plan).

2. **`observability-opentelemetry.md`** — `NEEDS-REFINEMENT`: OTLP destination (Grafana Cloud / Axiom / Honeycomb) not chosen. Pick before implementing; auth config differs. Also verify `@microlabs/otel-cf-workers` Workers runtime compatibility.
