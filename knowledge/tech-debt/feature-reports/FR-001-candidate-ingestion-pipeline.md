# Feature Report: Candidate Ingestion Pipeline

> Generated: 2026-05-18
> Scope: Resume upload → graph decomposition → embedding → matching → challenge assignment
> Overall Manageability: **C+** (Functional, high complexity, significant test gaps)

---

## 1. Overview

The candidate ingestion pipeline transforms raw candidate inputs (resume PDFs, culture interview transcripts, GitHub profiles) into structured, embedded graph nodes stored in Neo4j and D1. It then matches candidates against repos/roles and assigns code-review/code-implementation challenges.

This is the **core data pipeline** of the product. Every candidate touches it.

---

## 2. Complete Flow Trace

### Entry Points

| Entry Point | File | Function | Trigger |
|---|---|---|---|
| Recruiter resume upload | `routes/cockpit/candidates.ts` | `POST /:candidateId/resume` → `processResumeFromR2()` | Drag-and-drop in cockpit |
| Re-ingestion | `routes/cockpit/ingestion.ts` | `POST /:pipelineId/ingestion/:candidateId/reingest` | Recruiter clicks "Re-ingest" |
| Enrichment worker cron | `routes/cron/enrichmentWorker.ts` | `handleEnrichmentWorkerCron()` | Every 2 hours |
| Candidate INTAKE submission | `routes/rpc.ts` | `POST /rpc/submit-challenge-response` (INTAKE) | Candidate uploads resume |

### Main Pipeline — `runCandidateIngestion`

```
runCandidateIngestion(orchestrate.ts:66)
  ├── upsertPendingIngestion(persist.ts:35)
  ├── discoverCandidateProfile(agent.ts:136)              ← LLM call
  ├── persistCandidateProfile(persist.ts:72)
  ├── decomposeResumeToGraph(resumeDecomposition.ts:466)  ← AI embed + Neo4j write
  ├── embedAndUpsertCandidate(embed.ts:41)                ← aggregate vector
  └── runMatchAndAssign(orchestrate.ts:218)               ← repo match + assign
```

### Post-Interview Enrichment

```
runInterviewTerminationPipeline(cultureAgentPipeline.ts:666)
  ├── synthesizeCandidateProfile()              ← LLM → rich JSON
  ├── decomposeTranscript()                     ← LLM → typed nodes
  ├── persistDecomposedNodes()                  ← embed + Neo4j + coverage
  ├── runPostScreenerEnrichment()               ← mean-pool + mark enriched
  └── runMatchAndAssign(orchestrate.ts:218)     ← re-run matching
```

### GitHub Enrichment (Cron)

```
handleEnrichmentWorkerCron(enrichmentWorker.ts:22)
  ├── enrichCandidateFromGitHub(githubEnrich.ts:44)
  │   ├── GitHub REST + GraphQL
  │   ├── insertCandidateNode(candidateNodes.ts:6)
  │   └── embedCandidateNode(candidateNodes.ts:154)
  └── processResumeFromR2()  [for resume re-ingestion]
```

---

## 3. File Inventory & LOC

| File | LOC | Role | Tests? |
|---|---|---|---|
| `routes/rpc.ts` | 1,560 | Candidate-facing RPC (entry point) | ❌ No |
| `routes/cockpit/candidates.ts` | 1,267 | Recruiter CRUD + resume upload | ⚠️ Partial |
| `lib/cultureAgentPipeline.ts` | 715 | Post-screener enrichment | ✅ Yes |
| `lib/candidateDiscovery/resumeDecomposition.ts` | 685 | Resume → graph nodes | ⚠️ Moderate |
| `lib/candidateDiscovery/orchestrate.ts` | 752 | Main orchestrator | ❌ **No** |
| `lib/cvParser.ts` | 747 | PDF extraction + LLM parsing | ❌ **No** |
| `lib/enrichment/githubEnrich.ts` | 483 | GitHub → candidate nodes | ❌ **No** |
| `lib/match/autoStageBuilder.ts` | 406 | PR/issue picker | ❌ **No** |
| `routes/cockpit/ingestion.ts` | 386 | Ingestion status API | ⚠️ Partial |
| `lib/candidateDiscovery/persist.ts` | 361 | D1 state transitions | ❌ **No** |
| `lib/repoDiscovery/matchRepos.ts` | 347 | SQL repo matcher | ❌ **No** |
| `lib/neo4j/matchingQueries.ts` | 336 | Neo4j dealbreaker + repo matching | ✅ Yes |
| `lib/neo4j/writeCandidateGraph.ts` | 420 | Neo4j write batcher | ⚠️ Indirect |
| `lib/candidateDiscovery/attributeSkillTenure.ts` | 277 | D1 tenure attribution | — |
| `lib/candidateDiscovery/agent.ts` | 222 | Discovery LLM agent | ✅ Yes |
| `lib/candidateDiscovery/candidateNodes.ts` | 238 | Node CRUD + batch embed | ✅ Yes |
| `lib/candidateDiscovery/buildProfileSections.ts` | 167 | Frontend section builder | ✅ Yes |
| `lib/candidateDiscovery/embed.ts` | 159 | Profile embedding + Vectorize | ✅ Yes |
| `routes/cron/enrichmentWorker.ts` | 151 | Cron handler | ✅ Yes |
| `lib/enrichment/resumeIngestion.ts` | 108 | Shared resume→R2→pipeline helper | — |
| `lib/neo4j/candidateGraphQueries.ts` | 212 | Coverage + node reads | ✅ Yes |

