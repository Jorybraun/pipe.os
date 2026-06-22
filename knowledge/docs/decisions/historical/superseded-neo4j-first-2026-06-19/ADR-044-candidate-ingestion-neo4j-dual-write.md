# ADR-044: Candidate Ingestion Graph Decomposition (Neo4j Dual-Write)

**Date:** 2026-05-11
**Status:** Proposed
**Deciders:** Solo founder (Pipe)
**Depends on:** ADR-043

---

## Context

Candidate ingestion currently produces:
1. `candidate_searchable_profile` — flat prose blob
2. `candidate_ingestion.embedding_json` — single 1024-dim vector
3. `candidate_nodes` — decomposed sub-elements (Skill, Experience, Project, etc.) in D1
4. `CANDIDATE_INDEX` — Vectorize upsert of the single aggregate vector

The problem: `candidate_nodes` exists in D1 but is barely used. The matching layer queries `REPO_INDEX` with the aggregate profile text, not the structured nodes. The decomposition work (Part 4) produced a schema that has no query engine capable of consuming it relationally.

With Neo4j as the matching store (ADR-043), candidate sub-elements become first-class graph nodes with embeddings, relationships, and queryable evidence.

---

## Decision

`runCandidateIngestion` will MERGE candidate sub-elements into Neo4j after every successful D1 write. The write is **fire-and-forget** during Phase B: Neo4j failure is non-fatal, logged, and does not block the D1 write path.

### Node taxonomy

```cypher
(:Candidate {
  candidate_id: string,
  profile_state: string,
  last_engaged_at: integer,
  created_at: integer,
  updated_at: integer
})-[:HAS]->(:CandidateNode:Skill {
  id: string,
  narrative_text: string,
  embedding: list<float>,  // 1024-dim, BGE-large-en-v1.5
  confidence: float,
  evidence_source: string,
  created_at: integer,
  superseded_at: integer|null
})
```

CandidateNode labels: `:Skill`, `:Experience`, `:Project`, `:CulturalSignal`, `:TechnicalDemonstration`, `:Context`

### Dual-write pattern

```typescript
// In orchestrate.ts, after D1 write succeeds:
if (env.DUAL_WRITE_NEO4J === 'true') {
  writeCandidateGraph(candidate, nodes, env).catch(err =>
    console.error('[dual-write] neo4j candidate write failed:', {
      candidate_id_hash: hash(candidateId),
      error: err.message
    })
  );
}
```

### MERGE semantics (idempotent)

```cypher
MERGE (c:Candidate {candidate_id: $candidate_id})
SET c.profile_state = $profile_state,
    c.last_engaged_at = $last_engaged_at,
    c.updated_at = $updated_at

WITH c
UNWIND $nodes AS node
MERGE (n:CandidateNode {id: node.id})
SET n.narrative_text = node.narrative_text,
    n.embedding = node.embedding,
    n.confidence = node.confidence,
    n.node_type = node.node_type,
    n.created_at = node.created_at,
    n.superseded_at = node.superseded_at
MERGE (c)-[:HAS]->(n)
```

Running twice with the same data produces no duplicates.

---

## Alternatives Considered

### Option A — Batch sync (nightly job)
- **Pros:** No latency impact on ingestion. Simpler failure handling.
- **Cons:** Stale data in Neo4j until sync runs. Candidates who upload and immediately take a challenge see old graph state.
- **Verdict:** Rejected. The whole point is real-time matching. Batch sync reintroduces the `WAITING_FOR_MATCH` problem.

### Option B — Replace D1 entirely with Neo4j
- **Pros:** Single source of truth. No dual-write complexity.
- **Cons:** Neo4j is not the source of truth for candidate PII, auth, or billing data. D1 remains the transactional store. Also, rollback is harder if Neo4j has exclusive write access.
- **Verdict:** Rejected. Dual-write is the safe migration path. D1 stays primary; Neo4j is the matching-optimized replica.

### Option C — Dual-write fire-and-forget (chosen)
- **Pros:** Real-time. D1 write is authoritative. Neo4j failure is isolated. Easy rollback (flip `DUAL_WRITE_NEO4J=false`).
- **Cons:** Temporary complexity of two write paths. Parity drift possible.
- **Verdict:** Accepted. Standard migration pattern.

---

## Rationale

The candidate decomposition work (Part 4) already produces structured nodes. The only missing piece is writing them to a store that can query them relationally. Neo4j consumes the existing `candidate_nodes` schema with minimal transformation.

The fire-and-forget pattern ensures ingestion latency is unchanged. The D1 path (profile generation, embedding, status updates) remains synchronous. The Neo4j write is async, logged, and non-blocking.

---

## Consequences

### Positive
- Candidate sub-elements become queryable for per-requirement matching
- Evidence attribution: "Candidate matched on Skill:React (sim=0.87) and Experience:Frontend-Lead (sim=0.82)"
- Superseded nodes preserved in graph (temporal provenance)
- No change to existing D1 schema or ingestion flow

### Negative / Trade-offs
- Additional write latency: ~50-200ms per candidate (async, not blocking)
- Neo4j write failures create drift; requires parity dashboard
- `candidate_nodes` table in D1 becomes redundant after cutover; retirement planned in ADR-043 Phase E

### Risks
- Neo4j driver failure in Workers: mitigated by try/catch + log. D1 write succeeds regardless.
- Embedding dimension mismatch: vector index config must match `EMBEDDING_MODEL_VERSION` (1024 for BGE-large). If model changes, rebuild index.

---

## Data Model

```cypher
// Constraints
CREATE CONSTRAINT candidate_id_unique IF NOT EXISTS
FOR (c:Candidate) REQUIRE c.candidate_id IS UNIQUE;

CREATE CONSTRAINT candidate_node_id_unique IF NOT EXISTS
FOR (n:CandidateNode) REQUIRE n.id IS UNIQUE;

// Vector index
CREATE VECTOR INDEX candidate_node_embedding IF NOT EXISTS
FOR (n:CandidateNode) ON (n.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: 1024,
  `vector.similarity_function`: 'cosine'
}};
```

---

## Follow-up

- **Knowledge plan:** `part4-candidate-ingestion/neo4j-candidate-dual-write.md` — wire into `orchestrate.ts`, backfill script
- **Knowledge plan:** `part5-matching-migration/neo4j-dual-write-ingestion.md` — generic dual-write patterns (already exists, needs candidate-specific section)
- **Code:** `workers/api/src/lib/neo4j/writeCandidateGraph.ts` — MERGE implementation
- **Code:** `workers/api/src/lib/neo4j/writeCandidateGraph.test.ts` — mocked driver tests
