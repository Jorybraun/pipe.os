# Agent Flow Specification — New E2E Flow

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §3.2  
**Blocked by:** `architecture/state-machine-spec.md`  
**Blocks:** `implementation/mode-1-profile-builder.md`, `implementation/mode-2-role-fit.md`  

---

## 1. Problem Statement

The current culture agent flow is a single-phase ReAct loop: candidate answers → LLM analyzes → next question or probe. There is no phase architecture, no warm-up, no wrap-up, and no distinction between "elicit signal" and "evaluate signal." The discovery agent's flow (rapport → context → discovery → prioritize → friction → wrap-up) produces richer signal because each phase has a different conversational posture. The culture agent needs an equivalent phase architecture.

## 2. Current State

The current flow (`cultureAgent.ts:255–410`):

```
startCultureInterview()
  → pick first question from static bank
  → return { transcript, nextQuestion }

advanceCultureInterview()
  → runTurnAnalysis() [LLM call: STAR slots + probe decision]
  → if probe_needed: return probe text
  → else: evaluateTermination()
    → if terminate: return { terminated: true }
    → else: pickNextQuestion() from bank or generative planner
      → return { transcript, nextQuestion }
```

**Problems:**
- `runTurnAnalysis()` is an LLM call on every answer. For a 10-question interview with 3 probes, that's 13 LLM calls just for turn management.
- `evaluateTermination()` is a simple threshold check (`questionsAsked >= maxQuestions` or `coverage >= 1` per dimension). It cannot express "terminate after wrap-up" or "terminate after drilling completes."
- No phase awareness means the first question and the last question have the same posture.

## 3. Target State

### 3.1 High-level flow

```
[consent]
   │ candidate clicks "Start Interview"
   ▼
[rapport_building] ──→ 1–2 warm-up questions (not scored, not probed)
   │ candidate answers → heuristic evaluator runs (<1ms)
   │ if thin: gentle reframe (no LLM)
   ▼
[probing] ──→ coverage-driven probe selection
   │ candidate answers → heuristic evaluator runs
   │ if thin: transition to [drilling]
   │ if adequate: extract nodes, update coverage, select next probe
   │ loop until coverage_complete OR budget_exhausted
   ▼
[drilling] ──→ warm follow-up on thin answer (heuristic, no LLM)
   │ candidate answers → heuristic evaluator runs
   │ if now adequate: return to [probing]
   │ if still thin: mark dimension as "thin but probed", return to [probing]
   │ max 2 drill attempts per thin answer
   ▼
[wrap_up] ──→ 1–2 summary/clarification questions
   │ candidate answers → no probing, no scoring
   ▼
[scoring] ──→ 11 LLM calls (parallel, in waitUntil)
   │
   ▼
[complete] ──→ decomposition batch write → re-embed → match trigger
```

### 3.2 Turn-by-turn detail

**Turn 1 (rapport_building):**
- Question: "Before we dive in — tell me what drew you to apply for this role." (Mode-2) or "What are you looking for in your next opportunity?" (Mode-1)
- No STAR analysis. No probing. Heuristic evaluator only.
- Purpose: Establish baseline specificity. Warm up the candidate.

**Turn 2–N (probing):**
- Coverage computation runs (`candidate_coverage` table or in-memory equivalent).
- Lowest-coverage dimension selected.
- Probe selected from bank (Mode-1: `profile_probe_bank`; Mode-2: `role_probe_bank` + RCD overlay).
- Heuristic evaluator runs on answer.
- If rich: extract nodes, update coverage, continue.
- If moderate: extract nodes, continue.
- If thin: transition to drilling.

**Drilling turn:**
- Warm follow-up generated from heuristic signals (not LLM).
  - Missing Situation: "When was this, and what was the team or company at the time?"
  - Missing Task: "What was your specific responsibility in that situation?"
  - Missing Action: "What did you actually do — can you walk me through your steps?"
  - Missing Result: "What happened as a result? How did you know it worked?"
  - Vague outcome: "Can you put a number or timeframe on that?"
