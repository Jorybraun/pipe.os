# Discovery Agent Analysis — Patterns to Steal

**Owner:** Culture Agent Team  
**Status:** PENDING  
**Source strategy:** `culture-agent-redesign-master.md` §2.4  
**Blocked by:** None  
**Blocks:** `architecture/prompt-system-spec.md`, `implementation/mode-1-profile-builder.md`  

---

## 1. Problem Statement

The discovery agent (role discovery interview) is sophisticated: pure reducer, multi-phase prompts, heuristic answer evaluation, guard retry loops, per-domain batch generation. The culture agent is comparatively primitive: imperative FSM, single-phase prompt, LLM-based turn analysis, simple JSON.parse fallback, one-question-at-a-time generation. This document catalogs exactly which discovery agent patterns to copy and how to adapt them.

## 2. Current State

### 2.1 Discovery agent files

| File | Purpose | Lines |
|---|---|---|
| `workers/api/src/lib/agents/interview/reducer.ts` | Pure state machine | 314–401 |
| `workers/api/src/lib/agents/interview/types.ts` | State types | 1–87 |
| `workers/api/src/lib/agents/question/domainOrchestrator.ts` | Domain-driven question flow | 126–258 |
| `workers/api/src/lib/agents/question/domainGenerator.ts` | Batch question generation | 1–220 |
| `workers/api/src/lib/agents/question/answerEvaluator.ts` | Heuristic answer quality | 56–97 |
| `workers/api/src/lib/agents/question/generator.ts` | Question generation + guard retry | 239–338 |
| `workers/api/src/lib/agents/roleDiscovery/prompts.ts` | Multi-phase prompt system | 1–839 |

### 2.2 Culture agent files

| File | Purpose | Lines |
|---|---|---|
| `workers/api/src/lib/cultureAgent.ts` | Imperative FSM | 172–584 |
| `workers/api/src/lib/cultureAgentAdaptive.ts` | Generative planner FSM | 93–644 |
| `workers/api/src/lib/cultureGenerativePlanner.ts` | Single-question generation | 224–270 |
| `workers/api/src/lib/cultureAgentPrompts.ts` | Single-phase prompt | 106–196 |

## 3. Target State — Pattern Mapping

### Pattern 1: Pure Reducer

**Discovery:** `interviewReducer.ts:314–401`
```typescript
export function interviewReducer(state: InterviewState, action: InterviewAction): InterviewState {
  switch (action.type) {
    case 'ANSWER':
      return { ...state, exchanges: [...state.exchanges, action.exchange], questionsAsked: state.questionsAsked + 1 };
    // ...
  }
}
```

**Culture adaptation:** Replace `advanceCultureInterview()` with `cultureInterviewReducer()`.
- The culture reducer handles `ANSWER`, `DRILL`, `ADVANCE_PHASE`, `SCORE_COMPLETE`.
- Zero LLM calls in the reducer.
- State is immutable; every action returns a new object.

**File:** `workers/api/src/lib/cultureInterviewReducer.ts` (new)

---

### Pattern 2: Heuristic Answer Evaluator

**Discovery:** `answerEvaluator.ts:56–97`
```typescript
export function evaluateLatestAnswer(state: InterviewState): EvaluationResult {
  const answer = getLastAnswer(state);
  const specScore = specificityScore(answer);
  if (answer.length > 120 && specScore >= 2) return { quality: 'rich', needsFollowUp: false };
  if (answer.length > 60 || specScore >= 1) return { quality: 'moderate', needsFollowUp: false };
  return { quality: 'thin', needsFollowUp: true };
}
```

**Culture adaptation:** Replace `runTurnAnalysis()` (LLM call) with `evaluateAnswerHeuristic()` (pure function).
- Run on every answer before deciding to probe.
- If `needsFollowUp: true`, transition to `drilling` phase.
- If `quality: 'rich'`, skip STAR analysis for this turn (save LLM call).
- STAR analysis still runs at termination for scoring.

**File:** `workers/api/src/lib/cultureAnswerEvaluator.ts` (new)

---

### Pattern 3: Guard Retry Loop

**Discovery:** `generator.ts:239–338`
```typescript
export async function generateQuestionWithGuardRetry(...): Promise<Question> {
  for (let attempt = 0; attempt < MAX_GUARD_RETRIES; attempt++) {
    const question = await generateQuestion(...);
    const check = checkQuestion(question, state);
    if (check.valid) return question;
    messages.push(buildGuardNudge(check.reason));
  }
  throw new Error('Guard retry exhausted');
}
```

**Culture adaptation:** Add guard retry to `runGenerativeTurnPlanner()` and turn analysis.
- If LLM returns invalid JSON, append nudge message and retry (max 2).
- If retry exhausted, fall back to static bank (Mode-2) or generic probe (Mode-1).

**File:** `workers/api/src/lib/cultureGenerativePlanner.ts` (modify)

---

### Pattern 4: Per-Domain Batch Generation + Cache

**Discovery:** `domainOrchestrator.ts:126–258`
```typescript
export async function getNextDomainDrivenQuestion(state): Promise<DomainResult> {
  const domain = pickNextDomain(state);
  if (!state.domainQuestions[domain]) {
    const questions = await generateDomainQuestions(domain, state);
    statePatches.domainQuestions = { ...state.domainQuestions, [domain]: questions };
  }
  // Serve from cache, evaluate answer, mark complete
}
```

**Culture adaptation:** Batch-generate 3–5 probes per coverage dimension at phase entry.
- On entering `probing` phase for dimension X, generate a batch of probes for X.
- Cache in `state.dimensionProbes[X]`.
- Serve from cache until exhausted or coverage adequate.
- This replaces the one-question-at-a-time static bank selection.

