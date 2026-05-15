# Repo Matching Flow — What Actually Happens

> **Status:** This doc was written after discovering the `WAITING_FOR_MATCH` loading screen
> blocks candidates indefinitely because the underlying pipeline fails in local dev and
> the architecture has grown more complex than necessary.

---

## The Two Matching Systems (This Is The Root Confusion)

There are **two completely separate matching codepaths** that never talk to each other.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  SYSTEM A: Pipeline Build-Time Matching                                     │
│  (runs when recruiter clicks "Auto-Build")                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  recruiter ──► pipelinesAutoBuild.ts ──► autoStageBuilder()                │
│                                              │                              │
│                                              ▼                              │
│                                    ┌─────────────────┐                      │
│                                    │  matchRepos()   │  <-- SQL graph only  │
│                                    │  (SQL matcher)  │      no vectors      │
│                                    └─────────────────┘                      │
│                                              │                              │
│                                              ▼                              │
│                                    pick repo + PR + issue                   │
│                                    write into pipeline/stages/challenges    │
│                                                                             │
│  Result: Every candidate gets THE SAME repo baked into the pipeline         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│  SYSTEM B: Candidate Runtime Matching                                       │
│  (runs when candidate uploads resume via INTAKE)                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  candidate ──► submit resume ──► runCandidateIngestion()                   │
│                                      │                                      │
│                                      ▼                                      │
│                            ┌─────────────────────────┐                      │
│                            │  matchReposForCandidate │  <-- ANN + SQL blend │
│                            │  (vector + graph)       │                      │
│                            └─────────────────────────┘                      │
│                                      │                                      │
│                                      ▼                                      │
│                            write candidate_challenge_assignment            │
│                            (per-candidate override of pipeline challenge)   │
│                                                                             │
│  Result: Each candidate gets THEIR OWN repo (if pipeline is tailored)       │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

**The confusion:** Pass 3 repo "ingestion" (into `REPO_INDEX`) is for **System B only**.
System A doesn't use Vectorize at all — it uses raw SQL graph matching against `qualified_repos`.

---

## System B: The Full Candidate Runtime Pipeline

This is what runs when a candidate uploads a resume. It's also what the
`WAITING_FOR_MATCH` loading screen is waiting for.

