# Design Plan: Role Discovery as a State Machine + Question Generator

## Conversation Context

This plan was created during a discussion about the role discovery agent architecture. The current `callRoleAgent` (677 lines) is a monolithic function that handles interviewing, synthesis, tool calling, fallback providers, streaming, and gap-filling all in one place. The user observed that:

1. The agentic flow is "very dumb" — it should be split into smaller, composable parts
2. The UI needs to coordinate multiple agentic systems, not just passively receive responses
3. Context should be managed as state, not duplicated in prompts (no separate "conversation history" + "knowledge state" sections)
4. The eval gate exists but isn't wired into the production path
5. The unified agent runtime was built but never adopted — the role agent predates it and has capabilities the UAR can't handle

The user explicitly requested: "we just need a reducer, its really just a statemachine."

---

## Requirements

### Functional Requirements
- [R1] Interview state must be managed by a pure reducer (state machine) — no LLM calls
- [R2] Question generation must be stateless — takes state, returns question
- [R3] Synthesis generation must be stateless — takes state, returns persona + JD
- [R4] State is the single source of truth — no hidden state in any agent
- [R5] Exchanges (conversation history) are kept verbatim in state — no flattening or summarization
- [R6] The frontend coordinates the flow — it holds state, calls reducer, calls generator
- [R7] Eval gate runs on every generated question before delivery to user
- [R8] Tool calling (research) moves out of the question hot path — pre-fetched or backgrounded

### Non-Functional Requirements
- [N1] Reducer runs in <10ms (pure code, no I/O)
- [N2] Question generation completes in <2s (single LLM call)
- [N3] State object is JSON-serializable and sendable over HTTP
- [N4] No regression in RCD synthesis quality vs legacy
- [N5] All existing tests pass after each migration step

### UI Requirements
- [U1] Frontend displays current phase (CONTEXT, DISCOVERY, etc.)
- [U2] Frontend displays domain coverage bars
- [U3] Frontend displays progress (questions asked / budget)
- [U4] No "thinking..." spinners hiding multiple backend round-trips

---

## Executive Summary

The current `callRoleAgent` is a 677-line monolith. Replace it with two things:

1. **A state machine reducer** — pure function, no LLM. Takes `(state, action) => newState`.
2. **A question generator** — LLM call. Takes `state => question`.

The UI holds the state and coordinates: receives user input, runs the reducer, runs the generator, displays the result.

No separate agents. No orchestration layer. No hidden state. Just a reducer and a generator.

---

## 1. The Core Insight

The user is right: this is just a state machine.

```typescript
// Current (monolith)
const response = await callRoleAgent({
  provider, baseline, exchanges, knowledgeState,
  questionsAsked, questionBudget, phaseDirective, domainCoverage,
});
// response is either a question OR a synthesis — opaque, no intermediate state

// Target (reducer + generator)
const newState = interviewReducer(state, { type: 'ANSWER', answer: '...' });
// newState has updated coverage, phase, knowledgeState

if (newState.synthesisReady) {
  const synthesis = await synthesize(newState);
  // show persona + JD
} else {
  const question = await generateQuestion(newState);
  // show question
}
```

The frontend sees every state transition. No invisible work.

---

## 2. The State Machine (Reducer)

### State shape

```typescript
interface InterviewState {
  // Static
  baseline: RoleContextBaseline;
  participantRole: ParticipantRole;
  questionBudget: number;

  // Dynamic
  exchanges: Exchange[];
  knowledgeState: KnowledgeState;
  coverage: DomainCoverageMap;
  phase: ConversationPhase;      // CONTEXT | DISCOVERY | PRIORITIZE | EVP_FRICTION | WRAP_UP
  questionsAsked: number;
  synthesisReady: boolean;       // true when budget exhausted OR all gates pass
  conversationSummary: string;   // optional, maintained by reducer
}
```

### Actions

```typescript
type InterviewAction =
  | { type: 'ANSWER'; answer: string }
  | { type: 'SKIP' }
  | { type: 'FORCE_SYNTHESIZE' };
```

### Reducer

