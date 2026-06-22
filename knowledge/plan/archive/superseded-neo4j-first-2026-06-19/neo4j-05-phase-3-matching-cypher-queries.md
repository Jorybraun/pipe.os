# Phase 3: Matching Pipeline — Cypher Query Architecture

This phase replaces the 11-step `triangulateMatch.ts` pipeline with single Cypher queries that return per-requirement evidence. This is the core technical work of the migration.

---

## 1. Current Pipeline (What We Are Replacing)

```
triangulateMatch.ts (11 steps, 4 signals, 3 fallback paths)
├── Step 1: matchReposVectorNative — ANN against REPO_INDEX
├── Step 2: matchRepos — SQL graph matcher guardrail
├── Step 3: Blend ANN + SQL scores
├── Step 4: pickReviewPr — best PR for top repo
├── Step 5: pickImplementationIssue — best issue for top repo
├── Step 6: candidateSituationFit — Gemma LLM scorer on repo+PR
├── Step 7: role_repo_alignment — cached LLM rerank
├── Step 8: role_candidate_cosine — exact D1 embedding cosine
├── Step 9: skill_coverage — SQL graph matcher
├── Step 10: Weighted combinator (4 signals → 1 score)
└── Step 11: Philosophy-dependent weighting (validate/tailored/hybrid)
```

**Problems:**
- Requires Vectorize (`--remote` flag) for ANN
- 3 fallback paths mean behavior changes when services fail
- Opaque score — recruiter sees "0.87" with no explanation
- 11 steps = 11 failure points
- **Cross-product thinking** — computes similarity between ALL pairs, then filters

**New pipeline (graph-native nearest neighbor):**
```
matchingQueries.ts
└── matchCandidatesForRole(driver, roleContextId) — nearest neighbor traversal
    ├── Step 1: Walk :HAS_REQUIREMENT edges from Role → Requirements
    ├── Step 2: For each Requirement, find top-K nearest CandidateNodes by embedding similarity
    ├── Step 3: Walk :HAS edges back to Candidates
    ├── Step 4: Aggregate per-candidate with evidence
    ├── Step 5: Apply dealbreaker gates (separate traversal)
    └── Return: ranked candidates + per-requirement evidence
```

**Key difference:** Instead of `MATCH (role)-[:HAS_REQUIREMENT]->(req) MATCH (cand)-[:HAS]->(node) WHERE cosine(...) > threshold` (cross-product), we do `For each req, ORDER BY cosine DESC LIMIT k` (nearest neighbor). This is how graph databases are meant to be used.

---

## 2. The Complete Matching Query

### `matchCandidatesForRole`

**Purpose:** Given a role, return all candidates ranked by match score with per-requirement evidence.

**File:** `workers/api/src/lib/neo4j/matchingQueries.ts`

```typescript
export interface RequirementMatch {
  requirement_id: string;
  requirement_text: string;
  score: number;                    // 0-1, per-requirement score
  weight: number;                   // requirement weight
  evidence: EvidenceNode[];
}

export interface EvidenceNode {
  node_id: string;
  node_type: string;                // e.g. "TechnicalDemonstration"
  narrative: string;
  similarity: number;               // cosine similarity
  bars_score?: number;              // BARS score if assessment-derived
  source_type: string;              // "code_review_session", "resume", etc.
  captured_at: number;
}

export interface DealbreakerFailure {
  dealbreaker_id: string;
  narrative: string;
  matched_similarity: number;       // best match score (below threshold)
}

export interface CandidateMatchResult {
  candidate_id: string;
  overall_score: number;            // 0-1, tanh-normalized
  requirement_matches: RequirementMatch[];
  dealbreaker_failures: DealbreakerFailure[];
  matched_at: number;
}

export async function matchCandidatesForRole(
  driver: Driver,
  roleContextId: string
): Promise<CandidateMatchResult[]>
```

### Cypher Query — Graph-Native Nearest Neighbor

