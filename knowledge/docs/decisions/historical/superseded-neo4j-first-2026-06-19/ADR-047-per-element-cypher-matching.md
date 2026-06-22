# ADR-047: Per-Element Cypher Matching Algorithm

**Date:** 2026-05-11
**Status:** Proposed
**Deciders:** Solo founder (Pipe)
**Depends on:** ADR-043, ADR-044, ADR-045, ADR-046

---

## Context

Current matching is a three-stage pipeline:
1. `matchReposVectorNative` — ANN query against REPO_INDEX (cosine similarity, returns top 50 repo IDs)
2. `matchRepos` — SQL graph matcher against `candidate_nodes` + `repo_nodes` (returns top 10 by graph overlap)
3. `candidateSituationFit` — LLM rerank comparing candidate profile to 20 repo engineering signal narratives (returns fit_score 0-1)
4. `triangulateMatch` — weighted sum of four signals with philosophy-aware presets

This pipeline is 30-60s, costs $0.02-0.04 per candidate, and produces opaque scores. The LLM rerank exists because the vector+SQL layer cannot reason about structured relationships or explain its output.

With candidate, repo, and role sub-elements in Neo4j (ADRs 044-046), matching becomes a single Cypher query that traverses relationships, computes vector similarity per requirement, aggregates dimension scores, and enforces dealbreakers — all in <100ms.

---

## Decision

Replace the entire matching pipeline with a single Cypher query executed against Neo4j. No LLM rerank. No triangulation. No hydration.

### Matching algorithm (Cypher)

```cypher
// Step 1: Shortlist candidates per requirement
MATCH (role:Role {role_context_id: $role_id})-[:HAS_REQUIREMENT]->(req:Requirement)
MATCH (cand:Candidate)-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL
  AND node.confidence >= 0.6
WITH role, req, cand, node,
     vector.similarity.cosine(req.embedding, node.embedding) AS sim
WHERE sim >= 0.6
WITH role, req, cand, avg(sim) * log(1 + count(node)) AS per_req_score,
     collect({node_id: node.id, sim: sim, type: labels(node)})[0..3] AS top_evidence

// Step 2: Aggregate dimensions
WITH cand,
     collect({
       requirement_id: req.id,
       score: per_req_score,
       evidence: top_evidence,
       weight: req.weight
     }) AS requirement_matches,
     sum(per_req_score * req.weight) / sum(req.weight) AS overall_score

// Step 3: Dealbreaker check
OPTIONAL MATCH (role)-[:HAS_DEALBREAKER {strength: 'strong'}]->(db:Dealbreaker)
OPTIONAL MATCH (cand)-[:HAS]->(dbNode:CandidateNode)
WHERE dbNode.superseded_at IS NULL
WITH cand, requirement_matches, overall_score, db,
     vector.similarity.cosine(db.embedding, dbNode.embedding) AS dbSim
WHERE dbSim IS NULL OR dbSim >= 0.75

// Step 4: Return ranked results with evidence
RETURN cand.candidate_id,
       overall_score,
       requirement_matches
ORDER BY overall_score DESC
LIMIT 50
```

### Aggregation formula

```
per_req_score = avg(similarities) * log(1 + n)
where n = count of above-threshold matches for this requirement

overall_score = sum(per_req_score * req.weight) / sum(req.weight)
```

The `log(1 + n)` bonus rewards depth of evidence without letting volume dominate.

### Philosophy weights

Philosophy is applied at the role level via edge weights, not post-processing:

| Philosophy | Requirement weights | Dealbreaker enforcement |
|---|---|---|
| **validate** | Standard (must=1.0, nice=0.5) | Full |
| **tailored** | Candidate-fit nodes weighted higher | Full |
| **hybrid** | Balanced (all dimensions ~equal) | Full |

Tailored mode is achieved by querying `CandidateNode:Skill` and `CandidateNode:Experience` with higher weight multipliers, not by zeroing role alignment.

