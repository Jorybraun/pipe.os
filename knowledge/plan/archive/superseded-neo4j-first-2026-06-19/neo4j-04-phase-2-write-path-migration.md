# Phase 2: Neo4j Write Path Migration — Making Neo4j Primary

This phase makes the Neo4j write functions (`writeCandidateGraph`, `writeRoleGraph`, `writeRepoGraph`) the primary — and only — write path for graph-shaped data. D1 tables (`candidate_nodes`, `role_sub_elements`) become read-only historical archives.

---

## 1. Current State

The write path is currently split, AND matching is treated as a batch pipeline step:

```
Candidate Ingestion (orchestrate.ts)
├── D1: batchInsert('candidate_nodes', [...])   ← primary
├── Neo4j: writeCandidateGraph(driver, ...)     ← secondary (gated off)
└── triangulateMatch.ts                         ← runs AFTER ingestion, stores score in D1

Role Ingestion (decomposeRcd.ts)
├── D1: batchInsert('role_sub_elements', [...]) ← primary
└── Neo4j: writeRoleGraph(driver, ...)          ← secondary (gated off)

Repo Ingestion (ingestReposToNeo4j.ts)
└── Neo4j: writeRepoGraph(driver, ...)          ← only path (10 repos)

Matching (triggered separately)
├── matchVectorNative.ts (ANN against Vectorize)
├── triangulateMatch.ts (11-step combinator)
└── Stores result: candidate_ingestion.triangulatedScore, dimensions, status='matched'
```

**Two problems:**
1. D1 `candidate_nodes` / `role_sub_elements` are written to but NEVER read for matching. The matching pipeline uses Vectorize ANN, not D1 SQL.
2. **Matching is a batch process with a loading state.** The candidate sits in `status='matching'` while `triangulateMatch` runs. This is wrong — matching should be a query.

**Target state:**
```
Candidate Ingestion (orchestrate.ts)
└── Neo4j: writeCandidateGraph(driver, ...)     ← sole write target
    // Graph is now current. NO matching step. NO stored score.

Role Ingestion (decomposeRcd.ts)
└── Neo4j: writeRoleGraph(driver, ...)          ← sole write target

Repo Ingestion (ingestReposToNeo4j.ts)
└── Neo4j: writeRepoGraph(driver, ...)          ← sole write target + backfill all repos

Matching (on-demand, when recruiter views candidate vs role)
└── Cypher query: matchCandidatesForRole(roleId)   ← runs in ~20ms, no loading screen
    // Returns fresh score + evidence every time
```

---

## 2. `writeCandidateGraph.ts` — Make Primary

### File Location
`workers/api/src/lib/neo4j/writeCandidateGraph.ts`

### Current State
```typescript
// Commented as "dual-write" — called from orchestrate.ts inside DUAL_WRITE_NEO4J gate
export async function writeCandidateGraph(
  driver: Driver,
  candidateId: string,
  nodes: CandidateNodeInput[]
): Promise<void> {
  const session = driver.session();
  try {
    // Deletes old nodes for this candidate, creates new ones
    await session.run(`
      MATCH (c:Candidate {candidate_id: $candidate_id})
      OPTIONAL MATCH (c)-[:HAS]->(n:CandidateNode)
      WHERE n.superseded_at IS NULL
      SET n.superseded_at = timestamp()
    `, { candidate_id: candidateId });

    for (const node of nodes) {
      await session.run(`
        MATCH (c:Candidate {candidate_id: $candidate_id})
        CREATE (c)-[:HAS]->(n:CandidateNode:${node.node_type} {
          id: $id,
          embedding: $embedding,
          narrative_text: $narrative,
          confidence: $confidence,
          source_type: $source_type,
          captured_at: $captured_at,
          superseded_at: null,
          created_at: timestamp()
        })
      `, { /* params */ });
    }
  } finally {
    await session.close();
  }
}
```

### Changes Required

1. **Remove "dual-write" comments** — this is now the primary path
2. **Add `source_reference` field** — link to assessment/culture interview record
3. **Add type-specific properties:**
   - `Experience`: no extra fields
   - `Skill`: add `esco_id`
   - `TechnicalDemonstration`: add `bars_score`, `dimension`
   - `CulturalSignal`: add `bars_score`, `dimension_name`, `is_role_specific`, `role_context_id`
4. **Add `superseded_by_source` logic** — only supersede nodes from the SAME source type (e.g., new resume supersedes old resume, but not code review)

### Updated Function Signature
```typescript
interface CandidateNodeInput {
  id: string;
  node_type: 'Experience' | 'Skill' | 'TechnicalDemonstration' | 'CulturalSignal';
  embedding: number[];
  narrative_text: string;
  confidence: number;
  source_type: string;
  source_reference: string;        // assessment_id or ingestion_id
  captured_at: number;             // Unix timestamp of source event
  // Type-specific fields (optional based on node_type):
  esco_id?: string;
  bars_score?: number;
  dimension?: string;
  dimension_name?: string;
  is_role_specific?: boolean;
  role_context_id?: string;
}

export async function writeCandidateGraph(
  driver: Driver,
  candidateId: string,
  nodes: CandidateNodeInput[],
  options?: { supersedeSameSourceOnly?: boolean }
): Promise<void>
```

