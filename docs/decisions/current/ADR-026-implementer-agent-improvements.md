# ADR-026: Implementer Agent Improvements — Real Code Changes, Metrics, TDD

**Status:** Accepted — **Updated 2026-04-08 by [ADR-032](ADR-032-code-review-research-integration.md)**
**Date:** 2026-03-31
**Deciders:** Hans (founder)

> **UPDATE NOTICE — 2026-04-08**
> The 2026-04-08 code review research brief (`knowledge/outputs/code-review-content-sourcing.md`) confirms the direction of this ADR — implementer producing real code changes, implementer metrics, TDD. Two additions from [ADR-032](ADR-032-code-review-research-integration.md):
>
> 1. **Persona reactivity as versioned YAML.** The current hardcoded prompts in `workers/api/src/lib/prompts.ts` are replaced by `workers/api/src/lib/personas/{junior,mid,senior}.yaml` with explicit reactivity parameters: `pushback_probability` (research: junior persona = 0.40), `fix_acceptance_threshold`, `information_volunteering_rate`, `error_introduction_rate`. This is the "reactivity calibration" framing from the research brief Part 3.3.
>
> 2. **Revision evaluation dimension.** The `updated_code` work in Phase 2 of this ADR is the **prerequisite** for scoring "did the reviewer correctly assess whether the fix is complete, incomplete, or introduces new issues" — a new exclusive moat dimension (Dimension 5 in ADR-032). Phase 2 of this ADR must be complete before Revision Evaluation scoring can work.
>
> 3. **Consistency classifier.** The Phase 5 "Calibration Integration" step in this ADR should also wire in the new Gemma 4 12B consistency classifier (ADR-032, Phase 2) that runs before every implementer turn.
>
> See [ADR-032](ADR-032-code-review-research-integration.md) for the full context. The core work plan of this ADR (Phases 1–5) is **unchanged** — these are additions, not revisions.

## Context

The multi-turn code review pipeline has a working reviewer-implementer-scorer flow, but the implementer agent is weak:

- **Always caves** — junior persona agrees to everything, producing no pushback signal for the conversation scorer
- **No real code changes** — when the implementer says "change", it just says "I'll fix it" in text. The `updated_code` field exists in `ImplementerResponse` but the prompt never instructs the agent to populate it
- **No implementer metrics** — we measure reviewer quality but not implementer quality
- **No unit tests** — deterministic scoring logic (effectiveness, bands, weighted averages) has zero test coverage

### The Vision

After a turn where the reviewer requests changes, the implementer should actually modify the code and the reviewer should see the updated diff to verify the fix. The ultimate signal is whether a reviewer can drive the PR all the way to **APPROVE** by getting all bugs found and fixed.

Two modes exist:
- **Calibration** (`/calibrate` skill): Claude Code plays reviewer personas to tune agents. Synthetic.
- **Production** (the product): Real candidates review PRs, Devstral responds as the implementer. The implementer quality directly impacts candidate experience.

Both modes feed back into the same prompts via the training loop.

---

## Decision

Implement in 5 phases, TDD-first. Each phase starts with failing tests.

---

## Phase 1: Test Foundation + Deterministic Scoring Tests

Write tests first for all existing untested pure functions.

### 1.1 Create Vitest config for Worker
- **New file:** `workers/api/vitest.config.ts`
- Vitest is already in `package.json` but no config exists

### 1.2 Extract scoring pure functions
- **New file:** `workers/api/src/lib/scoring.ts`
- Extract from `scorerAgent.ts`: `computeEffectiveness()`, `weightedAvg()`, weight constants, `countReviewerComments()`, band assignment logic
- **Modify:** `workers/api/src/lib/scorerAgent.ts` — import from `scoring.ts`

