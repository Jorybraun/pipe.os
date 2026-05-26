# Candidate Graph Enrichment — Requirements & Gap Analysis

**Status:** Active — gaps identified, implementation partially complete  
**Last updated:** 2026-05-18

---

## 1. The Intended Flow

A candidate's graph is a **living semantic graph** that grows from multiple sources over time. It is not a static profile built once from a resume. Each source contributes typed sub-elements (`CandidateNode`s) with provenance, confidence, and temporal layering.

### Source → Graph mapping

| Source | When | Node types produced | Current status |
|---|---|---|---|
| **Resume / CV upload** | After token resolution, at INTAKE challenge | `Experience`, `Project`, `Skill`, `Education`, `Credential`, `CareerArc` | ✅ Implemented |
| **Automated screener** (profile builder) | After intake, before matching | `Experience` (enriched), `Skill` (validated), `WorkingStyle`, `Motivation`, `Context` | ❌ Not implemented — screener answers stored as raw submission JSON only |
| **Cultural fit interview** | Post-match, role-specific | `CulturalSignal` (5 competency + 5 profile dimensions with BARS scores) | ❌ Not implemented — culture scores isolated in `culture_interview_sessions` table |
| **Code review session** | Technical validation stage | `TechnicalDemonstration` (issue identification, reasoning quality, prioritization) | ❌ Not implemented — transcripts in `review_sessions.transcript` |
| **Implementation challenge** | Technical validation stage | `TechnicalDemonstration` (debugging, construction process), `WorkingStyle` (TDD ratio, AI collaboration) | ❌ Not implemented — no scorer yet |
| **GitHub enrichment** | Async, post-intake | `Project` (owned repos), `Experience` (contributions), `WorkingStyle` (commit patterns), `Credential` | ❌ Not implemented — `enrichment_jobs` queue does not exist |

---

## 2. What Works Today

### 2.1 Resume ingestion pipeline

When a candidate uploads a PDF/DOCX via `/rpc/upload-media`:

1. File stored in R2 at `candidate-documents/{candidateId}/{filename}`
2. `candidates.resume_s3_key` updated
3. `processResumeFromR2()` triggered asynchronously via `waitUntil`
4. `parseResume()` extracts structured CV data via LLM
5. `runCandidateIngestion()` orchestrates:
   - `discoverCandidateProfile()` — rich third-person prose + structured JSON
   - `persistCandidateProfile()` — writes to `candidate_ingestion` table
   - `decomposeResumeToGraph()` — creates `CandidateNode` rows in D1 + writes to Neo4j via `writeCandidateGraph()`
   - `embedAndUpsertCandidate()` — mean-pools node embeddings, upserts to CANDIDATE_INDEX
   - `runMatchAndAssign()` — D1 SQL `matchRepos` + picks PR/issue + writes assignment

### 2.2 Verified in production (local dev)

- Candidates `test-cand-aae08ac99f42aeea` and `4c1bee04-264e-4eea-afae-4b2d2dd894ba` have 34 and 30 `candidate_nodes` in D1 respectively
- Same counts reflected in Neo4j `CandidateNode` labels (64 total across all candidates)
- Source type for all existing nodes: `resume`

---

## 3. What's Missing

### 3.1 Screener answers → graph nodes

**Current behavior:** `QUIZ_SHORT_ANSWER` submissions are stored as `response_json` blobs in `challenge_submissions`. The text answers are never processed by an LLM to extract structured sub-elements.

**What should happen:**
- After screener submission, a background worker reads `response_json`
- Runs a decomposition prompt (similar to resume decomposition) scoped to single-answer mode
- Produces `Experience`, `Skill`, `WorkingStyle`, `Motivation`, `Context` nodes
- Attaches with `source_type = 'automated_screener'`, `source_reference = <screening_session_id>`
- Updates `candidate_coverage` dimensional completeness scores