### Updated Cypher (with type-specific properties)
```cypher
// Step 1: Supersede old nodes from same source type
MATCH (c:Candidate {candidate_id: $candidate_id})
OPTIONAL MATCH (c)-[:HAS]->(n:CandidateNode)
WHERE n.superseded_at IS NULL
  AND n.source_type = $source_type
SET n.superseded_at = timestamp()

// Step 2: Create new nodes with type labels
WITH c
UNWIND $nodes AS node
CREATE (c)-[:HAS {created_at: timestamp()}]->(n:CandidateNode)
SET n.id = node.id
SET n.embedding = node.embedding
SET n.narrative_text = node.narrative_text
SET n.confidence = node.confidence
SET n.source_type = node.source_type
SET n.source_reference = node.source_reference
SET n.captured_at = node.captured_at
SET n.superseded_at = null
SET n.created_at = timestamp()

// Add type-specific labels and properties
WITH n, node
CALL apoc.do.when(
  node.node_type = 'Experience',
  'SET n:Experience RETURN n',
  '',
  {n: n}
) YIELD value

CALL apoc.do.when(
  node.node_type = 'Skill',
  'SET n:Skill SET n.esco_id = node.esco_id RETURN n',
  '',
  {n: n, node: node}
) YIELD value

CALL apoc.do.when(
  node.node_type = 'TechnicalDemonstration',
  'SET n:TechnicalDemonstration SET n.bars_score = node.bars_score, n.dimension = node.dimension RETURN n',
  '',
  {n: n, node: node}
) YIELD value

CALL apoc.do.when(
  node.node_type = 'CulturalSignal',
  'SET n:CulturalSignal SET n.bars_score = node.bars_score, n.dimension_name = node.dimension_name, n.is_role_specific = node.is_role_specific, n.role_context_id = node.role_context_id RETURN n',
  '',
  {n: n, node: node}
) YIELD value

RETURN count(n)
```

**Note:** The `apoc.do.when` calls require the APOC plugin. If APOC is not available, use separate Cypher queries per node type in TypeScript.

---

## 3. `writeRoleGraph.ts` — Make Primary

### File Location
`workers/api/src/lib/neo4j/writeRoleGraph.ts`

### Current State
Similar to `writeCandidateGraph` — dual-write comments, generic `RoleNode` label.

### Changes Required

1. **Remove dual-write comments**
2. **Add dual-label pattern:** `:RoleNode:Requirement`, `:RoleNode:Dealbreaker`, `:RoleNode:Conflict`
3. **Add `weight` to Requirements** — used in matching aggregation
4. **Add `job_relatedness_strength` to Dealbreakers** — `'strong' | 'moderate' | 'weak'`
5. **Add `source_section` to Requirements** — for grouping in UX

### Updated Function Signature
```typescript
interface RoleNodeInput {
  id: string;
  node_type: 'Requirement' | 'Dealbreaker' | 'Conflict';
  embedding: number[];
  narrative_text: string;
  // Type-specific:
  weight?: number;                    // Requirement only
  source_section?: string;            // Requirement only
  job_relatedness_strength?: string;  // Dealbreaker only
  job_relatedness_note?: string;      // Dealbreaker only
  evidence_quote?: string;            // Dealbreaker only
  affected_node_ids?: string[];       // Conflict only
}

export async function writeRoleGraph(
  driver: Driver,
  roleContextId: string,
  nodes: RoleNodeInput[]
): Promise<void>
```

### Updated Cypher
```cypher
// Step 1: Clear old role nodes
MATCH (role:Role {role_context_id: $role_context_id})
OPTIONAL MATCH (role)-[r:HAS_REQUIREMENT|HAS_DEALBREAKER|HAS_CONFLICT]->(n:RoleNode)
DELETE r, n

// Step 2: Create new nodes with relationships
WITH role
UNWIND $nodes AS node

// Requirements
CALL apoc.do.when(
  node.node_type = 'Requirement',
  'CREATE (role)-[:HAS_REQUIREMENT {created_at: timestamp()}]->(n:RoleNode:Requirement {id: node.id, embedding: node.embedding, narrative_text: node.narrative_text, weight: node.weight, source_section: node.source_section, created_at: timestamp()}) RETURN n',
  '',
  {role: role, node: node}
) YIELD value

// Dealbreakers
CALL apoc.do.when(
  node.node_type = 'Dealbreaker',
  'CREATE (role)-[:HAS_DEALBREAKER {strength: node.job_relatedness_strength, created_at: timestamp()}]->(n:RoleNode:Dealbreaker {id: node.id, embedding: node.embedding, narrative_text: node.narrative_text, job_relatedness_strength: node.job_relatedness_strength, job_relatedness_note: node.job_relatedness_note, evidence_quote: node.evidence_quote, created_at: timestamp()}) RETURN n',
  '',
  {role: role, node: node}
) YIELD value

// Conflicts
CALL apoc.do.when(
  node.node_type = 'Conflict',
  'CREATE (role)-[:HAS_CONFLICT {created_at: timestamp()}]->(n:RoleNode:Conflict {id: node.id, embedding: node.embedding, narrative_text: node.narrative_text, affected_node_ids: node.affected_node_ids, created_at: timestamp()}) RETURN n',
  '',
  {role: role, node: node}
) YIELD value

RETURN count(*)
```

