# Feature Report: Culture Interview System

> Generated: 2026-05-18
> Scope: Culture interview FSM engine, scoring pipeline, post-termination enrichment
> Overall Manageability: **C+** (Well-tested pure functions, but bridge duplication and operational risk are high)

---

## 1. Overview

The culture interview system conducts AI-led culture fit interviews with candidates, scores them against org benchmarks using BARS rubrics, and decomposes results into graph nodes for matching. It supports two modes: `profile_builder` (general background) and `role_fit` (dimension-specific scoring).

---

## 2. Complete Flow Trace

### Entry Points

| Router | File | Auth | Endpoints |
|---|---|---|---|
| **Bridge** | `routes/assessment/agentInterview.ts` (625 LOC) | Candidate JWT | `/rpc/agent-interview/:challengeId/start\|respond\|complete` |
| **Native** | `routes/screening/culture.ts` (1,123 LOC) | Candidate JWT / Clerk JWT | `/rpc/culture/session/:token/*` + `/api/v1/screening/culture/*` |

### FSM Engine — `cultureAgent.ts` (688 lines)

```
startCultureInterview({ mode, seniority, roleOverlayId, probeBank })
  → builds fresh transcript → picks first question → returns { transcript, nextQuestion }

advanceCultureInterview({ provider, transcript, candidateAnswer, maxQuestions, minQuestions, ... })
  → reconstruct v2 state from transcript
  → runTurnAnalysis()                          ← LLM call (STAR slots, probe_needed, acknowledgment)
  → cultureInterviewReducer()                  ← pure: ANSWER or DRILL_ANSWER
  → evaluateCoverageTermination()              ← hard_cap or coverage_complete?
  → pickNextQuestion()                         ← coverage-gap × overlayWeight + bonuses
  → return { action: 'next'|'probe'|'terminate', transcript, ... }
```

### Scoring Pipeline — `cultureScorer.ts` (1,086 lines)

```
scoreCultureInterview({ provider, transcript, orgBenchmark, teamContext })
  → Promise.all([
      scoreCompetencyDimensionWithReprompt() × 5,   ← BARS rubric + 3-shot + reprompt guard
      scoreCultureProfileDimensionWithReprompt() × 5 ← position descriptors + benchmark
    ])
  → synthesizeReport()                              ← headline + narrative + recommendation
  → evaluateDealbreakers()                          ← RCD pattern scan → HITL flags
  → CultureScoreReport
```

### Post-Termination — `cultureAgentPipeline.ts` (715 lines)

```
runInterviewTerminationPipeline({ env, db, candidateId, transcript, mode, provider })
  → Promise.all([
      synthesizeCandidateProfile(provider, transcript),   ← rich structured profile
      decomposeTranscript(provider, transcript)           ← typed nodes (Experience/Skill/...)
    ])
  → persistDecomposedNodes()                             ← embed + writeCandidateGraph + coverage
  → runPostScreenerEnrichment()                          ← mean-pool + mark enriched
  → runMatchAndAssign()                                  ← re-run matching
```

### Score Graph Decomposition — `decomposeCultureScore.ts` (149 lines)

```
decomposeCultureScoreToGraph({ db, env, session, scoreReport })
  → for each of 10 dimensions:
      buildNarrative(evidenceQuotes, reasoning)
      embedCandidateNode(narrative)
      insertCandidateNode(db)  ← CulturalSignal node
  → computeCandidateCoverageWithFallback()
```

---

## 3. File Inventory & LOC

| File | LOC | Role | Tests? |
|---|---|---|---|
| `routes/screening/culture.ts` | 1,123 | Native routes + scoring job + recruiter review | ✅ Yes |
| `lib/cultureScorer.ts` | 1,086 | 11-call BARS scoring pipeline | ✅ Yes (fixtures) |
| `lib/cultureAgent.ts` | 688 | FSM engine (start, advance, turn analysis) | ✅ Yes |
| `lib/cultureAgentPipeline.ts` | 715 | Post-termination enrichment | ✅ Yes |
| `lib/cultureQuestionBank.ts` | 505 | 15 hand-authored questions + selector | ✅ Yes |
| `routes/assessment/agentInterview.ts` | 625 | Bridge router (adapter translation) | ⚠️ Partial |
| `lib/profileProbeBank.ts` | 377 | 18 profile-builder probes | ✅ Yes |
| `lib/cultureInterviewReducer.ts` | 164 | Pure reducer (START/ANSWER/DRILL/ADVANCE_PHASE/SCORE_COMPLETE) | ✅ Yes |
| `lib/cultureProbeBank.ts` | 162 | RCD-enriched probe loader | — |
| `lib/cultureRoleResolution.ts` | 211 | assessment_id → role_context chain | — |
| `lib/cultureRoleOverlay.ts` | 91 | 3 overlays (senior-ic, manager, universal) | ✅ Yes |
| `lib/decomposeCultureScore.ts` | 149 | Score → CulturalSignal nodes | ✅ Yes |
| `lib/cultureAgentContext.ts` | ~120 | Context assembly for LLM prompts | — |
| `lib/culturePhaseDirective.ts` | ~80 | Phase transition rules | ✅ Yes |