**File:** `workers/api/src/lib/cultureProbeGenerator.ts` (new)

---

### Pattern 5: Multi-Phase Prompt Architecture

**Discovery:** `prompts.ts:439–740`
```typescript
const CORE_PROMPT = `...`;
const PHASE_PROMPTS = {
  context: buildContextPhasePrompt(),
  discovery: buildDiscoveryPhasePrompt(),
  prioritize: buildPrioritizePhasePrompt(),
  // ...
};
```

**Culture adaptation:** Four phase prompts (rapport, probing, drilling, wrap_up) + two mode overlays (profile_builder, role_fit).
- System prompt = core + phase + mode.
- User message = facts block + coverage summary + prior conversation + directive.
- See `architecture/prompt-system-spec.md` for full prompt text.

**File:** `workers/api/src/lib/cultureAgentPrompts.ts` (rewrite)

---

### Pattern 6: State Patches (Immutable Updates)

**Discovery:** `domainOrchestrator.ts:42–46`
```typescript
return {
  question: nextQuestion,
  statePatches: { domainCompletion: { ...state.domainCompletion, [domain]: 'complete' } },
};
```

**Culture adaptation:** Every turn-producing function returns `statePatches` instead of mutating `transcript.scratchpad`.
- The reducer applies patches: `state = { ...state, ...statePatches }`.
- No in-place mutation of arrays or objects.

**File:** `workers/api/src/lib/cultureInterviewReducer.ts` (new)

---

### Pattern 7: Partial JSON Regex Fallback

**Discovery:** `domainGenerator.ts:30–62`
```typescript
function extractQuestionsFromPartialJson(content: string): GeneratedQuestion[] {
  const objRegex = /\{[^{}]*\}/g;
  const matches = content.match(objRegex) ?? [];
  return matches.map(parseObj).filter(Boolean);
}
```

**Culture adaptation:** Add to `parseAgentTurnJsonResponse()` and `runGenerativeTurnPlanner()`.
- If `JSON.parse` fails, attempt regex extraction.
- If regex also fails, fall back to mock response (current behavior) or retry.

**File:** `workers/api/src/lib/cultureAgent.ts` (modify parser)

---

### Pattern 8: Pre-Collected Field Suppression

**Discovery:** `prompts.ts:336–347`
```typescript
// If salary is already known, suppress salary questions
if (state.knowledgeState.salary) {
  flags.push('salary_known');
}
```

**Culture adaptation:** If candidate's resume already lists a skill (e.g., "Kafka"), the screener should not ask "Have you used Kafka?" It should ask "You mentioned Kafka — tell me about a specific problem you solved with it."
- Load `key_concepts_json.mustHaveSkills` into the facts block.
- The prompt includes: "The candidate's resume claims these skills. Do not re-ask. Drill for specifics."

**File:** `workers/api/src/lib/cultureAgentContext.ts` (modify)

---

### Pattern 9: Synthesis Leak Detection

**Discovery:** `generator.ts:210–212`
```typescript
if (parsed.persona || parsed.synthesis || parsed.jobDescription) {
  throw new Error('Synthesis leak detected');
}
```

**Culture adaptation:** If the turn analysis LLM returns a score report or hiring recommendation instead of STAR analysis, throw and retry.
- This prevents the model from prematurely evaluating the candidate.

**File:** `workers/api/src/lib/cultureAgent.ts` (modify parser)

## 4. Implementation Details

### 4.1 What NOT to copy

| Discovery Pattern | Why Not | Culture Alternative |
|---|---|---|
| Durable Object serialization | Interview is 10–15 min; DO is overkill | HTTP request/response |
| Streaming question generation | Adds complexity; not needed for text | Non-streaming only |
| 8-domain column architecture | Culture interview has 5 dimensions, not 8 | 5-dimension coverage model |
| Voice system prompt | Out of scope for this redesign | Text-only |

### 4.2 Priority order

1. **Heuristic evaluator** — immediate cost savings (removes 10+ LLM calls per interview)
2. **Pure reducer** — enables testing, debugging, replay
3. **Multi-phase prompts** — biggest UX improvement
4. **Guard retry loop** — improves robustness
5. **Batch generation + cache** — performance improvement
6. **Partial JSON fallback** — nice to have
7. **Pre-collected suppression** — refinement
8. **Synthesis leak detection** — safety net

## 5. Open Questions

1. **Should the heuristic evaluator use the same thresholds as the discovery agent?** The discovery agent uses `answer.length > 120 && specScore >= 2` for "rich." Culture answers may be shorter because behavioral questions are more focused. — **Recommendation:** Start with same thresholds. Calibrate on golden set after 10 interviews.

2. **Should we copy the discovery agent's `buildAcknowledgment` rotation?** The discovery agent rotates 3 warm acknowledgments to avoid repetition. — **Recommendation:** Yes. Add to `cultureAgentPrompts.ts`. Simple, high-UX win.

## 6. Validation Criteria

- **Unit test:** Each copied pattern has a test matching the discovery agent's test structure.
- **Integration test:** Culture agent produces same output quality as discovery agent on parallel test cases.
- **Cost test:** LLM call count per interview drops from 21+ to ≤12 (1 generative + 11 scoring).

## 7. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Heuristic evaluator misclassifies answers, causing wrong phase transitions | Medium | High | Calibrate on golden set; tunable thresholds |
| Multi-phase prompts confuse the model (wrong phase output) | Low | High | Phase is determined by reducer, not LLM. LLM only produces turn analysis. |
| Batch generation produces low-quality probes | Medium | Medium | Guard retry loop; fallback to static bank |
