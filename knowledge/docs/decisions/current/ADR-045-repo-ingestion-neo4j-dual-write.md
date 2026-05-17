# ADR-045: Repo Ingestion Graph Decomposition (Neo4j Dual-Write)

**Date:** 2026-05-11
**Status:** Proposed
**Deciders:** Solo founder (Pipe)
**Depends on:** ADR-043

---

## Context

Repo ingestion (Pass 3) currently produces:
1. `repo_searchable_profile` — flat prose blob (the "labeled blob")
2. `repo_engineering_signals` — JSON with architecture_style, engineering_narrative, etc.
3. `REPO_INDEX` — Vectorize upsert of the single aggregate vector

Part 3 plans (`repo-decomposition-schema.md`) already specify decomposing repos into `repo_nodes` sub-elements: Feature, ArchitecturalPattern, TechnicalStack, Construct, ChallengeSurface, QualitySignal, DomainContext, PRSample, IssueCandidate. But that plan targets D1 + Vectorize, which cannot query these relationally.

With Neo4j as the matching store (ADR-043), repo sub-elements become graph nodes that match against candidate and role sub-elements via vector similarity within relationship traversal.

---

## Decision

Pass 3 will MERGE repo sub-elements into Neo4j after every successful D1 write. The write is **fire-and-forget** during Phase B.

### Node taxonomy

```cypher
(:Repo {
  repo_id: integer,
  full_name: string,
  admin_status: string,  // approved, hold, reject
  signals_version: string,
  created_at: integer,
  updated_at: integer
})-[:HAS]->(:RepoNode:Feature {
  id: string,              // <repo_id>_Feature_<slug>
  narrative_text: string,  // "Feature: ..."
  embedding: list<float>,  // 1024-dim
  source_reference: string, // signals_version or pr_id
  created_at: integer
})
```

RepoNode labels: `:Feature`, `:ArchitecturalPattern`, `:TechnicalStack`, `:Construct`, `:ChallengeSurface`, `:QualitySignal`, `:DomainContext`, `:PRSample`, `:IssueCandidate`

### Pass 3 prompt change

Current Pass 3 prompt produces a single labeled blob. New prompt produces:
1. Legacy fields (unchanged): `architecture_style`, `engineering_narrative`, `repo_searchable_profile`
2. New field: `subElements: RepoSubElement[]`

Each `RepoSubElement` has `{ node_type, narrative_text, extracted_properties, source_reference }`.

`PRSample` and `IssueCandidate` nodes are derived from existing `repo_sample_prs` and `repo_issues` rows (no Gemma call needed for these types).

### Dual-write pattern

```typescript
// In pass3/run.ts, after D1 write succeeds:
if (env.DUAL_WRITE_NEO4J === 'true') {
  writeRepoGraph(repo, subElements, env).catch(err =>
    console.error('[dual-write] neo4j repo write failed:', {
      repo_id: repo.id,
      error: err.message
    })
  );
}
```

### MERGE semantics

```cypher
MERGE (r:Repo {repo_id: $repo_id})
SET r.full_name = $full_name,
    r.admin_status = $admin_status,
    r.signals_version = $signals_version,
    r.updated_at = $updated_at

WITH r
UNWIND $subElements AS elem
MERGE (n:RepoNode {id: elem.id})
SET n.narrative_text = elem.narrative_text,
    n.embedding = elem.embedding,
    n.node_type = elem.node_type,
    n.source_reference = elem.source_reference,
    n.created_at = elem.created_at
MERGE (r)-[:HAS]->(n)
```

---

## Alternatives Considered

### Option A — Keep aggregate vector only
- **Pros:** Simpler. One vector per repo. No schema change.
- **Cons:** Cannot match per-requirement. Cannot explain why a repo was chosen. Same opacity as current system.
- **Verdict:** Rejected. Defeats the purpose of Neo4j migration.

### Option B — Decompose but store in D1 only
- **Pros:** No new infrastructure. Uses existing `repo_nodes` table.
- **Cons:** D1 cannot do vector math. You still need Vectorize for similarity, which means hydration round-trips and no relationship queries.
- **Verdict:** Rejected. Same two-system problem.

### Option C — Decompose + dual-write to Neo4j (chosen)
- **Pros:** Structured nodes in a queryable graph. Per-element matching. Evidence attribution.
- **Cons:** Pass 3 token count increases ~30-50% (more sub-element narratives). Pass 3 runtime increases proportionally.
- **Verdict:** Accepted. The cost is one-time per repo; matching is perpetual and fast.

---

## Rationale

The repo decomposition schema is already designed. The only change is the persistence target. Instead of `repo_nodes` table + REPO_INDEX, we write to Neo4j.

The `repo_searchable_profile` legacy field is preserved for backward compatibility during transition. REPO_INDEX continues to receive the aggregate vector during dual-write (for shadow-read parity). Both are retired in Phase E.

---

## Consequences

### Positive
- Repo sub-elements match against role requirements and candidate skills with evidence
- Rich repos (20+ sub-elements) and thin repos (3-5) both supported
- Volume-based score inflation prevented by `max(sim)` aggregation per requirement
- PR/issue narratives become queryable nodes for challenge generation

### Negative / Trade-offs
- Pass 3 output shape changes: requires Zod validation before D1 write
- Backfill required for all `pass >= 3` repos
- `repo_nodes` D1 table becomes redundant after cutover

### Risks
- Gemma may hallucinate sub-elements not supported by Pass 2 signals. Mitigation: prompt instructs "enumerate features the repo actually supports; don't invent."
- Token cost increase for Pass 3. Monitor via `ai_usage_events`.

---

## Data Model

```cypher
// Constraints
CREATE CONSTRAINT repo_id_unique IF NOT EXISTS
FOR (r:Repo) REQUIRE r.repo_id IS UNIQUE;

CREATE CONSTRAINT repo_node_id_unique IF NOT EXISTS
FOR (n:RepoNode) REQUIRE n.id IS UNIQUE;

// Vector index
CREATE VECTOR INDEX repo_node_embedding IF NOT EXISTS
FOR (n:RepoNode) ON (n.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: 1024,
  `vector.similarity_function`: 'cosine'
}};
```

---

## Follow-up

- **Knowledge plan:** `part3-repo-ingestion/neo4j-repo-dual-write.md` — Pass 3 prompt rewrite, backfill script
- **Knowledge plan:** `part3-repo-ingestion/repo-decomposition-schema.md` — PATCH to reference Neo4j persistence
- **Code:** `workers/api/scripts/crawl-repos/pass3/run.ts` — sub-element generation + dual-write
- **Code:** `workers/api/scripts/backfillRepoNodes.ts` — backfill existing pass=3 repos