**Total culture system LOC: ~12,500 production + ~4,956 unit tests + ~1,735 E2E = ~19,191 total.**

---

## 4. DB Tables Touched

| Table | Purpose |
|---|---|
| `culture_interview_sessions` | Ground truth session state |
| `culture_compliance_audit` | Consent, completion, scorer_reprompt, review events |
| `culture_ai_usage_events` | Cost tracking per session/feature |
| `challenges` | `server_config` holds `orgBenchmark`, `screenerMode` |
| `assessments` | Links candidate → stage → pipeline |
| `stages` | Pipeline stage lookup |
| `pipelines` | Ownership checks |
| `role_contexts` | RCD JSON, persona, bars_overrides, dealbreakers |
| `role_probe_bank` | RCD-enriched probes per role |
| `candidate_ingestion` | Structured background, profile JSON |
| `candidates` | Fallback skills/current_role |
| `candidate_nodes` | Decomposed graph nodes (post-termination + score) |
| `candidate_coverage` | Per-candidate coverage tracking |

---

## 5. External Services

| Service | Usage |
|---|---|
| **Cloudflare Workers AI** | LLM inference (Gemma via `createCultureAgentProvider`) + embeddings (BGE) |
| **Neo4j** | `writeCandidateGraph`, `computeCandidateCoverageWithFallback` |
| **Cloudflare Vectorize** | `CANDIDATE_INDEX` upsert — currently skipped (read-only archive) |

---

## 6. Complexity Analysis

### State Surface

A culture interview session carries:
- D1 row state (`consent` → `in_progress` → `scoring` → `complete`)
- Transcript JSON (turns with questionText, candidateResponse, videoR2Key, probeOf)
- Coverage state (per-dimension STAR slot coverage)
- Phase history (`rapport_building` → `probing` → `drilling` → `wrap_up`)
- Drill state (current drill target, attempts)
- Scratchpad (running themes, question metadata)

### LLM Call Density

| Phase | Calls | Notes |
|---|---|---|
| Per turn | 1 | `runTurnAnalysis` — STAR slots, probe decision, acknowledgment |
| Scoring | 10 (parallel) | 5 competency + 5 profile dimensions |
| Scoring reprompts | 0-10 | If evidenceQuotes empty and score ≠ neutral |
| Synthesis | 1 | Headline + narrative + recommendation |
| Post-termination | 2 (parallel) | Profile synthesis + transcript decomposition |
| **Max per interview** | **~15-25 LLM calls** | |

### Critical Branches

1. **Mode split**: `profile_builder` vs `role_fit` branches exist in start, advance, probe selection, scoring (RCD context), and post-termination decomposition. Six distinct branching points.
2. **Provider null path**: Every LLM call has a null-provider fallback (`mockTurnResponse`, `mockScoreReport`). Used in tests and when `MOCK_AI=true`.
3. **Reprompt guard**: If `evidenceQuotes.length === 0 && score !== 3`, re-prompt once. This adds non-determinism to call count.
4. **Termination conditions**: `hard_cap` (maxQuestions) OR `coverage_complete` (minQuestions + coverage). Race between two gates.

---

## 7. Duplication & Dead Code

### Critical Duplication: Bridge Pattern

`agentInterview.ts` and `culture.ts` share **~80% identical logic**:

| Concern | Duplicated In |
|---|---|
| `parseJsonColumn<T>()` | Both files (identical) |
| `now()` | Both files (identical) |
| `CultureSessionRow` interface | Both files (90% overlap) |
| Role context + probe bank resolution | Appears **4 times** across both files |
| Provider creation + metering | Appears **5+ times** |
| `advanceCultureInterview` call | Identical invocation |
| Termination handling | Sets `scoring`, fires `runScoringJob` |

**Risk:** Every bug fix or feature addition must be applied in two places. Drift is non-trivial.

### Other Duplication

1. `buildTranscriptFromCulture`, `countTurnsAsked`, `getCurrentQuestion` helpers duplicated between routes.
2. `toQuestionTurnResult` / `toSynthesisResult` in `agentInterview.ts` are thin wrappers around the same data `culture.ts` returns raw.

