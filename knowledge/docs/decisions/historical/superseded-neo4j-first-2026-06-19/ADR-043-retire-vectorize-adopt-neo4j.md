# ADR-043: Retire Vectorize/D1 for Matching — Adopt Neo4j Graph+Vector

**Date:** 2026-05-11
**Status:** Proposed
**Deciders:** Solo founder (Pipe)
**Supersedes:** ADR-040-meaning-based-triangulation.md (partial — triangulation logic moves to Cypher)

---

## Context

The PIPE matching pipeline currently uses Cloudflare Vectorize (ANN cosine similarity) + D1 (hydration) + LLM rerank (`candidateSituationFit`). This architecture has three documented failures:

1. **Vectorize cannot express relationships.** It stores a vector + 10 metadata key-value pairs. It cannot model "Candidate HAS Skill node MATCHES Requirement node ON role" or enforce dealbreaker logic.

2. **D1 cannot do vector math.** SQLite has no `cosine_similarity()` or vector type. Structured matching requires two round-trips (Vectorize for IDs, D1 for data) per query.

3. **The LLM rerank is compensatory, not additive.** `candidateSituationFit` sends 500-1000 words of candidate prose + 20 repo narratives to an LLM, asking it to score 0-1. This takes 5-15s and costs $0.02-0.04 per candidate. It exists because the vector+SQL pipeline cannot produce explainable, structured match scores.

The result: a 30-60s matching pipeline with opaque scores, two parallel matching systems that disagree (pipeline build-time vs candidate runtime), and a `WAITING_FOR_MATCH` loading screen that blocks candidates indefinitely when AI bindings fail in local dev.

See `/docs/ops/repo-matching-flow.md` for the full technical autopsy.

---

## Decision

We will retire Vectorize and D1 from the **matching path**. Neo4j Community Edition becomes the primary store for graph-structured matching data. Vectorize may remain as a read-only archive during transition (Phase B dual-write), then is fully retired.

The matching query becomes a single Cypher execution using Neo4j's native vector index (5.11+) within graph traversal:

```cypher
MATCH (role:Role {role_context_id: $role_id})-[:HAS_REQUIREMENT]->(req:Requirement)
MATCH (cand:Candidate {candidate_id: $candidate_id})-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL AND node.confidence >= 0.6
WITH role, req, cand, node,
     vector.similarity.cosine(req.embedding, node.embedding) AS sim
WHERE sim >= 0.6
WITH role, req, cand, avg(sim) * log(1 + count(node)) AS per_req_score,
     collect({node_id: node.id, sim: sim, type: labels(node)})[0..3] AS top_evidence
RETURN cand.candidate_id, per_req_score, top_evidence
ORDER BY per_req_score DESC
```

This eliminates: LLM rerank, hydration round-trips, triangulation post-processing, and the 30-60s pipeline.

---

## Alternatives Considered

### Option A — Enhance Vectorize + D1 (status quo)
- **Pros:** Zero infrastructure change, stays in Cloudflare ecosystem.
- **Cons:** Vectorize has no relationship model. D1 has no vector math. The two-system dance is fundamentally incapable of per-element matching. We would add more layers (more SQL, more LLM prompts) to compensate.
- **Verdict:** Rejected. The architecture is already over-complex. Adding more duct tape makes it worse.

### Option B — PostgreSQL with pgvector
- **Pros:** Familiar SQL, vector similarity in the same database, managed options (Supabase, Neon).
- **Cons:** No native graph traversal. Recursive CTEs for relationship queries are verbose and slow. No built-in dealbreaker logic or evidence collection patterns.
- **Verdict:** Rejected. We need graph relationships, not just vector similarity in SQL.

### Option C — Neo4j Community self-hosted (chosen)
- **Pros:** Native graph + vector in one query engine. Cypher expresses exactly what we need. Community Edition is free. Docker-local for dev, Hetzner VPS (~$15/mo) for production.
- **Cons:** Self-hosted means we manage backups, upgrades, monitoring. Not serverless — requires a running VM.
- **Verdict:** Accepted. The query expressiveness is worth the ops overhead at our scale.

