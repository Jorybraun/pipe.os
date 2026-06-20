# Pipe Strategy v2 — Part 5: Matching Architecture and Infrastructure Migration
*Per-element matching, evidence-structured reports, the Neo4j migration, and the master sequencing.*

**Status:** v2.0 — Updated 2026-05-15  
**Canonical implementation plans:** `knowledge/plan/strategy-v2/part5-matching-migration/neo4j-migration/`

---

## The reframe

PIPE is not a pipeline of batch jobs that pre-compute scores. PIPE is a **living semantic graph** where every interaction produces nodes and edges. Matching is a real-time graph query.

For the full ecosystem vision, see [`neo4j-migration/10-unified-ecosystem-vision.md`](strategy-v2/part5-matching-migration/neo4j-migration/10-unified-ecosystem-vision.md).

---

## Neo4j Migration (primary workstream)

The migration is specified in 13 documents under [`neo4j-migration/`](strategy-v2/part5-matching-migration/neo4j-migration/):

| Document | Phase | Status |
|---|---|---|
| [`00-executive-summary.md`](strategy-v2/part5-matching-migration/neo4j-migration/00-executive-summary.md) | Overview | 📝 Plan |
| [`01-neo4j-vector-search-deep-dive.md`](strategy-v2/part5-matching-migration/neo4j-migration/01-neo4j-vector-search-deep-dive.md) | Reference | 📝 Plan |
| [`02-schema-design.md`](strategy-v2/part5-matching-migration/neo4j-migration/02-schema-design.md) | Phase 2 | 📝 Plan |
| [`03-phase-1-dead-code-removal.md`](strategy-v2/part5-matching-migration/neo4j-migration/03-phase-1-dead-code-removal.md) | Phase 1 | 📝 Plan |
| [`04-phase-2-write-path-migration.md`](strategy-v2/part5-matching-migration/neo4j-migration/04-phase-2-write-path-migration.md) | Phase 2 | 📝 Plan |
| [`05-phase-3-matching-cypher-queries.md`](strategy-v2/part5-matching-migration/neo4j-migration/05-phase-3-matching-cypher-queries.md) | Phase 3 | 📝 Plan |
| [`06-phase-4-matching-ux-overhaul.md`](strategy-v2/part5-matching-migration/neo4j-migration/06-phase-4-matching-ux-overhaul.md) | Phase 4 | 📝 Plan |
| [`07-phase-5-repo-backfill.md`](strategy-v2/part5-matching-migration/neo4j-migration/07-phase-5-repo-backfill.md) | Phase 5 | 📝 Plan |
| [`08-implementation-sequencing.md`](strategy-v2/part5-matching-migration/neo4j-migration/08-implementation-sequencing.md) | Sequencing | 📝 Plan |
| [`09-concrete-graph-example.md`](strategy-v2/part5-matching-migration/neo4j-migration/09-concrete-graph-example.md) | Reference | 📝 Plan |
| [`10-unified-ecosystem-vision.md`](strategy-v2/part5-matching-migration/neo4j-migration/10-unified-ecosystem-vision.md) | Reference | 📝 Plan |
| [`11-how-similarity-works.md`](strategy-v2/part5-matching-migration/neo4j-migration/11-how-similarity-works.md) | Phase 3 | 📝 Plan |
| [`MASTER-PLAN.md`](strategy-v2/part5-matching-migration/neo4j-migration/MASTER-PLAN.md) | Cohesive summary | 📝 Plan |

**Phase summary:**
- **Phase 1:** Dead code removal — `shadowRead.ts`, `neo4jParity.ts`, env var cleanup
- **Phase 2:** Write path — `writeCandidateGraph`, `writeRoleGraph`, `writeRepoGraph` as primary
- **Phase 3:** Matching Cypher — `matchCandidatesForRole`, `scoreCandidateAgainstRole`, `checkDealbreakersForCandidate`
- **Phase 4:** Frontend UX — `RequirementMatchCard`, `EvidenceNodeBadge`, `DealbreakerAlert`
- **Phase 5:** Repo backfill — ingest all 2,251 repos into Neo4j
- **Phase 6:** Cultural matching — decide model (A/B/C), implement in Cypher and frontend