---

## 8. Test Coverage

### Unit Tests (~4,956 lines)

| Test File | Lines | Coverage |
|---|---|---|
| `cultureAgent.test.ts` | 231 | Start/advance both modes, termination |
| `culture.rest.test.ts` | 481 | Mock path, probe budget, termination, score shapes |
| `cultureAgentPipeline.test.ts` | 429 | Synthesis, decomposition, full pipeline |
| `decomposeCultureScore.test.ts` | 308 | 10-node insertion, role flags, properties |
| `cultureInterviewReducer.test.ts` | 210 | All 7 reducer actions |
| `cultureInterviewState.test.ts` | 273 | Reconstruct/serialize, coverage, pending turn |
| `culturePhaseDirective.test.ts` | 169 | Phase transitions |
| `cultureGenerativePlanner.test.ts` | 228 | Prompt builders, parser, null provider |
| `profileProbeBank.test.ts` | 97 | Selector, coverage-driven picking |
| `candidateCoverage.test.ts` | 337 | STAR depth scoring, termination, gap ranking |
| `culturePhase2.test.ts` | 511 | Phase 2 integration |
| `scorerDispositional.test.ts` | 192 | Weight application |
| `probeLibrarian.test.ts` | 137 | Probe librarian agent |
| `cultureScorerCalibration.fixtures.ts` | 441 | Calibration data |

### E2E Tests (~1,735 lines)

| Spec | Coverage |
|---|---|
| `culture-linear-flow.spec.ts` | Basic start→respond→complete |
| `culture-coverage-termination.spec.ts` | Coverage-driven termination |
| `culture-probe-budget.spec.ts` | Probe exhaustion |
| `culture-consent-gate.spec.ts` | Consent flow |
| `culture-adaptive-generative.spec.ts` | Generative question mode |
| `culture-recruiter-report.spec.ts` | Recruiter report access |

### Coverage Gaps

- **Real LLM provider path untested** — all tests use null provider or mocks.
- **`cultureAgentDecomposition.ts`** (per-answer decomposition) — no dedicated tests.
- **`cultureAgentContext.ts`** — no dedicated tests.
- **Calibration route** (`POST /calibration/run`) — no route-level tests.
- **Cost dashboard** — untested.
- **Dealbreaker evaluation** with real patterns — only mock-tested.

---

## 9. Coupling Matrix

| Depends On | Coupling Point | Strength |
|---|---|---|
| Neo4j Graph | `writeCandidateGraph`, `computeCandidateCoverageWithFallback` | High |
| Candidate Ingestion | `runMatchAndAssign`, `loadDiscoveryResultFromDb` | High |
| Role Context (RCD) | `resolveCultureRoleContext`, BARS overrides, dealbreakers | **Very High** |
| Embedding System | `embedCandidateNode`, BGE model | High |
| LLM Provider Factory | `createCultureAgentProvider`, `withCultureMetering` | High |
| Assessments / Stages | Ownership checks, challenge config, assessment lookup | Medium |
| Candidate Ingestion | `candidate_ingestion` JSON blobs read by context | Medium |
| Challenges | `server_config` holds `orgBenchmark`, `screenerMode` | Medium |

---

## 10. Manageability Verdict

| Dimension | Score | Notes |
|---|---|---|
| **Code volume** | 🔴 Very High | ~12.5K production LOC |
| **Cognitive load** | 🔴 Very High | V1/V2 transcript duality, bridge duplication, 11-call scoring |
| **LLM call density** | 🔴 Very High | Up to 25 calls per interview |
| **State surface** | 🔴 High | D1 row + transcript JSON + coverage + phase + drill |
| **Testability (pure)** | 🟢 Good | Reducers, selectors, coverage are well-tested pure functions |
| **Testability (HTTP)** | 🔴 Poor | Bridge file untested; native route tests mock everything |
| **Operational risk** | 🔴 High | Background jobs, Neo4j writes, embedding failures silent |
| **Refactor target** | 🟡 Easy win | Extract `SessionService`, `ProviderFactory`, `TranscriptHelpers` from bridge |

### Recommended Actions

1. **Eliminate bridge duplication** — Merge `agentInterview.ts` into `culture.ts` or extract a shared `CultureSessionService` module.
2. **Add real-provider integration tests** — Run a minimal interview end-to-end against a real (or local) LLM in CI.
3. **Add tests for `cultureAgentContext.ts`** — Context assembly is complex and untested.
4. **Add route tests for calibration + cost dashboard** — Low-hanging fruit.
5. **Instrument provider call count** — Add telemetry to track actual calls per interview and alert on anomalies.