- Heuristic evaluator runs on drill answer.
- Return to probing regardless of outcome (mark dimension coverage accordingly).

**Final turn (wrap_up):**
- Question: "Is there anything we haven't covered that you think is important for us to know?" (Mode-1) or "Any questions for me about the team or how we work?" (Mode-2)
- No probing. No scoring.

### 3.3 Function signatures

```typescript
// New entry point — replaces startCultureInterview + startAdaptiveCultureInterview
export async function startCultureInterviewV2(
  input: StartInterviewInput,
): Promise<StartResult>;

// New advance — replaces advanceCultureInterview + advanceAdaptiveCultureInterview
export async function advanceCultureInterviewV2(
  input: AdvanceInterviewInput,
): Promise<AdvanceResult>;

// Heuristic evaluator — new, zero-LLM
export function evaluateAnswerHeuristic(
  answer: string,
  context: HeuristicContext,
): HeuristicResult;

// Coverage computation — new
export function computeCoverage(
  transcript: CultureTranscriptV2,
  mode: 'profile_builder' | 'role_fit',
): CoverageState;

// Phase directive — deterministic, zero-LLM
export function buildPhaseDirective(
  state: InterviewStateV2,
): PhaseDirective;
```

### 3.4 State shape (delta from current)

```typescript
interface InterviewStateV2 {
  // Existing fields preserved
  turns: CultureTurnV2[];
  scratchpad: CultureScratchpadV2;

  // NEW: Phase tracking
  phase: 'rapport_building' | 'probing' | 'drilling' | 'wrap_up' | 'scoring' | 'complete';
  phaseHistory: Array<{ phase: string; enteredAt: number }>;

  // NEW: Coverage state (replaces simple dimensionCoverage counts)
  coverage: CoverageState;

  // NEW: Drill tracking
  currentDrill: {
    targetTurnIndex: number;
    attempts: number;
    maxAttempts: number;
  } | null;

  // NEW: Node extraction buffer (batched until termination)
  pendingNodes: CandidateNodeDraft[];
}

interface CoverageState {
  experience: { completeness: number; lastProbedAt: number | null };
  cultural: { completeness: number; lastProbedAt: number | null };
  technical: { completeness: number; lastProbedAt: number | null };
  motivation: { completeness: number; lastProbedAt: number | null };
  context: { completeness: number; lastProbedAt: number | null };
}
```

## 4. Implementation Details

### 4.1 File changes

| File | Change |
|---|---|
| `workers/api/src/lib/cultureAgent.ts` | **Rewrite.** Replace imperative FSM with reducer + phase directive. Remove `runTurnAnalysis` from hot path. Keep scoring pipeline intact. |
| `workers/api/src/lib/cultureAgentAdaptive.ts` | **Delete.** Merge generative planner logic into new architecture as optional question source. |
| `workers/api/src/lib/cultureAgentPrompts.ts` | **Extend.** Add phase-specific prompt sections. Keep existing STAR analysis prompt for scoring path. |
| `workers/api/src/lib/cultureAnswerEvaluator.ts` | **New.** Heuristic evaluator (<1ms, zero LLM). |
| `workers/api/src/lib/cultureCoverage.ts` | **New.** Coverage computation from transcript + node buffer. |
| `workers/api/src/lib/culturePhaseDirective.ts` | **New.** Deterministic phase controller. |

### 4.2 Heuristic evaluator algorithm

Copy the pattern from `workers/api/src/lib/agents/question/answerEvaluator.ts:39–48`:

