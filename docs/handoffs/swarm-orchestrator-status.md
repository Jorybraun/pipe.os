# Handoff: Swarm Orchestrator Status vs. PLAN.md

**Date:** 2026-04-25
**Context:** LangGraph-native orchestrator refactor just landed (lane supervisor as structured routing agent, Lane Advisor added, Meta-PM elevated from per-plan PM, `pm.py` deleted).

---

## ✅ What's Fully Working

### Broker Layer (Phases 1–2)

| Component | Status | Evidence |
|-----------|--------|----------|
| **Plan registry** | ✅ | `plan_walker.py` parses 100 plans; `runnable_set()` excludes 17 NEEDS-REFINEMENT; broker DB populated |
| **Conflict matrix** | ✅ | `conflicts_for()` detects file + migration overlaps; tested with candidateNodes.ts + 0045–0052 races |
| **Migration ledger** | ✅ | Atomic `reserve_migration()` with `BEGIN IMMEDIATE`; race-tested 20 threads; `release_migration()` tombstones |
| **Event bus** | ✅ | `emit()` → SQLite `events` table; `get_events()` queryable; core lane events fire correctly |
| **Cue channel** | ✅ | `post_cue()` dedupes by SHA-256 content hash (1h window); `read_cues()` + `ack_cue()` functional |
| **Interrupt registry** | ✅ | `register_interrupt()`, `resume_interrupt()`, `list_interrupts()` all wired; LangGraph `interrupt()` used in `escalation_gate_node` |
| **Handoff registry** | ✅ | `submit_handoff()` auto-increments sequence; `get_handoff()` + `get_handoff_chain()` work |

### MCP Tools (All Wired)

| Tool Group | Tools |
|------------|-------|
| **Broker read-only** | `broker_list_plans`, `broker_runnable_set`, `broker_get_plan`, `broker_conflicts_for`, `broker_sync_plans` |
| **Events / Cues / Migrations / Interrupts** | `broker_reserve_migration`, `broker_release_migration`, `broker_list_reserved_migrations`, `broker_emit_event`, `broker_get_events`, `broker_post_cue`, `broker_read_cues`, `broker_ack_cue`, `broker_escalate`, `broker_resume`, `broker_list_interrupts` |
| **Handoffs** | `broker_submit_handoff`, `broker_get_handoff`, `broker_get_handoff_chain` |
| **Lane control** | `harness_start_lane`, `harness_get_lane_status`, `harness_list_active_lanes`, `harness_run_swarm` |
| **Meta-PM** | `harness_meta_pm_recommend` |
| **Legacy workflow** | All 12 `harness_*` lifecycle tools + 4 messaging tools still functional |

### Lane Graph (Compiled & Runnable)

| Node | Status |
|------|--------|
| `lane_supervisor_node` | ✅ Structured routing with `LaneRoutingDecision` (LLM decides next: advisor / developer / qa_deploy / escalate / end) |
| `advisor_node` | ✅ Reads plan + handoff chain + cues; emits `AdvisorOutput` (guidance, plan_health, escalation flag) |
| `developer_node` | ✅ Spawns ephemeral dev via `run_developer()`; handles `complete` / `context_exhausted` / `blocked` handoffs |
| `qa_deploy_node` | ✅ Runs QA-Deploy agent; marks plan complete / failed; updates lane row |
| `escalate_node` | ✅ Registers interrupt in broker; emits `escalated` event |
| `escalation_gate_node` | ✅ Calls LangGraph `interrupt()` for human approval before terminal END |
| **Dev N+1 chaining** | ✅ Preserved. `context_exhausted` keeps `current_subtask_id`; next dev gets same subtask with handoff as input |

### Supporting Infrastructure

| Component | Status |
|-----------|--------|
| `checkpoint.py` | ✅ `SqliteSaver` wired into dev, QA, and lane graphs |
| `escalation.py` | ✅ Regex checks for `migrations/`, `lib/privacy/`, `routes/candidate/`, `LL144`, `Article 22`, `EEOC` |
| `pr_template.py` | ✅ 7-section template + validator |
| Tests | ✅ `tests/test_swarm_orchestrator.py` — 8/8 pass |

---

## ⚠️ Partially Working / Implemented with Gaps

### Developer Agent

| Feature | State | Gap |
|---------|-------|-----|
| **Token budget** | Tracks input tokens per turn | **Advisory only**. At 80K injects a system message ordering handoff, but does **not** programmatically force the tool call. LLM could ignore it. |
| **Tool loop detection** | Detects 3× identical tool calls | ✅ Forces exit to END |
| **Context trimming** | Not implemented | `trim_messages` from `langgraph.prebuilt` is **not used** — messages grow unbounded within the 50-turn cap |

### QA-Deploy Agent

| Feature | State | Gap |
|---------|-------|-----|
| **Test execution** | Has ShellTool + Playwright browser tools | ✅ Can run tests |
| **PR creation** | **Missing** | No `gh pr create` tool. QA-Deploy emits `plan_completed` event; `qa_deploy_node` calls `mark_plan_complete()`. PR is **not opened**. |
| **Manual QA** | Prompt instructs Playwright smoke | ⚠️ Agent can run Playwright but no structured validation of results |

### Supervisor Class (Outer Dispatcher)

| Feature | State | Gap |
|---------|-------|-----|
| **Claims & dispatches lanes** | ✅ `tick()` queries `runnable_set()`, checks `conflicts_for()`, spawns `asyncio.Task` per lane | — |
| **Watchdog** | ✅ 30-min max runtime kill; 5-min stall kill | **Not heartbeat-based**. Kills are based on task runtime, not agent liveness pings |
| **Plan budget enforcement** | Tracks `plan_budget_used` in lane state | **Never halts or escalates** at 500K cap. `PlanBudget` class exists but is **uninstantiated** |
| **Re-dispatch on kill** | Cancels task, emits `lane_killed` | **Does not release migrations** or resume from checkpoint. Lane just dies. |