**Blocker:** No post-submission decomposition worker exists. The `submit-challenge-response` endpoint stores the submission and returns success — it does not trigger any graph enrichment.

### 3.2 Culture interview → graph nodes

**Current behavior:** `cultureAgent.ts` produces `CompetencyScoreResult` and `CultureProfileScoreResult` with evidence quotes and BARS scores. These are stored in `culture_interview_sessions.score_report` as JSON blobs.

**What should happen:**
- After culture scoring completes, map `CompetencyScoreResult` → `CulturalSignal` nodes
- Each competency dimension (ownership, collaboration, learning, conflict, self-awareness) becomes a `CulturalSignal` node
- Each profile dimension (autonomy, risk-tolerance, work-pace, collaboration-style, feedback-orientation) becomes a `CulturalSignal` node
- `source_type = 'culture_interview'`, `source_reference = <culture_interview_session_id>`
- Mode 1 (pre-match, role-agnostic) and Mode 2 (post-match, role-specific) both contribute, with different `source_type` tags

**Blocker:** No decomposition pipeline from culture score reports to candidate nodes. The mapping from score report schema to `CandidateNode` schema is undefined.

### 3.3 Code review → graph nodes

**Current behavior:** `review_sessions.transcript` captures the conversation. `review_sessions.score_report` stores 6-dimension BARS scores. Neither is decomposed into persistent candidate sub-elements.

**What should happen:**
- After code review session completes, each scored dimension becomes a `TechnicalDemonstration` node:
  - `issue_identification` → narrative derived from transcript evidence
  - `reasoning_quality` → narrative + BARS score
  - `prioritization` → narrative + BARS score
  - `question_formation` → narrative + BARS score
  - `revision_evaluation` → narrative + BARS score
  - `ai_direction` → narrative + BARS score
- `source_type = 'code_review_session'`, `source_reference = <review_session_id>`

**Blocker:** No decomposition from transcript + score report to `TechnicalDemonstration` nodes.

### 3.4 Implementation challenge → graph nodes

**Current behavior:** `/rpc/score-submission` returns null. No scoring pipeline exists.

**What should happen:**
- After the Sherlock-based scorer is built (Part 3), each scored dimension becomes a `TechnicalDemonstration` node
- Telemetry-derived features (TDD ratio, debug strategy, AI collaboration style) become `WorkingStyle` nodes

**Blocker:** Implementation scorer not yet built.

### 3.5 GitHub enrichment → graph nodes

**Current behavior:** Not implemented. No `enrichment_jobs` queue. No GitHub API integration.

**What should happen:**
- Candidate provides GitHub handle in intake form
- `enrichment_jobs` queue triggered asynchronously
- Worker fetches owned repos, contributions, commit patterns
- Decomposes into `Project`, `Experience`, `WorkingStyle`, `Credential`, `CommunicationStyle` nodes
- `source_type = 'github_enrichment'`

**Blocker:** `enrichment_jobs` queue and worker do not exist. GitHub API integration not built.

---

## 4. Why Matching Fell Back to D1 SQL (Root Cause)

When testing the code review E2E flow with candidate `7d5edbf3-e910-43d0-b8ea-ac22eba9bf31`:

1. **Neo4j primary path** (`matchReposForCandidateNeo4j`) returned **empty results**
2. **D1 SQL fallback** (`matchRepos`) ran and returned `chrisvel/tududi`

### Why Neo4j returned empty:

```cypher
MATCH (c:Candidate {candidate_id: $candidate_id})-[:HAS]->(cn:CandidateNode)
WHERE cn.superseded_at IS NULL
MATCH (r:Repo)-[:HAS]->(rn:RepoNode)
WHERE rn.node_type IN ['Feature', 'TechnicalStack', 'ArchitecturalPattern', 'PRSample']
```

- This candidate **never uploaded a resume** — created via test script, not UI flow
- Therefore `processResumeFromR2` was never called
- Therefore `decomposeResumeToGraph` was never called
- Therefore **zero `CandidateNode` sub-elements** exist in Neo4j for this candidate

