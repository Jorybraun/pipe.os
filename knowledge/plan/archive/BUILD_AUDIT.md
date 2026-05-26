SUPERSEDED_BY: commit 977e339af (2026-05-15) — Neo4j graph-native matching + culture FSM v2. This audit reflects state as of 2026-05-01. For current status, see `git log --oneline` and `workers/api/src/lib/neo4j/`.

# PIPE-OS Build Audit — Codebase vs. Plan

**Date:** 2026-05-01
**Auditor:** Kimi Code CLI (6 parallel explore agents)
**Scope:** All plan files in `knowledge/plan/strategy-v2/` + top-level plans + bugs
**Method:** Grep codebase for migrations, source files, routes, tests, package.json deps

---

## Executive Summary

| Part | Plans | BUILT | PARTIAL | MISSING |
|------|-------|-------|---------|---------|
| Part 1 — North Star / Phase 0 | 19 | 8 | 4 | 7 |
| Part 2 — Role Discovery | 14 | 7 | 2 | 5 |
| Part 3 — Repo Ingestion | 9 | 4 | 2 | 3 |
| Part 4 — Candidate Ingestion | 25 | 10 | 9 | 6 |
| Part 5 — Matching + Reliability + Observability | 19 | 1 | 3 | 15 |
| Part 6 — Market Research / Compliance | 9 | 1 | 2 | 6 |
| **TOTAL** | **95** | **31** | **22** | **42** |

**Key takeaway:** The app has a solid foundation (resume parsing, role discovery state machine, candidate graph decomposition, culture scoring, implementation scoring) but **major gaps in reliability, observability, matching maturity, and compliance**. 15 confirmed bugs are live in production.

---

## Part 1 — North Star / Phase 0

| Plan | Status | Evidence |
|------|--------|----------|
| pass3-confidence-threshold-auto-approval | ❌ MISSING | No `pass3_confidence` column, no threshold constant, no auto-approve flow |
| culture-question-bank-d1-sync | ❌ MISSING | `cultureQuestionBank.ts` is still static `CURATED_BANK` constant; no DB table |
| culture-reprompt-ungrounded-scores | ✅ BUILT | `cultureScorer.ts` lines 407-506; migration 0046; audit events emitted |
| rcd-consumer-cutover-remaining | ⚠️ PARTIAL | Cockpit routes use RCD primary; `discover.ts` still reads `persona.mustHaveSkills` directly |
| dealbreaker-gate-enforcement | ✅ BUILT | `dealbreakerGate.ts` with substring shim; wired to `candidates.ts` API |
| esco-skill-vocabulary | ❌ MISSING | Redirect to Part 6; zero ESCO references in code |
| hierarchical-summarization | ❌ MISSING | Deferred per plan; no implementation |
| leniency-metric | ❌ MISSING | Redirect to Part 6; no `leniencyMetric()` function |
| opentelemetry-gen-ai | ❌ MISSING | Redirect to Part 5; no `@microlabs/otel-cf-workers` dep |
| issue-body-prefetch | ✅ BUILT | Migration 0048; `routes/rpc.ts` surfaces `issueBody`; `issueScorer.ts` uses cache |
| quiz-short-answer-scorer | ❌ MISSING | Deferred per plan; current scoring is heuristic keyword-only |
| code-implementation-scorer | ✅ BUILT | Sherlock 4-dimension BARS scorer; graph decomposition; async HITL gate |
| reliability-patterns | ⚠️ PARTIAL | Retry exists in `provider.ts`/`githubClient.ts`; no circuit breaker, no idempotency, no DLQ |
| phase1-candidate-decomposition | ✅ BUILT | Full graph decomposition pipeline in `candidateDiscovery/` |
| phase2-role-repo-decomposition | ✅ BUILT | `decomposeRcd.ts`, `rcdSearchProfile.ts`, RCD schema fully defined |
| phase3-per-element-matching-rewrite | ❌ MISSING | `triangulateMatch.ts` still uses legacy triangulation, no per-element ANN |
| phase4-screener-uar-migration | ⚠️ PARTIAL | UAR runtime exists; culture plugin has TODO; still runs through bespoke route |
| phase5-neo4j-migration | ❌ MISSING | No Neo4j driver, no migrations, no dual-write |
| phase6-scoring-maturity | ⚠️ PARTIAL | QWK exists; Cohen's κ, Fleiss' κ, Leniency, golden set all missing |