### 1.3 Unit tests for scoring
- **New file:** `workers/api/src/__tests__/scoring.test.ts`
- Tests:
  - `computeEffectiveness`: all bugs found (RIS=100), none found (RIS=0), partial, false positive degradation, efficiency floor at 0, delta with no critical/major bugs, composite weights
  - `weightedAvg`: all 10s->100, all 1s->10, missing dimensions default to 5, weight sets sum to 1.0
  - Band assignment: boundary values (75->strong, 74->adequate, 45->adequate, 44->weak)
  - `countReviewerComments`: normal transcript, empty, malformed

### 1.4 Unit tests for buildThreadsFromRounds
- **New file:** `src/types/__tests__/conversation.test.ts`
- Tests: single round->one thread, follow-ups group by comment_id, move=change threading

---

## Phase 2: Implementer Produces Real Code Changes

The core change — make the agent generate actual code.

### 2.1 Failing tests for updated_code
- **New file:** `workers/api/src/__tests__/implementerAgent.test.ts`
- Mock `fetch` to simulate Devstral responses
- Tests:
  - move=change WITH updated_code -> passes through
  - move=change WITHOUT updated_code -> logged warning (soft enforcement)
  - move=comment/pushback -> no updated_code expected
  - JSON parsing with code blocks containing newlines/special chars

### 2.2 Update implementer prompt to require code on change
- **Modify:** `workers/api/src/lib/prompts.ts` `buildImplementerSystemPrompt()`
- Add `updated_code` to the JSON schema example
- Add rule: "When move is 'change', you MUST include an 'updated_code' field with the corrected code snippet. Show the complete function or block with your fix applied."
- Keep content at 1-3 sentences (the explanation), code goes in `updated_code`

### 2.3 Increase max_tokens
- **Modify:** `workers/api/src/lib/implementerAgent.ts` line 139
- `max_tokens`: 1024 -> 2048 (code snippets need room)

### 2.4 Propagate updated_code through types + API
- **Modify:** `src/types/conversation.ts` — add `updated_code?: string` to `ThreadExchange`
- **Modify:** `workers/api/src/routes/review.ts` `buildThreadsForResponse()` — include `updated_code` from `ImplementerResponse` in exchange objects

### 2.5 E2E test for code changes
- **Modify:** `e2e/multi-turn-api.spec.ts` — add section C.8:
  - Submit review with clear bug report -> verify implementer's response has `updated_code` when move=change
  - Verify `updated_code` differs from original code

---

## Phase 3: Implementer Metrics

Measure implementer behavior — pure functions, fully testable.

### 3.1 Define metrics + write tests first
- **New file:** `workers/api/src/__tests__/implementerMetrics.test.ts`
- Tests:
  - Move distribution: all-change transcript, mixed moves, empty transcript
  - Code change rate: 0% when no updated_code, 100% when all have it
  - Pushback quality: reasoning words detected vs bare pushback
  - Cave rate: immediate agreement on first exchange without prior pushback
  - Round progression: moves tracked per round

### 3.2 Implement computeImplementerMetrics
- **New file:** `workers/api/src/lib/implementerMetrics.ts`
- Pure function: `computeImplementerMetrics(rounds: ReviewRound[]): ImplementerMetrics`
- No LLM calls — fully deterministic

### 3.3 Store metrics + expose to recruiter
- **Modify:** `workers/api/src/routes/review.ts` — compute metrics in verdict async scoring block, store in score_report alongside scorer output
- **Modify:** `workers/api/src/routes/reviewSessions.ts` — include implementer_metrics in GET /report response

---

## Phase 4: Frontend Shows Code Changes

Display updated_code in the conversation panel.

### 4.1 CodeChangeBlock in ConversationPanel
- **Modify:** `src/components/Panels/ConversationPanel.tsx`
- When `exchange.move === 'change'` and `exchange.updated_code` exists, render a syntax-highlighted code block with green left border below the exchange text
- Collapsible by default if >10 lines

### 4.2 Resolved-line indicators on DiffPanel
- **Modify:** `src/components/Assessment/DiffPanel.tsx`
- Lines that received a move=change response get a subtle "FIXED" badge or green overlay
- Data comes from the thread exchanges in the conversation state

