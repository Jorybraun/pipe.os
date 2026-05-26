# Handoff: Role Discovery Frontend Hooks + Remaining Work

**Date:** 2026-04-28  
**Branch/Context:** star-lord-daredevil-red-star plan  
**Status:** Step 6 (frontend hooks) complete. Steps 1–6 done. Remaining items below.

---

## What Was Built (This Session)

### Frontend adapter rewired to new state-machine endpoints

`src/hooks/useRoleDiscovery.ts` now orchestrates `/state` → `/question` (or `/synthesize`) instead of the monolithic `/respond`.

**Flow per user answer:**
```
adapter.respond(answer)
  → POST /state   { state: InterviewState, action: { type: 'ANSWER', answer, knowledgeStateUpdate, domainCoverage } }
  ← { state: newState }

  if newState.synthesisReady:
    → POST /synthesize { state: newState }
    ← { persona, jobDescription, synthesis }
    → return SynthesisResult
  else:
    → POST /question { state: newState, enableEval: true }
    ← { question, acknowledgment, knowledgeStateUpdate, domainCoverage }
    → store KS update for next turn, append unanswered exchange
    → return QuestionTurnResult
```

**Key design decisions:**
- `InterviewState` lives in `useRef` (not React state or closure variables) so it survives adapter re-creation when `useApiClient` returns a new object.
- `pendingKsuRef` / `pendingDcRef` hold the `knowledgeStateUpdate` and `domainCoverage` from the *previous* `/question` response, feeding them into the *next* `/state` call.
- `participantRole` is detected from `knowledgeState._meta.participantRole` after each reducer run, matching the old inference behavior.
- `respondStream` is **not implemented** on the new adapter — `useConversation` falls back to non-streaming `respond()`.

### Files modified

| File | Change |
|------|--------|
| `src/hooks/useRoleDiscovery.ts` | New adapter: `initialize` builds `InterviewState`; `respond` orchestrates `/state` + `/question` + `/synthesize`; `completeEarly` forces synthesis; `hydrateInterviewState` / `resetInterviewState` for resume/reset |
| `src/lib/api/types.ts` | Added `InterviewState`, `InterviewPhase`, `InterviewStateExchange`, `PostStateRequest/Response`, `PostQuestionRequest/Response`, `PostSynthesizeRequest/Response` |
| `src/hooks/useRoleDiscovery.test.ts` | Tests rewritten to mock `api.post` for `/state`, `/question`, `/synthesize` instead of `api.postStream` for `/respond`. **6/6 pass.** |

### Verification

- `npx tsc --noEmit` — clean (only pre-existing `ThinkingIndicator` warning)
- `npx vite build` — passes
- `npx vitest run src/hooks/useRoleDiscovery.test.ts` — **6/6 pass**
- `npx vitest run src/lib/agents/` — 54 pass (backend agent tests)
- `npx vitest run src/routes/discovery/` — 34 pass (backend route tests)

---

## What Remains (Prioritized)

### 🔴 High Impact — Do These First

#### 1. Add SSE streaming to `/question`

**Problem:** The old `/respond` endpoint streamed tokens via SSE (`Accept: text/event-stream`). The new `/question` returns a single JSON blob. Users lose real-time token delivery.

**What to do:**
- Add a `streamSSE` variant to `POST /:id/question` in `workers/api/src/routes/discovery/roleContexts.ts`.
- Pattern already exists in the old `/respond` handler — look at `streamSSE` usage around line 1090.
- The adapter's `respondStream` method should be re-implemented to call the streaming `/question` endpoint.
- Frontend: `useConversation` already supports streaming — it checks `adapter.respondStream` and yields `chunk` events. Just implement the method on the adapter.

**Risk:** Low. Pattern exists. `useConversation` streaming branch is already tested.

#### 2. Extract `callGapFillingAgent` from `lib/roleAgent.ts`

**Problem:** The `/calibrate` endpoint (line 1496 of `roleContexts.ts`) still imports `callGapFillingAgent` from the monolithic `lib/roleAgent.ts`. You cannot safely delete `lib/roleAgent.ts` until this is moved.

**What to do:**
- Create `workers/api/src/lib/agents/calibration/gapFilling.ts`.
- Move `callGapFillingAgent`, `CallGapFillingAgentInput`, `CallGapFillingAgentOutput`, and `GAP_FILLING_SYSTEM_PROMPT` from `lib/roleAgent.ts` into the new module.
- Update `roleContexts.ts` import from `../../lib/roleAgent` to `../../lib/agents/calibration/gapFilling`.
- `mergeKnowledgeState` is already duplicated in `lib/agents/interview/reducer.ts` — confirm it's not needed from `roleAgent.ts` before deleting.

**Risk:** Low. Isolated function (~40 lines). Single consumer (`/calibrate`).

---

### 🟡 Medium Impact

#### 3. Fix `hydrateInterviewing` phase reconstruction

**Problem:** In `useRoleDiscovery.ts` line 410, `hydrateInterviewing` hardcodes:
```typescript
phase: data.questionsAsked < 2 ? 'CONTEXT' : 'DISCOVERY',
```
If a user refreshes during `PRIORITIZE` or `EVP_FRICTION`, the frontend displays the wrong phase until the next answer triggers the reducer.