---

## Part 2 — Role Discovery

| Plan | Status | Evidence |
|------|--------|----------|
| phase0-cockpit-rcd-cutover | ✅ BUILT | `agent.ts`, `repoDiscovery.ts`, `overview.ts` all use RCD primary, persona fallback |
| phase0-repodiscovery-rcd-cutover | ❌ MISSING | `discover.ts` still reads `persona.mustHaveSkills` directly; RCD only used for Vectorize recall |
| phase0-dealbreaker-gate-enforcement | 🔗 LINKED | Canonical in Part 5; see above |
| phase0-scorer-bars-anchor-audit | ❌ MISSING | Marked NEEDS-REFINEMENT; no BARS anchor consumption in scorer agents |
| phase0-delete-evaluator-files | ✅ BUILT | `evaluator.ts`, `evaluatorPrompt.ts`, `evaluateDiscovery.ts` all deleted |
| phase0-role-index-cutover | ✅ BUILT | `buildRcdSearchProfile` imported; `backfillRoleEmbeddings.ts` exists |
| phase2-rcd-decomposition | ✅ BUILT | `decomposeRcd.ts` with 11 node types; tests; wired to synthesis endpoints |
| phase2-role-nodes-migration | ✅ BUILT | Migration 0049 with exact schema, CHECK constraint, indexes |
| phase2-role-nodes-backfill | ✅ BUILT | `scripts/backfillRoleNodes.ts` with dry-run, batch, idempotency |
| phase4-uar-parity-and-cutover | ❌ MISSING | No `UAR_ROLE_DISCOVERY_ENABLED` flag; `roleAgent.ts` still exists (606 lines) |
| phase4-uar-plugin-port | ❌ MISSING | Plugin returns mock stub; `evalConfig.dimensions` have `model: undefined` |
| phase4-uar-shared-infra | ⚠️ PARTIAL | `D1SessionStore` implemented but `InMemorySessionStore` still used in `routes/agents.ts`; no Clerk JWT auth |
| phase4-uar-synthesis-hook | ❌ MISSING | `AgentPlugin` interface has no `onSessionComplete`; no synthesis hook in FSM |
| link-phase0-autostagebuilder-rcd-cutover | ✅ BUILT | `autoStageBuilder.ts` reads RCD primary via `parseRcd()` |
| **role-discovery-state-machine.md** | | |
| ├─ Step 1: Extract reducer | ✅ BUILT | `interviewReducer.ts` pure function |
| ├─ Step 2: Extract question generator | ✅ BUILT | `generateQuestionBatch.ts` |
| ├─ Step 3: Extract synthesis generator | ✅ BUILT | `synthesize.ts` |
| ├─ Step 4: Wire eval gate | ✅ BUILT | `evaluateQuestion.ts` |
| ├─ Step 5: Backend endpoints | ✅ BUILT | `/state`, `/question`, `/synthesize` in `roleContexts.ts` |
| ├─ Step 6: Frontend update | ✅ BUILT | `useRoleDiscovery.ts` calls new endpoints; phase/coverage displayed |
| └─ Step 7: Delete legacy | ❌ NOT DONE | `roleAgent.ts` (606 lines) and `roleAgentPrompts.ts` still exist |

---

## Part 3 — Repo Ingestion

| Plan | Status | Evidence |
|------|--------|----------|
| repo-decomposition-schema | ✅ BUILT | Migration 0050 `repo_nodes`; pass3 prompt with sub-elements; persist + backfill scripts |
| pr-narrative-enrichment | ✅ BUILT | Migration 0051; `prNarrative.ts`; semantic PR selection in `autoStageBuilder.ts` |
| issue-body-prefetch | ✅ BUILT | Migration 0048; `issueCrawler.ts` caches body; `issueScorer.ts` + `rpc.ts` consume it |
| issue-gemma-narratives | ❌ MISSING | Deferred to Phase 2+; no code |
| per-candidate-pr-override-ui | ⚠️ PARTIAL | `github_pr_number` column flows through API; **no recruiter UI** |
| dispositional-weights-to-scorer | ⚠️ PARTIAL | `BarsOverride` type exists in schema; **not wired to scorer** |
| confidence-threshold-auto-approval | ❌ MISSING | Zero implementation — no migration, no scorer, no admin queue API |
| code-implementation-scorer-sherlock | ✅ BUILT | Full Sherlock scorer; 4 dimensions; graph decomposition; HITL gate |
| skill-adjacency-table | ❌ MISSING | No table, no query rewrite, no feature flag |

