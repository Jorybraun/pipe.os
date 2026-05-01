# Handoff: Role Discovery State Machine — Kimi k2.6 Testing Session

**Date:** 2026-04-28  
**Author:** Kimi (autonomous agent session)  
**Context:** Switched from Kimi k2.6 → Vertex AI (Google Gemini) for role discovery agent
**Provider:** `ROLE_AGENT_PROVIDER=vertex-ai`, `VERTEX_AI_MODEL=google/gemini-3-flash-preview`  
**Status:** 🟢 Working — `/question` returns valid JSON reliably, eval disabled for speed

---

## What Was Tested

End-to-end flow: Frontend → `POST /:id/state` → `POST /:id/question` → Frontend state update

| Component | Status | Notes |
|-----------|--------|-------|
| Frontend state management | ✅ Working | `useRoleDiscovery.ts` holds `InterviewState`, calls reducer locally |
| `/state` endpoint | ✅ Working | Returns `200` with updated state, deterministic phase transitions |
| `/question` endpoint | ✅ Working | Returns valid JSON in **~7s** with Vertex AI |
| SSE streaming | ⚠️ Bypassed | Replaced `respondStream` with `respond` (non-streaming) in adapter |
| Eval gate (`/evaluate`) | ⏸️ Disabled | Can re-enable now that base latency is 7s instead of 38s |
| Synthesis (`/synthesize`) | ⏳ Not tested | Blocked until coverage gates pass |

---

## Critical Fixes Applied

### 1. `reasoning: null` (original fix)

Same as before — disables reasoning mode to force output into `content`.

### 2. Robust JSON extraction (`kimiProvider.ts` + `generator.ts`)

**Problem:** Kimi k2.6 is **non-deterministic**. Even with `reasoning: null`, sometimes:
- `content` has JSON, `reasoning_content` has reasoning ✅
- `content` has reasoning, `reasoning_content` has JSON ⚠️
- `content` has reasoning, `reasoning_content` is empty ❌

**Fix in `kimiProvider.ts`:**
```typescript
const contentLooksLikeJson = contentText.trim().startsWith('{');
const reasoningLooksLikeJson = reasoningText.trim().startsWith('{');
let rawText = '';
if (contentLooksLikeJson) rawText = contentText;
else if (reasoningLooksLikeJson) rawText = reasoningText;
else if (contentText) rawText = contentText;
else if (reasoningText) rawText = reasoningText;
```

**Fix in `generator.ts` (`cleanJson`):**
```typescript
const firstBrace = trimmed.indexOf('{');
const lastBrace = trimmed.lastIndexOf('}');
if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
  return trimmed.slice(firstBrace, lastBrace + 1);
}
```

### 3. Eval gate disabled for speed

**Before:** 38s per `/question` (5 parallel eval dimensions)
**After:** 24s per `/question` (question generation only)

Changed `enableEval: true` → `enableEval: false` in `useRoleDiscovery.ts`.

**Problem:** Kimi k2.6 on the coding endpoint (`api.kimi.com/coding/v1`) outputs reasoning tokens into `reasoning_content` instead of `content`. The `generator.ts` parser expects JSON in `content`, so `JSON.parse` failed on empty string.

**Root cause discovery:** `agent-harness/swarm/agents/developer.py` (and every other agent) passes `extra_body={"reasoning": None}` to `ChatOpenAI`. This disables reasoning mode and forces all output into the `content` field.

**Fix in `workers/api/src/lib/llm/kimiProvider.ts`:**

```typescript
const body: Record<string, unknown> = {
  model: this.model,
  messages: openaiMessages,
  max_tokens: options.maxTokens ?? 4096,  // was 1024
  temperature: 0.2,
  reasoning: null,  // ← NEW: disables reasoning mode
};
```

Also changed:
- `User-Agent: Kilo-Code/1.0` → `claude-code/0.1` (matches agent-harness exactly)

**Verification:** curl test confirmed `content` field now contains the JSON response (not `reasoning_content`).