```cypher
// ============================================
// MATCH CANDIDATES FOR ROLE — Nearest Neighbor Traversal
// Graph-native: walk edges, find nearest nodes by embedding similarity
// Replaces: matchVectorNative + matchRepos + triangulateMatch
// ============================================

// Parameters: $role_id, $similarity_threshold (default 0.55), $top_k_per_req (default 10)

// --- Step 1: Load role with its matching policy ---
MATCH (role:Role {role_context_id: $role_id})
WITH role

// --- Step 2: Walk :HAS_REQUIREMENT edges to get requirements ---
MATCH (role)-[:HAS_REQUIREMENT]->(req:RoleNode:Requirement)
WITH role, req

// --- Step 3: For EACH requirement, find top-K nearest candidate nodes ---
// This is nearest neighbor, NOT cross-product. We ORDER BY similarity and LIMIT.
CALL {
  WITH req, role
  MATCH (cand:Candidate)-[:HAS]->(node:CandidateNode)
  WHERE node.superseded_at IS NULL
    AND node.confidence >= role.confidence_threshold
  WITH cand, node,
       vector.similarity.cosine(req.embedding, node.embedding) AS sim
  WHERE sim >= $similarity_threshold
  // Apply structured score filter if requirement has one
  WITH cand, node, sim,
       CASE
         WHEN req.min_bars_score IS NOT NULL AND node.bars_score IS NOT NULL
         THEN node.bars_score >= req.min_bars_score
         ELSE true
       END AS meets_score
  WHERE meets_score = true
  // Nearest neighbor: order by similarity, take top K per requirement
  WITH cand, node, sim
  ORDER BY sim DESC
  LIMIT $top_k_per_req
  RETURN cand, node, sim
}

// --- Step 4: Aggregate per-requirement per-candidate ---
WITH role, req, cand,
     avg(sim) * log(1 + count(node)) AS per_req_score,
     collect({
       node_id: node.id,
       sim: sim,
       type: labels(node)[1],
       bars_score: node.bars_score,
       source_type: node.source_type,
       captured_at: node.captured_at,
       narrative: node.narrative_text
     })[0..role.evidence_cap] AS top_evidence,
     count(node) AS match_count

// --- Step 5: Apply philosophy multiplier ---
WITH role, cand, req, per_req_score, top_evidence, match_count,
     CASE role.match_philosophy
       WHEN 'tailored' THEN req.weight * 1.2
       WHEN 'hybrid' THEN req.weight * role.hybrid_mix_ratio
       ELSE req.weight
     END AS effective_weight

// --- Step 6: Roll up to candidate-level ---
WITH role, cand,
     collect({
       requirement_id: req.id,
       requirement_text: req.narrative_text,
       score: per_req_score,
       evidence: top_evidence,
       weight: effective_weight,
       match_count: match_count
     }) AS requirement_matches,
     sum(per_req_score * effective_weight) / sum(effective_weight) AS overall_score
WHERE overall_score > 0

// --- Step 7: Check dealbreakers (separate traversal) ---
OPTIONAL MATCH (role)-[:HAS_DEALBREAKER {strength: 'strong'}]->(db:RoleNode:Dealbreaker)
WITH role, cand, requirement_matches, overall_score, db
OPTIONAL MATCH (cand)-[:HAS]->(dbNode:CandidateNode)
WHERE dbNode.superseded_at IS NULL
WITH role, cand, requirement_matches, overall_score, db,
     CASE WHEN db IS NOT NULL
       THEN max(vector.similarity.cosine(db.embedding, dbNode.embedding))
       ELSE null
     END AS dbSim
WITH role, cand, requirement_matches, overall_score, db, dbSim
WHERE dbSim IS NULL OR dbSim >= role.dealbreaker_threshold

// --- Step 8: Collect dealbreaker failures for reporting ---
OPTIONAL MATCH (role)-[:HAS_DEALBREAKER]->(dbAll:RoleNode:Dealbreaker)
WITH role, cand, requirement_matches, overall_score, dbAll
OPTIONAL MATCH (cand)-[:HAS]->(dbNodeAll:CandidateNode)
WHERE dbNodeAll.superseded_at IS NULL
WITH role, cand, requirement_matches, overall_score, dbAll,
     CASE WHEN dbAll IS NOT NULL
       THEN max(vector.similarity.cosine(dbAll.embedding, dbNodeAll.embedding))
       ELSE null
     END AS dbSimAll
WITH role, cand, requirement_matches, overall_score,
     collect(CASE WHEN dbSimAll IS NOT NULL AND dbSimAll < role.dealbreaker_threshold
       THEN {
         dealbreaker_id: dbAll.id,
         narrative: dbAll.narrative_text,
         matched_similarity: dbSimAll
       }
       ELSE null
     END) AS dbf_raw
WITH role, cand, requirement_matches, overall_score,
     [x IN dbf_raw WHERE x IS NOT NULL] AS dealbreaker_failures

// --- Step 9: Return ranked results ---
WITH role, cand, requirement_matches, overall_score, dealbreaker_failures
ORDER BY overall_score DESC
WITH role, collect({
  candidate_id: cand.candidate_id,
  overall_score: overall_score,
  requirement_matches: requirement_matches,
  dealbreaker_failures: dealbreaker_failures
}) AS all_results
UNWIND all_results[0..role.result_limit] AS result
RETURN
  result.candidate_id AS candidate_id,
  result.overall_score AS overall_score,
  result.requirement_matches AS requirement_matches,
  result.dealbreaker_failures AS dealbreaker_failures
```

