# Part 5: Matching Architecture and Infrastructure Migration — Plan Index

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part5-matching-migration.md
**Updated:** 2026-05-16

> 2026-06-19 update: the old `skill-adjacency-table.md` work item was archived
> because hand-curated semantic adjacency conflicts with ADR-043 and the living
> context graph plan. Matching should use source-backed context assertions and
> persisted concept-registry relationships instead.
>
> 2026-06-19 update: the Neo4j-first migration plan set was also archived under
> `../../archive/superseded-neo4j-first-2026-06-19/`. Neo4j is now a
> rebuildable projection, not the semantic source of truth.

---

## Archived Neo4j-First Migration

The old Neo4j-first plan set is historical only. Current matching work should
start from `knowledge/plan/living-context-repo-matching-plan.md`.

| Archive | Status |
|---|---|
| `../../archive/superseded-neo4j-first-2026-06-19/` | **ARCHIVED** — conflicts with D1-authoritative, source-backed, rebuildable-projection architecture |

---

## Other matching work (parallel track)

| File | Status |
|---|---|
| `skill-adjacency-table.md` | **ARCHIVED** — see `../../archive/superseded-semantic-taxonomy-2026-06-19/part5-skill-adjacency-table.md` |
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
Parallel (any time):
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
