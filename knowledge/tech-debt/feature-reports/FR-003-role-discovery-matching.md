# Feature Report: Role Discovery & Semantic Matching

> Generated: 2026-05-18
> Scope: Role synthesis, RCD decomposition, Neo4j graph matching, repo discovery
> Overall Manageability: **C** (Complex cross-domain graph matching, thin test coverage on synthesis)

---

## 1. Overview

Role Discovery transforms recruiter inputs (job descriptions, stakeholder interviews) into a **Role Context Document (RCD)**, decomposes it into embedded graph nodes, and enables semantic matching against candidates via Neo4j Cypher queries. Repo Discovery sits in the middle, selecting challenge repositories based on role-candidate alignment.

This is the **other half** of the matching equation (candidate ingestion is the first half).

---

## 2. Complete Flow Trace

### Role Creation / Synthesis

```
routes/discovery/roleContexts.ts (1,802 LOC)
  ├── POST /                         → create role_contexts row
  ├── POST /:id/start                → calibration question
  ├── POST /:id/respond              → runNewArchitectureTurn() → interview reducer + question generator
  └── runRcdSynthesis()
        ├── synthesizeRcd.ts (455 LOC)     ← Layer 1-3 LLM synthesis, retry loop (max 2)
        ├── consumerSlice.ts (158 LOC)     ← deterministic CandidatePersona derivation
        ├── deriveJobDescription.ts (129 LOC) ← markdown JD generation
        ├── buildRoleProfile.ts (27 LOC)    ← searchable text strip
        └── embedRole.ts (98 LOC)           ← BGE embed → ROLE_INDEX
```

### Role Decomposition

```
lib/roleAgent/decomposeRcd.ts (465 LOC)
  ├── extractRequirements()        ← domain_matrix laddering chains (work/bar/codebase)
  ├── extractResponsibilities()    ← domain_matrix stories (work/team)
  ├── extractCulturalSignals()     ← team_culture_profile per_stakeholder
  ├── extractTeamContexts()        ← domain_matrix.team open_codes
  ├── extractDealbreakers()        ← dealbreakers[]
  ├── extractRedFlags()            ← red_flags[]
  ├── extractTechnicalContexts()   ← technical_context stack/constructs
  ├── extractCodebaseExpectations()← technical_context.codebase_expectations
  ├── extractProcessExpectations() ← domain_matrix.process open_codes
  ├── extractConflicts()           ← conflicts[]
  ├── extractBarsOverrides()       ← bars_overrides[]
  └── persistRoleNodes()
        ├── embed batches of 10 via env.AI.run(BGE)
        └── writeRoleGraphFireAndForget() → Neo4j
```

### Semantic Matching

```
lib/neo4j/matchingQueries.ts (336 LOC)
  ├── matchCandidatesForRole(driver, roleContextId)
  │     └── Single Cypher query:
  │         - Load Role + matching policy
  │         - Match (:Requirement) against active (:CandidateNode) via cosine
  │         - Score = avg(sim) * log(1 + count)
  │         - Apply philosophy multiplier (tailored/hybrid/validate)
  │         - Weighted overall score
  │         - Dealbreaker gate: max(cosine) >= threshold
  │         - Order by score, cap at result_limit
  ├── checkDealbreakersForCandidate(driver, roleContextId, candidateId)
  └── scoreCandidateAgainstRole(driver, roleContextId, candidateId)

lib/match/matchRouter.ts (153 LOC)
  └── routeMatchRead() → matchViaNeo4j()
        - Calls matchCandidatesForRole()
        - Hydrates candidate metadata from D1
        - Normalizes scores with Math.tanh()
```

### Repo Matching

```
lib/neo4j/matchingQueries.ts
  └── matchReposForCandidateNeo4j(driver, candidateId)
        - Match (:CandidateNode) against (:RepoNode)
        - RepoNode types: Feature, TechnicalStack, ArchitecturalPattern, PRSample
        - Score = avg(sim) * log(1 + count(rn))
        - Return topK ranked repos

lib/repoDiscovery/matchRepos.ts (347 LOC)
  └── matchRepos() — SQL catalog query (runtime path)
        - Slugify skills via skill_aliases
        - Hard-filter: disqualified=0, language, seniority_band, last_pushed >= 6mo
        - HAVING must_hits = must_total (ALL must-have skills)
        - Score: stack 45%, nice-to-have 15%, domain 10%, constructs 10%, PR quality 15%, contamination 5%

lib/match/autoStageBuilder.ts (406 LOC)
  ├── buildMatchRequest()        ← resolve must-have skills
  ├── pickReviewPr()             ← semantic PR pick (cosine vs size fallback)
  └── pickImplementationIssue()  ← difficulty_band matching
```

---

## 3. File Inventory & LOC