**What to do:**
- The server needs to return the correct `phase` somewhere in the resume payload. Currently `RoleContextFullState` and `RoleContextParticipantSummary` do **not** include `phase`.
- **Option A (backend):** Add `phase` to `RoleContextParticipantSummary` on the server (computed from `knowledgeState` + `questionsAsked` via `selectPhase`), then update `hydrateInterviewing` to use `data.phase`.
- **Option B (frontend-only):** Run `selectPhase` logic locally in `hydrateInterviewing` by reading `knowledgeState` flags (`_mustHavesPrioritized`, `_frictionProbed`, `_probesDelivered`, etc.). This avoids a backend change but duplicates the reducer's phase logic.
- **Recommendation:** Option A — add `phase` to `RoleContextParticipantSummary` and the GET `/role-contexts/:id` response. Single source of truth.

#### 4. Surface phase, reasoning, and urgent gaps in the UI

**Problem:** The reducer now returns rich metadata (`focusGoal`, `urgentGaps`, `reasoning`, `synthesisAllowed`) from `selectPhase`, but nothing surfaces it to the user.

**What to do:**
- Add `phase`, `reasoning`, and `urgentGaps` to `InterviewState` (they're already computed by `selectPhase` in the reducer but not persisted in `InterviewState` — they return as `PhaseSelectionResult` and are only used for the prompt).
- **Quick win:** Add `phase` badge to `AIChat` or the role-discovery page header: `"DISCOVERY · Probe 4 of 8"`.
- **Medium win:** Show a small "gaps remaining" chip when `synthesisAllowed` is false — e.g. "2 probes remaining · must-haves not ranked".
- **Files:** `src/components/AIChat/AIChat.tsx`, `src/pages/RoleDiscoveryPage.tsx` (or wherever the interview UI lives).

---

### 🟢 Cleanup (Step 7 — Only After Production Validation)

#### 5. Delete Legacy

Once you're confident the new flow is stable:

1. **Delete `workers/api/src/lib/roleAgent.ts`**
   - After extracting `callGapFillingAgent` (item 2 above).
   - After confirming `callRoleAgent`, `buildPhaseDirective`, and the 800-line prompt are no longer imported anywhere.

2. **Delete `workers/api/src/lib/roleAgentPrompts.ts`**
   - Or reduce to a pure re-export shim if anything still imports it.

3. **Remove `/respond` endpoint from `roleContexts.ts`**
   - Lines ~550–1100 (the old `POST /:id/respond` handler). Large block.

4. **Clean up imports**
   - `callRoleAgent` imports in `roleContexts.ts`.
   - Unused types like `RespondRoleContextResponse`, `RespondSynthesisResponse`, `RespondQuestionResponse` from `validation/roleContexts.ts` if still present.

5. **Update `roleContexts.ts` GET `/role-contexts/:id`**
   - Remove legacy `exchanges` field from the root response (it's now on `participants`).

**Risk:** High. Only do this after the frontend has been running the new endpoints in production for at least a few days with no issues.

---

## Open Questions

1. **Does `/state` persist to D1?** No — it runs the reducer and returns the new state. The frontend holds state. If we want server-side state resilience (e.g., user refreshes mid-interview and we don't have the state in localStorage), we'd need to add D1 persistence to `/state` or have the frontend send state to the server periodically.

2. **What about `callGapFillingAgent`'s fallback?** The current implementation returns a generic fallback question if the LLM call fails. The extracted module should preserve this behavior.

3. **Should `enableEval` default to true?** Currently the frontend hardcodes `enableEval: true` on every `/question` call. We may want to make this configurable per-deployment or per-pipeline.

---

## How to Verify

```bash
cd workers/api
npx vitest run src/lib/agents/        # 54 agent tests
npx vitest run src/routes/discovery/  # 34 route tests
npx vitest run src/__tests__/roleDiscovery.test.ts  # 18 legacy tests

cd ../..
npx vitest run src/hooks/useRoleDiscovery.test.ts   # 6 frontend tests
npx tsc --noEmit
npx vite build
```

---

## Next Actions (Pick One)

| Option | Scope | Risk | Value |
|--------|-------|------|-------|
| **A. Add streaming to `/question`** | Backend endpoint + adapter `respondStream` | Low | High — restores UX parity with old flow |
| **B. Extract gap-filling agent** | Move `callGapFillingAgent` to `lib/agents/calibration/` | Low | Medium — unblocks Step 7 (legacy deletion) |
| **C. Fix hydrateInterviewing phase** | Backend `RoleContextParticipantSummary.phase` + frontend consume | Low | Medium — correctness for resume |
| **D. Surface phase/gaps in UI** | `AIChat` or page header badges | Low | Medium — user-visible improvement |
| **E. Delete legacy** | Remove `roleAgent.ts`, `roleAgentPrompts.ts`, `/respond` | High | High — code cleanup |

**Recommendation:** Do **A + B in parallel** (independent, both block full legacy deletion), then **C**, then **D**, then **E** only after prod validation.
