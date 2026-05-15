# Neo4j: Matching Cutover — Shadow Read and Primary Read

**Source:** knowledge/plan/pipe-strategy-v2-part5-matching-migration.md (lines 361–421)
**Phase:** 2 (Migration Phases C and D: weeks 7–12)
**Status:** PENDING
**Estimate:** 3 weeks

## Source quote

> Phase C (weeks 7–10): Shadow-read. Matching queries run against both stores; D1 + Vectorize results are served to users while Neo4j results are computed in parallel and compared.
> Phase D (weeks 11–12): Primary-read cutover. Matching queries now served from Neo4j. D1 + Vectorize stay populated as fallback for ~1 month.

## Why

Shadow reads validate Neo4j result correctness under real production load before any user impact. Cutover is gated on shadow-read agreement, not on a calendar date. The fallback feature flag means a single config change reverts to D1 if Neo4j degrades.

## Subtasks (delegable)

### Subtask 1 — Neo4j Cypher matching queries
**Files:**
- `workers/api/src/lib/neo4j/matchingQueries.ts` (new)
- `workers/api/src/lib/neo4j/matchingQueries.test.ts` (new — unit tests with mocked driver)

**Spec:**
- Export `matchCandidatesForRole(roleContextId: string, philosophy: MatchPhilosophy, env): Promise<Neo4jMatchResult[]>` using the full Cypher from strategy:
  ```cypher
  MATCH (role:Role {role_context_id: $role_id})-[:HAS]->(req:Requirement)
  MATCH (cand:Candidate)-[:HAS]->(node:CandidateNode)
  WHERE node.superseded_at IS NULL
    AND node.confidence >= 0.6
  WITH role, req, cand, node,
       vector.similarity.cosine(req.embedding, node.embedding) AS sim
  WHERE sim >= 0.6
  WITH role, req, cand, avg(sim) * log(1 + count(node)) AS per_req_score,
       collect({node_id: node.id, sim: sim, type: labels(node)})[0..3] AS top_evidence
  WITH cand,
       collect({...}) AS requirement_matches,
       sum(per_req_score * req.weight) / sum(req.weight) AS overall_score
  RETURN cand.candidate_id, overall_score, requirement_matches
  ORDER BY overall_score DESC LIMIT 50
  ```
- Export `checkDealbreakersFails(roleContextId, candidateId, env): Promise<DealbreakerFailure[]>` using the dealbreaker absence query from strategy.
- All embeddings passed as parameters (not embedded in query string).
- Unit tests with mocked driver: verify result mapping, parameter passing, empty result handling.

**Status:** ⏳ PENDING

### Subtask 2 — Shadow read: parallel execution and divergence logging
**Files:**
- `workers/api/src/lib/match/shadowRead.ts` (new)

**Spec:**
- Export `shadowMatchRead(roleContextId, philosophy, env): Promise<MatchResult>`:
  - Run D1 + Vectorize matching (existing path) and Neo4j matching in parallel via `Promise.allSettled`.
  - Serve D1 result to caller.
  - Compare results: compute `top10Overlap` (intersection of top-10 candidate IDs), `scoreDeviation` (avg absolute score difference for matching candidates).
  - Log divergence as structured JSON: `{ event: 'shadow_read_divergence', role_id_hash, d1_top10, neo4j_top10, score_deviation }`.
  - If Neo4j errors: log error, silently continue serving D1 result — never surface Neo4j failure to user.
- Feature flag `SHADOW_READ_NEO4J` (env var, default `false`).

**Status:** ⏳ PENDING

### Subtask 3 — Primary read cutover with fallback flag
**Files:**
- `workers/api/src/lib/match/matchRouter.ts` (new)
- `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

**Spec:**
- Export `routeMatchRead(roleContextId, philosophy, env): Promise<MatchResult>`:
  - `PRIMARY_MATCH_STORE` env var: `'d1'` (default) | `'neo4j'`.
  - `'neo4j'`: run Neo4j matching, fall back to D1 on any Neo4j error (log fallback event).
  - `'d1'`: run D1 + Vectorize matching (existing path).
  - During shadow period: `'d1'` with shadow writes active.
- Replace direct matching calls in `orchestrate.ts` with `routeMatchRead`.
- Fallback activation: one env var change reverts to D1 — no code deploy needed.
- Log `{ event: 'match_read', store: 'neo4j' | 'd1', latency_ms, candidate_count }` on each invocation.

**Status:** ⏳ PENDING

## Dependencies

- Depends on: `neo4j-migration/MASTER-PLAN.md` Phase 2 (Neo4j must be populated before shadow reads)
- Depends on: `neo4j-validation-parity.md` (shadow divergence analysis is part of parity validation)
- Depends on: `per-element-matching-algorithm.md` (Cypher queries replace the per-element algorithm for the Neo4j path)

## Acceptance criteria

- [ ] Neo4j Cypher matching queries produce ranked results from real graph data
- [ ] Shadow read runs both stores in parallel, serves D1 result, logs divergence
- [ ] Shadow divergence logged as structured JSON with overlap and score deviation
- [ ] `PRIMARY_MATCH_STORE=neo4j` routes all reads to Neo4j with D1 fallback
- [ ] Single env var change reverts to D1 (no deploy needed)
- [ ] `npx tsc --noEmit` passes