| File | LOC | Role | Tests? |
|---|---|---|---|
| `routes/discovery/roleContexts.ts` | 1,802 | Role creation, stakeholder interview, synthesis trigger | ⚠️ Partial (embed/question tested, not route handlers) |
| `lib/roleAgent/synthesizeRcd.ts` | 455 | Layer 1-3 RCD synthesis via LLM | ❌ No |
| `lib/roleAgent/decomposeRcd.ts` | 465 | 11 extractors → typed RoleNode rows | ✅ Yes |
| `lib/neo4j/writeRoleGraph.ts` | 328 | MERGE Role + sub-elements into Neo4j | ⚠️ Indirect |
| `lib/neo4j/matchingQueries.ts` | 336 | Cypher matching (candidates, repos, dealbreakers) | ✅ Yes |
| `lib/repoDiscovery/discover.ts` | 518 | Hybrid recall + RCD-aware rerank | — |
| `lib/repoDiscovery/matchRepos.ts` | 347 | SQL catalog matcher | ❌ No |
| `lib/match/autoStageBuilder.ts` | 406 | PR/issue picker + match request builder | ✅ Yes |
| `lib/match/matchRouter.ts` | 153 | Neo4j match hydration + normalization | ❌ No |
| `lib/roleDiscovery/buildRoleProfile.ts` | 27 | Searchable text generation | — |
| `lib/roleDiscovery/embedRole.ts` | 98 | Role embedding + Vectorize upsert | — |
| `lib/roleAgent/consumerSlice.ts` | 158 | Deterministic persona derivation | ❌ No |
| `lib/roleAgent/deriveJobDescription.ts` | 129 | JD markdown generation | ❌ No |
| `lib/repoDiscovery/rcdSearchProfile.ts` | 130 | Profile word-count padding/truncation | ✅ Yes |

**Total tracked flow: ~38 files, ~10,860 LOC.**

---

## 4. DB Tables Touched

### Role Side

| Table | Purpose |
|---|---|
| `role_contexts` | RCD JSON, persona JSON, JD markdown, embedding, status |
| `role_context_participants` | Stakeholder transcripts, exchanges |
| `role_nodes` | Decomposed role nodes (D1 backup) |
| `pipeline_match_config` | match_philosophy, tolerance, hybrid_mix_ratio |
| `discovered_repos` | Crawled repo catalog |
| `discovery_jobs` | Background discovery queue |
| `repo_role_alignment` | Top 20 aligned repos per role |

### Repo Catalog

| Table | Purpose |
|---|---|
| `qualified_repos` | Repo names, URLs, metadata |
| `repo_skills` | Repo skill tags |
| `repo_constructs` | Repo construct tags |
| `repo_engineering_signals` | Quality signals |
| `repo_sample_prs` | PR narratives + embeddings |
| `repo_issues` | Issue body cache |
| `issue_challenge_signals` | Implementability / difficulty |
| `skill_aliases` | Skill canonicalization |

### Candidate Side (read-only for matching)

| Table | Purpose |
|---|---|
| `candidates` | Metadata |
| `candidate_ingestion` | Status, embedding, scores |
| `candidate_nodes` | Graph nodes |
| `candidate_coverage` | Coverage tracking |
| `candidate_repo_matches` | Visibility |
| `candidate_challenge_assignment` | Assignments |
| `match_feedback` | Recruiter thumbs up/down |

---

## 5. External Services

| Service | Usage |
|---|---|
| **Neo4j** (Aura) | Graph store for Role→Requirement→CandidateNode matching |
| **Cloudflare Workers AI** | LLM synthesis + BGE embeddings |
| **Cloudflare Vectorize** | `ROLE_INDEX`, `CANDIDATE_INDEX`, `REPO_INDEX` |
| **Cloudflare D1** | Relational metadata, catalogs, ingestion state |
| **Resend** | Email invitations to stakeholders |
| **GitHub API** | Legacy — now only in crawler scripts |
| **Libraries.io** | Legacy — now only in crawler scripts |

---

## 6. Complexity Analysis

### The Matching Cypher Query

The `matchCandidatesForRole` query is a **single Cypher statement** that:
1. Loads the Role node (with dynamic policy properties)
2. Traverses `[:HAS_REQUIREMENT]` edges
3. Computes `vector.similarity.cosine()` for every (Requirement, CandidateNode) pair
4. Aggregates per-requirement scores with a logarithmic evidence bonus
5. Applies philosophy multipliers (tailored × 1.2, hybrid × ratio)
6. Computes weighted overall score
7. Enforces strong dealbreakers
8. Ranks and caps results

**Target latency: <100ms** (vs 30-60s legacy pipeline).

### Policy-Driven Matching

The Role node stores matching policy dynamically:
- `similarity_threshold` (0.50–0.70)
- `confidence_threshold` (0.50–0.70)
- `dealbreaker_threshold` (0.65–0.80)
- `match_philosophy` (`validate` | `tailored` | `hybrid`)
- `hybrid_mix_ratio` (default 0.6)

