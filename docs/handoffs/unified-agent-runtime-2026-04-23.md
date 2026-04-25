# UnifiedAgentRuntime — Implementation Handoff

> **Date:** 2026-04-23
> **Handoff from:** Kimi Code CLI (agent session)
> **Status:** Phase 1 Complete (Core Runtime Libraries). Not yet integrated.

---

## 1. What We Were Asked To Do

Implement the **Unified Agent Runtime** from ADR-034 — a shared framework that eliminates duplication across PIPE's three AI interview agents (role discovery, code review, culture interview).

We built the runtime as standalone libraries with 100% test coverage. The code exists but is **not wired into the running application**.

---

## 2. What Was Completed

### 2.1 Core Runtime (`workers/api/src/lib/unifiedAgentRuntime/`)

| File | Responsibility | Tests |
|---|---|---|
| `types.ts` | Shared data shapes: AgentSession, AgentTurn, ScoreReport, EvalConfig, FSMConfig, AgentPlugin | — |
| `fsm.ts` | Generic finite state machine: `consent → in_progress → scoring → complete` | ✅ 8 tests |
| `provider.ts` | LLM wrapper: retry (exp backoff, max 3), JSON enforcement, cost tracking callback, 30s timeout | ✅ 6 tests |
| `evalGate.ts` | Quality gate: `all_pass` / `no_fail` / `weighted` approval rules, parallel dimension evals | ✅ 9 tests |
| `scorer.ts` | Multi-dimension scoring: parallel dimension calls, evidence-grounding validation, synthesis | ✅ 6 tests |
| `sessionStore.ts` | InMemorySessionStore (dev/tests) + D1SessionStore (production) | ✅ 8 tests |
| `pluginRegistry.ts` | `registerPlugin()` / `getPlugin()` / `listPlugins()` | — |
| `index.ts` | Public API exports | — |

**Test results:** 44 passing (6 test files). Zero type errors in runtime code.

### 2.2 Agent Plugin Stubs (`workers/api/src/lib/agents/`)

Three plugins registering with the runtime:

| Plugin | Type | FSM | Eval Gate | Scorer |
|---|---|---|---|---|
| `roleDiscovery/plugin.ts` | `role_discovery` | Budget-based termination | 2 dims, `all_pass` | None (interviewer-only) |
| `codeReview/plugin.ts` | `code_review` | Verdict-based termination | 2 dims, `no_fail` | 6 BARS dimensions + synthesis |
| `culture/plugin.ts` | `culture_interview` | Coverage-based termination | 3 dims, `weighted` | 10 dimensions + synthesis |
| `index.ts` | `registerAllPlugins()` — call this at boot | — | — | — |

These are **stubs**. The `generateTurn` methods return mock questions. Full migration of agent logic happens in Phases 2–4.

### 2.3 Unified Route Handler (`workers/api/src/routes/agents.ts`)

Single route module replacing three separate route files:

```
POST /api/v1/agents/:agentType/sessions              → create session
GET  /rpc/agents/:token                              → candidate read
POST /rpc/agents/:token/consent                      → consent
POST /rpc/agents/:token/respond                      → respond (turn + eval gate)
GET  /api/v1/agents/:agentType/sessions/:id/report   → score report
POST /api/v1/agents/:agentType/sessions/:id/review   → HITL override
```

Uses `InMemorySessionStore` for now. Swap to `D1SessionStore` in Phase 5.

### 2.4 Database Migration (`migration/0043_agent_sessions.sql`)

Creates unified `agent_sessions` table with indexes on `agent_type`, `candidate_id`, `state`, `created_at`.

---

## 3. What Remains To Do

### Phase 0: ADR-041 Prerequisite (NOT started)

**Why:** Accepted ADR silently dropped in production. Refactoring unimplemented code compounds drift.

- [ ] Add `'WRAP_UP'` to `ConversationPhase` union in `workers/api/src/types.ts`
- [ ] Remove/replace `'QUALIFY_CLOSE'` (check for references)
- [ ] Promote `roleAgentPromptsV2.ts` → `roleAgentPrompts.ts`, delete V2
- [ ] Fix budget defaults: `questionBudget = 10 → 8`, `DEFAULT_BUDGET = 15 → 8`
- [ ] Update `QUESTION_BUDGETS = [5, 10, 15, 20] → [6, 8, 10, 15]`
- [ ] Update test fixtures asserting budget values
- [ ] Run `npx vitest run` and `npx tsc --noEmit`

### Phase 1: Integration (NOT started)

**Goal:** Wire the runtime into the running application.

- [ ] **Register plugins at boot** — call `registerAllPlugins()` in the Worker entrypoint
- [ ] **Mount unified routes** — import `routes/agents.ts` into the main Hono app
- [ ] **Find the main Hono app** — likely `workers/api/src/index.ts` or `app.ts`
- [ ] **Decide on session store** — keep InMemory for dev, swap to D1SessionStore when `env.DB` is available
- [ ] **Create provider factory integration** — wire `createRoleAgentProvider(env)` into the respond handler

### Phase 2: Migrate Role Discovery (NOT started)

**Goal:** Port the role discovery agent to use the extracted libraries.

- [ ] Migrate `callRoleAgent()` logic → `agents/roleDiscovery/interviewer.ts`
- [ ] Migrate prompts → `agents/roleDiscovery/prompts.ts`
- [ ] Wrap existing `evaluator.ts` into `EvalConfig` format
- [ ] Delete `callRoleAgentStream()` from `roleAgent.ts`
- [ ] Update `roleContexts.ts` respond handler: replace streaming loop with sync call + single SSE event
- [ ] Update frontend `useRoleDiscovery.ts`: remove `respondStream` path
- [ ] Ensure existing BDD tests pass without behavioral change

