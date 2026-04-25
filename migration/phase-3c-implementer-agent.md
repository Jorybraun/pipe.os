# Phase 3c: Implementer Agent — Real Code Changes, Metrics, Calibration

> **Status:** In Progress
> **Depends on:** Phase 3 (multi-turn code review endpoints, scorer agent, /calibrate skill)
> **ADR:** `docs/decisions/current/ADR-026-implementer-agent-improvements.md`

---

## 1. Overview

The multi-turn code review pipeline has a working reviewer-implementer-scorer flow, but the implementer agent is weak. This phase upgrades the implementer to produce real code changes, adds quality metrics, and wires both into the calibration training loop.

### Problems being solved

| Problem | Impact |
|---|---|
| Implementer always caves | Conversation scorer can't differentiate strong vs weak reviewers |
| No real code changes | Reviewer can't verify fixes — `updated_code` field exists but is never populated |
| No implementer metrics | We tune the scorer but have no data on the implementer |
| No unit tests | Deterministic scoring logic has zero coverage |
| Junior persona is a pushover | Unrealistic conversations, poor training signal |

### The vision

After a reviewer requests changes, the implementer actually modifies the code. The reviewer sees the updated diff and can verify the fix. The strongest reviewers drive the PR all the way to **APPROVE** by finding all bugs and getting them fixed.

---

## 2. Routes

No new routes. Changes to existing:

| Route | Change |
|---|---|
| `POST /rpc/review/submit` | Implementer response now includes `updated_code` on change moves |
| `POST /rpc/review/:sessionId/respond` | Same — `updated_code` flows through |
| `POST /rpc/review/:sessionId/verdict` | Computes implementer metrics alongside scorer output |
| `GET /api/v1/review-sessions/:id/report` | Returns `implementer_metrics` in response |

---

## 3. Implementation Phases

### Phase 1: Test Foundation + Deterministic Scoring Tests

Write tests first for all existing untested pure functions.

**New files:**
- `workers/api/vitest.config.ts` — Vitest config (package already has vitest dep)
- `workers/api/src/lib/scoring.ts` — Extract pure functions from `scorerAgent.ts`
- `workers/api/src/__tests__/scoring.test.ts` — Unit tests for effectiveness, weighted averages, bands
- `src/types/__tests__/conversation.test.ts` — Unit tests for `buildThreadsFromRounds`

**BDD scenarios:**

```gherkin
Scenario: All planted bugs found yields RIS = 100
  Given 3 planted bugs (critical=1, major=1, minor=1)
  And the reviewer found all 3
  Then RIS = 100

Scenario: No bugs found yields RIS = 0
  Given 3 planted bugs
  And the reviewer found 0
  Then RIS = 0

Scenario: False positives degrade efficiency
  Given 5 total comments and 2 false positives
  Then efficiency = (3/5)*100 - 2*10 = 40

Scenario: Band boundaries
  Given overall score = 75 then band = strong
  Given overall score = 74 then band = adequate
  Given overall score = 45 then band = adequate
  Given overall score = 44 then band = weak
```

---

### Phase 2: Implementer Produces Real Code Changes

The core change — when the implementer agrees to fix something, it generates actual code.

**New files:**
- `workers/api/src/__tests__/implementerAgent.test.ts` — Mock fetch, test `updated_code` parsing

**Modified files:**
- `workers/api/src/lib/prompts.ts` — Add `updated_code` to JSON schema in response format
- `workers/api/src/lib/implementerAgent.ts` — Increase max_tokens 1024->2048, soft validation
- `src/types/conversation.ts` — Add `updated_code?: string` to `ThreadExchange`
- `workers/api/src/routes/review.ts` — Propagate `updated_code` in `buildThreadsForResponse()`
- `e2e/multi-turn-api.spec.ts` — Add section C.8

**BDD scenarios:**

```gherkin
Scenario: Implementer includes updated_code when accepting a change
  Given a reviewer comment "URL not encoded — use encodeURIComponent"
  When the implementer responds with move = change
  Then the response includes an updated_code field
  And updated_code contains actual code (not empty)

Scenario: Implementer does NOT include updated_code on pushback
  Given a reviewer comment "Consider using useMemo"
  When the implementer responds with move = pushback
  Then the response does NOT include updated_code

Scenario: updated_code appears in thread exchanges via API
  Given a completed review session with a change move
  When the candidate fetches session status
  Then the thread exchanges include updated_code for change moves
```

