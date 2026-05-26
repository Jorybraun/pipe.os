# Phase 2: Role Discovery Migration — Implementation Handoff

> **Date:** 2026-04-23
> **Status:** Phase 0 & 1 Complete. Phase 2 Ready to Start.
> **Depends on:** ADR-034 Unified Agent Runtime, ADR-041 Prerequisite Fixes

---

## 1. What Phase 2 Must Accomplish

Migrate the **Role Discovery Agent** from its legacy monolithic implementation (`lib/roleAgent.ts`, `lib/roleAgentPrompts.ts`) into the **Unified Agent Runtime** pattern (`agents/roleDiscovery/` plugin + runtime libraries).

The migration must be **behavior-preserving** — existing BDD Playwright tests and recruiter UI flows must continue to work unchanged.

---

## 2. What Was Completed Before This (Phase 0 + 1)

### Phase 0 (ADR-041 Prerequisite)
- ✅ `ConversationPhase` renamed `QUALIFY_CLOSE` → `WRAP_UP`
- ✅ `roleAgentPromptsV2.ts` promoted → `roleAgentPrompts.ts`, V2 deleted
- ✅ Budget defaults: `10 → 8`, `QUESTION_BUDGETS = [6, 8, 10, 15]`
- ✅ Test fixtures updated across 4 files

### Phase 1 (Runtime Integration)
- ✅ `registerAllPlugins()` called at Worker boot (`index.ts`)
- ✅ Unified `routes/agents.ts` mounted in Hono app (`app.route('', agents)`)
- ✅ Provider factory wired into `agents.ts` (`createRoleAgentProvider(env)`)
- ✅ `InMemorySessionStore` kept for dev (D1 swap is Phase 5)

---

## 3. Phase 2 Task Breakdown

### 3.1 Create `agents/roleDiscovery/interviewer.ts`

**Goal:** Port `callRoleAgent()` logic into the plugin's `generateTurn` method.

**Source material:**
- `workers/api/src/lib/roleAgent.ts` — main agent logic (lines 497–570)
- `workers/api/src/lib/roleAgentPrompts.ts` — prompt builders (already promoted V2)

**What to port:**
- `callRoleAgent()` — the core ReAct + tool-calling loop
- Mock fallbacks (`getMockQuestionResponse`, `getMockSynthesisResponse`)
- JSON parsing/validation (`parseQuestionResponse`, `parseSynthesisResponse`)
- Tool execution (`executeToolCall`, `fetchAndExtract`, `AGENT_TOOLS`)

**What to drop:**
- `callRoleAgentStream()` — streaming is being deleted in this phase
- The old V1 monolithic prompt selection (already gone after Phase 0)

**Plugin interface:**
```ts
// Current stub in agents/roleDiscovery/plugin.ts
async generateTurn(session, context, provider): Promise<AgentTurn>
```

The `generateTurn` signature receives `provider: LLMProvider | null`. Use `callProviderWithTools(provider, messages)` pattern from `roleAgent.ts` when provider is non-null; fall back to mock responses when null.

**Key decision:** The `AgentTurn` shape is different from `RoleAgentQuestionResponse`:
- `AgentTurn`: `{ idx, questionId, questionText, candidateResponse, metadata, timestamp }`
- `RoleAgentQuestionResponse`: `{ type: 'question', question: { id, text, input, suggestedAnswers }, ... }`

Map between them inside `generateTurn`.

### 3.2 Create `agents/roleDiscovery/prompts.ts`

**Goal:** Extract role-discovery-specific prompt builders from `lib/roleAgentPrompts.ts`.

**Source material:**
- `workers/api/src/lib/roleAgentPrompts.ts` — `buildRoleAgentSystemPrompt`, `buildRoleAgentUserMessage`, `buildSynthesisPrompt`, phase-specific prompts, `buildConversationContext`, `buildPhaseDirective`

**What to extract:**
- `buildRoleAgentSystemPrompt(participantRole)`
- `buildRoleAgentUserMessage(opts)`
- `buildSynthesisPrompt(opts)`
- `buildConversationContext(knowledgeState, exchanges)`
- `buildPhaseDirective(context, questionsAsked, questionBudget)`
- `selectPhasePrompt(phase, participantRole)`
- All phase-specific prompt builders (`buildContextPhasePrompt`, `buildDiscoveryPhasePrompt`, etc.)
- `buildVoiceSystemPrompt`

