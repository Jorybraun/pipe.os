# Phase 2 Handoff — Mode-1 Probe Bank

**Agent:** probe-bank-agent (Phase 2 of culture-agent-redesign)  
**Date:** 2026-05-02  
**Status:** COMPLETE — committed

---

## What shipped

### 1. `profile_probe_bank` table (migration 0069)
- Schema: id, dimension, text, expected_slots, max_probes, probe_library_json, tags, sort_order
- Indexed by dimension and sort_order
- Seed data lives in code; DB table for dynamic curation without deployments

### 2. `profileProbeBank.ts` — 18 curated role-agnostic probes
- 6 dimensions × 3 probes each:
  - `career_history` — chronological walkthrough, responsibility jumps, recent role focus
  - `behavioral_depth` — autonomy, failure, influence
  - `cultural` — ownership, collaboration, learning
  - `technical` — complexity, debugging, opinion change
  - `motivation` — priorities, fit, intrinsic drive
  - `context` — location/remote, availability, company stage
- `pickNextProfileProbe()` — coverage-driven selector (inverse coverage scoring)
- `emptyProfileCoverage()` — initializes all 6 dimensions to 0

### 3. `cultureAgent.ts` — dual-mode FSM
- `startCultureInterview` branches on `mode`: profile_builder uses probe bank, role_fit uses competency bank
- `advanceCultureInterview` delegates to:
  - `advanceProfileBuilderInterview` — uses profile probes, profile dimensions for coverage, profile probe selector
  - `advanceRoleFitInterview` — existing logic, unchanged
- `evaluateProfileBuilderTermination` — terminates when all 6 profile dimensions have ≥1 coverage
- Transcript `dimensionCoverage` relaxed to `Record<string, number>` to hold both competency and profile dimensions

### 4. `cultureAgentAdaptive.ts` — generative planner bypass
- `startAdaptiveCultureInterview` skips generative planner when `mode === 'profile_builder'`
- `advanceAdaptiveCultureInterview` delegates to static path for profile_builder
- Rationale per plan: "No generative planner for Mode-1 (too risky for a blocking gate)"

### 5. Tests
- `profileProbeBank.test.ts` — 11 tests: seed bank integrity, selector coverage bias, exhausted bank
- `cultureAgent.test.ts` — 7 tests: start/advance/terminate for both profile_builder and role_fit modes

## Build & test status
- TypeScript: clean (1 pre-existing error in roleDiscovery/prompts.ts)
- Tests: 954 passed | 1 skipped | +18 new tests (2 pre-existing failures in retryHelper.test.ts)

## Integration with prior phases
- Phase 0 (gate): `get-stage-config` already returns `WAITING_FOR_MATCH` for profile_builder candidates
- Phase 1 (pipeline): `runInterviewTerminationPipeline` already runs synthesis + decomposition + enrichment + matching
- Phase 2 (this work): The screener now uses profile probes in profile_builder mode, producing richer signal for the pipeline

## Next work (Phase 3 — FSM-agent)
Per the master plan, Phase 3 is the discovery-agent pattern port:
- Heuristic answer evaluator (`answerEvaluator.ts` pattern) replacing per-turn LLM STAR analysis
- Guard retry loop replacing JSON.parse + mock fallback
- Reducer + phase directive replacing imperative FSM
- Deleting `cultureAgentAdaptive.ts` (70% duplicated code)

## Ambiguities resolved
- **NYC Local Law 144 compliance:** Engineering-curated seed bank is acceptable pre-revenue. Recruiter review before first customer. Noted in INDEX.md.