**Total ingestion-critical LOC: ~7,087** across 21 files.

---

## 4. DB Tables Touched

### D1 (Cloudflare SQLite)

| Table | Reads | Writes | Notes |
|---|---|---|---|
| `candidates` | ✓ | ✓ | Resume key, skills, YoE |
| `candidate_ingestion` | ✓ | ✓ | State machine, embeddings, scores |
| `candidate_nodes` | ✓ | ✓ | Resume + GitHub + interview graph nodes |
| `candidate_profile_state` | | ✓ | overall_status='seed' |
| `candidate_challenge_assignment` | ✓ | ✓ | Repo/PR/issue assignments |
| `candidate_repo_matches` | ✓ | ✓ | Top-3 repo matches for UI |
| `enrichment_jobs` | ✓ | ✓ | Cron queue |
| `stages` | ✓ | | Placeholder challenge lookup |
| `challenges` | ✓ | | server_config, orgBenchmark |
| `pipelines` | ✓ | | Ownership |
| `pipeline_match_config` | ✓ | | match_philosophy |
| `role_contexts` | ✓ | | Embedding + alignment |
| `repo_role_alignment` | ✓ | | Top 20 aligned repos |
| `qualified_repos` | ✓ | | Repo catalog |
| `repo_sample_prs` | ✓ | | PR picking |
| `repo_issues` | ✓ | | Issue body cache |
| `issue_challenge_signals` | ✓ | | Difficulty scoring |
| `skill_aliases` | ✓ | | Skill canonicalization |
| `match_feedback` | | ✓ | Recruiter feedback |
| `assessments` | ✓ | ✓ | Challenge lifecycle |
| `challenge_submissions` | ✓ | ✓ | INTAKE payloads |

### Neo4j

- `:Candidate`, `:Experience`, `:Project`, `:Skill`, `:CulturalSignal`, `:WorkingStyle`, `:Motivation`, `:Context`, `:CareerArc`, `:Education`, `:Credential`
- Relationships: `(:Candidate)-[:HAS]->(:CandidateNode)`

---

## 5. External Services

| Service | Usage | Binding |
|---|---|---|
| **R2 (STORAGE)** | Resume PDF/DOCX storage | `env.STORAGE` |
| **Workers AI** | BGE embeddings, Whisper, Llama parsing | `env.AI` |
| **Vectorize** | Candidate + repo vector search (telemetry) | `env.CANDIDATE_INDEX`, `env.REPO_INDEX` |
| **Neo4j** | Primary graph store | `env.NEO4J_URI` |
| **GitHub REST/GraphQL** | Repo enumeration, PRs, issues | `env.GITHUB_TOKEN` |
| **LLM Provider** | Discovery, decomposition, synthesis | `createCandidateAgentProvider()` |
| **Resend** | Invitation emails | `env.RESEND_API_KEY` |
| **Calendly** | Scheduling URLs | OAuth in `scheduling_connections` |

---

## 6. Complexity Analysis

### State Machine

`candidate_ingestion.status` transitions:
```
pending → profile_generated → embedded → matched/failed
                    ↓
              enriching → enriched  (post-screener)
```

### Critical Branches

1. **Embedding path bifurcation** (`orchestrate.ts` lines 176-209):
   - Primary: `meanPoolVectors(decompositionEmbeddings)` → `upsertCandidateVector`
   - Fallback: `embedAndUpsertCandidate(prose profile)`
   - Decomposition failure is **non-blocking but silently changes strategy**.

2. **Neo4j fallback dance**: Every Neo4j read has try/catch → D1 fallback. Repeats in 4+ files.

3. **`runMatchAndAssign` role context logic** (lines 314-377): Loads role_contexts → repo_role_alignment → runs cosine + Vectorize queries even when `philosophy === 'validate'` (assignments skipped later, but queries still run — wasted work).