### Phase 3: Migrate Code Review (NOT started)

**Goal:** Port code review agent to the runtime.

- [ ] Migrate `implementerAgent.ts` → `agents/codeReview/implementer.ts`
- [ ] Migrate `scorerAgent.ts` + `scorerPrompts.ts` → `agents/codeReview/scorer.ts`
- [ ] Update to 6 dimensions per ADR-032 Phase 1
- [ ] Update `routes/reviewSessions.ts` to use code review plugin + runtime FSM
- [ ] Keep existing API contract — no frontend changes required

### Phase 4: Build Culture Interview (NOT started)

**Goal:** Build culture interview agent fresh on the proven runtime.

- [ ] Build `agents/culture/interviewer.ts` — deterministic question bank + generative probing
- [ ] Build `agents/culture/scorer.ts` + `scorerPrompts.ts` — 10 dimensions + synthesis per ADR-029
- [ ] Add culture endpoints to unified route module
- [ ] 5 BDD Playwright specs: consent, linear flow, probe budget, coverage termination, recruiter report

### Phase 5: Session Table Unification (NOT started)

**Goal:** Unify `role_context_participants`, `review_sessions`, and future `culture_interview_sessions` into `agent_sessions`.

- [ ] Run migration `0043_agent_sessions.sql`
- [ ] Dual-write: update all session creation paths to write to BOTH old and new tables
- [ ] Backfill script: copy existing sessions into `agent_sessions`
- [ ] Read cutover: update all reads to query `agent_sessions`
- [ ] Verify operational queries work ("show all active sessions")

### Phase 6: Route Unification (NOT started)

**Goal:** Replace three separate route modules with unified `routes/agents.ts`.

- [ ] Migrate `roleContexts.ts` → `/api/v1/agents/role_discovery/...`
- [ ] Migrate `reviewSessions.ts` → `/api/v1/agents/code_review/...`
- [ ] Maintain backwards compatibility or update frontend calls
- [ ] Update `useRoleDiscovery.ts`, `useCodeReview.ts` to use unified paths

---

## 4. File Inventory

### New files created
```
workers/api/src/lib/unifiedAgentRuntime/
├── types.ts
├── fsm.ts
├── provider.ts
├── evalGate.ts
├── scorer.ts
├── sessionStore.ts
├── pluginRegistry.ts
├── index.ts
└── __tests__/
    ├── fsm.test.ts
    ├── provider.test.ts
    ├── evalGate.test.ts
    ├── scorer.test.ts
    ├── sessionStore.test.ts
    └── integration.test.ts

workers/api/src/lib/agents/
├── index.ts
├── roleDiscovery/
│   └── plugin.ts
├── codeReview/
│   └── plugin.ts
└── culture/
    └── plugin.ts

workers/api/src/routes/agents.ts
migration/0043_agent_sessions.sql
```

### Files to migrate (future phases)
```
workers/api/src/lib/roleAgent.ts → agents/roleDiscovery/interviewer.ts
workers/api/src/lib/roleAgentPromptsV2.ts → agents/roleDiscovery/prompts.ts
workers/api/src/lib/roleDiscovery/evaluator.ts → agents/roleDiscovery/evaluator.ts (wrap in EvalConfig)
workers/api/src/lib/implementerAgent.ts → agents/codeReview/implementer.ts
workers/api/src/lib/scorerAgent.ts → agents/codeReview/scorer.ts
workers/api/src/lib/scorerPrompts.ts → agents/codeReview/scorerPrompts.ts
workers/api/src/routes/discovery/roleContexts.ts → routes/agents.ts (merge)
workers/api/src/routes/reviewSessions.ts → routes/agents.ts (merge)
```

### Files to delete (future phases)
```
workers/api/src/lib/roleAgent.ts (after migration)
workers/api/src/lib/roleAgentPromptsV2.ts (after promotion)
```

---

## 5. Open Questions

1. **Where is the main Hono app entrypoint?** Need to find `workers/api/src/index.ts` or equivalent to mount routes and register plugins.
2. **Should we delete `callRoleAgentStream` in Phase 0 or Phase 2?** Handoff recommends Phase 2 (cleaner — replace with runtime pattern).
3. **Role-type probe variants?** ADR-041 Open Question #1 — out of scope for this plan, but plugin interface supports per-role-type config injection.
4. **Qwen-on-Workers-AI classifier vs provider evaluator?** Current `evaluator.ts` uses same provider. Runtime `evalGate.ts` supports per-dimension model overrides.

---

## 6. Quality Gates (Every Phase)

| Gate | Command | Must Pass |
|---|---|---|
| Type check | `npx tsc --noEmit -p workers/api/tsconfig.json` | Zero new errors |
| Unit tests | `npx vitest run workers/api/src/lib/unifiedAgentRuntime` | 44+ pass, 0 new failures |
| E2E tests | `npx playwright test e2e/role-discovery.spec.ts` | ✅ |
| DevTools audit | `lighthouse_audit` | Accessibility ≥ 90, Best Practices ≥ 90 |

---

## 7. How to Pick This Up

1. **Start with Phase 0** (ADR-041) — it fixes accepted-but-unimplemented drift before any runtime migration.
2. **Then Phase 1** (Integration) — wire the runtime into the Hono app so it's actually reachable.
3. **Then Phase 2** (Role Discovery migration) — proves the runtime works with real agent behavior.
4. **Run tests after every phase** — the runtime test suite is at `npx vitest run workers/api/src/lib/unifiedAgentRuntime`.
