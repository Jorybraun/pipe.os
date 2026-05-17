# ADR-046: Role Discovery Graph Decomposition (Neo4j Dual-Write)

**Date:** 2026-05-11
**Status:** Proposed
**Deciders:** Solo founder (Pipe)
**Depends on:** ADR-043

---

## Context

Role discovery produces the Role Context Document (RCD) — a rich JSON blob with domain matrix, dealbreakers, conflicts, BARS overrides, technical context, and cultural signals. Currently:

1. RCD is stored as `role_contexts.rcd_json`
2. A single `role_searchable_profile` prose blob is generated
3. `role_contexts.embedding_json` stores one aggregate vector
4. `ROLE_INDEX` receives the aggregate vector

Part 2 (`phase2-rcd-decomposition.md`) already specifies decomposing RCD into `role_nodes` with 11 types: Requirement, Responsibility, CulturalSignal, TeamContext, Dealbreaker, RedFlag, TechnicalContext, CodebaseExpectation, ProcessExpectation, Conflict, BarsOverride. But that plan targets D1 + Vectorize.

With Neo4j as the matching store (ADR-043), role sub-elements become graph nodes with weighted edges that drive the matching algorithm.

---

## Decision

RCD synthesis will MERGE role sub-elements into Neo4j after every successful D1 write. The write is **fire-and-forget** during Phase B.

### Node taxonomy

```cypher
(:Role {
  role_context_id: string,
  pipeline_id: string,
  rcd_version: string,
  created_at: integer,
  updated_at: integer
})-[:HAS_REQUIREMENT {weight: 1.0}]->(:RoleNode:Requirement {
  id: string,
  narrative_text: string,     // "Requirement: ..."
  embedding: list<float>,     // 1024-dim
  source_section: string,     // "domain_matrix.work.hiring_manager"
  weight: float,              // 1.0 = must, 0.5 = nice
  created_at: integer
})

(:Role)-[:HAS_DEALBREAKER {strength: 'strong'}]->(:RoleNode:Dealbreaker {
  id: string,
  narrative_text: string,
  embedding: list<float>,
  job_relatedness_strength: string,  // strong | moderate | weak
  created_at: integer
})

(:Role)-[:HAS_CONFLICT]->(:RoleNode:Conflict {
  id: string,
  narrative_text: string,
  affected_node_ids: list<string>,
  created_at: integer
})-[:BETWEEN]->(affected:RoleNode)
```

RoleNode labels: `:Requirement`, `:Responsibility`, `:CulturalSignal`, `:TeamContext`, `:Dealbreaker`, `:RedFlag`, `:TechnicalContext`, `:CodebaseExpectation`, `:ProcessExpectation`, `:Conflict`, `:BarsOverride`

### Edge properties

| Edge | Properties | Meaning |
|---|---|---|
| `[:HAS_REQUIREMENT]` | `weight: float` | 1.0 = must-have, 0.5 = nice-to-have |
| `[:HAS_DEALBREAKER]` | `strength: string` | strong = auto-fail, moderate = flag, weak = ignore |
| `[:HAS_CONFLICT]` | none | Links to Conflict node |
| `[:BETWEEN]` | none | Conflict → affected RoleNode |

### Dual-write pattern

```typescript
// In synthesizeRcd.ts, after D1 write succeeds:
if (env.DUAL_WRITE_NEO4J === 'true') {
  writeRoleGraph(roleContext, nodes, env).catch(err =>
    console.error('[dual-write] neo4j role write failed:', {
      role_context_id: roleContext.id,
      error: err.message
    })
  );
}
```

### MERGE semantics