```typescript
function interviewReducer(state: InterviewState, action: InterviewAction): InterviewState {
  switch (action.type) {
    case 'ANSWER': {
      const exchanges = [...state.exchanges, {
        id: `q-${state.questionsAsked + 1}`,
        question: state.currentQuestion!,
        answer: action.answer,
        acknowledgment: state.currentAcknowledgment!,
      }];

      const questionsAsked = state.questionsAsked + 1;
      const budgetExhausted = questionsAsked >= state.questionBudget;

      // Extract facts from answer → merge into knowledgeState
      const knowledgeState = mergeKnowledgeState(
        state.knowledgeState,
        extractFacts(action.answer, state.phase)
      );

      // Update coverage
      const coverage = assessCoverage(knowledgeState);

      // Determine phase
      const phase = selectPhase(questionsAsked, coverage, knowledgeState);
      const synthesisReady = budgetExhausted || allGatesPass(knowledgeState);

      return {
        ...state,
        exchanges,
        questionsAsked,
        knowledgeState,
        coverage,
        phase,
        synthesisReady,
      };
    }

    case 'FORCE_SYNTHESIZE':
      return { ...state, synthesisReady: true };

    default:
      return state;
  }
}
```

### What the reducer does (all code, no LLM)

1. Append exchange to `exchanges`
2. Increment `questionsAsked`
3. Extract facts from answer → merge into `knowledgeState`
4. Assess `coverage` from `knowledgeState`
5. Select `phase` based on budget + coverage + probe progress
6. Return new state

### Phase selection (extracted from `buildPhaseDirective`)

```typescript
function selectPhase(questionsAsked: number, coverage: DomainCoverageMap, knowledgeState: KnowledgeState): ConversationPhase {
  const probesDelivered = countProbes(knowledgeState);

  if (questionsAsked < 2) return 'CONTEXT';
  if (probesDelivered < 8) return 'DISCOVERY';
  if (!knowledgeState.mustHavesPrioritized) return 'PRIORITIZE';
  if (anyEvpUncovered(knowledgeState)) return 'EVP_FRICTION';
  return 'WRAP_UP';
}
```

---

## 3. The Question Generator

### Function signature

```typescript
async function generateQuestion(
  state: InterviewState,
  provider: LLMProvider,
): Promise<{
  question: Question;
  acknowledgment: string;
  reasoning: string;
}>;
```

### Prompt construction

The prompt renders state directly. No duplication, no hidden context:

```
You are a senior recruiting partner conducting a role discovery interview.

BASELINE:
{JSON.stringify(state.baseline)}

PARTICIPANT: {state.participantRole}
PHASE: {state.phase}
BUDGET: {state.questionsAsked} of {state.questionBudget} used

DOMAIN COVERAGE:
{JSON.stringify(state.coverage)}

KNOWLEDGE STATE:
{JSON.stringify(state.knowledgeState)}

EXCHANGES:
{state.exchanges.map(e => `[${e.id}] Agent: ${e.question}\n    User: ${e.answer}`).join('\n\n')}

Generate the next question and acknowledgment.
One question only. Under 15 words. Acknowledgment ≤ 1 sentence.
```

### Key properties

- **Stateless**: takes state, returns question. No side effects.
- **Deterministic prompt**: same state → same prompt every time.
- **No tool loop**: research is pre-fetched or cached in state.
- **Fast**: single LLM call, no blocking operations.

---

## 4. The Synthesis Generator

### Function signature

```typescript
async function synthesize(
  state: InterviewState,
  provider: LLMProvider,
): Promise<{
  persona: CandidatePersona;
  jobDescription: string;
}>;
```

### Prompt construction

```
Produce the final role synthesis based on the completed interview.

BASELINE:
{JSON.stringify(state.baseline)}

EXCHANGES:
{state.exchanges.map(...).join('\n\n')}

KNOWLEDGE STATE:
{JSON.stringify(state.knowledgeState)}

DOMAIN COVERAGE:
{JSON.stringify(state.coverage)}

Emit persona JSON and job description Markdown.
```

---

## 5. Eval Gate

### Where it fits

```typescript
async function generateQuestionWithEval(state, provider) {
  const result = await generateQuestion(state, provider);

  const evalResult = await runEvalGate(provider, result, session, evalConfig);

  if (!evalResult.approved && evalResult.rewrite) {
    return { ...result, question: { ...result.question, text: evalResult.rewrite } };
  }

  return result;
}
```

### Dimensions

- `brevity` — question ≤ 15 words
- `coverage` — advances a non-deep domain
- `redundancy` — not previously asked
- `phase_alignment` — matches phase posture
- `acknowledgment_quality` — references user's answer

---

## 6. UI Flow

```
User submits answer
  │
  ▼
Frontend: state = interviewReducer(state, { type: 'ANSWER', answer })
  │
  ▼
Frontend: update UI (phase badge, coverage bars, progress)
  │
  ▼
Frontend checks state.phase
  │
  ├── 'SYNTHESIZE' ──→ call synthesize(state) ──→ show persona + JD
  │
  └── else ──→ call generateQuestion(state) ──→ show question
```

