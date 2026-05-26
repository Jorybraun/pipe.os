# Handoff Report: evaluator-agent

**Owner:** evaluator-agent  
**Status:** COMPLETE  
**Date:** 2026-05-03  
**Plan documents:** `implementation/discovery-agent-analysis.md` (Pattern 2) + `implementation/scoring-engine.md` (coverage section)

---

## What was built

### 1. `answerEvaluator.ts` — Heuristic answer evaluator (analytics / fallback only)
**File:** `workers/api/src/lib/answerEvaluator.ts`

Ports the discovery agent's lightweight evaluator. Pure function. No LLM. <1ms.

**⚠️ NOT wired into the live interview flow.** Per-turn STAR analysis (`runTurnAnalysis`) is retained for maximum quality. This module exists for:
- Offline transcript audit and coverage estimation
- Mock-provider fallback when LLM is unavailable
- Golden-set calibration baseline

**Exports:**
- `evaluateAnswer(answer: string): AnswerEvaluation` — classifies a single answer as `rich`, `moderate`, or `thin`
- `specificityScore(answer: string): number` — counts specificity signals (numbers, dates, examples, tech stack mentions)
- `evaluateTranscript(turns): Map<number, AnswerEvaluation>` — batch-evaluates all seed turns

### 2. `candidateCoverage.ts` — STAR-based coverage engine + gap detection
**File:** `workers/api/src/lib/candidateCoverage.ts`

High-quality coverage engine that consumes **STAR slot analysis** (not heuristics). Tracks per-dimension depth, specificity-weighted coverage, systematic gap patterns, and targeted probe recommendations.

**Exports:**
- `scoreStarDepth(slots)` — depth score for a single STAR analysis (0–2)
- `computeCoverageState(turns, dimensions, config?)` — full `CoverageState` with depth, gaps, and probe recommendations
- `evaluateCoverageTermination({coverageState, questionsAsked, minQuestions, maxQuestions})` — termination gate
- `rankCoverageGaps(coverageState)` — dimensions ordered by ascending depth score
- `isDimensionCovered(dimension, coverageState, config?)` — single-dimension check

**CoverageState shape:**
```typescript
interface CoverageState {
  dimensions: DimensionDepth[];
  gaps: string[];
  isComplete: boolean;
  probeRecommendations: ProbeRecommendation[];
  summary: string;
}

interface DimensionDepth {
  dimension: string;
  turnCount: number;
  avgSpecificity: number;      // 0–2
  completeness: number;        // 0–1
  missingSlots: StarSlot[];    // e.g. ['A', 'R']
  weakSlots: StarSlot[];       // present but specificity < 1
  depthScore: number;          // 0–2, average per-slot depth
}

interface ProbeRecommendation {
  dimension: string;
  missingSlots: StarSlot[];
  weakSlots: StarSlot[];
  suggestedProbes: string[];   // targeted templates for each gap
}
```

**Depth formula:**
- Per-slot depth = (presence ratio across turns) × (average specificity when present)
- Dimension depthScore = average of all 4 slot depths
- A dimension with all slots always present and specificity=2 scores 2.0
- A dimension with consistently missing Action scores lower regardless of other slots

**Probe recommendations:**
- Generated for ANY dimension with missing or weak slots
- Suggestions target specific slots (S→situation probes, T→task probes, A→action probes, R→result probes)
- Templates rotate based on turn count to avoid repetition

### 3. Unit tests
**Files:**
- `workers/api/src/lib/__tests__/answerEvaluator.test.ts` — 18 tests
- `workers/api/src/lib/__tests__/candidateCoverage.test.ts` — 19 tests

All pass. No regressions in existing suite (pre-existing `retryHelper.test.ts` failures unchanged).

---

## API changes

### New types
```typescript
// answerEvaluator.ts
export type AnswerQuality = 'rich' | 'moderate' | 'thin';
export interface AnswerEvaluation {
  quality: AnswerQuality;
  reasoning: string;
  needsFollowUp: boolean;
}

// candidateCoverage.ts
export interface StarCoverageTurn {
  questionId: string;
  probeOf: string | null;
  dimension: string;
  starSlots: Record<StarSlot, { present: boolean; specificity: number }>;
}

export interface DimensionDepth {
  dimension: string;
  turnCount: number;
  avgSpecificity: number;
  completeness: number;
  missingSlots: StarSlot[];
  weakSlots: StarSlot[];
  depthScore: number;
}

export interface ProbeRecommendation {
  dimension: string;
  missingSlots: StarSlot[];
  weakSlots: StarSlot[];
  suggestedProbes: string[];
}

export interface CoverageState {
  dimensions: DimensionDepth[];
  gaps: string[];
  isComplete: boolean;
  probeRecommendations: ProbeRecommendation[];
  summary: string;
}
```