---

## Part 4 — Candidate Ingestion

| Plan | Status | Evidence |
|------|--------|----------|
| candidate-nodes-schema | ✅ BUILT | Migration 0052; full CRUD in `candidateNodes.ts`; tests |
| candidate-decomposition-prompt | ✅ BUILT | `candidateDecompositionPrompt.ts`; `resumeDecomposition.ts`; wired to orchestrator |
| candidate-sub-element-embedding | ⚠️ PARTIAL | `embedCandidateNode()` exists; no batch helper; `supersedeCandidateNode()` doesn't update Vectorize metadata |
| candidate-backfill-decomposition | ⚠️ PARTIAL | Library function exists; **no CLI script**; no `--candidate-id` single mode |
| candidate-matching-sub-elements | ⚠️ PARTIAL | Nodes passed to `candidateSituationFit()`; **no sub-element ANN pass** in `matchReposForCandidate` |
| loose-match-evidence-density | ⚠️ PARTIAL | Density multiplier in `triangulateMatch.ts`; formula differs from plan (`0.5+0.5x` vs `0.7+0.3x`) |
| living-graph-provenance-tagging | ❌ MISSING | `source_type` is TEXT not typed union; no `SOURCE_CONFIDENCE_DEFAULTS`; no `getNodesBySource()` |
| living-graph-supersedes-schema | ⚠️ PARTIAL | `supersedeCandidateNode()` atomic batch exists; missing chain walker, point-in-time query, drift diff |
| living-graph-temporal-queries | ⚠️ PARTIAL | `candidateRecency.ts` has recency + re-engagement + trajectory; **no HTTP route** exposes them |
| candidate-profile-state-schema | ⚠️ PARTIAL | Migration 0058 exists; schema differs significantly from plan (enum values, TEXT vs INTEGER version) |
| candidate-profile-view | ❌ MISSING | No candidate-facing portal; no `GET /rpc/candidate/profile`; no correction endpoint |
| profile-probe-bank | ❌ MISSING | No table, no migration, no admin API; screener uses static `cultureQuestionBank.ts` |
| screener-coverage-computation | ✅ BUILT | `candidateCoverage.ts` with all 5 dimensions; tests; tie-break order correct |
| screener-mode-generalization | ⚠️ PARTIAL | `cultureAgentAdaptive.ts` supports 2 modes; no `ScreenerConfig` type; static bank not probe-bank backed |
| screener-answer-decomposition | ⚠️ PARTIAL | `cultureAgentDecomposition.ts` full implementation; **`persistDecomposition()` is a stub** — doesn't write to DB |
| screener-recruiter-ui | ❌ MISSING | No invite-screening endpoint; no screening status column; no UI button |
| code-review-graph-decomposition | ✅ BUILT | `decomposeCodeReview.ts`; 6 `TechnicalDemonstration` nodes; backfill script; tests |
| implementation-scorer | ✅ BUILT | Sherlock scorer; graph decomposition; async HITL; `routes/rpc.ts` wiring |
| culture-interview-graph-decomposition | ✅ BUILT | `decomposeCultureScore.ts`; 10 `CulturalSignal` nodes; mode-1 + mode-2 support |
| adaptive-culture-interview-agent | ✅ BUILT | `cultureAgentAdaptive.ts`; FSM; generative planner; anti-fatigue; compliance audit; E2E tests |
| github-enrichment-worker | ✅ BUILT | `enrichmentWorker.ts` cron; `githubClient.ts`; `githubEnrich.ts` v2; tests |
| github-enrichment-intake | ✅ BUILT | `github_url`/`linkedin_url` columns; `IntakeChallenge.tsx`; queues enrichment job |
| uar-culture-plugin-reconciliation | ⚠️ PARTIAL | Plugin has 10 live dimensions; missing ADR and `ProfileBuilderPlugin` interface stub |
| gdpr-deletion-ux | ❌ MISSING | No `deletion_requests` table; no `eraseCandidate()`; no privacy page |
| candidate-intake-challenge | ✅ BUILT | Migration 0062; `IntakeChallenge.tsx`; `ChallengeRegistry.tsx`; INTAKE bypass; queues ingestion |

