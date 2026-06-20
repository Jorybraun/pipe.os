# Neo4j Schema Design — Labels, Properties, and Temporal Versioning

This document defines the canonical Neo4j schema for the PIPE system. It covers the dual-label pattern, temporal versioning via validity intervals, and the complete node/relationship type reference.

---

## 1. Core Principle: Labels for Type, Properties for State

```
(:CandidateNode:TechnicalDemonstration {
  node_type: 'TechnicalDemonstration',  // redundant but queryable
  bars_score: 4.5,
  confidence: 0.85,
  superseded_at: null
})
```

**Why both label AND property?**
- **Labels** are fastest for `MATCH (n:TechnicalDemonstration)` — the planner uses label indexes
- **Properties** are needed for `WHERE n.node_type = 'TechnicalDemonstration'` in dynamic queries and index filtering
- **Neo4j recommends max ~4 labels per node** for performance. Our nodes have 2 labels (base + type).

---

## 2. Root Entity Nodes

### Candidate

```cypher
(:Candidate {
  candidate_id: string,           // UUID, primary key
  profile_state: string,          // 'active' | 'archived' | 'ghosted'
  name: string,
  email: string,
  last_engaged_at: integer,       // Unix timestamp
  created_at: integer,
  updated_at: integer
})
```

**Indexes:**
```cypher
CREATE CONSTRAINT candidate_id_unique IF NOT EXISTS
FOR (c:Candidate) REQUIRE c.candidate_id IS UNIQUE;

CREATE INDEX candidate_profile_state IF NOT EXISTS
FOR (c:Candidate) ON (c.profile_state);
```

### Role

```cypher
(:Role {
  role_context_id: string,        // UUID, primary key
  pipeline_id: string,            // FK to D1 pipeline
  rcd_version: integer,           // increment on each decomposition
  title: string,
  confidence_threshold: float,    // min confidence for candidate nodes (default 0.5)
  similarity_threshold: float,    // min cosine similarity (default 0.55)
  evidence_cap: integer,          // max evidence nodes per requirement (default 3)
  match_philosophy: string,       // 'validate' | 'tailored' | 'hybrid'
  hybrid_mix_ratio: float,        // 0.0-1.0, used when philosophy='hybrid'
  dealbreaker_threshold: float,   // min similarity for dealbreaker pass (default 0.75)
  result_limit: integer,          // max candidates to return (default 50)
  created_at: integer,
  updated_at: integer
})
```

**Indexes:**
```cypher
CREATE CONSTRAINT role_context_id_unique IF NOT EXISTS
FOR (r:Role) REQUIRE r.role_context_id IS UNIQUE;

CREATE INDEX role_pipeline_id IF NOT EXISTS
FOR (r:Role) ON (r.pipeline_id);
```

### Repo

```cypher
(:Repo {
  repo_id: integer,               // GitHub repo ID
  full_name: string,              // "owner/repo"
  admin_status: string,           // 'active' | 'archived' | 'pending'
  embedding: list<float>,         // 1024-dim vector (repo-level summary)
  embedding_model: string,        // e.g. "@cf/baai/bge-base-en-v1.5"
  description: string,
  stars: integer,
  language: string,
  topics: list<string>,
  created_at: integer,
  updated_at: integer
})
```

**Indexes:**
```cypher
CREATE CONSTRAINT repo_id_unique IF NOT EXISTS
FOR (r:Repo) REQUIRE r.repo_id IS UNIQUE;

CREATE VECTOR INDEX repo_embedding IF NOT EXISTS
FOR (r:Repo) ON (r.embedding)
OPTIONS { indexConfig: { `vector.dimensions`: 1024, `vector.similarity_function`: 'cosine' }};
```

---

## 3. Sub-Element Nodes — Dual-Label Pattern

All sub-elements have a base label (`CandidateNode`, `RoleNode`, `RepoNode`) plus a type label.

### Candidate Sub-Elements

