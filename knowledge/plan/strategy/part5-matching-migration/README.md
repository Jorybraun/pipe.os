# Part 5: Matching Migration

> 2026-06-19 update: `skill-adjacency-table.md` was archived under
> `../../archive/superseded-semantic-taxonomy-2026-06-19/` because static
> semantic adjacency conflicts with ADR-043 and the living-context graph plan.
> The Neo4j-first plan set was archived under
> `../../archive/superseded-neo4j-first-2026-06-19/`; Neo4j is now a
> rebuildable projection, not the semantic source of truth.

## Archived Neo4j-First Migration

| Plan | Phase |
|---|---|
| `../../archive/superseded-neo4j-first-2026-06-19/` | Historical only — use `../../living-context-repo-matching-plan.md` for current architecture |

## Other matching work

| Plan | What |
|---|---|
| skill-adjacency-table.md | **ARCHIVED** — static semantic adjacency is superseded by source-backed concept-registry relationships |
| [match-reports-schema.md](match-reports-schema.md) | Match report storage schema |

## Reliability & observability

| Plan | What |
|---|---|
| [reliability-retry-and-error-classification.md](reliability-retry-and-error-classification.md) | Retry with backoff |
| [reliability-circuit-breakers.md](reliability-circuit-breakers.md) | Circuit breakers per provider |
| [reliability-idempotency-and-partial-materialization.md](reliability-idempotency-and-partial-materialization.md) | Idempotency keys |
| [reliability-heartbeats-and-stale-detection.md](reliability-heartbeats-and-stale-detection.md) | Heartbeats |
| [reliability-dead-letter-queue.md](reliability-dead-letter-queue.md) | DLQ for permanent failures |
| [observability-opentelemetry.md](observability-opentelemetry.md) | OpenTelemetry for AI |
| [observability-recruiter-status.md](observability-recruiter-status.md) | Structured recruiter-facing status |
