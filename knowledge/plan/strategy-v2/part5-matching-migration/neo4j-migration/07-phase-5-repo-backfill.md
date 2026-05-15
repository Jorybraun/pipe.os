# Phase 5: Repo Backfill — Complete Neo4j Repo Graph

This phase backfills all 2,251 repos into Neo4j with rich sub-elements (features, technical stack, architectural patterns, PR samples). Currently only 10 repos have rich data.

---

## 1. Current State

```
Repos in D1: 2,251 (from github_repos table)
Repos in Neo4j: 2,251 (basic :Repo nodes from migration 005)
Repos with rich sub-elements: 10 (from manual ingestReposToNeo4j.ts runs)
```

The `ingestReposToNeo4j.ts` script works but has only been run on a handful of repos. We need to run it at scale.

---

## 2. `ingestReposToNeo4j.ts` — Review and Update

### File Location
`workers/api/scripts/ingestReposToNeo4j.ts`

### Current Capabilities
- Reads from D1 `github_repos` table
- Generates embedding for repo description/README
- Creates `:Repo` node with embedding
- Creates `:RepoElement` sub-elements (generic label)

### Changes Required

1. **Update to dual-label pattern** — `:RepoNode:Feature`, `:RepoNode:TechnicalStack`, etc.
2. **Add PR sample ingestion** — fetch recent merged PRs, generate embeddings for description + code changes
3. **Add architectural pattern detection** — scan for patterns in README/docs (CQRS, event sourcing, microservices)
4. **Batch processing** — process 50 repos at a time to avoid memory issues
5. **Error handling** — log failures, continue with next repo

### Updated Script Structure

```typescript
// ingestReposToNeo4j.ts

interface RepoInput {
  repo_id: number;
  full_name: string;
  description: string;
  readme_content: string;
  primary_language: string;
  topics: string[];
  stars: number;
}

async function ingestReposToNeo4j(
  db: D1Database,
  env: Env,
  options: {
    batchSize: number;        // default 50
    skipExisting: boolean;    // default true
    maxRepos: number;         // default 0 (all)
  }
): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  errors: { repoId: number; error: string }[];
}>
```

### Processing Pipeline (per repo)

```
1. Fetch repo from D1
2. Skip if already in Neo4j with rich elements (check :RepoNode count)
3. Generate embedding for repo description + README summary
4. Extract features from README (bullet points, capabilities)
5. Extract technical stack from package files / language stats
6. Detect architectural patterns from docs
7. Fetch recent merged PRs (top 5)
8. Generate embeddings for each sub-element
9. Write to Neo4j in a single transaction per repo
10. Log progress
```

### Embedding Generation

Use Cloudflare AI REST API (works locally, unlike Vectorize):

```typescript
async function generateEmbedding(text: string, env: Env): Promise<number[]> {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CF_ACCOUNT_ID}/ai/run/@cf/baai/bge-base-en-v1.5`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.CF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text }),
    }
  );
  const result = await response.json<{ result: { data: number[] } }>();
  return result.result.data;
}
```

---

## 3. Cypher Query for Repo Matching

Once all repos have rich sub-elements, replace `matchReposForCandidate.ts` with Cypher.

### `matchReposForCandidateNeo4j`

**Purpose:** Given a candidate, find the best-matching repos with evidence.

```typescript
export async function matchReposForCandidateNeo4j(
  driver: Driver,
  candidateId: string,
  options?: {
    topK?: number;           // default 10
    minSimilarity?: number;  // default 0.55
  }
): Promise<RepoMatchResult[]>

interface RepoMatchResult {
  repoId: number;
  fullName: string;
  score: number;
  evidence: RepoEvidence[];
}

interface RepoEvidence {
  nodeType: string;
  narrative: string;
  similarity: number;
}
```

### Cypher Query

```cypher
// Parameters: $candidate_id, $top_k (default 10), $min_similarity (default 0.55)

// Step 1: Get candidate's active nodes
MATCH (c:Candidate {candidate_id: $candidate_id})-[:HAS]->(cn:CandidateNode)
WHERE cn.superseded_at IS NULL

// Step 2: Match against repo sub-elements
MATCH (r:Repo)-[:HAS]->(rn:RepoNode)
WHERE rn.node_type IN ['Feature', 'TechnicalStack', 'ArchitecturalPattern', 'PRSample']