**What to keep in `lib/roleAgentPrompts.ts`:**
- RCD synthesis prompts (`buildRcdSynthesisSystemPrompt`, `buildRcdSynthesisUserMessage`) — these are shared across stakeholders and used by `synthesizeRcd.ts`, not per-turn

**Open question:** Should `lib/roleAgentPrompts.ts` re-export from `agents/roleDiscovery/prompts.ts` for backwards compatibility, or update all import sites? There are ~5 import sites:
- `roleAgent.ts` (being migrated → will import from new location)
- `roleContexts.ts` (uses `buildConversationContext`, `buildPhaseDirective`)
- `useRoleDiscovery.ts` (frontend — does not import prompts)
- Tests

**Recommendation:** Create the new file, update `lib/roleAgentPrompts.ts` to re-export from it with a deprecation comment, then clean up in Phase 6.

### 3.3 Wrap `evaluator.ts` into `EvalConfig`

**Goal:** Make the existing per-question evaluator work with the runtime's `runEvalGate`.

**Source material:**
- `workers/api/src/lib/roleDiscovery/evaluator.ts` — `evaluateQuestion()` function
- `workers/api/src/lib/roleDiscovery/evaluatorPrompt.ts` — prompt builders

**Current state:**
- `evaluateQuestion(provider, candidate, conversationHistory, currentCoverage)` returns `EvalResult`
- The runtime's `runEvalGate(provider, turn, session, evalConfig)` expects `EvalConfig` with dimension prompts

**Approach:**
The evaluator is already structured as a quality gate. Create an `EvalConfig` that maps each evaluator dimension (goal alignment, coverage realism, tone, redundancy, probe fidelity) to an `EvalDimensionConfig` with the appropriate prompt template. Then call `evaluateQuestion` inside a wrapper or adapt the prompts to work with `runEvalGate`.

**Simpler approach (recommended):** Keep `evaluateQuestion` as-is and call it directly from `generateTurn` before returning the turn, rather than forcing it through `runEvalGate`. The runtime `runEvalGate` is designed for generic dimension evaluation; the role discovery evaluator has a specialized 5-dimension pipeline with its own parser. Wrap it pragmatically:

```ts
// In plugin.ts generateTurn
const turn = await generateRawTurn(session, provider);
if (provider && plugin.evalConfig) {
  const evalResult = await evaluateQuestion(provider, mapTurnToCandidateQuestion(turn), ...);
  if (!evalResult.approved && evalResult.suggestedRewrite) {
    turn.questionText = evalResult.suggestedRewrite;
  }
}
return turn;
```

### 3.4 Delete `callRoleAgentStream()` from `roleAgent.ts`

**Goal:** Remove streaming variant.

**Steps:**
1. Delete `callRoleAgentStream()` function (lines 581–643)
2. Delete `completeStream` usage from `roleAgent.ts`
3. Verify no other imports reference `callRoleAgentStream` (already confirmed: only `roleContexts.ts`)

### 3.5 Update `roleContexts.ts` respond handler

**Goal:** Replace streaming loop with synchronous call + single SSE event.

**Current state:** The respond handler has TWO paths:
1. **Streaming path** (lines 616–830): Uses `streamSSE`, `callRoleAgentStream`, yields chunks + done event
2. **Non-streaming path** (lines 832–1000+): Uses `callRoleAgent`, returns JSON

**What to change:**
- Remove the streaming path entirely (the `if (acceptHeader === 'text/event-stream')` block)
- Keep the non-streaming path but wrap it in a single SSE `done` event when the client requests streaming
- OR: keep both paths but make the streaming path call `callRoleAgent()` synchronously and emit one `done` event

**Recommended approach:** Since the frontend `useRoleDiscovery.ts` already handles both sync JSON and SSE `done` events, the safest change is:

```ts
// Replace the streaming block with:
if (acceptHeader === 'text/event-stream') {
  return streamSSE(c, async (stream) => {
    // ... do the same logic as non-streaming ...
    const agentResponse = await callRoleAgent(agentInput);
    // ... persist ...
    await stream.writeSSE({ event: 'done', data: JSON.stringify(resultPayload) });
  });
}
```

This preserves the SSE contract for the frontend while eliminating the streaming generator.