### 4.3 E2E UI test
- **Modify:** `e2e/multi-turn-e2e.spec.ts` — add scenario:
  - Submit review -> get change response -> verify code block visible in conversation panel

---

## Phase 5: Calibration Integration + Clean Run

Wire everything into the training loop.

### 5.1 Update /calibrate skill
- **Modify:** `.claude/commands/calibrate.md`
- Step 5 (Analyze): add implementer metrics to the report — move distribution, code change rate, pushback quality
- Step 6 (Diagnose): add implementer failure modes — always caves, no code, generic pushback
- Prompt tuning targets both scorer AND implementer prompts

### 5.2 Run clean calibration
- Fresh experiment `exp-v3` with all changes in place
- 3 challenges x 3 personas = 9 runs
- Validate: junior pushes back sometimes, code changes appear, scores separate bands

---

## Test Strategy

| Layer | Tool | What's Tested |
|-------|------|---------------|
| Unit (scoring) | Vitest | computeEffectiveness, weightedAvg, bands, countComments |
| Unit (metrics) | Vitest | computeImplementerMetrics — moves, caves, code rate |
| Unit (agent) | Vitest + fetch mock | implementerAgent response parsing, updated_code validation |
| Unit (types) | Vitest | buildThreadsFromRounds — threading, exchange grouping |
| API E2E | Playwright | C.8 code changes in response, C.9 multi-round dynamics |
| UI E2E | Playwright | Code blocks render in conversation, resolved lines in diff |
| Integration | /calibrate | Full pipeline with Devstral — personas, scoring, metrics |

---

## File Index

### New files
- `workers/api/vitest.config.ts`
- `workers/api/src/lib/scoring.ts`
- `workers/api/src/lib/implementerMetrics.ts`
- `workers/api/src/__tests__/scoring.test.ts`
- `workers/api/src/__tests__/implementerAgent.test.ts`
- `workers/api/src/__tests__/implementerMetrics.test.ts`
- `src/types/__tests__/conversation.test.ts`

### Modified files
- `workers/api/src/lib/scorerAgent.ts` — import extracted scoring functions
- `workers/api/src/lib/prompts.ts` — updated_code in response format
- `workers/api/src/lib/implementerAgent.ts` — max_tokens, validation
- `workers/api/src/routes/review.ts` — propagate updated_code, compute metrics
- `workers/api/src/routes/reviewSessions.ts` — expose metrics in report
- `src/types/conversation.ts` — updated_code on ThreadExchange
- `src/components/Panels/ConversationPanel.tsx` — CodeChangeBlock
- `src/components/Assessment/DiffPanel.tsx` — resolved-line indicators
- `e2e/multi-turn-api.spec.ts` — C.8, C.9
- `e2e/multi-turn-e2e.spec.ts` — code block UI test
- `.claude/commands/calibrate.md` — implementer metrics in analysis

---

## Verification

After all phases:
1. `cd workers/api && npm test` — all Vitest unit tests pass
2. `npx tsc --noEmit` — no type errors
3. `npx playwright test multi-turn-api` — all E2E API tests pass (C.1-C.9)
4. `npx playwright test multi-turn-e2e` — all E2E UI tests pass
5. `/calibrate --auto` — run clean experiment, verify implementer metrics in report

---

## Consequences

- **Positive:** Implementer produces real code, giving reviewers something concrete to verify. Metrics enable data-driven prompt tuning for both agents. TDD ensures regressions are caught.
- **Positive:** The calibration loop now tunes both sides of the conversation, not just the scorer.
- **Risk:** Devstral may not reliably produce `updated_code`. Mitigated with soft enforcement (warn, don't fail) and fallback parsing.
- **Risk:** Increased token usage from code snippets. Mitigated by bumping max_tokens to 2048. Monitor costs.
- **Trade-off:** Phase 4 uses simple "resolved line" indicators rather than full diff evolution (applying code patches to produce a new diff). Full diff reconstruction is deferred — it's complex and error-prone. The visual indicator ships faster and still communicates the key information.