These are derived from `pipeline_match_config` tolerance (`strict`/`moderate`/`lenient`).

---

## 7. Duplication & Dead Code

### Duplication

1. **`matchReposForCandidateNeo4j`** and **`matchCandidatesForRole`** share nearly identical scoring formula (`avg(sim) * log(1 + count)`). The pattern is duplicated with different node types.
2. **Role embedding** (`embedRole.ts`) and **candidate embedding** (`embed.ts`) are separate files with nearly identical BGE call + Vectorize upsert logic.
3. **`resolvePolicyFromConfig`** in `writeRoleGraph.ts` mirrors pipeline config reading in `decomposeRcd.ts`.

### Dead Code

1. **Hybrid recall in `discover.ts`** — `REPO_INDEX.query()` is called but the SQL catalog path is primary. Vectorize path may be redundant.
2. **RCD-aware rerank** (`rerankMatchedRepos`) uses Gemma-4 but is rarely exercised in production.

---

## 8. Test Coverage

| Test File | Lines | Target |
|---|---|---|
| `decomposeRcd.test.ts` | 266 | All 11 extractors, weight logic |
| `matchingQueries.test.ts` | 195 | Cypher shape, result mapping, dealbreakers |
| `neo4j.test.ts` | 530 | Driver, write queries, graph round-trips |
| `autoStageBuilder.test.ts` | 429 | Shared-repo vs per-stage, PR/issue picking |
| `rcdSearchProfile.test.ts` | 302 | Profile padding/truncation |
| `roleDiscovery.test.ts` | 156 | Route-level embedding + profile |

**Total test lines: ~1,873**

### Coverage Gaps

- `synthesizeRcd.ts` — **no unit tests** (relies on LLM; only manual/integration tested).
- `verifyRcd.ts` — no dedicated test file.
- `consumerSlice.ts` — no dedicated test file.
- `matchRouter.ts` — no dedicated test file.
- `matchRepos.ts` — only tested indirectly via autoStageBuilder stubs.
- `writeRoleGraph.ts` — covered indirectly via neo4j.test.ts.

---

## 9. Coupling Matrix

### Role → Candidate (downstream)

| Coupling Point | Strength |
|---|---|
| `matchRouter.ts` LEFT JOINs `candidate_ingestion` | High |
| `matchingQueries.ts` traverses `CandidateNode` nodes written by candidate ingestion | **Very High** |
| `autoStageBuilder.ts` / `matchRepos.ts` consumed by candidate ingestion | High |

### Candidate → Role (upstream)

| Coupling Point | Strength |
|---|---|
| `orchestrate.ts` imports from `match/autoStageBuilder` and `repoDiscovery/matchRepos` | High |
| `orchestrate.ts` queries `role_contexts` and `repo_role_alignment` | High |

### Shared Neo4j Graph

Both sides write to the same Neo4j graph. `matchingQueries.ts` only works when **both** sides have been decomposed and written.

---

## 10. Manageability Verdict

| Dimension | Score | Notes |
|---|---|---|
| **Code volume** | 🔴 High | ~10.8K LOC across 38 files |
| **Cognitive load** | 🔴 High | RCD schema → 11 extractors → Neo4j → Cypher matching → hydration |
| **Graph query complexity** | 🔴 High | Single Cypher does everything; hard to debug, impossible to unit test |
| **Testability (extractors)** | 🟢 Good | `decomposeRcd` extractors are pure and tested |
| **Testability (matching)** | 🔴 Poor | Cypher matching tested only at shape level, not with real data |
| **Testability (synthesis)** | 🔴 Poor | `synthesizeRcd.ts` has zero tests |
| **Operational risk** | 🟡 Medium | Neo4j is external; fallback to D1 exists but degrades quality |
| **Refactorability** | 🟡 Medium | Clear extractor pattern; but RCD schema changes ripple everywhere |

### Recommended Actions

1. **Add integration tests for matching** — Seed Neo4j with test Role + Candidate nodes, run `matchCandidatesForRole`, assert ranking.
2. **Add tests for `synthesizeRcd.ts`** — Mock the provider and test retry logic, JSON parsing, verifier.
3. **Add tests for `consumerSlice.ts`** — Pure deterministic function; trivial to test.
4. **Consolidate embedding logic** — Merge `embedRole.ts` and `embed.ts` into a single `embedText()` utility.
5. **Extract shared scoring formula** — The `avg(sim) * log(1 + count)` pattern appears in candidate matching, repo matching, and potentially other places. Extract a shared Cypher fragment or query builder.
6. **Document the RCD schema contract** — Changes to `domain_matrix`, `dealbreakers`, `bars_overrides` break extractors, Neo4j writes, and scorer logic. The contract is implicit.
