# Implementation Scorer — Sherlock-Based `lib/implementationScorer.ts`

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 266–283)
**Phase:** 4
**Status:** PENDING
**Estimate:** 3 weeks

## Source quote
> `/rpc/score-submission` currently returns null. The new implementation:
> 1. When submission arrives, `ctx.waitUntil` triggers `scoreImplementationSubmission` in `lib/implementationScorer.ts`
> 2. The scorer reads the submission (code, virtual FS files), the dev container telemetry (filesystem events, git history, AI copilot interaction log), and the challenge repo context
> 3. Runs the four Sherlock dimensions through Gemma with detailed BARS anchors
> 4. Produces `ImplementationScoreReport` with per-dimension scores, evidence quotes from the telemetry, confidence, reasoning
> 5. Writes to `challenge_submissions.score_report_json`
> 6. Decomposes into TechnicalDemonstration and WorkingStyle sub-elements on the candidate's graph
> 7. HITL gate parallel to culture scoring — recruiter must confirm/override before candidate sees score

## Why
Implementation challenge submissions currently go unscored — `/rpc/score-submission` returns null. This is an assessment-stage gap: candidates complete technical work that produces no signal. The Sherlock scorer activates the implementation challenge as a real graph-building event.

## Subtasks (delegable)

### Subtask 1 — `ImplementationScoreReport` types and BARS anchors
**Files:**
- `workers/api/src/lib/implementationScorer/types.ts`

**Spec:**
Export `SherlockDimension = 'reasoning_decomposition' | 'code_construction' | 'adaptability' | 'debugging_maintenance'`. Export `ImplementationScoreDimension` interface: `{ dimension: SherlockDimension, bars_score: number, evidence_quotes: string[], reasoning: string, confidence: number }`. Export `ImplementationScoreReport` interface: `{ dimensions: ImplementationScoreDimension[], telemetry_features: TelemetryFeatures, synthesis: string, overall_confidence: number, scored_at: number }`. Export `TelemetryFeatures`: `{ tdd_ratio: number, debug_strategy_pattern: string, ai_collaboration_style: string, commit_frequency: string }`. BARS anchors for all 4 dimensions as string constants in the same file.

**Status:** ⏳ PENDING

---

### Subtask 2 — Scorer prompts (4 dimensions)
**Files:**
- `workers/api/src/lib/implementationScorer/prompts.ts`

**Spec:**
Four prompt builder functions, one per dimension: `buildReasoningDecompositionPrompt(submission, telemetry, repoContext)`, `buildCodeConstructionPrompt(...)`, `buildAdaptabilityPrompt(...)`, `buildDebuggingMaintenancePrompt(...)`. Each function composes a structured prompt with: the BARS anchor text for that dimension, relevant telemetry features, code submission excerpts (summarized to stay within ~4K tokens), challenge repo context (what was the task, what was the expected approach). Instructs Gemma: respond with JSON `{ bars_score: number, evidence_quotes: string[], reasoning: string, confidence: number }` only.

**Status:** ⏳ PENDING

---

### Subtask 3 — `scoreImplementationSubmission` orchestrator
**Files:**
- `workers/api/src/lib/implementationScorer/implementationScorer.ts`

**Spec:**
Export `scoreImplementationSubmission(submissionId: string, env: Env): Promise<ImplementationScoreReport>`. Fetches submission from `challenge_submissions`, repo context from `challenge_repos`, telemetry from `challenge_telemetry` (or wherever dev container events land). Runs all 4 dimension prompts via `env.AI.run('@cf/google/gemma-3-27b-it')` (same model as culture scoring). Cost meter via `aiUsage.ts` tagged `feature='implementation_scoring'`. Aggregates into `ImplementationScoreReport`. Writes to `challenge_submissions.score_report_json`. Throws on any Gemma error — no partial scores written.

**Status:** ⏳ PENDING

---

### Subtask 4 — Wire to `/rpc/score-submission` + HITL gate
**Files:**
- `workers/api/src/routes/rpc/submissions.ts`

**Spec:**
Replace the null return in `/rpc/score-submission` with: `ctx.waitUntil(scoreImplementationSubmission(submissionId, env))`. Submission returns 202 immediately (work is async). Add HITL gate: after scorer writes the report, set `challenge_submissions.hitl_status = 'PENDING_REVIEW'`. Recruiter sees "needs review" badge in cockpit. Until recruiter confirms, candidate does not see score. Wire the confirm endpoint: `POST /api/v1/submissions/:id/confirm-score` (Clerk-authed). Tag `aiUsage.ts` on each scorer invocation. Log `[submissions] implementation scoring triggered for submission <id>`.

**Status:** ⏳ PENDING

---

### Subtask 5 — Decompose score into graph nodes
**Files:**
- `workers/api/src/lib/implementationScorer/implementationScorer.ts`

**Spec:**
After writing score report: for each of 4 scored dimensions, create one TechnicalDemonstration node. For each telemetry feature (`tdd_ratio`, `debug_strategy_pattern`, `ai_collaboration_style`), create one WorkingStyle node. All nodes: `source_type='implementation_challenge'`, `source_reference=submissionId`, `confidence=dimension.confidence`. Insert + embed all nodes. Call `computeCandidateCoverage`. Decomposition failure must not affect score report write (try/catch, log).

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md`, `candidate-sub-element-embedding.md`, `screener-coverage-computation.md`
- Depends on: Part 3 (Sherlock rubric context — see Part 3 plan files for the scorer design)
- Blocks: nothing in Part 4 (terminal assessment stage)

## Acceptance criteria
- [ ] `/rpc/score-submission` returns 202 immediately (not blocking)
- [ ] `scoreImplementationSubmission` writes `score_report_json` to D1
- [ ] HITL gate: candidate does not see score until recruiter confirms
- [ ] Cost metered under `feature='implementation_scoring'` in `aiUsage.ts`
- [ ] 4 TechnicalDemonstration + 3 WorkingStyle nodes created per scored submission
- [ ] Scorer failure does not propagate to submission endpoint (worker absorbs via waitUntil)
- [ ] `npx tsc --noEmit` clean