### Step-by-step breakdown

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: upsertPendingIngestion                                               │
│  ─────────────────────────────                                                │
│  Writes: candidate_ingestion.status = 'pending'                              │
│  Speed: 10ms                                                                  │
│  AI needed: NO                                                                │
└──────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: discoverCandidateProfile                                             │
│  ────────────────────────────────                                             │
│  Input: parsed CV (skills, experiences, education)                           │
│  Output: searchable prose profile + keyConcepts (mustHaveSkills, etc.)       │
│  Speed: 3-10s                                                                 │
│  AI needed: YES — calls Cloudflare Workers AI (@cf/meta/llama-3.1-8b)        │
│  Local dev: FAILS with error 1031 (model unavailable)                        │
└──────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: persistCandidateProfile                                              │
│  ───────────────────────────────                                              │
│  Writes: candidate_ingestion.status = 'profile_generated'                    │
│           candidate_searchable_profile                                        │
│           key_concepts_json                                                   │
│  Speed: 10ms                                                                  │
│  AI needed: NO                                                                │
└──────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: decomposeResumeToGraph                                               │
│  ──────────────────────────────                                               │
│  Input: resume text                                                           │
│  Output: candidate_nodes (Skill, Experience, Project, etc.)                  │
│  Speed: 5-15s                                                                 │
│  AI needed: YES — embeds each node into CANDIDATE_INDEX                      │
│  Local dev: FAILS (same AI binding issue)                                    │
└──────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 5: embedAndUpsertCandidate                                              │
│  ───────────────────────────────                                              │
│  Input: candidate_searchable_profile prose                                    │
│  Output: 1024-dim BGE embedding                                               │
│  Writes: candidate_ingestion.embedding_json                                  │
│           Upserts vector to CANDIDATE_INDEX (remote Vectorize)               │
│  Speed: 2-5s                                                                  │
│  AI needed: YES — calls @cf/baai/bge-large-en-v1.5 for embedding             │
│  Local dev: FAILS (same AI binding issue)                                    │
└──────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 6: matchReposForCandidate                                               │
│  ──────────────────────────────                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  6a. matchReposVectorNative (ANN query)                                 │  │
│  │      ─────────────────────────────────                                  │  │
│  │      • Query CANDIDATE_INDEX? NO — queries REPO_INDEX                  │  │
│  │      • Wait, what? The candidate profile is embedded, but we don't     │  │
│  │        query with the candidate vector. We query with the PROFILE TEXT. │  │
│  │      • This means: AI re-embeds the profile text on EVERY match call.  │  │
│  │      • Returns: top 50 repo IDs + similarity scores                     │  │
│  │      • Speed: <100ms (if embedding is cached, otherwise +2s)           │  │
│  │      • AI needed: YES (for the live embed)                             │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  6b. matchRepos (SQL graph matcher)                                     │  │
│  │      ──────────────────────────────                                     │  │
│  │      • Structured SQL query against candidate_nodes + repo_nodes       │  │
│  │      • Returns: top 10 repos by graph overlap score                     │  │
│  │      • Speed: 50-200ms                                                  │  │
│  │      • AI needed: NO                                                   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
│                              │                                               │
│                              ▼                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐  │
│  │  6c. Blend scores                                                       │  │
│  │      ───────────                                                        │  │
│  │      • If both ANN and SQL returned results: weighted average          │  │
│  │      • If only one returned: use that                                   │  │
│  │      • Speed: <1ms                                                      │  │
│  │      • AI needed: NO                                                   │  │
│  └────────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 7: candidateSituationFit                                                │
│  ─────────────────────────────                                                │
│  Input: top 20 repos from step 6 + candidate profile + repo engineering      │
│         signals (test_touch_rate, complexity_band, architecture_style, etc.) │
│  Output: fit_score [0..1] and fit_band per repo                              │
│  Speed: 5-15s                                                                 │
│  AI needed: YES — calls LLM with a massive prompt comparing candidate to    │
│                    each repo's engineering culture                           │
│  Local dev: FAILS (same AI binding issue)                                    │
│  Cache: YES — results cached in situation_fit_cache for 7 days               │
└──────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 8: triangulateMatch                                                     │
│  ───────────────────────                                                      │
│  Input: graph scores + situation fit scores + role_repo_alignment scores     │
│  Output: single triangulated_score per repo                                  │
│  Speed: <1ms                                                                  │
│  AI needed: NO — pure math weighted average                                   │
└──────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 9: pickReviewPr + pickImplementationIssue                               │
│  ──────────────────────────────────────────────                               │
│  Input: winning repo                                                          │
│  Output: PR number + issue number                                             │
│  Speed: 50-200ms                                                              │
│  AI needed: NO — heuristic (semantic similarity against PR/issue titles)     │
└──────────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│  STEP 10: Write assignment rows                                               │
│  ──────────────────────────────                                               │
│  Writes: candidate_challenge_assignment                                      │
│           candidate_ingestion.status = 'matched'                             │
│  Speed: 10ms                                                                  │
│  AI needed: NO                                                                │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## What The Loading Screen Actually Does

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  CANDIDATE SEES:                                                            │
│  "Building your personalized challenge..."                                  │
│  [progress bar slowly fills to 95%]                                         │
│  Auto-refreshes every 30 seconds                                            │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  WHAT checkMatchingGate ACTUALLY DOES:                                      │
│                                                                             │
│  SELECT status FROM candidate_ingestion WHERE candidate_id = ?              │
│                                                                             │
│  IF status IN ('enriched', 'matched'):                                      │
│      return {blocked: false}                                                │
│  ELSE:                                                                      │
│      return {blocked: true, syntheticChallenge: WAITING_FOR_MATCH}         │
│                                                                             │
│  That's it. No matching happens. No vector queries. Just a status check.   │
└─────────────────────────────────────────────────────────────────────────────┘
```

**The loading screen is pure theater.** The actual matching ran (or failed) hours ago
when the candidate uploaded their resume. The screen just polls a status column.

---

## Technical Limitations (The Stuff Nobody Explained)

### 1. Vectorize ≠ Database

Vectorize stores:
- A 1024-float vector
- Up to 10 metadata key-value pairs (string/number/boolean only)
- **Nothing else**

It does NOT store `full_name`, `description`, `repo_searchable_profile`, or PR lists.
That's why hydration is required — the vector index gives you IDs, D1 gives you data.

### 2. D1 Cannot Do Vector Math

D1 is SQLite. It has no `cosine_similarity()` function, no `vector` type, no ANN index.
You cannot do `SELECT * FROM repos ORDER BY cosine(embedding, ?) DESC`.
That's why Vectorize exists as a separate service.

### 3. AI Binding Fails in Local Dev

```
wrangler.jsonc:
  "ai": { "binding": "AI", "remote": true }
