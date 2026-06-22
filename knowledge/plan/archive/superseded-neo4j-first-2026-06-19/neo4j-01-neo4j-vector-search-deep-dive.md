# Neo4j Vector Search — Deep Dive

This document is the research foundation for the matching pipeline rewrite. It explains how Neo4j's vector capabilities work, when to use exact vs approximate search, and how to combine vector similarity with structured graph filters — the core capability that makes the Neo4j-first architecture possible.

---

## 1. Index Type: HNSW

Neo4j uses HNSW (Hierarchical Navigable Small World) — the same algorithm as Pinecone, Qdrant, Weaviate. It is not Neo4j-specific; it is the industry standard for approximate nearest neighbor search.

### Creating the Index

```cypher
CREATE VECTOR INDEX candidate_node_embedding IF NOT EXISTS
FOR (n:CandidateNode) ON (n.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: 1024,
  `vector.similarity_function`: 'cosine'
}}
```

**Key parameters:**
- `vector.dimensions`: Must match your embedding model output (1024 for our system)
- `vector.similarity_function`: `cosine` for semantic similarity (our use case). Alternatives: `euclidean` for raw distance.

### Index Status Check

```cypher
SHOW INDEXES YIELD name, type, state, populationPercent
WHERE type = 'VECTOR'
```

A newly created index starts at `populationPercent: 0` and gradually backfills. Queries will be slow until it reaches 100%. For small datasets (<100K nodes), this takes seconds.

---

## 2. Two Ways to Query

### A) Approximate Search (HNSW — fast, uses index)

```cypher
CALL db.index.vector.queryNodes('candidate_node_embedding', 10, $query_vector)
YIELD node, score
RETURN node, score
```

| Attribute | Value |
|---|---|
| Latency | ~2-8ms for 1M vectors |
| Recall | 95-99% (tunable via `ef_search`) |
| Best for | Stage 1 retrieval (top-K shortlist) |
| Drawback | Approximate — may miss exact best matches |

**Tuning `ef_search`:**
```cypher
CALL db.index.vector.queryNodes('candidate_node_embedding', 10, $query_vector)
YIELD node, score
WITH node, score
ORDER BY score DESC
RETURN node, score
```
Higher `ef_search` = better recall, slower query. Default is usually sufficient.

### B) Exact Search (Brute-force — no index)

```cypher
MATCH (n:CandidateNode)
WITH n, vector.similarity.cosine($query_vector, n.embedding) AS score
RETURN n, score
ORDER BY score DESC
LIMIT 10
```

| Attribute | Value |
|---|---|
| Latency | Linear scan — acceptable at our scale |
| Recall | 100% |
| Best for | Small datasets, filtered candidate sets, exact scores |

### Critical Insight for Our Scale

At **<50K vectors**, exact search is often **faster** than HNSW because you avoid index overhead (memory-resident graph structure, hop traversal). The HNSW index shines at 100K+ vectors.

**Our current scale:**
- 13 candidates × ~5 nodes each = ~65 candidate nodes
- 13 roles × ~5 nodes each = ~65 role nodes  
- 2,251 repos × ~20 nodes each (after backfill) = ~45,000 repo nodes
- **Total: ~45,130 vectors**

**Decision: Use exact cosine search for all matching queries.** The precision is worth the 5-20ms cost. If we scale to 500K+ vectors, we can add HNSW indices later without changing query structure.

---

## 3. The "Marriage" — Vector Search + Structured Filters

This is the feature that makes our architecture possible. Neo4j supports three filtering patterns:

### Pattern 1: Pre-filtering (Cypher → Vector)

**Use when:** You can define a small candidate set with graph structure first.

```cypher
// Step 1: Graph pre-filter — only candidates who passed code review
MATCH (c:Candidate)-[:HAS]->(n:CandidateNode:TechnicalDemonstration)
WHERE n.source_type = 'code_review_session'
  AND n.bars_score >= 4.0
  AND n.superseded_at IS NULL

// Step 2: Exact vector similarity on the filtered set
WITH c, n, vector.similarity.cosine($req_embedding, n.embedding) AS sim
WHERE sim >= 0.60

// Step 3: Aggregate
RETURN c.candidate_id, avg(sim) AS score
ORDER BY score DESC
```

| Pros | Cons |
|---|---|
| Exact scores | Scans all filtered nodes |
| Full Cypher flexibility | (fine at our scale) |
| No index needed | |