```typescript
function specificityScore(answer: string): number {
  let score = 0;
  if (/\d/.test(answer)) score += 1;                        // numbers
  if (/\b20\d{2}\b/.test(answer)) score += 1;              // years
  if (/(for example|one time|specifically|namely)/i.test(answer)) score += 1;
  if (/(we use|our stack|we run on|built with)/i.test(answer)) score += 1;
  if (answer.length > 120) score += 1;
  return score;
}

function evaluateAnswerHeuristic(answer: string): HeuristicResult {
  const spec = specificityScore(answer);
  if (answer.length > 120 && spec >= 2) return { quality: 'rich', needsFollowUp: false };
  if (answer.length > 60 || spec >= 1) return { quality: 'moderate', needsFollowUp: false };
  return { quality: 'thin', needsFollowUp: true };
}
```

### 4.3 Phase directive logic

```typescript
function buildPhaseDirective(state: InterviewStateV2): PhaseDirective {
  const { phase, turns, coverage, currentDrill } = state;

  // Rapport building: exit after 2 turns or if candidate gives rich answer
  if (phase === 'rapport_building') {
    const rapportTurns = turns.filter(t => t.phase === 'rapport_building');
    if (rapportTurns.length >= 2) return { nextPhase: 'probing' };
    return { nextPhase: 'rapport_building' };
  }

  // Probing: check coverage and budget
  if (phase === 'probing') {
    if (currentDrill) return { nextPhase: 'drilling' };
    const totalTurns = turns.length;
    const minQuestions = state.config.minQuestions;
    const maxQuestions = state.config.maxQuestions;

    // Wrap-up gate: minimum met and coverage adequate
    if (totalTurns >= minQuestions && isCoverageAdequate(coverage)) {
      return { nextPhase: 'wrap_up' };
    }

    // Budget exhaustion
    if (totalTurns >= maxQuestions) {
      return { nextPhase: 'wrap_up' };
    }

    return { nextPhase: 'probing' };
  }

  // Drilling: exit after max attempts or if answer improves
  if (phase === 'drilling') {
    if (!currentDrill || currentDrill.attempts >= currentDrill.maxAttempts) {
      return { nextPhase: 'probing' };
    }
    return { nextPhase: 'drilling' };
  }

  // Wrap-up: exit after 2 turns
  if (phase === 'wrap_up') {
    const wrapTurns = turns.filter(t => t.phase === 'wrap_up');
    if (wrapTurns.length >= 2) return { nextPhase: 'scoring' };
    return { nextPhase: 'wrap_up' };
  }

  return { nextPhase: phase };
}
```

## 5. Open Questions

1. Should the heuristic evaluator run on EVERY answer, or only as a pre-filter before the LLM? If the heuristic says "rich," do we still run STAR analysis for scoring? — **Recommendation:** Heuristic always runs. STAR analysis runs only for answers that will be scored (i.e., all non-rapport answers). STAR analysis can be deferred to termination and run batched.

2. How many turns should `rapport_building` have? 1 feels too short; 3 feels too long. — **Recommendation:** 1 fixed warm-up + exit to probing on turn 2 regardless. The warm-up is not scored.

3. Should drilling be allowed in `wrap_up`? — **Recommendation:** No. Wrap-up questions are not scored. No probing, no drilling.

## 6. Validation Criteria

- **Unit test:** `buildPhaseDirective` returns correct next phase for all state combinations.
- **Unit test:** Heuristic evaluator correctly classifies rich/moderate/thin answers from golden set.
- **E2E test:** Full interview completes in ≤15 turns for test candidate.
- **E2E test:** No LLM call is made for turn management (only for question generation and scoring).

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Heuristic evaluator misclassifies thin answers as rich | Medium | High (missed signal) | Calibrate on golden set; add tunable thresholds |
| Phase directive creates infinite loop (drilling ↔ probing) | Low | High | Max drill attempts + test coverage |
| Candidates find phase transitions jarring | Medium | Medium | Warm acknowledgments between phases; no explicit "now we enter phase X" |
| Removing LLM from turn path breaks probe quality | Medium | High | A/B test: heuristic-only vs. LLM-assisted probe selection |
