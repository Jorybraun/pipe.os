# Discovery Agent — Context Handoff

> **Date:** 2026-04-23
> **Handoff from:** Kimi Code CLI (agent session)
> **Status:** ADR-041 Accepted but unimplemented. RCD Synthesis pipeline live and working.

---

## 1. What We Were Asked To Do

The founder asked us to:
1. Check the strategy for the discovery agent
2. Check the plan for the discovery agent
3. Test it

We explored the full codebase, ran the test suite, and identified critical drift between accepted ADRs and production code.

---

## 2. The Strategy (Canonical Source)

**File:** `knowledge/STRATEGY.md` — this is the single source of truth.

Key relevant sections:
- **Goal:** Role Discovery is the pipeline's single source of truth
- **Brief 4 (Role Discovery + Repo Understanding Data Contract):** PASS WITH NOTES — defines RCD schema, 3-layer synthesis, 2-stage repo understanding
- **Brief 5 (Dual-Purpose Needs Discovery):** PASS WITH NOTES — defines 5-phase controller-directed architecture (CONTEXT → DISCOVERY → PRIORITIZE → EVP_FRICTION → WRAP_UP)
- **Brief 6 (Guardrails):** PASS WITH NOTES — defines eval gate, sensitivity ladder, cross-family classifier, bad-robot feedback loop

**Guardrail rule from STRATEGY.md:** If a founder request contradicts this plan, the assistant MUST pause and flag the contradiction before acting. Research findings must not be silently dropped.

---

## 3. Architecture Overview

The codebase has **two discovery agents**:

### 3.1 Role Discovery Agent (Primary)
Interviews recruiters/hiring managers to extract deep role context. Produces a **Role Context Document (RCD)**.

**Flow:**
```
Baseline Form → Calibration Q ("What's your relationship to this role?") → AI Interview (6 calibrated probes + 2 personality Qs) → Synthesis → RCD → JD + Persona
```

**Key backend files:**
| File | Responsibility |
|---|---|
| `workers/api/src/lib/roleAgent.ts` | Core agent — provider-agnostic LLM calls, ReAct loop, tool calling, eval-gated pipeline, mock fallback |
| `workers/api/src/lib/roleAgentPrompts.ts` | **ACTIVE prompt file** — system prompts, phase prompts, participant role variants |
| `workers/api/src/lib/roleAgentPromptsV2.ts` | **ORPHANED prompt file** — contains ADR-041 changes but is imported nowhere |
| `workers/api/src/lib/roleDiscovery/evaluator.ts` | Eval-gated pipeline — runs per-candidate question evaluation |
| `workers/api/src/lib/roleAgent/synthesizeRcd.ts` | RCD synthesis — 3-layer synthesis (schema-guided → parse normalization → deterministic verifier) |
| `workers/api/src/lib/roleAgent/verifyRcd.ts` | Deterministic verifier (layer 3) |
| `workers/api/src/lib/roleAgent/calibrateRcd.ts` | Gap-filling calibration — generates clarifying Q + re-synthesizes cell |
| `workers/api/src/lib/roleAgent/deriveJobDescription.ts` | Derives JD from RCD |
| `workers/api/src/lib/roleAgent/consumerSlice.ts` | Derives flat CandidatePersona from RCD domain_matrix |
| `workers/api/src/routes/discovery/roleContexts.ts` | Hono routes — create, start, respond, complete, parse-jd, transcribe, calibrate |

**Frontend files:**
| File | Responsibility |
|---|---|
| `src/pages/RoleDiscoveryPage.tsx` | Main UI — baseline form → interview → synthesis |
| `src/hooks/useRoleDiscovery.ts` | State machine: IDLE → BASELINE → CALIBRATING → INTERVIEWING → COMPLETE |
| `src/hooks/useConversation.ts` | Generic conversation hook |

**Database tables:**
| Table | Purpose |
|---|---|
| `role_contexts` | Shared state — baseline, knowledge_state, question_budget, status, RCD JSON, persona, JD |
| `role_context_participants` | Per-person interviews — exchanges, participant_role, status, invite_token |

### 3.2 Candidate Discovery Agent (Secondary)
Processes candidate resumes/CVs to produce searchable profiles. Mirror of repo-side pass3 pipeline.

**Files:** `workers/api/src/lib/candidateDiscovery/*`

**Not in scope for this handoff** — was not part of the testing request.

---

## 4. Critical Finding: ADR-041 Is Accepted but Unimplemented

**ADR-041: Role Discovery Calibrated Probes** (Accepted 2026-04-22)