---

## Part 5 — Matching + Reliability + Observability

| Plan | Status | Evidence |
|------|--------|----------|
| per-element-matching-algorithm | ❌ MISSING | No `shortlist.ts`, `evidenceGather.ts`, `dimensionAggregator.ts`; matching is single-vector ANN |
| match-reports-schema | ❌ MISSING | No `match_reports` table; match data inline in `candidate_ingestion` |
| triangulation-summary-layer | ⚠️ PARTIAL | `triangulateMatch.ts` exists with vector weights; no `MatchReport` input adapter; no `match_feedback` dimension columns |
| dealbreaker-gate-enforcement | ✅ BUILT | Pre-Neo4j substring shim; tests; wired to API response |
| skill-adjacency-table | ❌ MISSING | No table; `matchRepos.ts` still exact-match `HAVING must_hits = must_total` |
| reliability-retry-and-error-classification | ⚠️ PARTIAL | `retryHelper.ts` + tests exist; **not integrated** at `embed.ts`, `candidateSituationFit.ts`, `embedRole.ts` call sites |
| reliability-circuit-breakers | ❌ MISSING | No `circuit_breaker_state` table; `opossum` not in package.json; no custom breaker |
| reliability-idempotency-and-partial-materialization | ❌ MISSING | No `ingestion_idempotency_keys` table; re-ingest has no `Idempotency-Key`; no resume-from-step |
| reliability-heartbeats-and-stale-detection | ❌ MISSING | No `heartbeat_at` column; no stale-run scanner cron |
| reliability-dead-letter-queue | ❌ MISSING | No `ingestion_failures` table; no Queue bindings; no DLQ producer/consumer |
| observability-opentelemetry | ❌ MISSING | No `@microlabs/otel-cf-workers`; no spans; no OTLP endpoint |
| observability-recruiter-status | ⚠️ PARTIAL | SSE endpoint exists (`ingestionStatus.ts`); **missing structured columns** (`current_step`, `estimated_completion_at`, etc.); no `stepDurationTracker.ts` |
| neo4j-vps-provisioning | ❌ MISSING | No `infra/neo4j/` directory |
| neo4j-driver-and-binding | ❌ MISSING | No `neo4j-driver` in package.json |
| neo4j-schema-and-constraints | ❌ MISSING | No Cypher files |
| neo4j-dual-write-ingestion | ❌ MISSING | No `writeCandidateGraph.ts`; no `DUAL_WRITE_NEO4J` flag |
| neo4j-validation-parity | ❌ MISSING | No `parity.test.ts`; no shadow-read |
| neo4j-matching-cutover | ❌ MISSING | No `matchingQueries.ts`; no `shadowRead.ts` |
| neo4j-retirement-plan | ❌ MISSING | No `schema_deprecations` table |

---

## Part 6 — Market Research / Compliance

| Plan | Status | Evidence |
|------|--------|----------|
| codesignal-phased-calibration | ❌ MISSING | No `rubric_maturity` table; no calibration lifecycle |
| esco-skill-id-field | ❌ MISSING | No `esco_id` column; no ESCO references in prompts |
| kappa-calibration-study | ⚠️ PARTIAL | `quadraticWeightedKappa()` exists in `cultureScorerCalibration.ts`; Cohen's κ, Leniency, runner all missing |
| learning-to-rank-data-collection | ⚠️ PARTIAL | `match_feedback` table exists with vector signals; missing `rank_position`, `list_size`, `pairwise_preferences` |
| disparate-impact-monitoring | ❌ MISSING | No `candidate_protected_attributes` table; no `disparateImpact.ts`; no `DiversityOptIn.tsx` |
| candidate-ai-disclosure-ux | ❌ MISSING | No `AiUseDisclosure.tsx`; no `ai_disclosure_*` audit events |
| gdpr-subject-rights | ❌ MISSING | No data-export endpoint; no erasure endpoint; no candidate privacy page |
| gdpr-article-22-ui | ❌ MISSING | No `AutomatedDecisionDisclosure.tsx`; no `decision_contests` table |
| code-implementation-scorer-bars | ✅ BUILT | Canonical in Part 4; Sherlock BARS 1-5 fully implemented |

---

## Confirmed Bugs (from `bugs.md`)

