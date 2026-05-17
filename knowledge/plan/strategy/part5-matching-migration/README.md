# Part 5: Matching Migration

## Neo4j migration (current primary workstream)

| Plan | Phase |
|---|---|
| [neo4j-MASTER-PLAN.md](neo4j-MASTER-PLAN.md) | Overview — start here |
| [neo4j-00-executive-summary.md](neo4j-00-executive-summary.md) | Goals, constraints, timeline |
| [neo4j-02-schema-design.md](neo4j-02-schema-design.md) | Labels, properties, DDL |
| [neo4j-03-phase-1-dead-code-removal.md](neo4j-03-phase-1-dead-code-removal.md) | Phase 1 |
| [neo4j-04-phase-2-write-path-migration.md](neo4j-04-phase-2-write-path-migration.md) | Phase 2 |
| [neo4j-05-phase-3-matching-cypher-queries.md](neo4j-05-phase-3-matching-cypher-queries.md) | Phase 3 |
| [neo4j-06-phase-4-matching-ux-overhaul.md](neo4j-06-phase-4-matching-ux-overhaul.md) | Phase 4 |
| [neo4j-07-phase-5-repo-backfill.md](neo4j-07-phase-5-repo-backfill.md) | Phase 5 |
| [neo4j-08-implementation-sequencing.md](neo4j-08-implementation-sequencing.md) | Week-by-week execution |
| [neo4j-01-neo4j-vector-search-deep-dive.md](neo4j-01-neo4j-vector-search-deep-dive.md) | Reference |
| [neo4j-09-concrete-graph-example.md](neo4j-09-concrete-graph-example.md) | Reference |
| [neo4j-11-how-similarity-works.md](neo4j-11-how-similarity-works.md) | Reference |

## Other matching work

| Plan | What |
|---|---|
| [skill-adjacency-table.md](skill-adjacency-table.md) | Skill adjacency + matchRepos rewrite |
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