---

## Alternatives Considered

### Option A — Keep LLM rerank, use Neo4j for shortlisting only
- **Pros:** Familiar. LLM validates Neo4j results.
- **Cons:** Still 5-15s. Still expensive. LLM is validating what vector math already told us.
- **Verdict:** Rejected. The point of Neo4j is to eliminate the LLM bottleneck.

### Option B — Hybrid: Cypher for shortlist, LLM for top-5 final ranking
- **Pros:** Keeps some LLM "judgment" for edge cases.
- **Cons:** Adds complexity. Two query paths. Evidence attribution is split between Cypher and LLM.
- **Verdict:** Rejected. If Cypher produces good evidence, LLM adds no value. If it doesn't, fix the Cypher.

### Option C — Pure Cypher matching (chosen)
- **Pros:** <100ms. Deterministic. Testable. Explainable. No token costs.
- **Cons:** Requires high-quality embeddings and well-structured sub-elements. Garbage in, garbage out.
- **Verdict:** Accepted. Embedding quality is already a requirement; this makes it the primary signal instead of compensating for it with LLM calls.

---

## Rationale

The current pipeline's `candidateSituationFit` step sends:
- Full candidate profile (500-1000 words)
- 20 repo engineering signal narratives (200-500 words each)
- Cultural signal nodes, experience nodes

To an LLM, asking it to score each repo 0-1. This is essentially asking the LLM to do what cosine similarity already does, but slower and more expensively. The LLM has no access to structured requirement weights or dealbreaker logic; it improvises from prose.

Cypher matching replaces this with:
- Explicit requirement nodes with weights
- Explicit candidate nodes with embeddings
- Exact cosine similarity per pair
- Deterministic aggregation with evidence trails

The recruiter sees: "Matched on React (0.87), TypeScript (0.82), Team Leadership (0.71). Failed dealbreaker: No Production ML Experience (0.43 < 0.75)." Not a black-box score.

---

## Consequences

### Positive
- Matching: 30-60s → <100ms
- Cost: $0.02-0.04/candidate → $0 (compute on VPS)
- Explainability: per-dimension scores with top-3 evidence per requirement
- Deterministic: same inputs → same outputs, unit testable
- Philosophy-aware: weights on edges, not post-processing presets

### Negative / Trade-offs
- Embedding quality becomes critical. Bad embeddings = bad matches, no LLM to compensate.
- Sub-element coverage matters. Candidates with <3 nodes produce sparse matches.
- Cypher query is complex. Requires query review and optimization as data grows.

### Risks
- Neo4j vector index performance at 1M+ nodes: monitor query latency, add indexes as needed.
- Dealbreaker threshold (0.75) may need tuning per domain. Start with 0.6 for requirements, 0.75 for strong dealbreakers.
- `log(1 + n)` bonus may over-reward candidates with many weak matches. Monitor and adjust formula.

---

## Performance Targets

| Metric | Current | Target | Measurement |
|---|---|---|---|
| Matching latency | 30-60s | <100ms | `match_read` event log |
| Per-candidate cost | $0.02-0.04 | $0 | AI usage events |
| Explainability | opaque score | per-dimension + evidence | Match report schema |
| Dealbreaker enforcement | post-processing (unreliable) | query-time (deterministic) | Unit tests |

---

## Follow-up

- **Knowledge plan:** `part5-matching-migration/per-element-matching-algorithm.md` — UPDATE to reference Cypher implementation
- **Knowledge plan:** `part5-matching-migration/neo4j-matching-cutover.md` — shadow-read and primary-read spec
- **Code:** `workers/api/src/lib/neo4j/matchingQueries.ts` — Cypher query implementations
- **Code:** `workers/api/src/lib/match/matchOrchestrator.ts` — orchestrator using `routeMatchRead`
- **Code:** `workers/api/src/lib/match/shadowRead.ts` — parallel D1 + Neo4j execution with divergence logging