| ID | Severity | Bug | Root Cause |
|----|----------|-----|------------|
| H1 | 🔴 HIGH | Cosine score missing in UI | `wrangler dev` remote proxy fails → `env.AI` unavailable → ingestion stuck `pending` |
| H2 | 🔴 HIGH | ALL pipelines show `—` for AVG SCORE | Same as H1 — systemic score calculation blocked |
| H3 | 🔴 HIGH | `GET /api/v1/candidates/:id` returns `ingestion: null` | LEFT JOIN bug at `candidates.ts` ~L556 |
| H4 | 🔴 HIGH | XSS payload accepted in candidate name | No sanitization on `name` field |
| H5 | 🔴 HIGH | Duplicate candidate emails in same pipeline | No unique constraint on `(pipeline_id, email)` |
| M1 | 🟡 MEDIUM | INTELLIGENCE tab unresponsive | Missing route handler or conditional render gate |
| M2 | 🟡 MEDIUM | Ingestion silently fails when AI down | `createCandidateAgentProvider` returns null → early return, no error |
| M3 | 🟡 MEDIUM | DOCX uploads to R2 but not parsed | `parseResume` returns null for non-PDF; skipped silently |
| M4 | 🟡 MEDIUM | Browser tab crashes to black after navigation | Possible React Router issue or memory leak |
| M5 | 🟡 MEDIUM | Direct `/cockpit/pipelines/:id` redirects to dashboard | Pipeline detail is modal/overlay, not standalone route |
| M6 | 🟡 MEDIUM | Filter panel not keyboard/screen-reader accessible | StaticText nodes with no role/ref |
| M7 | 🟡 MEDIUM | Pipeline actions menu only shows DELETE | Missing View, Edit options |
| M8 | 🟡 MEDIUM | `DELETE /api/v1/candidates/:id` returns `INTERNAL_ERROR` | Endpoint broken |
| M9 | 🟡 MEDIUM | No 404 page — all unknown routes redirect to `/` | Catch-all handler redirects |
| L1 | 🟢 LOW | Timeline shows "SUBMITTED → PENDING" for invited candidates | Origin label incorrect |
| L2 | 🟢 LOW | Overall Signal shows "MAYBE" with no numeric score | Missing tooltip/fallback |
| L3 | 🟢 LOW | Shared dev environment has data pollution | No test isolation |
| L4 | 🟢 LOW | "KEEP_PLAYING" toggle has unclear purpose | Ambiguous UI copy |

---

## What's Actually Working Well

- ✅ Resume upload and PDF parsing
- ✅ API error handling with clear codes
- ✅ File upload validation (type, size)
- ✅ Dashboard search and filtering
- ✅ Settings panel (DISPLAY + INTEGRATIONS)
- ✅ New Role wizard (AI conversational flow, 15 questions, resume session)
- ✅ All sidebar navigation pages render correctly
- ✅ Repo Catalog (2,250 repos with curation UI)
- ✅ AI Usage tracking (correctly logs failed sessions)
- ✅ Role discovery state machine (reducer + generator + synthesis)
- ✅ Candidate graph decomposition (Experience, Skill, Project, CareerArc, CulturalSignal nodes)
- ✅ Culture adaptive interview (FSM, generative planner, compliance audit)
- ✅ Implementation scorer (Sherlock 4-dimension BARS, graph decomposition, HITL)
- ✅ GitHub enrichment worker (cron, pagination, contribution calendar)

---

## Critical Gaps (Blocking Production Hardiness)

1. **Reliability layer incomplete** — retry helper exists but isn't wired; no circuit breaker, idempotency, heartbeats, or DLQ
2. **Observability incomplete** — SSE endpoint exists but lacks structured status columns, step tracker, p50 duration, estimated completion
3. **Score system dead in local dev** — `wrangler dev` remote proxy failure blocks all AI/Vectorize → all scores show `—`
4. **No match reports** — match data is inline JSON blobs, not queryable structured reports
5. **No per-element matching** — single-vector ANN, no evidence gathering per requirement
6. **No GDPR/compliance** — zero GDPR infrastructure, no AI disclosure, no protected attributes
7. **Legacy code not deleted** — `roleAgent.ts` (606 lines) and `roleAgentPrompts.ts` still exist despite new architecture
8. **Screener answer decomposition not persisted** — `persistDecomposition()` is a stub despite table existing

---

*End of audit. 95 plans reviewed across 6 strategic domains + 15 confirmed bugs.*
