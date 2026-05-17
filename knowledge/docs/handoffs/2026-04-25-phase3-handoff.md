# Full Handoff — Phase 3 Complete ✅

## Done

- `pyproject.toml` — added LangGraph + LangChain stack: `langgraph`, `langgraph-checkpoint-sqlite`, `langchain-anthropic`, `langchain-community`, `langchain-mcp-adapters`, plus `langchain-experimental`, `playwright`, `beautifulsoup4`
- `broker/handoff_registry.py` — `submit_handoff` / `get_handoff` / `get_handoff_chain` (schema already had table from Phase 2)
- `broker/__init__.py` — exports handoff functions
- `server.py` — 3 new MCP tools wired: `broker_submit_handoff_tool`, `broker_get_handoff_tool`, `broker_get_handoff_chain_tool`
- `swarm/toolkit.py` — `get_developer_tools()` returning 18 tools:
  - FileManagementToolkit (read/write/list/copy/move/search/delete)
  - ShellTool (`terminal`)
  - Playwright browser tools (`navigate_browser`, `extract_text`, `click_element`) — best-effort, graceful fallback if async loop blocks sync browser
  - Broker tools: `broker_submit_handoff_tool`, `broker_emit_event_tool`, `broker_get_plan_tool`, `broker_reserve_migration_tool`, `broker_post_cue_tool`, `broker_read_cues_tool`, `broker_ack_cue_tool`
- `swarm/checkpoint.py` — `SqliteSaver` wired to `.checkpoints.db`
- `swarm/prompts/developer.md` — system prompt: BDD-first, one-subtask-at-a-time, 80K context cap, path restrictions, handoff format
- `swarm/agents/developer.py` — `build_developer_graph()`:
  - Manual ReAct graph (agent → should_continue → tools → budget_guard → agent)
  - `budget_guard_node` counts cumulative input tokens per turn
  - Warn at 60K via injected SystemMessage
  - Force-exit at 80K via injected SystemMessage + `status="context_exhausted"`
  - `tools_node` caches tools at module level to avoid repeated browser instantiation
- `swarm/budget.py` — `TokenBudget` helper (warn 60K, force-exit 80K, reserve 20K for Handoff write)
- `scripts/validate_phase3.py` — 5/5 pass:
  - `test_budget` — warn/exhaust thresholds
  - `test_toolkit` — 18 tools present
  - `test_handoff_registry` — submit/get/chain CRUD
  - `test_graph_compiles` — graph compiles with `SqliteSaver`
  - `test_mock_e2e` — mock LLM forces handoff, graph terminates, handoff persisted in broker

## Files touched

```
agent-harness/pyproject.toml
agent-harness/src/agent_harness/broker/__init__.py
agent-harness/src/agent_harness/broker/handoff_registry.py
agent-harness/src/agent_harness/server.py
agent-harness/src/agent_harness/swarm/__init__.py
agent-harness/src/agent_harness/swarm/toolkit.py
agent-harness/src/agent_harness/swarm/checkpoint.py
agent-harness/src/agent_harness/swarm/prompts/developer.md
agent-harness/src/agent_harness/swarm/agents/developer.py
agent-harness/src/agent_harness/swarm/budget.py
agent-harness/scripts/validate_phase3.py
```

## New directories created

```
agent-harness/src/agent_harness/swarm/
agent-harness/src/agent_harness/swarm/agents/
agent-harness/src/agent_harness/swarm/prompts/
```

## Known caveats / Phase 4 prep notes

1. **Playwright sync-in-async loop**: `get_developer_tools()` gracefully catches the error when instantiated inside an async event loop (LangGraph compiled graphs run async internally). The tools are unavailable in that context but the agent continues. Phase 4 should either:
   - Use async Playwright tools (`create_async_playwright_browser` + async tool wrappers)
   - Or defer browser instantiation to the `qa_deploy` agent only
2. **ANTHROPIC_API_KEY required**: `developer.py` expects this env var. Phase 4 supervisor should inject it into dev config.
3. **Context-exhaust loop not yet fully wired**: The graph injects a SystemMessage at 80K forcing the agent to call `submit_handoff`, but there's no hard guarantee the LLM obeys. Phase 4 could add a custom node that directly synthesizes the `broker_submit_handoff_tool` tool call as an AIMessage to make it deterministic.
4. **No `consult_architect` tool yet**: Listed in PLAN.md MCP tool surface but not implemented. Phase 4 can add as a one-shot LLM call.
5. **No `complete_plan` or `heartbeat` tools yet**: Also Phase 4 scope.

## Next (Phase 4)

Per PLAN.md:

- `swarm/agents/pm.py` — reads plan, populates `work_items`, exits
- `swarm/agents/supervisor.py` — claims plans via broker, calls `Send()` per lane, watches Handoff events, dispatches next dev
- `swarm/agents/qa_deploy.py` — reads `handoff_chain`, runs full suite on clean checkout, opens PR
- `swarm/graph.py` — `langgraph-supervisor` topology with `Send()` for parallel lane dispatch
- `swarm/budget.py` extension — per-plan (500K) and per-subtask handoff cap (5)
- Liveness watchdog — 30s heartbeats, 5min timeout, re-dispatch with last Handoff
- Validation Phase 4a — synthetic context-exhaust chains through 3 devs
- Validation Phase 4b — two non-conflicting plans in parallel

Ready for direction: proceed to Phase 4, or something else?