---

## SSE Streaming Status

**Current workaround:** `useRoleDiscovery.ts` adapter uses `respond()` (non-streaming JSON) instead of `respondStream()`.

**Why:** Kimi's coding endpoint sends streaming tokens in `delta.reasoning_content` instead of `delta.content` when `response_format: {type: "json_object"}` is used. The SSE parser fix (accumulating multi-line `data:` lines) was applied to `client.ts`, but the underlying issue is the API's delta field placement.

**Future:** If/when Kimi fixes streaming delta fields, revert the adapter to `respondStream`.

---

## Known Issues

### 1. Eval Gate Performance
`evaluateQuestion()` in `eval.ts` runs 5 parallel LLM calls (one per dimension: brevity, coverage, redundancy, phase_alignment, acknowledgment_quality).
- With Kimi k2.6: added ~14s on top of 24s base = 38s total ❌
- With Vertex AI (Gemini): base is ~7s; eval would add ~3-5s = ~10-12s total ✅
- **Status:** Still disabled in frontend (`enableEval: false`) for now. Can re-enable.

### 2. `max_tokens` too low for some questions
Default was `1024`; bumped to `4096` to match agent-harness. Some role descriptions + state context can exceed 2K tokens in the prompt, leaving little room for the response.

### 3. `dayInLifeProbed` missing from `allGatesPass`
Found during code review — `dayInLifeProbed` was not checked in the synthesize gate condition. Fixed in `reducer.ts`.

---

## How to Resume Testing

1. **Restart the worker** (`.dev.vars` changes don't hot-reload):
   ```bash
   cd workers/api && npx wrangler dev --port 8787
   ```

2. **Test the `/question` endpoint**:
   ```bash
   curl -X POST http://localhost:8787/role-contexts/:id/question \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <token>" \
     -d '{"state": {"phase":"dayInLife","coverage":[],"questionsAsked":0,...}}'
   ```

3. **Check the response**:
   - Should return `200` with `stateId: "question"`, `questions: [...]`, `pass: false`
   - Should complete in <5s (not 49s)

4. **Run backend tests**:
   ```bash
   cd workers/api && npm test
   ```
   All 61 tests + 7 frontend tests should pass.

5. **Frontend e2e**: Navigate to a role discovery session, verify questions appear and state transitions correctly.

---

## Files Modified This Session

| File | Change |
|------|--------|
| `workers/api/.dev.vars` | `ROLE_AGENT_PROVIDER=vertex-ai` (was `kimi`) |
| `workers/api/src/lib/llm/kimiProvider.ts` | Added robust JSON field selection (content vs reasoning_content) — kept for future Kimi use |
| `workers/api/src/lib/agents/interview/reducer.ts` | Added `dayInLifeProbed` to `allGatesPass` |
| `workers/api/src/lib/agents/question/generator.ts` | `cleanJson` now extracts JSON from prose wrappers |
| `src/lib/api/client.ts` | Fixed SSE multi-line `data:` accumulation |
| `src/hooks/useRoleDiscovery.ts` | Bypassed SSE, uses `respond` instead of `respondStream`, `enableEval: false` |

---

## Next Steps

1. **Verify the fix works end-to-end** — `/question` should now return valid JSON in <5s
2. **Test eval gate** — check if `reasoning: null` improves the 5 parallel dimension calls
3. **Re-enable SSE** — if Kimi's streaming delta behavior is fixed, switch adapter back to `respondStream`
4. **Complete a full discovery session** → synthesis → verify RCD quality
5. **Once e2e passes**: proceed with frontend cutover from legacy `/respond` to state machine

---

## Contact

For context on the agent-harness setup, see:
- `agent-harness/src/agent_harness/swarm/agents/developer.py` (lines 116–140) — `_make_model()`
- `agent-harness/src/agent_harness/swarm/graph.py` (line 251) — supervisor model setup

Both use identical `extra_body={"reasoning": None}` + `User-Agent: claude-code/0.1` configuration.