The UI is the coordinator. It holds state. It calls the reducer. It calls the generator. It displays everything.

---

## 7. Backend Endpoints

Replace the monolithic `/respond` with three simple endpoints:

| Method | Path | Body | Response |
|--------|------|------|----------|
| POST | `/api/v1/role-contexts/:id/state` | `{ state, action }` | `{ state }` |
| POST | `/api/v1/role-contexts/:id/question` | `{ state }` | SSE or JSON `{ question, acknowledgment }` |
| POST | `/api/v1/role-contexts/:id/synthesize` | `{ state }` | `{ persona, jobDescription }` |

### `/state` endpoint

```typescript
app.post('/api/v1/role-contexts/:id/state', async (c) => {
  const { state, action } = await c.req.json();
  const newState = interviewReducer(state, action);

  // Persist to D1
  await persistState(c.env.DB, id, newState);

  return c.json({ state: newState });
});
```

### `/question` endpoint

```typescript
app.post('/api/v1/role-contexts/:id/question', async (c) => {
  const { state } = await c.req.json();
  const provider = createRoleAgentProvider(c.env);

  const result = await generateQuestion(state, provider);

  // Optional: eval gate
  if (evalConfig) {
    const evalResult = await runEvalGate(provider, result, session, evalConfig);
    if (!evalResult.approved && evalResult.rewrite) {
      result.question.text = evalResult.rewrite;
    }
  }

  return c.json(result);
});
```

---

## 8. File Changes

### New files

| File | Responsibility |
|------|---------------|
| `lib/agents/interview/reducer.ts` | `interviewReducer` — pure state machine |
| `lib/agents/interview/types.ts` | `InterviewState`, `InterviewAction`, `Exchange` |
| `lib/agents/question/generator.ts` | `generateQuestion` — LLM call |
| `lib/agents/question/prompt.ts` | Prompt builder from state |
| `lib/agents/question/eval.ts` | Eval config + eval wrapper |
| `lib/agents/synthesis/generator.ts` | `synthesize` — LLM call |
| `lib/agents/synthesis/prompt.ts` | Synthesis prompt builder |

### Deleted files

| File | Reason |
|------|--------|
| `lib/roleAgent.ts` | Replaced by reducer + generators |
| `lib/roleAgentPrompts.ts` | Prompts move to agent directories |

### Modified files

| File | Change |
|------|--------|
| `routes/discovery/roleContexts.ts` | Replace `/respond` with `/state`, `/question`, `/synthesize` |
| `src/hooks/useRoleDiscovery.ts` | Orchestrate reducer + generator calls |
| `src/hooks/useConversation.ts` | Accept state from reducer, display phase/coverage |

---

## 9. Migration Path

### Step 1: Extract reducer

1. Create `lib/agents/interview/reducer.ts`
2. Move `buildPhaseDirective`, coverage logic, knowledge state merging into reducer
3. Make it pure: `(state, action) => newState`
4. Add tests: every action → expected state

### Step 2: Extract question generator

1. Create `lib/agents/question/generator.ts`
2. Move question generation from `callRoleAgent`
3. Remove tool loop, synthesis path, gap-filling
4. Stateless: takes `InterviewState`, returns `Question`

### Step 3: Extract synthesis generator

1. Create `lib/agents/synthesis/generator.ts`
2. Move synthesis from `callRoleAgent`
3. Stateless: takes `InterviewState`, returns `Persona + JD`

### Step 4: Wire eval gate

1. Create `lib/agents/question/eval.ts`
2. Define eval dimensions
3. Call `runEvalGate` in `/question` endpoint

### Step 5: Update frontend

1. `useRoleDiscovery.ts` calls `/state` then `/question` (or `/synthesize`)
2. Display `state.phase`, `state.coverage`, `state.questionsAsked` in UI

### Step 6: Delete legacy

1. Delete `lib/roleAgent.ts`
2. Delete `lib/roleAgentPrompts.ts`
3. Update imports

---

## 10. Acceptance Criteria

- [ ] `interviewReducer` is pure: same `(state, action)` → same `newState`
- [ ] `interviewReducer` runs in <10ms (no LLM calls)
- [ ] `generateQuestion` is stateless: same `state` → same prompt
- [ ] `generateQuestion` completes in <2s (single LLM call)
- [ ] Eval gate runs on every question, produces `EvalResult`
- [ ] Frontend displays `state.phase`, `state.coverage`, `state.questionsAsked`
- [ ] Synthesis produces same quality RCD as legacy
- [ ] `lib/roleAgent.ts` deleted