---

## 4. `writeRepoGraph.ts` — Add Typed Labels

### File Location
`workers/api/src/lib/neo4j/writeRepoGraph.ts`

### Current State
Uses generic `:RepoElement` label with `node_type` property.

### Changes Required

1. **Add dual-label pattern:** `:RepoNode:Feature`, `:RepoNode:TechnicalStack`, `:RepoNode:ArchitecturalPattern`, `:RepoNode:PRSample`
2. **Add PR-specific fields:** `pr_number`, `pr_title`, `pr_state`
3. **Add `source_reference`** for traceability

### Updated Cypher
```cypher
// For each repo element:
MATCH (repo:Repo {repo_id: $repo_id})

// Feature
CREATE (repo)-[:HAS {created_at: timestamp()}]->(n:RepoNode:Feature {
  id: $id,
  embedding: $embedding,
  narrative_text: $narrative,
  source_reference: $source_reference,
  created_at: timestamp()
})

// Or TechnicalStack
CREATE (repo)-[:HAS {created_at: timestamp()}]->(n:RepoNode:TechnicalStack {
  id: $id,
  embedding: $embedding,
  narrative_text: $narrative,
  created_at: timestamp()
})

// Or PRSample
CREATE (repo)-[:HAS {created_at: timestamp()}]->(n:RepoNode:PRSample {
  id: $id,
  embedding: $embedding,
  narrative_text: $narrative,
  pr_number: $pr_number,
  pr_title: $pr_title,
  pr_state: $pr_state,
  created_at: timestamp()
})
```

---

## 5. Update Callers

### 5.1 `orchestrate.ts` — Candidate Ingestion

**Current call site:**
```typescript
// After resume decomposition produces nodes[]
if (env.DUAL_WRITE_NEO4J === 'true') {
  await writeCandidateGraph(driver, candidateId, nodes);
}
// D1 batch insert happens here (remove this)
// THEN: triangulateMatch runs, stores score, sets status='matched'
```

**New call site:**
```typescript
// After resume decomposition produces nodes[]
const driver = createNeo4jDriver(env);
try {
  await writeCandidateGraph(driver, candidateId, nodes, {
    supersedeSameSourceOnly: true
  });
} finally {
  await driver.close();
}
// No D1 batch insert — Neo4j is sole target
// NO triangulateMatch call — matching is a query, not a pipeline step
// candidate_ingestion.status can stay but triangulatedScore/dimensions are deprecated
```

### 5.2 `decomposeRcd.ts` — Role Ingestion

**Same pattern:** Remove D1 batch insert, make `writeRoleGraph` unconditional.

### 5.3 `ingestReposToNeo4j.ts` — Repo Ingestion

Already Neo4j-only. Just update to use typed labels.

---

## 6. Schema Migration

Apply the schema changes from `02-schema-design.md`:

```cypher
// Add dual-labels to existing RepoElement nodes
MATCH (n:RepoElement)
WHERE n.node_type = 'Feature'
SET n:RepoNode:Feature;

MATCH (n:RepoElement)
WHERE n.node_type = 'TechnicalStack'
SET n:RepoNode:TechnicalStack;

MATCH (n:RepoElement)
WHERE n.node_type = 'ArchitecturalPattern'
SET n:RepoNode:ArchitecturalPattern;

MATCH (n:RepoElement)
WHERE n.node_type = 'PR'
SET n:RepoNode:PRSample;

// Create indexes for new labels
CREATE INDEX repo_node_type IF NOT EXISTS
FOR (n:RepoNode) ON (n.node_type);
```

---

## 7. Verification

```bash
# 1. Ingest a test candidate
npm run dev
# Trigger candidate ingestion via API

# 2. Verify in Neo4j Browser
MATCH (c:Candidate {candidate_id: 'TEST_ID'})-[:HAS]->(n)
RETURN labels(n), n.source_type, n.superseded_at

# 3. Verify D1 candidate_nodes table received NO new rows
sqlite3 .wrangler/state/v3/d1/miniflare-D1Database.sqlite
SELECT COUNT(*) FROM candidate_nodes WHERE created_at > $CUTOFF;

# 4. TypeScript compiles
npx tsc --noEmit -p workers/api/tsconfig.json

# 5. Tests pass
npm test -- --run
```

---

## 8. Estimated Effort

| Task | Time |
|------|------|
| Update `writeCandidateGraph.ts` | 1 hour |
| Update `writeRoleGraph.ts` | 1 hour |
| Update `writeRepoGraph.ts` | 30 min |
| Update callers (orchestrate.ts, decomposeRcd.ts) | 30 min |
| Schema migration (Cypher) | 15 min |
| Testing & verification | 1 hour |

**Total: ~4.5 hours**