#### Experience
```cypher
(:CandidateNode:Experience {
  id: string,                     // UUID
  embedding: list<float>,         // 1024-dim
  narrative_text: string,         // e.g. "Built payment processing system at Stripe"
  confidence: float,              // 0.0-1.0, extraction confidence
  source_type: string,            // 'resume' | 'screening' | 'enrichment' | 'code_review_session' | 'culture_interview'
  source_reference: string,       // FK to source record (e.g. assessment_id)
  captured_at: integer,           // when the source event happened
  superseded_at: integer,         // null = active; set when newer version exists
  created_at: integer
})
```

#### Skill
```cypher
(:CandidateNode:Skill {
  id: string,
  embedding: list<float>,
  narrative_text: string,
  esco_id: string,                // European Skills/Competences framework ID
  confidence: float,
  source_type: string,
  source_reference: string,
  captured_at: integer,
  superseded_at: integer,
  created_at: integer
})
```

#### TechnicalDemonstration
```cypher
(:CandidateNode:TechnicalDemonstration {
  id: string,
  embedding: list<float>,
  narrative_text: string,         // e.g. "Demonstrated understanding of async/await patterns"
  bars_score: float,              // 1.0-5.0, BARS assessment score
  dimension: string,              // e.g. "code_quality" | "system_design" | "testing"
  confidence: float,
  source_type: string,            // always 'code_review_session' for this type
  source_reference: string,       // assessment_id
  captured_at: integer,
  superseded_at: integer,
  created_at: integer
})
```

#### CulturalSignal
```cypher
(:CandidateNode:CulturalSignal {
  id: string,
  embedding: list<float>,
  narrative_text: string,         // e.g. "Described conflict resolution approach using non-violent communication"
  bars_score: float,              // 1.0-5.0
  dimension_name: string,         // e.g. "collaboration" | "growth_mindset" | "ownership"
  is_role_specific: boolean,      // true if derived from role-specific culture interview
  role_context_id: string,        // FK to role (if role-specific)
  confidence: float,
  source_type: string,            // 'culture_interview' | 'screening'
  source_reference: string,
  captured_at: integer,
  superseded_at: integer,
  created_at: integer
})
```

**CandidateNode indexes:**
```cypher
CREATE INDEX candidate_node_superseded IF NOT EXISTS
FOR (n:CandidateNode) ON (n.superseded_at);

CREATE INDEX candidate_node_source_type IF NOT EXISTS
FOR (n:CandidateNode) ON (n.source_type);

CREATE INDEX candidate_node_confidence IF NOT EXISTS
FOR (n:CandidateNode) ON (n.confidence);
```

### Role Sub-Elements

#### Requirement
```cypher
(:RoleNode:Requirement {
  id: string,
  embedding: list<float>,
  narrative_text: string,         // e.g. "Must have 2+ years production Kafka experience"
  weight: float,                  // 0.0-1.0, importance in overall score
  source_section: string,         // e.g. "technical_requirements" | "experience"
  min_bars_score: float,          // optional minimum BARS score
  created_at: integer
})
```

#### Dealbreaker
```cypher
(:RoleNode:Dealbreaker {
  id: string,
  embedding: list<float>,
  narrative_text: string,         // e.g. "Must be legally authorized to work in the EU"
  job_relatedness_strength: string, // 'strong' | 'moderate' | 'weak'
  job_relatedness_note: string,   // explanation of why this is a dealbreaker
  evidence_quote: string,         // quote from RCD supporting this classification
  created_at: integer
})
```

#### Conflict
```cypher
(:RoleNode:Conflict {
  id: string,
  embedding: list<float>,
  narrative_text: string,         // e.g. "Candidate should not have recent experience with competing product X"
  affected_node_ids: list<string>, // candidate node IDs that would trigger this
  created_at: integer
})
```

**RoleNode indexes:**
```cypher
CREATE INDEX role_node_source_section IF NOT EXISTS
FOR (n:RoleNode) ON (n.source_section);
```

### Repo Sub-Elements

