# Handoff Report: pipeline-agent

**Owner:** pipeline-agent  
**Status:** COMPLETE  
**Date:** 2026-05-02  
**Plan document:** `implementation/decomposition-pipeline.md`

---

## What was built

### 1. `cultureAgentPipeline.ts` — Dual-output termination pipeline
**File:** `workers/api/src/lib/cultureAgentPipeline.ts`

Core module implementing the dual-output architecture. Fired when a culture interview terminates, running inside `ctx.waitUntil()`.

**Outputs:**
- **Call 1: `synthesizeCandidateProfile()`** — single LLM call reads the full transcript and produces a rich `CandidateProfile` JSON (career timeline, skills inventory, project portfolio, working style, motivation, behavioral evidence). Persists to `candidate_ingestion.candidate_profile_json`.
- **Call 2: `decomposeTranscript()`** — single LLM call reads the full transcript and extracts typed nodes (Experience, Project, Skill, CulturalSignal, WorkingStyle, Motivation) for insertion into `candidate_nodes`.

**Post-screener enrichment:**
- `runPostScreenerEnrichment()` — marks candidate as `enriching`, computes enriched embedding via mean-pool of all active `candidate_nodes`, upserts to `CANDIDATE_INDEX` with `aggregate_source: 'enriched_mean_pool'`, marks candidate as `enriched` with `enriched_embedding_json` and `candidate_profile_json`.

**Matching trigger:**
- `loadDiscoveryResultFromDb()` reconstructs `CandidateDiscoveryResult` from the D1 row
- `runMatchAndAssign()` is called with the reloaded discovery result to run the full match pipeline

**Orchestrator:**
- `runInterviewTerminationPipeline()` runs synthesis + decomposition in parallel, then persists nodes, runs enrichment, and triggers matching. Never throws — all errors caught and logged.

### 2. `orchestrate.ts` — Exported matching + discovery reloader
**File:** `workers/api/src/lib/candidateDiscovery/orchestrate.ts`

- `runMatchAndAssign` changed from `async function` to `export async function`
- `MatchAndAssignInput` changed from `interface` to `export interface`
- Added `loadDiscoveryResultFromDb()` — reconstructs `CandidateDiscoveryResult` from `candidate_ingestion` row with safe JSON parsing and fallbacks

### 3. `culture.ts` — Wired pipeline at termination, removed per-turn decomposition
**File:** `workers/api/src/routes/screening/culture.ts`

- **Removed:** Per-turn `decomposeCandidateAnswer()` + `persistDecomposition()` calls (lines ~983–1025). This saves ~15 LLM calls per interview.
- **Added:** `runInterviewTerminationPipeline` fired in `ctx.waitUntil()` alongside the existing `runScoringJob` at termination.
- Import updated: removed `decomposeCandidateAnswer, persistDecomposition` from `cultureAgentDecomposition`, added `runInterviewTerminationPipeline` from `cultureAgentPipeline`.

### 4. Unit tests
**File:** `workers/api/src/lib/__tests__/cultureAgentPipeline.test.ts`

12 tests covering:
- Synthesis: valid JSON, no provider, LLM failure, invalid JSON, partial JSON
- Decomposition: valid JSON, invalid node type filtering, no provider, LLM failure
- Full pipeline: end-to-end with mocked DB/Env, null provider, missing discovery result

---

## API changes

### New types
```typescript
interface CandidateProfile {
  careerTimeline: Array<{ company, role, startDate, endDate, durationMonths, teamSize, scope, keyAccomplishments, technologies }>;
  skillsInventory: Array<{ skill, proficiency, evidence, yearsExperience }>;
  projectPortfolio: Array<{ name, description, role, outcomes, technologies }>;
  workingStyle: { collaborationPreference, communicationStyle, decisionMaking, feedbackReceptiveness };
  motivation: { primaryDrivers, dealbreakers, growthTrajectory };
  behavioralEvidence: Array<{ dimension, evidence, confidence }>;
}
```

### New functions
```typescript
async function synthesizeCandidateProfile(provider, transcript): Promise<CandidateProfile | null>
async function decomposeTranscript(provider, transcript): Promise<DecomposedTranscript | null>
async function runPostScreenerEnrichment(env, db, candidateId, candidateProfileJson): Promise<void>
async function runInterviewTerminationPipeline(input: PipelineInput): Promise<void>
async function loadDiscoveryResultFromDb(db, candidateId): Promise<CandidateDiscoveryResult | null>
```

### Modified functions
```typescript
// Before: not exported
async function runMatchAndAssign(input: MatchAndAssignInput): Promise<void>
// After: exported
export async function runMatchAndAssign(input: MatchAndAssignInput): Promise<void>
```

---

## Change requests for other agents

| File | Requesting Agent | Change | Priority |
|---|---|---|---|
| `cultureAgent.ts` | fsm-agent (pending) | Replace per-turn STAR analysis (`runTurnAnalysis`) with heuristic evaluator (<1ms); keep LLM for probe text generation only | Medium |
| `cultureAgentAdaptive.ts` | fsm-agent (pending) | Delete — 70% duplicate of `cultureAgent.ts`; merge generative planner into new architecture | Medium |
| `cultureScorer.ts` | scorer-agent (pending) | No changes required — scoring pipeline unchanged; `decomposeCultureScoreToGraph` continues to create CulturalSignal nodes from score report | None |
| Frontend | frontend-agent (pending) | Add `WAITING_FOR_MATCH` to Challenge type union; render spinner + auto-refresh | Blocker |

---

## Tests passing

- **Unit tests:** 938 passed | 1 skipped (939 total) — +12 new tests
- **Integration tests:** All passing
- **TypeScript:** Clean compile (1 pre-existing error in `roleDiscovery/prompts.ts`)

Note: 2 unhandled rejections in `retryHelper.test.ts` are pre-existing and unrelated.

---

## Known issues

1. **Embedding model type cast:** `embedCandidateNode` expects a narrow `AI.run` signature. The pipeline casts `env` with `as { AI: { run: (model: string, input: { text: string[] }) => Promise<{ data?: number[][] }> } }` — same pattern used by `decomposeCultureScoreToGraph`.

2. **No E2E test for full flow yet.** The end-to-end flow (resume upload → screener → WAITING_FOR_MATCH → CODE_REVIEW) requires frontend-agent to implement the WAITING_FOR_MATCH spinner.

3. **Migration 0068 needs application.** The `candidate_ingestion` table must have `enriching`, `enriched`, `screener_completed_at`, `candidate_profile_json`, `enriched_embedding_json` columns. Run `wrangler d1 migrations apply <DB_NAME>` when ready.

---

## Next agent should know

- **The pipeline never throws.** It runs inside `ctx.waitUntil()`. All errors are caught and logged. Partial failures are acceptable — a candidate can still proceed even if synthesis or decomposition fails.
- **Per-turn decomposition is removed.** The old `decomposeCandidateAnswer()` call in the respond handler is gone. Batch decomposition at termination replaces it, saving ~15 LLM calls per interview.
- **Matching is re-triggered after enrichment.** `runMatchAndAssign` reloads the discovery result from D1 and re-runs the full match pipeline. This means the match can benefit from the newly created screener-derived nodes.
- **The enriched embedding is a mean-pool of ALL active nodes** (resume + screener + code review + etc.), not just the new screener nodes. This gives the most complete candidate representation.
- **Both synthesis and decomposition use `maxTokens: 2048`.** This is higher than the old per-turn analysis (768 tokens) because they process the full transcript, not a single answer.