### 3.6 Update frontend `useRoleDiscovery.ts`

**Goal:** Remove `respondStream` path.

**Current state:** The `ConversationAdapter` interface has both `respond()` (sync) and `respondStream()` (async generator). The `useConversation` hook decides which to call based on some config.

**What to change:**
1. In `useRoleDiscovery.ts`, remove the `respondStream` method from `roleDiscoveryAdapter`
2. Update `useConversation.ts` (if it has streaming-specific logic for role discovery)
3. Update `useRoleDiscovery.test.ts` (if it tests streaming)

**Important:** Check `useConversation.ts` to see if it auto-detects streaming support via `adapter.respondStream` existence.

### 3.7 Ensure BDD tests pass

**Key test files:**
- `e2e/role-discovery.spec.ts` — Full flow
- `e2e/role-discovery-streaming.spec.ts` — If this exists, it will need updating or deletion
- `workers/api/src/__tests__/roleDiscovery.test.ts` — Unit tests

**Behavioral contract to preserve:**
- POST `/api/v1/role-contexts/:id/respond` returns JSON when `Accept: application/json`
- POST `/api/v1/role-contexts/:id/respond` returns SSE `done` event when `Accept: text/event-stream`
- Response shape: `{ participantId, acknowledgment, question, progress, status }` for question turns
- Response shape: `{ participantId, synthesis, persona, jobDescription, rcd, progress }` for synthesis

---

## 4. File Inventory

### Files to create
```
workers/api/src/lib/agents/roleDiscovery/
├── interviewer.ts      (ported from roleAgent.ts)
├── prompts.ts          (extracted from roleAgentPrompts.ts)
└── evaluator.ts        (wrapper around existing evaluator.ts)
```

### Files to modify
```
workers/api/src/lib/agents/roleDiscovery/plugin.ts     (wire generateTurn to interviewer)
workers/api/src/lib/roleAgent.ts                       (delete callRoleAgentStream)
workers/api/src/lib/roleAgentPrompts.ts                (re-export or keep RCD synthesis only)
workers/api/src/routes/discovery/roleContexts.ts       (replace streaming loop)
src/hooks/useRoleDiscovery.ts                          (remove respondStream)
```

### Files to delete (future — after full cutover)
```
workers/api/src/lib/roleAgent.ts
```

---

## 5. Open Questions / Decisions Needed

1. **Evaluator integration strategy:** Call `evaluateQuestion` directly inside `generateTurn`, or force it through `runEvalGate`? The direct call is simpler and preserves the existing 5-dimension parser.

2. **Prompt file split:** How much of `roleAgentPrompts.ts` moves to `agents/roleDiscovery/prompts.ts`? The RCD synthesis prompts are shared across all stakeholders and should stay in `lib/`. Everything else (interviewing prompts, phase controller) is role-discovery-specific.

3. **Frontend streaming removal:** Does `useConversation.ts` auto-detect `respondStream`? If so, simply removing the method from the adapter may be enough.

4. **Budget enforcement:** The plugin stub already has FSM `canTerminate` based on `questionBudget`. The migrated `generateTurn` should read budget from `session.transcript.scratchpad.questionBudget` and return synthesis when exhausted.

---

## 6. Quality Gates (Every Subtask)

| Gate | Command | Must Pass |
|---|---|---|
| Type check | `npx tsc --noEmit -p workers/api/tsconfig.json` | Zero new errors |
| Unit tests | `npx vitest run workers/api/src/__tests__/roleDiscovery.test.ts` | 18 pass, 0 new failures |
| E2E tests | `npx playwright test e2e/role-discovery.spec.ts` | All pass |
| Runtime tests | `npx vitest run workers/api/src/lib/unifiedAgentRuntime` | 44+ pass |

---

## 7. How to Pick This Up

1. **Start with 3.1** (`interviewer.ts`) — port `callRoleAgent()` logic into `generateTurn`. This is the biggest piece.
2. **Then 3.2** (`prompts.ts`) — extract prompts. Update `roleAgentPrompts.ts` to re-export.
3. **Then 3.4 + 3.5** — delete streaming, update `roleContexts.ts` respond handler.
4. **Then 3.3** — wrap evaluator (smaller, can be done in parallel with 3.1/3.2 if you want a swarm).
5. **Then 3.6** — frontend cleanup.
6. **Run all gates** after every subtask.