#### Feature
```cypher
(:RepoNode:Feature {
  id: string,
  embedding: list<float>,
  narrative_text: string,         // e.g. "Implements OAuth2 authentication flow"
  source_reference: string,       // e.g. "README.md:42" or "doc/architecture.md"
  created_at: integer
})
```

#### TechnicalStack
```cypher
(:RepoNode:TechnicalStack {
  id: string,
  embedding: list<float>,
  narrative_text: string,         // e.g. "TypeScript, React, PostgreSQL, Redis"
  created_at: integer
})
```

#### ArchitecturalPattern
```cypher
(:RepoNode:ArchitecturalPattern {
  id: string,
  embedding: list<float>,
  narrative_text: string,         // e.g. "CQRS with event sourcing for order processing"
  created_at: integer
})
```

#### PRSample
```cypher
(:RepoNode:PRSample {
  id: string,
  embedding: list<float>,
  narrative_text: string,         // PR description + key code changes
  pr_number: integer,
  pr_title: string,
  pr_state: string,               // 'open' | 'closed' | 'merged'
  created_at: integer
})
```

**RepoNode indexes:**
```cypher
CREATE INDEX repo_node_type IF NOT EXISTS
FOR (n:RepoNode) ON (n.node_type);
```

---

## 4. Relationships

```cypher
// Candidate → owns → CandidateNode
(c:Candidate)-[:HAS {created_at: integer}]->(n:CandidateNode)

// Role → owns → RoleNode
(role:Role)-[:HAS_REQUIREMENT {created_at: integer}]->(req:RoleNode:Requirement)
(role:Role)-[:HAS_DEALBREAKER {strength: string, created_at: integer}]->(db:RoleNode:Dealbreaker)
(role:Role)-[:HAS_CONFLICT {created_at: integer}]->(conf:RoleNode:Conflict)

// Repo → owns → RepoNode
(repo:Repo)-[:HAS {created_at: integer}]->(rn:RepoNode)

// Candidate → matched against → Role (for caching results)
(c:Candidate)-[:MATCHED_AGAINST {
  role_context_id: string,
  overall_score: float,
  matched_at: integer,
  match_version: integer          // increment when re-matched
}]->(role:Role)

// Repo → related to → Role (for role-repo alignment)
(repo:Repo)-[:ALIGNED_WITH {
  role_context_id: string,
  alignment_score: float,
  alignment_method: string        // 'llm_rerank' | 'semantic'
}]->(role:Role)
```

---

## 5. Temporal Versioning — The Validity Interval Pattern

Neo4j has no native temporal support. The community standard is validity intervals:

### Current-State Query (default)

```cypher
MATCH (c:Candidate)-[:HAS]->(n:CandidateNode)
WHERE n.superseded_at IS NULL
RETURN n
```

### Point-in-Time Query

```cypher
MATCH (c:Candidate)-[:HAS]->(n:CandidateNode)
WHERE n.created_at <= $as_of
  AND (n.superseded_at IS NULL OR n.superseded_at > $as_of)
RETURN n
```

### Drift Detection

```cypher
// What changed between Jan 1 and Mar 1?
MATCH (c:Candidate)-[:HAS]->(n:CandidateNode)
WHERE n.created_at > $from AND n.created_at <= $to
   OR (n.superseded_at > $from AND n.superseded_at <= $to)
RETURN
  collect(DISTINCT CASE WHEN n.created_at > $from THEN n END) AS added,
  collect(DISTINCT CASE WHEN n.superseded_at > $from THEN n END) AS superseded
```

### Supersession Logic (in application code)

When a new version of a candidate's data arrives (e.g., updated resume):

```typescript
// 1. Mark old nodes as superseded
const session = driver.session();
await session.run(`
  MATCH (c:Candidate {candidate_id: $candidate_id})-[:HAS]->(n:CandidateNode)
  WHERE n.superseded_at IS NULL
    AND n.source_type = $source_type
  SET n.superseded_at = $now