### New functions
```typescript
// answerEvaluator.ts
export function evaluateAnswer(answer: string): AnswerEvaluation;
export function specificityScore(answer: string): number;
export function evaluateTranscript(
  turns: Array<{ candidateResponse: string | null; probeOf: string | null }>,
): Map<number, AnswerEvaluation>;

// candidateCoverage.ts
export function scoreStarDepth(slots: Record<StarSlot, { present: boolean; specificity: number }>): { depthScore: number; completeness: number; avgSpecificity: number };
export function computeCoverageState(turns: StarCoverageTurn[], dimensions: string[], config?: Partial<CoverageConfig>): CoverageState;
export function evaluateCoverageTermination(input: { coverageState: CoverageState; questionsAsked: number; minQuestions: number; maxQuestions: number }): 'hard_cap' | 'coverage_complete' | null;
export function rankCoverageGaps(coverageState: CoverageState): Array<{ dimension: string; depthScore: number }>;
export function isDimensionCovered(dimension: string, coverageState: CoverageState, config?: Partial<CoverageConfig>): boolean;
```

### JSON shape changes
None. These are new pure-function modules with no DB schema impact.

---

## Change requests for other agents

| File | Requesting Agent | Change | Priority |
|---|---|---|---|
| `cultureAgent.ts` | fsm-agent (pending) | **Retain `runTurnAnalysis()` on every turn** — do NOT replace with heuristic evaluator. Pass `llmResult.star_slots` into `computeCoverageState()` to build rich coverage. Use `probeRecommendations` to generate targeted probes instead of generic `probe_text`. | Blocker |
| `cultureAgent.ts` | fsm-agent (pending) | Replace `scoreTurnCoverage()` with `scoreStarDepth()` for richer per-turn signal. Replace `evaluateTermination()` with `evaluateCoverageTermination()` which uses depth-based coverage. | High |
| `cultureAgent.ts` | fsm-agent (pending) | Import `rankCoverageGaps()` to drive `pickNextQuestion()` / `pickNextProfileProbe()` toward least-covered dimensions. | Medium |
| `cultureGenerativePlanner.ts` | prompt-agent (pending) | Consume `ProbeRecommendation.suggestedProbes` as prompt hints when generating probe text. Higher quality than LLM-generated generic probes. | Medium |

---

## Tests passing

- **New unit tests:** 37/37 passed
- **Existing unit tests:** 991 passed | 1 skipped (same as before)
- **Pre-existing failures:** `retryHelper.test.ts` unhandled rejections (unchanged, unrelated)
- **TypeScript:** Clean compile (no errors from new files)

---

## Known issues

1. **Depth thresholds are uncalibrated.** `DEFAULT_COVERAGE_CONFIG.threshold` is 1.0 (middle of 0–2 scale). This may be too strict or too lenient for real transcripts. Calibrate on the golden set.
2. **Probe templates are generic.** `SLOT_PROBE_TEMPLATES` uses 2 templates per slot. For higher quality, prompt-agent should generate slot-specific probes from question bank data.
3. **Single-turn dimensions score lower.** A single perfect STAR answer scores 2.0, but a single answer with 2 strong slots scores 1.0. If you want to require at least 2 questions per dimension before considering it covered, raise `threshold` to 1.5 or increase `slotPresenceThreshold`.

---

## Next agent should know

- **These modules are pure.** No side effects, no DB, no LLM. Safe to call in tests and reducers.
- **Probe turns don't count for coverage.** Only seed turns (`probeOf === null`) contribute to dimension depth. Probes are tracked in the transcript but ignored by `computeCoverageState`.
- **Coverage is depth-based, not count-based.** Two mediocre answers ≠ one great answer. The `depthScore` penalizes missing slots proportionally.
- **`probeRecommendations` is quality-focused.** It generates recommendations for ANY dimension with missing/weak slots, even if the dimension technically hits the threshold. The caller decides whether to act on them.
- **`answerEvaluator.ts` is NOT for live flow.** Keep per-turn STAR analysis. The heuristic is for dashboards, mocks, and calibration only.