```

`remote: true` means local dev calls Cloudflare's AI API. It fails with:
```
error code: 1031
```

This means **steps 2, 4, 5, and 7 all fail** in local development.
The candidate ingestion pipeline never completes.
The loading screen spins forever.

### 4. The Same Profile Gets Re-Embedded on Every Match

Look at `matchReposForCandidate.ts:136`:
```ts
annMatches = await matchReposVectorNative({
  queryText: candidateProfile,  // <-- raw text, not the vector!
  ai,
  ...
});
```

It passes `queryText` (the prose profile) not `queryVector` (the pre-computed embedding).
So `matchReposVectorNative` calls the AI embedding model **again** on every match.

This is wasteful. The candidate embedding already exists in `CANDIDATE_INDEX`.
It should pass `queryVector: candidateVec` instead.

### 5. Two Match Systems That Don't Share Results

- **Pipeline build** (`autoStageBuilder`) uses SQL graph matching only
- **Candidate runtime** (`matchReposForCandidate`) uses Vectorize ANN + SQL graph blending

They use different algorithms, different codepaths, and produce different repo picks.
A recruiter building a pipeline gets a different repo than what the candidate gets.

### 6. `candidateSituationFit` Is The Real Bottleneck

This is an AI call that sends:
- The full candidate profile (500-1000 words)
- 20 repo engineering signal narratives (each 200-500 words)
- Cultural signal nodes, experience nodes, project nodes

To an LLM, asking it to score each repo 0-1.

**This single call takes 5-15 seconds and costs the most tokens.**
It runs AFTER the vector query already found the nearest neighbors.
It's essentially asking the LLM to validate what the vector math already told us.

---

## The Honest Assessment: What's Necessary vs. Unnecessary

| Step | Necessary? | Why / Why Not |
|------|-----------|---------------|
| Parse CV | **YES** | Need structured data |
| Generate searchable profile (AI) | **Debatable** | Could use raw CV text as embedding input |
| Decompose to candidate_nodes | **NO** | Graph nodes are barely used; SQL graph matcher is fallback |
| Embed candidate (AI) | **YES** | Need vector for ANN |
| Query REPO_INDEX (ANN) | **YES** | Fast way to find similar repos |
| SQL graph matcher | **NO** | Legacy fallback; ANN is primary now |
| `candidateSituationFit` (AI) | **NO** | Expensive LLM validation of vector results |
| `triangulateMatch` | **Debatable** | Nice for explainability, but vector score alone works |
| Pick PR + issue | **YES** | Need concrete challenge content |
| Write assignment | **YES** | Need per-candidate override |

**The minimal viable pipeline:**
```
Parse CV → Embed profile → ANN query REPO_INDEX → Pick top repo →
Pick PR/issue → Write assignment → Done
```

**Time: <2 seconds total** (instead of 30-60 seconds)
**AI calls: 1** (embedding) instead of 4

---

## Why The Loading Screen Exists (Historical Reason)

The loading screen was designed for the **batch pipeline era**:

1. Candidate uploads resume at 9am
2. Background job runs `runCandidateIngestion` (takes 30-60s)
3. Candidate comes back at 10am to take the code challenge
4. `checkMatchingGate` sees `status = 'matched'` → allows through

The assumption was: matching happens **well before** the candidate needs it.
The loading screen is a fallback for race conditions.

**The reality today:**
- Candidates often skip INTAKE (no resume upload)
- Or INTAKE runs but AI fails
- Or candidates progress through stages faster than ingestion completes
- The loading screen becomes the primary experience instead of a fallback

---

## Fix Options

### Option A: Synchronous Fast Path (Recommended)

Rewrite `checkMatchingGate` to do matching on-demand:

```ts
async function checkMatchingGate(db, candidateId, pipelineId, nextChallengeType) {
  // 1. Is candidate already embedded?
  const embedding = await db.prepare(
    `SELECT embedding_json FROM candidate_ingestion WHERE candidate_id = ?`
  ).bind(candidateId).first<{embedding_json: string}>();

  if (embedding?.embedding_json) {
    // 2. ANN query (100ms)
    const repos = await matchReposVectorNative({
      db, targetIndex: env.REPO_INDEX,
      queryVector: parseEmbeddingJson(embedding.embedding_json),
      topK: 5,
    });

    // 3. Pick PR/issue (200ms)
    const winner = repos[0];
    const pr = await pickReviewPr(winner, ...);
    const issue = await pickImplementationIssue(winner, ...);

    // 4. Write assignment (10ms)
    await writeAssignment(candidateId, winner, pr, issue);

    return {blocked: false};
  }

  // Fallback: show intake prompt
  return {blocked: true, reason: 'needs_resume'};
}
```

**Result:** No loading screen. Matching happens in <500ms when candidate clicks "Next".

### Option B: Skip The Gate for Validate Mode

Insert `pipeline_match_config` with `match_philosophy = 'validate'`.

In validate mode:
- `autoStageBuilder` picks the repo at pipeline creation time
- Every candidate gets the same repo
- `checkMatchingGate` returns `{blocked: false}` immediately
- No loading screen ever appears

**Good for:** Testing, demo pipelines, roles where personalized matching doesn't matter.

### Option C: Pre-Match at Intake Time

Keep the batch pipeline but ensure it actually runs:
- Fix AI binding in local dev (use `MOCK_AI=true` with stub responses)
- Run ingestion synchronously during INTAKE submission (block the submit button)
- Never show the loading screen because matching is already done

---

## Summary

| Question | Answer |
|----------|--------|
| What is the system analyzing? | Mostly itself. The loading screen polls a status column. |
| Does it work? | **No in local dev** (AI calls fail). **Sometimes in prod** (when AI is up). |
| Can we use nearest neighbors? | **Yes.** The ANN query is <100ms. The pipeline around it is 30-60s of unnecessary AI calls. |
| Why query then hydrate? | Vectorize stores IDs + tiny metadata. D1 stores full records. Standard vector search pattern. |
| Are repos ingested in Pass 3? | **Yes** into REPO_INDEX. But Pass 3 is for System B only. System A (pipeline build) ignores Vectorize. |
| What's unnecessary? | `candidateSituationFit` (LLM re-ranking), SQL graph matcher (fallback), `decomposeResumeToGraph` (nodes unused). |