### Option D — Neo4j AuraDB (managed)
- **Pros:** No ops, automatic backups, scaling.
- **Cons:** $65/GB/mo (Professional, min 1GB) or $146/GB/mo (Business Critical, min 2GB). A 2GB Professional cluster = $130/mo. AuraDB Free caps at 200K nodes — our candidate × repo × skill graph will exceed this immediately. Aura Agent (no-code agent builder) is +$0.35/agent/hour (~$250/mo per agent) — irrelevant to our custom agent architecture. GraphQL API is included in Professional but our matching queries are Cypher-heavy with vector similarity and aggregations that GraphQL cannot express efficiently.
- **Verdict:** Rejected pre-revenue. The rule is: if the data is worth $130/mo, the revenue will pay for it. Until then, self-hosted Community on a $15 VPS. Migration path is zero-downtime (`neo4j-admin dump` → AuraDB import).

---

## Rationale

The core insight from `/docs/ops/repo-matching-flow.md`: the current pipeline is "mostly analyzing itself." The loading screen polls a status column. The vector query is <100ms; the pipeline around it is 30-60s of unnecessary AI calls.

Neo4j lets us:
- Store sub-element nodes with typed relationships
- Compute vector similarity AS A FILTER within structured queries
- Collect evidence per requirement (top-3 matching nodes with similarity scores)
- Enforce dealbreakers in the query itself
- Execute in <100ms with no LLM calls

The cost: ~$15/mo for a Hetzner VPS (or $0 for Docker dev). This pays for itself if it eliminates even 50% of LLM rerank calls.

---

## Consequences

### Positive
- Matching drops from 30-60s to <500ms
- Eliminates $0.02-0.04/candidate LLM rerank cost
- Explainable per-dimension scores with evidence attribution
- Dealbreaker logic in Cypher, not post-processing
- Single query instead of 4 AI calls + hydration + blending

### Negative / Trade-offs
- Self-hosted Neo4j requires backup, monitoring, upgrade discipline
- New dependency outside Cloudflare ecosystem
- Migration period requires dual-write (D1 + Neo4j) for parity validation
- Team must learn Cypher (though similar to SQL with pattern matching)

### Risks
- Neo4j driver compatibility with Cloudflare Workers must be verified (see `neo4j-driver-and-binding.md`)
- Community Edition is single-node; no HA. Acceptable until revenue justifies AuraDB.
- If Neo4j is down, matching fails. Mitigation: D1 fallback during shadow-read phase, then circuit breaker post-cutover.

---

## Migration Phases

| Phase | Duration | What | Cost |
|---|---|---|---|
| A — Dev | Now | Docker local, schema design, Cypher validation | $0 |
| B — Dual-write | Weeks 1-4 | Ingestion writes to D1+Vectorize AND Neo4j. Reads stay on D1. | $0 (dev) |
| C — Shadow-read | Weeks 5-8 | Matching queries run against both stores. D1 results served; Neo4j compared. | ~$15/mo (Hetzner) |
| D — Primary-read | Weeks 9-10 | Matching serves from Neo4j. D1 as fallback. | ~$15/mo |
| E — Retirement | Month 4+ | Stop dual-write. Vectorize read-only archive. | ~$15/mo |
| F — Scale | Post-revenue | Migrate to AuraDB Pro if managed service justified. | ~$526/mo |

---

## Follow-up

- **ADR-044:** Candidate ingestion graph decomposition (Neo4j dual-write spec)
- **ADR-045:** Repo ingestion graph decomposition (Neo4j dual-write spec)
- **ADR-046:** Role discovery graph decomposition (Neo4j dual-write spec)
- **ADR-047:** Per-element Cypher matching algorithm (replaces `matchReposForCandidate` + `candidateSituationFit`)
- **Knowledge plan:** `part5-matching-migration/UNIFIED-NEO4J-MIGRATION.md` — master dependency graph and phase ordering
- **Knowledge plan:** `part5-matching-migration/neo4j-docker-dev.md` — Docker Compose setup for local dev
