# Feature Report: Graph / Neo4j Layer

> Generated: 2026-05-18
> Scope: Neo4j driver, graph writes (candidate + role), matching queries, coverage queries
> Overall Manageability: **B-** (Clean separation, well-typed, but fallback logic is scattered)

---

## 1. Overview

The Neo4j layer is the **semantic backbone** of the platform. It stores typed, embedded sub-elements for Candidates, Roles, and Repos, and executes vector-similarity graph traversals for matching. The design follows ADR-044 (candidate ingestion) and ADR-046 (role graph model) and ADR-047 (per-element Cypher matching).

This layer is **shared by every feature** in the system. It is the highest-leverage code to get right.

---

## 2. Complete Architecture

### Graph Model

```
(:Candidate {candidate_id})-[:HAS]->(:CandidateNode:Experience)
(:Candidate {candidate_id})-[:HAS]->(:CandidateNode:Skill)
(:Candidate {candidate_id})-[:HAS]->(:CandidateNode:CulturalSignal)
(:Candidate {candidate_id})-[:HAS]->(:CandidateNode:TechnicalDemonstration)
(:Candidate {candidate_id})-[:HAS]->(:CandidateNode)  // fallback label

(:Role {role_context_id})-[:HAS_REQUIREMENT {weight}]->(:RoleNode:Requirement)
(:Role {role_context_id})-[:HAS_DEALBREAKER {strength}]->(:RoleNode:Dealbreaker)
(:Role {role_context_id})-[:HAS_CONFLICT]->(:RoleNode:Conflict)
(:Role {role_context_id})-[:HAS]->(:RoleNode)  // fallback

(:Repo {repo_id})-[:HAS]->(:RepoNode:Feature)
(:Repo {repo_id})-[:HAS]->(:RepoNode:TechnicalStack)
(:Repo {repo_id})-[:HAS]->(:RepoNode:ArchitecturalPattern)
(:Repo {repo_id})-[:HAS]->(:RepoNode:PRSample)
```

### Write Flow (Candidate)

```
lib/neo4j/writeCandidateGraph.ts (420 LOC)
  ├── MERGE (:Candidate {candidate_id}) with profile_state + timestamps
  ├── Supersede old nodes from same source_type (SET superseded_at = now)
  ├── Partition nodes by type:
  │     Experience → :CandidateNode:Experience
  │     Skill → :CandidateNode:Skill
  │     TechnicalDemonstration → :CandidateNode:TechnicalDemonstration
  │     CulturalSignal → :CandidateNode:CulturalSignal
  │     Others → :CandidateNode
  └── UNWIND batch MERGE each partition with (:Candidate)-[:HAS]->(n)
```

### Write Flow (Role)

```
lib/neo4j/writeRoleGraph.ts (328 LOC)
  ├── MERGE (:Role {role_context_id}) with matching policy
  ├── Partition nodes:
  │     Requirement → [:HAS_REQUIREMENT {weight}]
  │     Dealbreaker → [:HAS_DEALBREAKER {strength}]
  │     Conflict → [:HAS_CONFLICT]
  │     Others → [:HAS]
  └── UNWIND batch MERGE each partition
```

### Read Flow (Matching)

```
lib/neo4j/matchingQueries.ts (336 LOC)
  ├── matchCandidatesForRole(driver, roleContextId)
  ├── checkDealbreakersForCandidate(driver, roleContextId, candidateId)
  ├── scoreCandidateAgainstRole(driver, roleContextId, candidateId)
  └── matchReposForCandidateNeo4j(driver, candidateId, options)
```

### Read Flow (Coverage)

```
lib/neo4j/candidateGraphQueries.ts (212 LOC)
  ├── getActiveCandidateNodesFromNeo4j(driver, candidateId, nodeType?)
  ├── computeCandidateCoverageFromNeo4j(driver, candidateId)
  └── candidateHasNodesFromSourceType(driver, candidateId, sourceType)
```

---

## 3. File Inventory & LOC

| File | LOC | Role | Tests? |
|---|---|---|---|
| `lib/neo4j/writeCandidateGraph.ts` | 420 | MERGE candidate + typed sub-nodes | ⚠️ Indirect (neo4j.test.ts) |
| `lib/neo4j/writeRoleGraph.ts` | 328 | MERGE role + weighted sub-nodes | ⚠️ Indirect |
| `lib/neo4j/matchingQueries.ts` | 336 | Cypher matching queries | ✅ Yes |
| `lib/neo4j/candidateGraphQueries.ts` | 212 | Coverage + node reads with D1 fallback | — |
| `lib/neo4j/driver.ts` | ~80 | Driver singleton + config builder | ✅ Yes |
| `lib/neo4j/query.ts` | ~60 | runReadQuery / runWriteQuery wrappers | ✅ Yes |
| `lib/neo4j/seedGraph.ts` | ~120 | Graph seeding utilities | — |
| `lib/neo4j/health.ts` | ~40 | Health check query | — |