### The graph is populated for candidates who DID upload resumes:

| Candidate | Nodes in D1 | Nodes in Neo4j | Ingestion status |
|---|---|---|---|
| `test-cand-aae08ac99f42aeea` | 34 | ✅ | matched |
| `4c1bee04-264e-4eea-afae-4b2d2dd894ba` | 30 | ✅ | failed (FK error at match/assign step, after decomposition) |

### The real issue is not missing code — it's missing data for test candidates:

The E2E test candidate needs to **actually upload a resume through the UI** for the graph-native matching to work. The D1 SQL fallback matched based on the **pipeline's role context**, not the candidate's personal graph.

---

## 5. Architectural Decisions Needed

### 5.1 When should screener/culture answers be decomposed?

**Option A: Synchronous in `submit-challenge-response`**
- Pros: Graph is immediately enriched, next stage sees updated candidate
- Cons: Adds LLM latency to submission API (decomposition is not free)

**Option B: Asynchronous via `waitUntil` or queue**
- Pros: Submission API stays fast
- Cons: Race condition — candidate might reach next stage before graph is enriched

**Recommendation:** Option B with a lightweight `candidateEnrichment` background task. The candidate's next stage match can use the existing graph (resume-only) and the enriched graph will be available for recruiter review or re-matching.

### 5.2 Should culture interview results feed back into matching?

Yes — but with a nuance. Mode 2 culture interview is role-specific. The `CulturalSignal` nodes it produces should be tagged with `rcd_version` and `role_context_id`. When matching against a specific role, prefer Mode 2 `CulturalSignal` nodes for that role. When matching against other roles, fall back to Mode 1 (role-agnostic) nodes.

### 5.3 Should code review technical demonstrations update the candidate's visible challenge assignment?

No. `TechnicalDemonstration` nodes are retrospective evidence — they describe what the candidate demonstrated in past assessments. They do not change challenge assignments. Challenge assignment happens once at ingestion (or on-demand at stage entry).

---

## 6. Implementation Sequencing

**Phase 0 (now):** Fix test candidates to have resumes → verify Neo4j graph-native matching works end-to-end

**Phase 1:** Build post-submission decomposition worker for screener answers
- Input: `challenge_submissions.response_json` for `QUIZ_SHORT_ANSWER` challenges in SCREENING stages
- Output: `CandidateNode` rows in D1 + Neo4j
- Trigger: `submit-challenge-response` → `waitUntil(decomposeScreenerSubmission)`

**Phase 2:** Build culture interview → graph node mapping
- Input: `culture_interview_sessions.score_report`
- Output: `CulturalSignal` nodes
- Trigger: After HITL gate approval (not immediately after interview, because unapproved scores should not enter the graph)

**Phase 3:** Build code review → graph node mapping
- Input: `review_sessions.transcript` + `review_sessions.score_report`
- Output: `TechnicalDemonstration` nodes
- Trigger: After session completion + scoring

**Phase 4:** GitHub enrichment worker
- Input: Candidate-provided GitHub handle
- Output: `Project`, `Experience`, `WorkingStyle`, `Credential` nodes
- Trigger: Async after intake

---

## 7. Verification Criteria

- [ ] Candidate uploads resume → D1 `candidate_nodes` created → Neo4j `CandidateNode` created → `candidate_coverage` updated
- [ ] Candidate completes screener → new `CandidateNode`s with `source_type='automated_screener'` appear within 30 seconds
- [ ] Candidate completes culture interview → `CulturalSignal` nodes appear after HITL approval
- [ ] Candidate completes code review → `TechnicalDemonstration` nodes appear after scoring
- [ ] Neo4j `matchReposForCandidateNeo4j` returns non-empty results for candidates with enriched graphs
- [ ] Matching uses graph-native cosine similarity, not D1 SQL fallback, when candidate has ≥10 nodes