### Meta-PM

| Feature | State | Gap |
|---------|-------|-----|
| **ReAct agent** | ✅ Built with broker read tools | Uses deprecated `langgraph.prebuilt.create_react_agent` (LangGraph V1.0 warning) |
| **Tool mismatch** | Prompt claims `harness_start_lane` and `broker_post_cue` are available | **Not in `_get_meta_pm_tools()`**. Meta-PM can only *observe*, not *act*. |
| **MCP exposure** | ✅ `harness_meta_pm_recommend()` returns recommendation | No telemetry emitted (no broker event on call) |

### Event Bus

| Feature | State | Gap |
|---------|-------|-----|
| **Append-only SQLite events** | ✅ Works | — |
| **SSE subscribe** | ❌ Missing | PLAN.md lists `subscribe(filter?, since?)` for real-time SSE stream. Only polling via `broker_get_events_tool` exists. |

---

## ❌ Not Yet Implemented

| PLAN.md Item | Why It Matters | Current State |
|--------------|----------------|---------------|
| `claim_plan(path, lane_id)` — atomic plan reservation | Prevents two callers from starting the same plan lane concurrently | `harness_start_lane` checks `status == 'PENDING'` but does **not** lock or transition atomically |
| `heartbeat(lane_id, agent_id)` | Liveness; supervisor watchdog reads | `lanes.last_heartbeat` column exists but **nothing writes to it** |
| `consult_architect(question, context)` | Bounded one-shot design help for developers | **Not implemented anywhere** |
| `complete_plan(path, result)` — MCP tool | QA-Deploy terminal action | `mark_plan_complete()` exists in Python but is **not exposed as MCP tool** |
| `langgraph-supervisor` package usage | PLAN.md said "Don't build a custom dispatcher" | Built fully custom `Supervisor` class + manual `StateGraph` instead |
| `langchain-mcp-adapters` usage | Listed in `pyproject.toml` | **Never imported**. Broker tools manually wrapped with `@tool` |
| `trim_messages` | Context window management | **Not used** |
| Phase 6 cutover (delete `pm/`, delete `.github/agents/harness/`) | Cleanup | Old directories still exist. Legacy orchestrator (`orchestrator.py`, `messaging.py`, `websocket_server.py`) still fully wired and functional |

---

## 🔴 Critical Blockers

1. **`sync_plans_to_db()` FK crash**
   - `sqlite3.IntegrityError: FOREIGN KEY constraint failed` when dependency points to non-existent plan
   - Breaks Phase 2 validation script; breaks plan re-scan workflow
   - Fix: Skip dependencies that don't resolve instead of hard-failing

2. **QA-Deploy does not open PRs**
   - Terminal action is incomplete. Swarm runs tests but stops at `plan_completed` event
   - Fix: Add `gh` CLI tool to QA-Deploy toolkit; validate PR template; call `gh pr create`

3. **Plan budget not enforced**
   - Supervisor tracks `plan_budget_used` but never checks 500K cap
   - Fix: Add budget guard in `Supervisor.tick()` or `lane_supervisor_node`

4. **Meta-PM cannot act**
   - Prompt says it can spawn lanes, but tools are read-only
   - Fix: Add `harness_start_lane` and `broker_post_cue` wrappers to `_get_meta_pm_tools()`

5. **No atomic plan claim**
   - Race condition: two `harness_start_lane` calls for same plan could both pass the `PENDING` check before either lane updates state
   - Fix: Add `claim_plan()` atomic transition `PENDING → CLAIMED` in broker

---

## 📝 What Just Changed (This Refactor)

| Before | After |
|--------|-------|
| `pm.py` — per-plan agent that populated work_items | `_init_work_items()` in `graph.py` — hydrates queue before lane starts |
| `supervisor.py` — separate file, imperative dispatcher | `lane_supervisor_node` inside `graph.py` — structured routing agent; `Supervisor` class manages lane pool |
| 4-agent topology (Supervisor, PM, Dev, QA) | 5-agent topology (Meta-PM, Supervisor, Lane Advisor, Dev, QA) |
| `work_items: []` in initial state | `work_items: _init_work_items(plan_id)` + `advisor_guidance` + `next_node` fields |
| `pm.py` existed | `pm.py` deleted |
| No Meta-PM MCP tool | `harness_meta_pm_recommend()` added |
| `import json` missing in developer.py | Fixed |

---

## 🧪 Test Status

| Suite | Result |
|-------|--------|
| `tests/test_swarm_orchestrator.py` | **8/8 pass** |
| `scripts/validate_phase3.py` | **5/5 pass** (mock dev run) |
| `scripts/validate_phase4.py` | **2/5 pass** (3 fail without `KIMI_API_KEY`) |
| `scripts/validate_phase2.py` | **Fails** (`sync_plans_to_db` FK crash) |

---

## 🎯 Next Recommended Actions

1. **Fix `sync_plans_to_db` FK bug** — unblock plan re-scan
2. **Add `gh pr create` to QA-Deploy toolkit** — complete terminal action
3. **Enforce plan budget in Supervisor** — prevent runaway lanes
4. **Give Meta-PM action tools** — `harness_start_lane`, `broker_post_cue`
5. **Add atomic `claim_plan`** — prevent lane-start races
6. **Wire heartbeat system** — real agent liveness, not task-runtime proxy
