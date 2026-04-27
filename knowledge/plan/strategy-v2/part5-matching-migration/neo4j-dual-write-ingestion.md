# Neo4j: Dual-Write Ingestion (Phase B)

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 413–418)
**Phase:** 2 (Migration Phase B: weeks 3–6)
**Status:** PENDING
**Estimate:** 2 weeks

## Source quote

> Phase B (weeks 3–6): Dual-write from ingestion. Every time D1 + Vectorize gets a write, the same data is also written to Neo4j. Reads stay on D1 + Vectorize. Both paths run in production; Neo4j serves no traffic. Parity dashboards compare the two stores for drift.

## Why

Dual-write is the safe migration path: it populates Neo4j with production data without serving any traffic, enabling parity validation before cutover. If Neo4j writes fail, they must not block the D1 write — Neo4j failure is non-fatal during this phase. Parity drift monitoring is the signal that triggers cutover readiness.

## Subtasks (delegable)

### Subtask 1 — Neo4j write layer for candidates
**Files:**
- `workers/api/src/lib/neo4j/writeCandidateGraph.ts` (new)
- `workers/api/src/lib/neo4j/writeCandidateGraph.test.ts` (new — unit tests with mocked driver)

**Spec:**
- Export `upsertCandidateNode(candidate: CandidateEntity, env): Promise<void>`:
  - `MERGE (c:Candidate {candidate_id: $candidate_id}) SET c += $props`
  - Props: `profile_state`, `last_engaged_at`, `updated_at`.
- Export `upsertCandidateSubElement(element: CandidateSubElement, env): Promise<void>`:
  - `MERGE (n:CandidateNode {id: $id}) SET n += $props, n.embedding = $embedding`
  - `MERGE (c:Candidate {candidate_id: $candidate_id})-[:HAS]->(n)`
  - If `superseded_at` is set, add `MERGE (n)-[:SUPERSEDES]->(prev)` edge to the superseded node.
- Unit tests: verify MERGE semantics (upsert, not duplicate), relationship creation, supersedes chain.

**Status:** ⏳ PENDING

### Subtask 2 — Neo4j write layer for roles and repos
**Files:**
- `workers/api/src/lib/neo4j/writeRoleGraph.ts` (new)
- `workers/api/src/lib/neo4j/writeRepoGraph.ts` (new)

**Spec:**
- `upsertRoleNode(role, env)`: MERGE `:Role`, then MERGE each sub-element node with `[:HAS]` relationship. For requirements: `[:HAS_REQUIREMENT {weight}]`. For dealbreakers: `[:HAS_DEALBREAKER {strength}]`. For conflicts: `[:HAS_CONFLICT]->(conflict:Conflict)-[:BETWEEN]->(affected_node)`.
- `upsertRepoNode(repo, env)`: MERGE `:Repo`, then MERGE `:RepoNode :Feature` and `:RepoNode :ChallengeSurface` sub-elements.
- All writes use MERGE (idempotent) — running twice with same data is safe.
- Unit tests for relationship edge properties (weight on HAS_REQUIREMENT, strength on HAS_DEALBREAKER).

**Status:** ⏳ PENDING

### Subtask 3 — Wire dual-write into ingestion pipeline (fire-and-forget)
**Files:**
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`
- `workers/api/src/lib/roleDiscovery/embedRole.ts` (or wherever role data is persisted)
- `workers/api/src/routes/cockpit/adminRepos.ts`

**Spec:**
- After each successful D1 write in the ingestion pipeline, add a non-blocking Neo4j write:
  ```typescript
  // Fire-and-forget — do NOT await, do NOT let failure block D1 path
  upsertCandidateNode(candidate, env).catch(err =>
    console.error('[dual-write] neo4j candidate write failed:', { candidate_id_hash, err })
  );
  ```
- Same pattern for role sub-elements after RCD is persisted, and repo sub-elements after Pass 3 approval.
- Log all Neo4j write failures as structured JSON for parity dashboard.
- Feature flag `DUAL_WRITE_NEO4J` (env var, default `false`): gates all Neo4j writes. Enables gradual rollout.

**Status:** ⏳ PENDING

### Subtask 4 — Parity dashboard: D1 vs Neo4j count comparison
**Files:**
- `workers/api/src/routes/cockpit/neo4jParity.ts` (new)

**Spec:**
- `GET /api/v1/internal/neo4j-parity` (admin-only route, Clerk JWT with admin role check):
  - Compares row counts between D1 and Neo4j for candidates, roles, repos, and sub-elements.
  - Returns `{ d1_candidates, neo4j_candidates, drift_percent, d1_role_nodes, neo4j_role_nodes, ... }`.
  - "Drift" = `abs(d1 - neo4j) / d1 * 100` per entity type.
- Acceptable drift during Phase B: <5% (write failures are expected occasionally).
- When drift exceeds 5% per entity type: log alert-level structured JSON.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `neo4j-schema-and-constraints.md`
- Depends on: `neo4j-driver-and-binding.md`
- Blocks: `neo4j-matching-cutover.md` (cutover only after parity validated)
- Blocks: `neo4j-validation-parity.md`

## Acceptance criteria

- [ ] All candidate, role, repo nodes written to Neo4j alongside D1 writes
- [ ] Neo4j write failures do not block or surface to D1 write path
- [ ] `DUAL_WRITE_NEO4J` feature flag gates all Neo4j writes
- [ ] Parity dashboard shows entity counts from both stores with drift %
- [ ] MERGE semantics verified: duplicate writes do not create duplicate nodes
- [ ] `npx tsc --noEmit` passes