```cypher
MERGE (r:Role {role_context_id: $role_context_id})
SET r.pipeline_id = $pipeline_id,
    r.rcd_version = $rcd_version,
    r.updated_at = $updated_at

WITH r
// Requirements with weighted edges
UNWIND $requirements AS req
MERGE (n:RoleNode:Requirement {id: req.id})
SET n.narrative_text = req.narrative_text,
    n.embedding = req.embedding,
    n.weight = req.weight,
    n.source_section = req.source_section,
    n.created_at = req.created_at
MERGE (r)-[:HAS_REQUIREMENT {weight: req.weight}]->(n)

WITH r
// Dealbreakers with strength edges
UNWIND $dealbreakers AS db
MERGE (n:RoleNode:Dealbreaker {id: db.id})
SET n.narrative_text = db.narrative_text,
    n.embedding = db.embedding,
    n.job_relatedness_strength = db.strength,
    n.created_at = db.created_at
MERGE (r)-[:HAS_DEALBREAKER {strength: db.strength}]->(n)
```

---

## Alternatives Considered

### Option A — Flat role node (no sub-elements)
- **Pros:** Simple. One vector per role. No decomposition logic.
- **Cons:** Cannot weight requirements differently. Cannot enforce dealbreakers selectively. Cannot explain which requirement matched.
- **Verdict:** Rejected. The whole point of per-element matching is granularity.

### Option B — Store sub-elements in D1 only
- **Pros:** No new infrastructure.
- **Cons:** D1 cannot do vector math on sub-elements. Cannot traverse relationships.
- **Verdict:** Rejected.

### Option C — Decompose + dual-write to Neo4j (chosen)
- **Pros:** Weighted edges express requirement priority. Dealbreaker strength drives auto-fail logic. Conflicts modeled as graph paths.
- **Cons:** More complex Cypher. Edge properties require careful handling in MERGE.
- **Verdict:** Accepted. The graph model matches the domain exactly.

---

## Rationale

The RCD decomposition work (Part 2) already produces structured nodes. The only change is persistence target and edge semantics. The `[:HAS_REQUIREMENT {weight}]` edge is the key innovation: it lets the matching query weight technical requirements higher than cultural signals (or vice versa) per philosophy preset.

Dealbreaker strength on the edge means the matching query can auto-fail on `strength: 'strong'` without post-processing. This is impossible in Vectorize/D1.

---

## Consequences

### Positive
- Requirement weights drive philosophy-aware matching (validate/tailored/hybrid)
- Dealbreaker strength enforces auto-fail at query time
- Conflict nodes trace to affected requirements for explainability
- BARS overrides preserved as graph nodes for scoring calibration

### Negative / Trade-offs
- `role_nodes` D1 table becomes redundant after cutover
- RCD re-synthesis must supersede old nodes (set `superseded_at`, don't delete)
- Edge properties in MERGE require careful Cypher (can't MERGE edge with properties directly; need MATCH then SET)

### Risks
- Dealbreaker strength values must match strategy spec exactly ('strong', 'moderate', 'weak'). Case-sensitive.
- Conflict `affected_node_ids` must reference valid node IDs. Validation required before write.

---

## Data Model

```cypher
// Constraints
CREATE CONSTRAINT role_context_id_unique IF NOT EXISTS
FOR (r:Role) REQUIRE r.role_context_id IS UNIQUE;

CREATE CONSTRAINT role_node_id_unique IF NOT EXISTS
FOR (n:RoleNode) REQUIRE n.id IS UNIQUE;

// Vector index
CREATE VECTOR INDEX role_node_embedding IF NOT EXISTS
FOR (n:RoleNode) ON (n.embedding)
OPTIONS { indexConfig: {
  `vector.dimensions`: 1024,
  `vector.similarity_function`: 'cosine'
}};
```

---

## Follow-up

- **Knowledge plan:** `part2-role-discovery/neo4j-role-dual-write.md` — wire into `synthesizeRcd.ts`, edge property handling
- **Knowledge plan:** `part2-role-discovery/phase2-rcd-decomposition.md` — PATCH to reference Neo4j persistence
- **Code:** `workers/api/src/lib/neo4j/writeRoleGraph.ts` — MERGE with edge properties
- **Code:** `workers/api/src/lib/neo4j/writeRoleGraph.test.ts` — mocked driver tests