The ADR specifies:
- 6 calibrated probes in **conversational tone**
- 2 personality-reveal questions (Q7, Q8) for team_culture_profile
- Budget reduced from 10 to **8** (standard) / **6** (quick)
- `QUALIFY_CLOSE` phase renamed to **`WRAP_UP`**
- Probe discipline: at most one follow-up per probe, deterministic order, no skipping

**Production reality:**
| Requirement | Status |
|---|---|
| Conversational tone | ❌ Active prompt uses formal tone |
| 2 personality questions (Q7, Q8) | ❌ Missing entirely from active prompt |
| Budget 8/6 | ❌ Still 10 everywhere (`useRoleDiscovery.ts`, validation, tests) |
| `WRAP_UP` phase | ❌ Still `QUALIFY_CLOSE` in types and active prompt |
| Probe tracking for 8 probes | ❌ Controller tracks 6 probes only |

**The `roleAgentPromptsV2.ts` file contains the correct implementation** — conversational probes, Q7/Q8, `WRAP_UP` phase, 8-probe tracking in `buildPhaseDirective`. But:
1. **Zero files import it**
2. It uses `'WRAP_UP'` which is **not in the `ConversationPhase` type union** in `types.ts`
3. Switching imports to V2 would cause a TypeScript error

**Root cause:** The V2 file was written but never wired into the runtime. The old file was never deleted. Types were never updated.

This is a **strategy guardrail violation** — ADR-041 is Accepted, mapped in STRATEGY.md, but silently dropped in production.

---

## 5. RCD Synthesis Pipeline (Working Correctly)

Despite the ADR-041 drift, the RCD synthesis pipeline (the "new strategy" the founder mentioned) is fully built and operational.

**Path B in `roleContexts.ts` (respond handler):**
```
Agent returns synthesis (or budget exhausted)
  → runRcdSynthesis() called
    → synthesizeRcd() generates RCD from all participant transcripts
      → verifyRcd() runs deterministic checks
    → deriveJobDescriptionFromRcd() generates JD
    → deriveConsumerSlice() generates flat persona
  → Results persisted to role_contexts row
    → rcd_json, persona_json, job_description_md, validation_metadata
  → buildAndStoreRoleEmbedding() fires async for vector search
```

**This works.** The calibrate endpoint (`POST /api/v1/role-contexts/:id/calibrate`) is also wired and tested (11/11 passing).

---

## 6. Test Results

### 6.1 Full Suite
```
Test Files:  2 failed | 53 passed (55)
Tests:       740 passed | 1 skipped | 2 failed suites
Duration:    ~7s
```

**Failures are unrelated to discovery:**
- `workers/api/src/__tests__/DevContainerDO.test.ts` — Cannot resolve `cloudflare:workers` in Vitest node environment
- `workers/api/src/__tests__/devContainer.rest.test.ts` — Same module resolution issue

### 6.2 Discovery-Specific Tests
```
workers/api/src/__tests__/roleContextsCalibrate.test.ts  → 11/11 passed
workers/api/src/__tests__/roleDiscovery.test.ts          → 8/8 passed  
src/hooks/useRoleDiscovery.test.ts                       → 6/6 passed
```

**Critical gap:** All discovery tests mock `createRoleAgentProvider` to `null`, which forces the **mock fallback path**. The real agent logic (provider calls, JSON parsing, eval gate, phase switching) has **zero coverage** against actual LLM responses.

### 6.3 E2E Tests
`e2e/role-discovery.spec.ts` exists but mocks all API responses. It does not exercise the real agent.

---

## 7. Known Bugs and Issues

### P0 — Ship Today
1. **ADR-041 drift** (see §4) — Accepted ADR not implemented. Fix: promote V2, update types, adjust budgets.
2. **Mixed imports between old and V2** — `roleAgent.ts` and `roleContexts.ts` import from `roleAgentPrompts` (old). `roleAgent.ts` does NOT import `buildRcdSynthesisSystemPrompt` / `buildRcdSynthesisUserMessage` from V2 even though V2 exports them. RCD synthesis imports from old file too, but that's fine since both files export the same RCD synthesis functions.

### P1 — Next Sprint
3. **Streaming bypasses eval gate** — `callRoleAgentStream()` parses JSON directly without running `evaluateQuestion()` on candidates. The non-streaming path has the eval gate; streaming does not. Recommend deleting streaming (see §8).
4. **No resume-after-close** — Close tab mid-interview → next visit starts over. Data model supports resume; frontend doesn't.
5. **`ABANDONED` status is dead code** — Valid enum value with zero code paths writing it.