For week-by-week execution, see [`08-implementation-sequencing.md`](strategy-v2/part5-matching-migration/neo4j-migration/08-implementation-sequencing.md).

---

## Non-Neo4j matching work (parallel track)

These plans are independent of the Neo4j migration and can proceed in parallel:

| Document | Status |
|---|---|
| [`dealbreaker-gate-enforcement.md`](strategy-v2/part5-matching-migration/dealbreaker-gate-enforcement.md) | 📝 Plan |
| [`skill-adjacency-table.md`](strategy-v2/part5-matching-migration/skill-adjacency-table.md) | 📝 Plan |
| [`per-element-matching-algorithm.md`](strategy-v2/part5-matching-migration/per-element-matching-algorithm.md) | 📝 Plan (D1/Vectorize version; superseded by Neo4j Cypher for graph path) |
| [`match-reports-schema.md`](strategy-v2/part5-matching-migration/match-reports-schema.md) | 📝 Plan |
| [`triangulation-summary-layer.md`](strategy-v2/part5-matching-migration/triangulation-summary-layer.md) | 📝 Plan (retired for Neo4j path; still relevant for D1 fallback) |

---

## Reliability and observability (cross-cutting)

| Document | Status |
|---|---|
| [`reliability-retry-and-error-classification.md`](strategy-v2/part5-matching-migration/reliability-retry-and-error-classification.md) | 📝 Plan |
| [`reliability-circuit-breakers.md`](strategy-v2/part5-matching-migration/reliability-circuit-breakers.md) | 📝 Plan |
| [`reliability-idempotency-and-partial-materialization.md`](strategy-v2/part5-matching-migration/reliability-idempotency-and-partial-materialization.md) | 📝 Plan |
| [`reliability-heartbeats-and-stale-detection.md`](strategy-v2/part5-matching-migration/reliability-heartbeats-and-stale-detection.md) | 📝 Plan |
| [`reliability-dead-letter-queue.md`](strategy-v2/part5-matching-migration/reliability-dead-letter-queue.md) | 📝 Plan |
| [`observability-opentelemetry.md`](strategy-v2/part5-matching-migration/observability-opentelemetry.md) | 📝 Plan |
| [`observability-recruiter-status.md`](strategy-v2/part5-matching-migration/observability-recruiter-status.md) | 📝 Plan |

---

## Data partition principle

| Store | Owns | Does NOT Own |
|-------|------|-------------|
| **Neo4j** | Graph-shaped data: entities, sub-elements, embeddings, relationships, challenge-to-role mappings | Pipelines, stages, assessments, audit logs, user accounts |
| **D1** | Pipelines, stages, challenge submissions, review transcripts, audit logs, user accounts, recruiter decisions | Sub-element embeddings (for Neo4j path), graph relationships |
| **Vectorize** | Read-only archive (legacy) | Nothing — no new writes |

For the full data partition, see [`MASTER-PLAN.md` §7](strategy-v2/part5-matching-migration/neo4j-migration/MASTER-PLAN.md).

---

## What changes the plan

- **First paying customer** → reliability/observability jump in priority
- **First 10 hires with outcome data** → unlocks validation and calibration
- **Cost anomaly** → observability to the front
- **Regulatory inquiry** → fairness and compliance immediate
- **Recruiter feedback ~50/month** → justifies learning-to-rank
- **Neo4j latency >200ms p99** → add HNSW index or optimize Cypher
- **Major Gemma regression** → golden set re-scoring, emergency fallback

---

## Architectural commitments

1. **Three-entity decomposition** (candidates, roles, repos) with per-sub-element embeddings and evidence attribution
2. **Candidate as living graph** — multi-source accumulation with provenance, temporal layering, supersedes
3. **Per-element matching with evidence-structured reports** as primary output; scores as derived summaries
4. **Neo4j as graph substrate** for decomposed entities; Cloudflare Workers as application layer
5. **Compliance and fairness as constraints**, not deferred — finite probe banks, HITL gates, audit trails