**Prompt change (in `buildImplementerSystemPrompt`):**

Add to the JSON example:
```json
{
  "to_comment_id": 1,
  "content": "Good catch, fixing now!",
  "move": "change",
  "updated_code": "function validate(token: string): boolean {\n  if (!token) return false;\n  return token.length > 0;\n}"
}
```

Add rules:
- When move is "change", include an `updated_code` field with the corrected code snippet
- Show the complete function or block with the fix applied
- When move is "comment" or "pushback", do NOT include `updated_code`

---

### Phase 3: Implementer Metrics

Measure implementer behavior — pure functions, fully testable.

**New files:**
- `workers/api/src/lib/implementerMetrics.ts` — `computeImplementerMetrics()` pure function
- `workers/api/src/__tests__/implementerMetrics.test.ts` — Unit tests

**Type:**
```typescript
interface ImplementerMetrics {
  totalResponses: number;
  moveDistribution: { comment: number; change: number; pushback: number };
  moveRatios: { comment: number; change: number; pushback: number };
  codeChangeRate: number;       // % of change moves with updated_code
  pushbackQuality: { withReasoning: number; bare: number };
  caveRate: number;             // immediate agreement without pushback history
  roundProgression: Array<{ round: number; moves: Record<string, number> }>;
}
```

**BDD scenarios:**

```gherkin
Scenario: All-cave transcript has cave rate = 1.0
  Given a transcript where every response is move=change on round 1
  Then caveRate = 1.0

Scenario: Mixed moves produce correct distribution
  Given 3 change, 2 pushback, 1 comment responses
  Then moveRatios = { change: 0.5, pushback: 0.33, comment: 0.17 }

Scenario: Code change rate tracks updated_code presence
  Given 4 change moves, 2 with updated_code
  Then codeChangeRate = 0.5
```

---

### Phase 4: Frontend Shows Code Changes

Display `updated_code` in the conversation panel.

**Modified files:**
- `src/components/Panels/ConversationPanel.tsx` — Add `CodeChangeBlock` inline component
- `src/components/Assessment/DiffPanel.tsx` — Add resolved-line indicators
- `e2e/multi-turn-e2e.spec.ts` — UI test for code block rendering

**BDD scenarios:**

```gherkin
Scenario: Code change block renders for change moves
  Given an implementer response with move=change and updated_code
  Then a code block with green left border appears in the conversation
  And the code block contains the updated_code content

Scenario: No code block for pushback moves
  Given an implementer response with move=pushback
  Then no code block appears in the conversation

Scenario: Resolved line indicator on diff
  Given a change response targeting file line 32
  Then line 32 in the DiffPanel shows a FIXED indicator
```

---

### Phase 5: Calibration Integration + Clean Run

Wire everything into the training loop.

**Modified files:**
- `.claude/commands/calibrate.md` — Add implementer metrics to analysis + diagnose steps

**Validation:**
- Fresh experiment `exp-v3` with all changes
- 3 challenges x 3 personas = 9 runs
- Verify: junior pushes back sometimes, code changes appear, scores separate bands
- Implementer metrics in the calibration report

---

## 4. Test Strategy

| Layer | Tool | Coverage |
|---|---|---|
| Unit (scoring) | Vitest | computeEffectiveness, weightedAvg, bands, countComments |
| Unit (metrics) | Vitest | computeImplementerMetrics — moves, caves, code rate |
| Unit (agent) | Vitest + fetch mock | Response parsing, updated_code validation |
| Unit (types) | Vitest | buildThreadsFromRounds — threading, exchange grouping |
| API E2E | Playwright | C.8 code changes, C.9 multi-round dynamics |
| UI E2E | Playwright | Code blocks in conversation, resolved lines in diff |
| Integration | /calibrate | Full Devstral pipeline — personas, scoring, metrics |

---

## 5. Risks

| Risk | Mitigation |
|---|---|
| Devstral doesn't reliably produce `updated_code` | Soft enforcement (warn, don't fail) + fallback code extraction from content |
| Increased token usage from code snippets | max_tokens 1024->2048, monitor costs |
| Diff evolution complexity (applying patches) | Defer to visual indicators first, full diff reconstruction later |
| Junior prompt change breaks calibration | Run clean experiment after all changes, compare to baseline |