// Step 3: Compute similarities
WITH r, cn, rn, vector.similarity.cosine(cn.embedding, rn.embedding) AS sim
WHERE sim >= $min_similarity

// Step 4: Aggregate per-repo
WITH r, avg(sim) * log(1 + count(rn)) AS repo_score,
     collect({
       node_type: labels(rn)[1],
       narrative: rn.narrative_text,
       similarity: sim
     })[0..3] AS evidence,
     count(rn) AS match_count

// Step 5: Return ranked results
RETURN
  r.repo_id AS repo_id,
  r.full_name AS full_name,
  repo_score AS score,
  evidence AS evidence,
  match_count AS match_count
ORDER BY repo_score DESC
LIMIT $top_k
```

---

## 4. Running the Backfill

### Local (against Docker Neo4j)

```bash
# 1. Ensure Neo4j is running
docker ps | grep pipe-neo4j

# 2. Run the ingestion script
npx tsx workers/api/scripts/ingestReposToNeo4j.ts \
  --batch-size 50 \
  --max-repos 2251 \
  --skip-existing true

# 3. Monitor progress
# The script logs: "Processed 50/2251 repos (2 succeeded, 0 failed)"
```

### Expected Duration

| Batch Size | Repos | Est. Time |
|---|---|---|
| 50 | 2,251 | ~2-3 hours |

Most time is spent on:
- Embedding generation (API call per sub-element)
- GitHub API calls for PR fetching

### Parallelization

Run multiple instances with offset:
```bash
# Terminal 1: repos 0-749
npx tsx workers/api/scripts/ingestReposToNeo4j.ts --offset 0 --limit 750

# Terminal 2: repos 750-1499
npx tsx workers/api/scripts/ingestReposToNeo4j.ts --offset 750 --limit 750

# Terminal 3: repos 1500-2250
npx tsx workers/api/scripts/ingestReposToNeo4j.ts --offset 1500 --limit 751
```

---

## 5. Role→Repo Alignment Query

Replace the cached LLM rerank with Cypher:

```cypher
// Parameters: $role_id, $top_k

MATCH (role:Role {role_context_id: $role_id})-[:HAS_REQUIREMENT]->(req:RoleNode:Requirement)
MATCH (r:Repo)-[:HAS]->(rn:RepoNode)
WITH role, r, req, rn, vector.similarity.cosine(req.embedding, rn.embedding) AS sim
WHERE sim >= 0.55
WITH r, avg(sim) * log(1 + count(rn)) AS alignment_score,
     collect({req_id: req.id, sim: sim, repo_evidence: rn.narrative_text})[0..5] AS evidence
RETURN
  r.repo_id AS repo_id,
  r.full_name AS full_name,
  alignment_score AS score,
  evidence AS evidence
ORDER BY alignment_score DESC
LIMIT $top_k
```

This replaces `role_repo_alignment` in `triangulateMatch.ts`.

---

## 6. Verification

```bash
# 1. Check repo count in Neo4j
# In Neo4j Browser:
MATCH (r:Repo) RETURN count(r)          // should be 2251
MATCH (r:Repo)-[:HAS]->(n:RepoNode) 
RETURN count(n)                         // should be ~45,000 (20 per repo)

# 2. Check repo matching works
# In Neo4j Browser:
MATCH (c:Candidate)-[:HAS]->(cn:CandidateNode)
WHERE cn.superseded_at IS NULL
WITH c, cn LIMIT 1
MATCH (r:Repo)-[:HAS]->(rn:RepoNode)
WITH r, cn, rn, vector.similarity.cosine(cn.embedding, rn.embedding) AS sim
WHERE sim >= 0.55
RETURN r.full_name, sim
ORDER BY sim DESC LIMIT 5

# 3. Test via API
# After updating matchReposForCandidate to use Cypher:
curl -X POST http://localhost:8787/search/repos \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"candidateId": "TEST_ID"}'
```

---

## 7. Estimated Effort

| Task | Time |
|------|------|
| Update `ingestReposToNeo4j.ts` for dual-labels | 1 hour |
| Add PR fetching + embedding | 2 hours |
| Add architectural pattern detection | 1 hour |
| Write `matchReposForCandidateNeo4j` Cypher | 1 hour |
| Run backfill (2,251 repos) | 3 hours (mostly waiting) |
| Fix failures / edge cases | 2 hours |
| Verification | 1 hour |

**Total: ~11 hours**
