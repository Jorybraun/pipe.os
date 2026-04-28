# Handoff: Role Discovery State Machine + Generator Split

**Date:** 2026-04-28
**Branch/Context:** star-lord-daredevil-red-star plan
**Status:** Steps 1–5 complete. Steps 6–7 pending.

---

## What Was Built

Split the monolithic `callRoleAgent` (677 lines) into three separate entities plus an eval gate.

### New Files

| File | Responsibility | Tests |
|------|---------------|-------|
| `lib/agents/interview/types.ts` | `InterviewState`, `InterviewAction`, `CreateInterviewStateInput` | — |
| `lib/agents/interview/reducer.ts` | Pure deterministic reducer `(state, action) => newState`. Phase selection refactored from `buildPhaseDirective` into declarative `phaseRules`. | **30 pass** |
| `lib/agents/question/prompt.ts` | Concise prompt builder from `InterviewState`. Reuses `selectPhasePrompt` for posture but drops the 800-line `CORE_PROMPT`. | — |
| `lib/agents/question/generator.ts` | Stateless `generateQuestion(state, provider)`. Single LLM call. No tool loop. No synthesis path. | **8 pass** |
| `lib/agents/question/eval.ts` | 5-dimension eval gate (`brevity`, `coverage`, `redundancy`, `phase_alignment`, `acknowledgment_quality`). Zero UAR dependency. | **7 pass** |
| `lib/agents/synthesis/prompt.ts` | Focused synthesis prompt (persona rules + JD rules + response format). ~130 lines vs 800. | — |
| `lib/agents/synthesis/generator.ts` | Stateless `synthesize(state, provider)`. Returns `persona`, `jobDescription`, `synthesis`. | **9 pass** |

### Modified Files

| File | Change |
|------|--------|
| `validation/roleContexts.ts` | Added `stateActionSchema`, `questionSchema`, `synthesizeSchema` |
| `routes/discovery/roleContexts.ts` | Three new endpoints: `POST /:id/state`, `POST /:id/question`, `POST /:id/synthesize`. Existing `/respond` untouched. |

### Test Summary

- **54 new agent tests** — all pass
- **34 existing route tests** — all pass
- **18 existing roleDiscovery tests** — all pass

---

## Architecture Decisions

### 1. Reducer is pure, no LLM

`interviewReducer` handles structural state changes only:
- Appends exchange + answer
- Increments `questionsAsked`
- Merges optional `knowledgeStateUpdate` / `domainCoverage` from the action
- Re-computes `phase` and `synthesisReady` deterministically

Knowledge-state extraction still happens in the **question generator** (LLM), not the reducer. The reducer receives the extracted facts as part of the `ANSWER` action. This keeps the reducer fast (<10ms, pure code) while preserving the quality of LLM-driven fact extraction.

### 2. Phase selection refactored into declarative rules

Instead of the original `if/else` chain from `buildPhaseDirective`:

```typescript
// Before (imperative)
if (questionsAsked < 2) { ... }
else if (!allProbesDelivered) { ... }

// After (declarative)
const rules = [
  { match: questionsAsked < 2, phase: 'CONTEXT', ... },
  { match: !allProbesDelivered, phase: 'DISCOVERY', ... },
  ...
];
const selected = rules.find(r => r.match)!;
```

This is easier to extend (add a phase = add one array entry) and trivial to unit-test in isolation.

### 3. Eval gate is lightweight, no UAR dependency

The existing `runEvalGate` in `lib/unifiedAgentRuntime/evalGate.ts` depends on UAR types (`AgentSession`, `AgentTurn`, `callProvider`). The UAR is unfinished and was never adopted for production role discovery.

We built a standalone eval gate in `lib/agents/question/eval.ts` that:
- Defines dimensions as simple prompt templates
- Runs them in parallel using `provider.complete()` directly
- Supports `all_pass`, `no_fail`, and `weighted` approval rules
- Returns `{ approved, dimensions[], rewrite? }`

### 4. Prompts are state-rendered, not history-concatenated

The question generator prompt renders the `InterviewState` directly:

```
BASELINE: {JSON}
PHASE: {state.phase}
BUDGET: {state.questionsAsked} of {state.questionBudget}
DOMAIN COVERAGE: {JSON}
KNOWLEDGE STATE: {JSON}
EXCHANGES: {formatted}
```

No separate "conversation history" + "knowledge state" sections. The state IS the context.

### 5. Backward compatibility during migration

The existing `POST /:id/respond` endpoint is **untouched**. The new endpoints (`/state`, `/question`, `/synthesize`) live alongside it. This allows:
- Gradual frontend migration
- A/B testing between old and new flows
- Safe rollback if issues arise

---

## New API Endpoints

### `POST /api/v1/role-contexts/:id/state`

**Body:** `{ state: InterviewState, action: InterviewAction }`
**Response:** `{ state: InterviewState }`