4. **Matching gate in `rpc.ts`** (`checkMatchingGate`): PRIMARY_MATCH_STORE env var branches between Neo4j and D1 with nested try/finally driver lifecycle.

---

## 7. Duplication & Dead Code

### Duplication

1. **Embed + D1 update logic** duplicated between `embedAndUpsertCandidate` and `upsertCandidateVector` — both update `candidate_ingestion` with identical SQL.
2. **Parser-only node construction** in `resumeDecomposition.ts` (lines 246-426) mirrors decomposition-path node building — two parallel code paths.
3. **Mean-pool embedding aggregation** in both `orchestrate.ts` and `cultureAgentPipeline.ts`.
4. **Location extraction from Context nodes** pattern appears in `orchestrate.ts` and likely elsewhere.

### Dead / Orphaned Code

1. **`upsertEnrichedVector`** in `cultureAgentPipeline.ts` is a **no-op** — logs "Skipped Vectorize upsert" and does nothing.
2. **Legacy Vectorize path** comments appear throughout, but `REPO_INDEX.query()` is still called for telemetry.
3. **`candidateSituationFit`**, `computeRecencyMultiplier` imports were removed but comments remain.
4. **`vectorize` parameter** in `ResumeDecompositionInput` is marked `@deprecated` but still present.
5. **`writeParserOnlyNodes`** uses D1 `insertCandidateNode` but the main path writes to Neo4j only. D1 may be stale for parser-only fallback.

---

## 8. Test Coverage

| File | Test File | Coverage |
|---|---|---|
| `agent.ts` | `__tests__/agent.test.ts` | ✅ Good |
| `embed.ts` | `__tests__/embed.test.ts` | ✅ Good |
| `resumeDecomposition.ts` | `__tests__/resumeDecomposition.test.ts` | ⚠️ Moderate (mocks out key deps) |
| `cultureAgentPipeline.ts` | `lib/__tests__/cultureAgentPipeline.test.ts` | ✅ Good |
| `candidateNodes.ts` | `__tests__/candidateNodes.test.ts` | ✅ Good |
| `candidateCoverage.test.ts` | `__tests__/candidateCoverage.test.ts` | ✅ Good |
| `orchestrate.ts` | **NONE** | ❌ **Critical gap — 752 LOC untested** |
| `persist.ts` | **NONE** | ❌ **Critical gap — 361 LOC untested** |
| `cvParser.ts` | **NONE** | ❌ **Critical gap — 747 LOC untested** |
| `githubEnrich.ts` | **NONE** | ❌ **483 LOC untested** |
| `autoStageBuilder.ts` | **NONE** | ❌ **406 LOC untested** |
| `matchRepos.ts` | **NONE** | ❌ **347 LOC untested** |

**Coverage verdict:** Unit tests exist for leaf utilities. The **orchestrator and backbone files have zero tests**. These 5 untested files form the backbone of the pipeline (~2,645 LOC).

---

## 9. Coupling Matrix

| Depends On | Coupling Point | Strength |
|---|---|---|
| Culture Interview | `cultureAgentPipeline.ts` triggers `runMatchAndAssign` | High |
| Role Discovery | `role_contexts`, `repo_role_alignment` queried for triangulation | High |
| Neo4j Graph | `writeCandidateGraph`, `computeCandidateCoverageWithFallback` | High |
| LLM Providers | `createCandidateAgentProvider`, `embedCandidateNode` | High |
| Repo Discovery | `matchRepos`, `pickReviewPr`, `pickImplementationIssue` | High |
| Vectorize | `CANDIDATE_INDEX`, `REPO_INDEX` (telemetry) | Low |

---

## 10. Manageability Verdict

| Dimension | Score | Notes |
|---|---|---|
| **Code volume** | ⚠️ High | ~7K LOC for ingestion alone |
| **Cognitive load** | 🔴 Very High | Bifurcated embedding paths, fallback dances, state machine |
| **Testability** | 🔴 Poor | Orchestrator untested; integration tests only via cron worker |
| **Operational risk** | 🔴 High | Background jobs, Neo4j writes, embedding failures all silent |
| **Refactorability** | 🟡 Medium | Clear module boundaries; but god-file orchestrator is a bottleneck |

### Recommended Actions

1. **Write tests for `orchestrate.ts`** — highest impact. Start with `runMatchAndAssign` (it has no side effects beyond D1 writes).
2. **Write tests for `persist.ts`** — SQL UPSERT/UPDATE paths are pure D1; easy to test with mock D1.
3. **Consolidate embedding paths** — remove the prose-profile fallback or make it explicit, not silent.
4. **Remove dead code** — `upsertEnrichedVector` no-op, deprecated `vectorize` param, orphaned comments.
5. **Extract `processResumeFromR2`** into a pure function + effect layer to make it testable.