**This is our primary pattern.** All matching queries use pre-filtering:
1. `MATCH` the role requirements
2. `MATCH` candidate nodes with temporal + confidence filters
3. Compute exact cosine
4. Aggregate per-requirement

### Pattern 2: Post-filtering (Vector → Cypher)

**Use when:** You need vector similarity first, then refine.

```cypher
// Step 1: Vector search (approximate, top-50)
CALL db.index.vector.queryNodes('candidate_node_embedding', 50, $query_vector)
YIELD node, score AS sim

// Step 2: Post-filter with graph logic
MATCH (node)<-[:HAS]-(c:Candidate)
WHERE node.superseded_at IS NULL
  AND node.bars_score >= 4.0
  AND EXISTS((c)-[:HAS]->(:CandidateNode {source_type: 'code_review_session'}))

RETURN c.candidate_id, sim
ORDER BY sim DESC
LIMIT 10
```

| Pros | Cons |
|---|---|
| Fast vector retrieval | May return fewer than K results |
| Then flexible filtering | if filter is strict |

**Not our primary pattern** — we need exact scores for hiring decisions.

### Pattern 3: In-index Filtering (Neo4j v2026.01 preview)

**Use when:** You need speed AND simple property filters.

```cypher
// Cypher 25 syntax (preview — not available yet)
MATCH (n)
SEARCH n IN (
  VECTOR INDEX filtered_embedding
  FOR $query_vector
  WHERE n.node_type = 'TechnicalDemonstration'
    AND n.source_type = 'code_review_session'
  LIMIT 10
) SCORE AS sim
RETURN n, sim
```

| Pros | Cons |
|---|---|
| Fastest — filter in HNSW traversal | Filter props must be declared at index creation |
| | Less flexible than Cypher |

**Not applicable yet** — requires Neo4j version we don't have.

---

## 4. Performance Reality Check

### Benchmarks at 1M vectors, 1536 dims:

| DB | P50 | P99 | QPS | Recall |
|---|---|---|---|---|
| Qdrant | 2ms | 6ms | 1,200 | 99% |
| Pinecone | 4ms | 12ms | 800 | 97% |
| Weaviate | 6ms | 18ms | 550 | 96% |
| pgvector | 8ms | 24ms | 350 | 95% |

Neo4j HNSW is comparable — it's the same algorithm regardless of host database.

### At Our Scale (~45K vectors):

| Approach | Latency | Recall |
|---|---|---|
| Exact brute-force scan | ~5-20ms | 100% |
| HNSW ANN | ~2-5ms | 95-99% |

**Either is fast enough for real-time matching.** We choose exact for precision.

### Memory Footprint:

```
45K vectors × 1024 dims × 4 bytes = ~184MB
```

Fits comfortably in a 2GB VPS with room to grow to 500K+ vectors.

---

## 5. Query Plan Analysis

Always `EXPLAIN` or `PROFILE` matching queries before deploying:

```cypher
PROFILE
MATCH (role:Role {role_context_id: $role_id})-[:HAS_REQUIREMENT]->(req:Requirement)
MATCH (cand:Candidate)-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL
WITH role, req, cand, node,
     vector.similarity.cosine(req.embedding, node.embedding) AS sim
WHERE sim >= 0.55
RETURN cand.candidate_id, avg(sim) AS score
ORDER BY score DESC
LIMIT 50
```

**What to look for:**
- `NodeByLabelScan` on `:CandidateNode` — expected for exact search
- `Filter` steps on `superseded_at IS NULL` — should happen early
- No `DbHits` explosion — if you see millions of db hits, check that `role_context_id` is indexed

**Index requirements for performance:**
```cypher
CREATE INDEX role_context_id IF NOT EXISTS
FOR (r:Role) ON (r.role_context_id);

CREATE INDEX candidate_id IF NOT EXISTS
FOR (c:Candidate) ON (c.candidate_id);

CREATE INDEX node_superseded IF NOT EXISTS
FOR (n:CandidateNode) ON (n.superseded_at);
```

---

## 6. Decision Summary

| Decision | Choice | Rationale |
|---|---|---|
| Exact vs ANN | **Exact cosine** | Precision matters for hiring; scale is small enough |
| Filtering pattern | **Pre-filtering (Pattern 1)** | Complex multi-property filters; exact scores needed |
| HNSW indices | **Skip for now** | Add only if we exceed 100K vectors |
| B-tree indices | **Add on lookup keys** | `role_context_id`, `candidate_id`, `superseded_at` |