Runs the reducer and returns the new state. The frontend is expected to hold state and send it.

### `POST /api/v1/role-contexts/:id/question`

**Body:** `{ state: InterviewState, enableEval?: boolean }`
**Response:** `GeneratedQuestion + optional { eval: EvalResult }`

Generates the next question from state. Optional eval gate (`enableEval=true`).

### `POST /api/v1/role-contexts/:id/synthesize`

**Body:** `{ state: InterviewState }`
**Response:** `SynthesisResult`

Produces persona + JD from a completed interview state. Uses `ROLE_AGENT_SYNTHESIS_PROVIDER`.

---

## What Was NOT Changed (Intentionally)

- `lib/roleAgent.ts` — still exists, still used by `/respond` and `/complete`
- `lib/roleAgentPrompts.ts` — still exists, still re-exports from `agents/roleDiscovery/prompts.ts`
- `lib/agents/roleDiscovery/prompts.ts` — untouched (reused by new code via `selectPhasePrompt`)
- `runRcdSynthesis` in `roleContexts.ts` — untouched. Multi-stakeholder RCD synthesis is a separate concern from the single-participant inline synthesis generator.
- Frontend code — no changes yet

---

## Known Gaps / Next Steps

### Step 6: Frontend Orchestration (Pending)

The frontend needs to stop using `POST /respond` and start orchestrating:

```
User submits answer
  → POST /state { state, action: { type: 'ANSWER', answer, knowledgeStateUpdate, domainCoverage } }
  ← { state: newState }

Frontend checks newState.synthesisReady
  → true:  POST /synthesize { state }
  → false: POST /question { state, enableEval: true }
```

**Files to modify:**
- `src/hooks/useRoleDiscovery.ts` — replace `callRespond()` with orchestration
- `src/hooks/useConversation.ts` — display `state.phase`, `state.coverage`, `state.questionsAsked`
- UI components — show phase badge, coverage bars, progress

**Open question:** Does the frontend store `InterviewState` in React state, Zustand, or send it to the backend after every reducer call? The `/state` endpoint currently does NOT persist to D1 (it only runs the reducer). If we want server-side state, we need to add persistence logic.

### Step 7: Delete Legacy (Pending)

Once the frontend is fully migrated:

1. Delete `lib/roleAgent.ts`
2. Delete `lib/roleAgentPrompts.ts` (or reduce to pure re-export shim)
3. Remove `/respond` endpoint from `roleContexts.ts`
4. Remove `callRoleAgent` imports from `roleContexts.ts`
5. Update any remaining consumers of `CallRoleAgentInput`, `RoleAgentResponse`, etc.

### Gap: Streaming

The new `/question` endpoint does not support SSE streaming yet. The old `/respond` had a streaming path (`Accept: text/event-stream`). If the frontend relies on streaming tokens, we need to add `streamSSE` to `/question`.

### Gap: Tool Calling

The new question generator has **no tool loop**. Research tools (`research_company`, `search_technology`) were moved out of the hot path per the plan. If we need them, they should be:
- Pre-fetched at interview start (company research)
- Backgrounded / cached in state

### Gap: Gap-Filling Calibration

`callGapFillingAgent` in `lib/roleAgent.ts` is used by the `/calibrate` endpoint. This is a separate agent call that asks a clarifying question about a flagged RCD gap. It should be extracted into its own module before `lib/roleAgent.ts` is deleted.

### Gap: Multi-Stakeholder Synthesis

The new `synthesize()` generator produces persona + JD from a **single participant's** `InterviewState`. The production path for final synthesis is `runRcdSynthesis`, which reads ALL participants from D1 and calls `synthesizeRcd()` for multi-stakeholder RCD generation.

The `/synthesize` endpoint is useful for:
- Quick inline preview during a single-participant interview
- Force-complete scenarios

But the canonical synthesis path remains `runRcdSynthesis` → `synthesizeRcd` → `deriveJobDescriptionFromRcd`.

---

## How to Verify

```bash
cd workers/api

# New agent tests
npx vitest run src/lib/agents/

# Existing tests (should still pass)
npx vitest run src/__tests__/roleDiscovery.test.ts
npx vitest run src/routes/discovery/
```

---

## Files to Review

High-priority review:
1. `lib/agents/interview/reducer.ts` — phase selection logic, state shape
2. `lib/agents/question/generator.ts` — prompt construction, parsing
3. `lib/agents/question/eval.ts` — dimension prompts, approval rules
4. `routes/discovery/roleContexts.ts` — new endpoint handlers (lines ~1098–1200)

Medium-priority review:
5. `lib/agents/synthesis/generator.ts` — synthesis parsing
6. `validation/roleContexts.ts` — new schemas

---

## Rollback Plan

If anything breaks:
1. Frontend continues using `POST /respond` (it was not modified)
2. New endpoints can be removed without affecting existing flow
3. `lib/roleAgent.ts` is still present and functional