**Why this is graph-native:**
- We **walk edges** (`:HAS_REQUIREMENT`, `:HAS`) to scope the search space
- We use **nearest neighbor** (`ORDER BY sim DESC LIMIT k`) rather than computing all pairs
- The similarity computation happens only on the **edge-connected subgraph**, not the entire database
- This scales with graph topology, not with the square of node counts

---

## 3. Supporting Queries

### `scoreCandidateAgainstRole`

**Purpose:** One-shot scoring for a specific candidate-role pair (used in candidate profile page).

```typescript
export async function scoreCandidateAgainstRole(
  driver: Driver,
  roleContextId: string,
  candidateId: string
): Promise<CandidateMatchResult | null>
```

**Cypher:** Same as above but add `WHERE cand.candidate_id = $candidate_id` before Step 3 and remove the `ORDER BY / LIMIT` at the end. Return a single result.

### `checkDealbreakersForCandidate`

**Purpose:** Quick dealbreaker check without full matching (used in kanban list view for red flags).

```typescript
export async function checkDealbreakersForCandidate(
  driver: Driver,
  roleContextId: string,
  candidateId: string
): Promise<DealbreakerFailure[]>
```

**Cypher:**
```cypher
MATCH (role:Role {role_context_id: $role_id})-[:HAS_DEALBREAKER]->(db:RoleNode:Dealbreaker)
MATCH (cand:Candidate {candidate_id: $candidate_id})-[:HAS]->(node:CandidateNode)
WHERE node.superseded_at IS NULL
WITH db, max(vector.similarity.cosine(db.embedding, node.embedding)) AS dbSim
WHERE dbSim < role.dealbreaker_threshold
RETURN {
  dealbreaker_id: db.id,
  narrative: db.narrative_text,
  matched_similarity: dbSim
} AS failures
```

---

## 4. Score Normalization

Cypher `vector.similarity.cosine` returns values in `[-1, 1]`. For our embeddings (normalized to unit vectors), values are in `[0, 1]`.

The raw per-requirement score is: `avg(sim) * log(1 + count(node))`

This can exceed 1.0 when a candidate has many high-similarity matches for a requirement. We normalize with `tanh`:

```typescript
const normalizedScore = Math.tanh(rawOverallScore);
```

`Math.tanh(x)` maps:
- `x = 0` → `0`
- `x = 1` → `0.76`
- `x = 2` → `0.96`
- `x → ∞` → `1.0`

This gives us a smooth `[0, 1)` range where:
- `0.5` = moderate match
- `0.7` = strong match
- `0.9` = exceptional match

---

## 5. `matchRouter.ts` — Feature-Flagged Cutover

The router stays but both paths are maintained during validation:

```typescript
export async function routeMatchRead(
  input: MatchInput,
  env: Env
): Promise<UnifiedMatchResult[]> {
  const store = env.PRIMARY_MATCH_STORE; // "d1" | "neo4j"
  
  if (store === 'neo4j') {
    return matchViaNeo4j(input, env);
  }
  
  return matchViaD1(input, env);
}

async function matchViaNeo4j(input: MatchInput, env: Env): Promise<UnifiedMatchResult[]> {
  const driver = createNeo4jDriver(env);
  try {
    const neo4jResults = await matchCandidatesForRole(driver, input.roleContextId);
    
    // Hydrate with D1 candidate metadata (name, email, etc.)
    const candidateIds = neo4jResults.map(r => r.candidate_id);
    const d1Candidates = await db.prepare(`
      SELECT candidate_id, name, email, profile_state 
      FROM candidates WHERE candidate_id IN (${placeholders(candidateIds)})
    `).bind(...candidateIds).all();
    
    const candidateMap = new Map(d1Candidates.results.map(c => [c.candidate_id, c]));
    
    return neo4jResults.map(r => ({
      candidateId: r.candidate_id,
      score: Math.tanh(r.overall_score),
      requirementMatches: r.requirement_matches,
      dealbreakerFailures: r.dealbreaker_failures,
      // Hydrated fields:
      name: candidateMap.get(r.candidate_id)?.name,
      email: candidateMap.get(r.candidate_id)?.email,
    }));
  } finally {
    await driver.close();
  }
}
```

---

## 6. Migration Strategy

### Step 1: Deploy Cypher queries (Day 1)
- Add `matchCandidatesForRole` to `matchingQueries.ts`
- Add `scoreCandidateAgainstRole` and `checkDealbreakersForCandidate`
- Run against test data (13 candidates × 13 roles)
- Compare outputs with `triangulateMatch.ts` results

### Step 2: Side-by-side validation (Day 2-5)
- Route 10% of traffic to Neo4j path (`PRIMARY_MATCH_STORE=neo4j` for test roles)
- Log both scores for comparison
- Investigate discrepancies

### Step 3: Full cutover (Day 6)
- Set `PRIMARY_MATCH_STORE=neo4j` in `wrangler.jsonc`
- Monitor for 1 week

### Step 4: Delete old code (Day 13+)
- After validation period, delete:
  - `matchVectorNative.ts`
  - `triangulateMatch.ts`
  - `matchReposForCandidate.ts`
  - `candidateSituationFit.ts` (or keep as optional LLM rerank)
  - `dealbreakerGate.ts`
- Remove `PRIMARY_MATCH_STORE` env var

---

## 7. Performance Expectations

| Dataset Size | Query | Expected Latency |
|---|---|---|
| 13 candidates × 5 req × 5 nodes | `matchCandidatesForRole` | ~20-50ms |
| 100 candidates × 8 req × 10 nodes | `matchCandidatesForRole` | ~100-200ms |
| Single candidate-role pair | `scoreCandidateAgainstRole` | ~10-20ms |
| Dealbreaker check only | `checkDealbreakersForCandidate` | ~5-10ms |

**Optimization:** If latency exceeds 200ms with 100+ candidates:
1. Add HNSW vector index on `CandidateNode.embedding`
2. Use `CALL db.index.vector.queryNodes` for initial shortlisting (Pattern 2)
3. Run exact cosine only on the shortlisted candidates

---

## 8. Verification

```bash
# 1. Run Cypher query directly in Neo4j Browser
# Replace $role_id with an actual role_context_id

# 2. Compare with triangulateMatch output
# Use the same role + candidate set, compare overall scores

# 3. Verify evidence is returned
# Check that requirement_matches[].evidence has non-empty arrays

# 4. Test dealbreaker gate
# Find a role with dealbreakers, verify candidates below threshold are excluded

# 5. Run API tests
npm test -- --run workers/api/src/lib/match/

# 6. E2E test
npm run e2e -- candidate-matching.spec.ts
```

---

## 9. Estimated Effort

| Task | Time |
|------|------|
| Write `matchCandidatesForRole` Cypher | 2 hours |
| Write `scoreCandidateAgainstRole` Cypher | 30 min |
| Write `checkDealbreakersForCandidate` Cypher | 30 min |
| Update `matchRouter.ts` | 1 hour |
| Update TypeScript interfaces | 30 min |
| Side-by-side validation | 4 hours |
| Fix discrepancies | 2-4 hours |

**Total: ~12 hours**