`, { candidate_id, source_type, now: Date.now() });

// 2. Create new nodes
await session.run(`
  MATCH (c:Candidate {candidate_id: $candidate_id})
  CREATE (c)-[:HAS]->(n:CandidateNode:Experience {
    id: $id,
    embedding: $embedding,
    narrative_text: $narrative,
    confidence: $confidence,
    source_type: $source_type,
    source_reference: $source_ref,
    captured_at: $captured_at,
    superseded_at: null,
    created_at: $now
  })
`, { /* params */ });
```

**Research-backed:** Academic studies (Clock-G, hal.science papers) show this pattern outperforms snapshot-based versioning by 12× disk usage and 99% query speed.

---

## 6. Migration from Current Schema

### Current state (before migration):

```cypher
// Generic labels — no type specificity
(:RepoElement {node_type: 'Feature'})
(:RepoElement {node_type: 'TechnicalStack'})
```

### Target state (after migration):

```cypher
// Dual-label pattern
(:RepoNode:Feature)
(:RepoNode:TechnicalStack)
```

### Migration Cypher:

```cypher
// Add type labels to existing RepoElement nodes
MATCH (n:RepoElement)
WHERE n.node_type = 'Feature'
SET n:RepoNode:Feature;

MATCH (n:RepoElement)
WHERE n.node_type = 'TechnicalStack'
SET n:RepoNode:TechnicalStack;

MATCH (n:RepoElement)
WHERE n.node_type = 'ArchitecturalPattern'
SET n:RepoNode:ArchitecturalPattern;

// Remove old generic label (optional — keep for backward compat)
// MATCH (n:RepoNode) REMOVE n:RepoElement;
```

---

## 7. Complete Schema DDL

Run this in Neo4j Browser to establish the full schema:

```cypher
// === CONSTRAINTS ===
CREATE CONSTRAINT candidate_id_unique IF NOT EXISTS
FOR (c:Candidate) REQUIRE c.candidate_id IS UNIQUE;

CREATE CONSTRAINT role_context_id_unique IF NOT EXISTS
FOR (r:Role) REQUIRE r.role_context_id IS UNIQUE;

CREATE CONSTRAINT repo_id_unique IF NOT EXISTS
FOR (r:Repo) REQUIRE r.repo_id IS UNIQUE;

// === B-TREE INDEXES ===
CREATE INDEX candidate_profile_state IF NOT EXISTS
FOR (c:Candidate) ON (c.profile_state);

CREATE INDEX role_pipeline_id IF NOT EXISTS
FOR (r:Role) ON (r.pipeline_id);

CREATE INDEX candidate_node_superseded IF NOT EXISTS
FOR (n:CandidateNode) ON (n.superseded_at);

CREATE INDEX candidate_node_source_type IF NOT EXISTS
FOR (n:CandidateNode) ON (n.source_type);

CREATE INDEX candidate_node_confidence IF NOT EXISTS
FOR (n:CandidateNode) ON (n.confidence);

CREATE INDEX role_node_source_section IF NOT EXISTS
FOR (n:RoleNode) ON (n.source_section);

CREATE INDEX repo_node_type IF NOT EXISTS
FOR (n:RepoNode) ON (n.node_type);

// === VECTOR INDEXES (optional — for ANN if needed later) ===
CREATE VECTOR INDEX candidate_node_embedding IF NOT EXISTS
FOR (n:CandidateNode) ON (n.embedding)
OPTIONS { indexConfig: { `vector.dimensions`: 1024, `vector.similarity_function`: 'cosine' }};

CREATE VECTOR INDEX role_node_embedding IF NOT EXISTS
FOR (n:RoleNode) ON (n.embedding)
OPTIONS { indexConfig: { `vector.dimensions`: 1024, `vector.similarity_function`: 'cosine' }};

CREATE VECTOR INDEX repo_embedding IF NOT EXISTS
FOR (r:Repo) ON (r.embedding)
OPTIONS { indexConfig: { `vector.dimensions`: 1024, `vector.similarity_function`: 'cosine' }};
```