### P2 — Insurance
6. **No nightly Mistral smoke test** — No CI test calls real Mistral API to assert response shape.
7. **No tool-calling end-to-end test** — `research_company` and `search_technology` exist but have no test coverage for full ReAct round-trip.
8. **Multi-stakeholder merge logic untested** — `migration/assessments/role-discovery/todo.md` explicitly flags this as highest-risk untested capability.

---

## 8. The Unified Runtime Plan (Founder's Proposal)

The founder proposed building a unified agent runtime that all three agents (role discovery, code review, culture interview) share.

**Summary of proposal:**
- Extract common patterns into `lib/agentRuntime/` (FSM, session store, provider wrapper, eval gate, scorer)
- Convert each agent to a plugin registering with the runtime
- Unify session tables into `agent_sessions` with `agent_type` discriminator
- Unify routes into single `agents.ts` module
- Delete streaming

**Our assessment:**
- **Architecturally sound** but **high-risk as a big-bang refactor**
- **Better approach:** Extract shared components as **libraries** first (eval gate, scorer orchestrator), prove them across 2 agents, then consider runtime unification
- **Session table unification is premature** — code review transcripts and role discovery exchanges have fundamentally different schemas and query patterns
- **Do not start this until ADR-041 is shipped** — refactoring unimplemented code compounds the drift

---

## 9. Recommended Immediate Actions

### Option A: Wire ADR-041 (Recommended — 15 min)
1. Update `workers/api/src/types.ts` — add `'WRAP_UP'` to `ConversationPhase`, remove `'QUALIFY_CLOSE'`
2. Replace `workers/api/src/lib/roleAgentPrompts.ts` with the contents of `roleAgentPromptsV2.ts`
3. Delete `roleAgentPromptsV2.ts`
4. Update default `questionBudget` from 10 → 8 in `src/hooks/useRoleDiscovery.ts` and validation schema
5. Run `npx tsc --noEmit` in `workers/api/` to verify no type errors
6. Run `npx vitest run` to confirm tests still pass
7. Update tests that assert prompt text to match conversational tone

### Option B: Add Real Agent Test Coverage
Write a test that mocks the LLM provider to return a realistic JSON response (not `null`), then assert:
- `callRoleAgent()` parses the response correctly
- Eval gate runs when 2 candidates are returned
- Phase directive switches phases based on probe progress

### Option C: Start Unified Runtime Extract
**Do not do this yet.** Do Option A first.

---

## 10. Files to Read First (For Next Agent)

If you're picking this up, read in this order:

1. `knowledge/STRATEGY.md` — understand the guardrail and research briefs
2. `docs/decisions/current/ADR-041-role-discovery-calibrated-probes.md` — what should be implemented
3. `workers/api/src/lib/roleAgentPromptsV2.ts` — the correct prompt implementation (currently orphaned)
4. `workers/api/src/lib/roleAgent.ts` — core agent runtime
5. `workers/api/src/routes/discovery/roleContexts.ts` — route handlers (note the respond handler is ~300 lines with streaming + non-streaming paths)
6. `workers/api/src/lib/roleAgent/synthesizeRcd.ts` — RCD synthesis pipeline
7. `migration/assessments/role-discovery/todo.md` — known gaps list

---

## 11. Open Questions

1. **Should we delete `callRoleAgentStream`?** The founder's unified plan proposes this. The streaming path has a known bug (no eval gate) and the UX benefit is minimal (1-2 sentence responses).
2. **Role-type probe variants?** ADR-041 Open Question #1 asks whether sales/design/marketing roles need different probe sets. Not addressed in current code.
3. **Qwen-on-Workers-AI classifier vs provider evaluator?** ADR-038 prescribes Qwen3-30b on Workers AI as the cross-family classifier. Current `evaluator.ts` uses the same LLMProvider as the primary agent (could be Gemma on Vertex). This violates the cross-family independence requirement.

---

## 12. Verification Commands

```bash
# Run all tests
npx vitest run

# Run discovery-specific tests
npx vitest run workers/api/src/__tests__/roleDiscovery.test.ts
npx vitest run workers/api/src/__tests__/roleContextsCalibrate.test.ts
npx vitest run src/hooks/useRoleDiscovery.test.ts

# Type check the worker
npx tsc --noEmit -p workers/api/tsconfig.json

# Run e2e (requires dev servers)
npx playwright test e2e/role-discovery.spec.ts
```

---

*End of handoff. Next agent should start with Option A (wire ADR-041) unless instructed otherwise.*