**Total Neo4j layer: ~1,596 LOC.**

---

## 4. DB Tables Touched (D1 Fallback)

| Table | Purpose |
|---|---|
| `candidate_nodes` | Fallback when Neo4j unavailable |
| `candidate_coverage` | Coverage scores computed from D1 or Neo4j |
| `role_nodes` | Role node backup (D1) |

---

## 5. External Services

| Service | Usage |
|---|---|
| **Neo4j Aura** | Primary graph store for all matching and coverage |

---

## 6. Complexity Analysis

### Superseding Logic

Both write functions implement **idempotent versioning**:
- Before writing new nodes, they `SET superseded_at = now` on existing active nodes from the same `source_type`
- This means re-ingestion doesn't delete data — it archives it
- The query uses `MATCH (c)-[:HAS]->(n) WHERE n.superseded_at IS NULL AND n.source_type = $source_type`

### Typed Labels

The system uses **multiple labels** for type discrimination:
- `:CandidateNode:Experience` — allows `labels(node)[1]` to extract type in Cypher
- This is more efficient than property-based filtering for large graphs

### Fallback Pattern

Every Neo4j read has a **D1 fallback**:

```typescript
// Pattern repeated in 4+ files
if (driver) {
  try {
    return await getActiveCandidateNodesFromNeo4j(driver, candidateId, nodeType);
  } catch (err) {
    console.warn(`Neo4j read failed, falling back to D1:`, err);
  }
}
return getActiveCandidateNodes(db, candidateId, nodeType);
```

This pattern appears in:
- `candidateGraphQueries.ts`
- `candidateNodes.ts` (`getActiveCandidateNodesWithFallback`)
- `cultureAgentPipeline.ts` (`computeCandidateCoverageWithFallback`)
- `decomposeCultureScore.ts`

---

## 7. Duplication & Dead Code

### Duplication

1. **MERGE pattern** in `writeCandidateGraph.ts` and `writeRoleGraph.ts` is structurally identical:
   - Both do `MATCH (root) → WITH root → UNWIND $nodes → MERGE (n) → SET properties → MERGE relationship`
   - Could be extracted into a generic `batchMergeNodes(driver, rootLabel, rootKey, nodes, relationshipType)`.

2. **Embedding parsing** (`parseEmbedding`) is duplicated in both write files.

3. **`nowEpoch()`** is duplicated in both write files.

### Dead Code

1. **`writeCandidateGraphFireAndForget`** exists but `writeCandidateGraph` is always `await`ed in practice.
2. **Neo4j health endpoint** (`routes/internal/neo4jHealth.ts`) may be unused in production monitoring.

---

## 8. Test Coverage

| Test File | Lines | Target |
|---|---|---|
| `neo4j.test.ts` | 530 | Driver, write queries, graph round-trips |
| `matchingQueries.test.ts` | 195 | Cypher query shape, result mapping, dealbreaker check |

**Coverage verdict:** The layer itself is reasonably tested. However, **fallback paths are untested** — no test verifies D1 fallback when Neo4j is unavailable.

---

## 9. Coupling Matrix

| Consumer | Usage | Strength |
|---|---|---|
| Candidate Ingestion | `writeCandidateGraph`, `computeCandidateCoverageWithFallback` | **Very High** |
| Culture Interview | `writeCandidateGraph`, `computeCandidateCoverageWithFallback` | **Very High** |
| Role Discovery | `writeRoleGraph` | **Very High** |
| Matching | `matchingQueries.ts` (all functions) | **Very High** |
| Repo Discovery | `matchReposForCandidateNeo4j` | Medium |
| RPC (matching gate) | `matchReposForCandidateNeo4j` | Medium |

**This layer is the central dependency of the entire backend.**

---

## 10. Manageability Verdict

| Dimension | Score | Notes |
|---|---|---|
| **Code volume** | 🟢 Low | ~1,600 LOC — tight and focused |
| **Cognitive load** | 🟡 Medium | Cypher is dense but well-commented |
| **Testability** | 🟡 Medium | Neo4j tests exist; fallback paths untested |
| **Operational risk** | 🔴 High | If Neo4j goes down, matching degrades to D1 SQL (no semantic similarity) |
| **Refactorability** | 🟢 Good | Clean module boundaries; could extract generic batch MERGE helper |
| **Performance** | 🟢 Good | Single Cypher queries target <100ms |

### Recommended Actions

1. **Extract generic batch MERGE helper** — `writeCandidateGraph` and `writeRoleGraph` share ~70% structure.
2. **Test fallback paths** — Add tests that simulate Neo4j failure and verify D1 fallback behavior.
3. **Add Cypher query plan monitoring** — Log query execution times from Neo4j to catch degradation.
4. **Consider graph schema versioning** — If node properties change, old Cypher queries may break. Add schema migration tracking.
5. **Add `EXPLAIN` tests for matching queries** — Ensure Cypher queries use indexes and don't do full graph scans.
