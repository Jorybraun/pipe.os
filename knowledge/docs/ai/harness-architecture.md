# Agent Harness Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MCP CLIENTS                                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐   │
│  │  Kimi CLI    │  │Claude Desktop│  │   VS Code    │  │   SSE/HTTP   │   │
│  │   (stdio)    │  │   (stdio)    │  │   (stdio)    │  │   (port)     │   │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘   │
└─────────┼─────────────────┼─────────────────┼─────────────────┼───────────┘
          │                 │                 │                 │
          └─────────────────┴────────┬────────┴─────────────────┘
                                     │
                              ┌──────▼──────┐
                              │  MCP STDIO  │     ← Content-Length or line-delimited
                              │   SERVER    │       JSON (auto-detected)
                              │  (FastMCP)  │
                              └──────┬──────┘
                                     │
                    ┌────────────────┼────────────────┐
                    │                │                │
              ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
              │  Broker   │   │   Lane    │   │   Agent   │
              │  Tools    │   │  Control  │   │  Runtime  │
              │ (49 tool) │   │  (4 tool) │   │ (6 tool)  │
              └─────┬─────┘   └─────┬─────┘   └─────┬─────┘
                    │               │               │
┌───────────────────┼───────────────┼───────────────┼───────────────────────────┐
│                   │               │               │                           │
│  ┌────────────────▼───────────────▼───────────────▼───────────────────────┐   │
│  │                         BROKER DATABASE (SQLite)                       │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │  │    plans    │  │    lanes    │  │   events    │  │    cues     │  │   │
│  │  │  (strategy) │  │  (running)  │  │   (audit)   │  │  (steering) │  │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                   │   │
│  │  │ interrupts  │  │ migration   │  │   handoffs  │                   │   │
│  │  │  (escalate) │  │   ledger    │  │   (exit)    │                   │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘                   │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐   │
│  │                    SWARM / ORCHESTRATOR (LangGraph)                     │   │
│  │                                                                         │   │
│  │   ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐        │   │
│  │   │supervisor│────▶│ advisor │────▶│developer│────▶│qa_deploy│        │   │
│  │   │  node   │◄────│  node   │◄────│  node   │◄────│  node   │        │   │
│  │   └────┬────┘     └─────────┘     └─────────┘     └────┬────┘        │   │
│  │        │                                               │              │   │
│  │        └───────────────────────────────────────────────┘              │   │
│  │                        ↑ deterministic routing                         │   │
│  │                        (no LLM — state machine)                        │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐   │
│  │                      LANE RUNNER (asyncio)                              │   │
│  │                                                                         │   │
│  │   claim_plan() → start_lane(plan_id) → run_lane() ─────┐               │   │
│  │                              │                          │               │   │
│  │                              ▼                          ▼               │   │
│  │                      ┌─────────────┐            ┌─────────────┐         │   │
│  │                      │ asyncio.Task│            │ThreadPool   │         │   │
│  │                      │  (async)    │            │  (sync ctx) │         │   │
│  │                      └──────┬──────┘            └──────┬──────┘         │   │
│  │                             │                          │               │   │
│  │                             └──────────┬───────────────┘               │   │
│  │                                        ▼                                │   │
│  │                              ┌─────────────────┐                        │   │
│  │                              │  Lane Graph.run │                        │   │
│  │                              │  (checkpointer) │                        │   │
│  │                              └─────────────────┘                        │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
│  ┌────────────────────────────────────────────────────────────────────────┐   │
│  │                         AGENTS (DeepAgents)                             │   │
│  │                                                                         │   │
│  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  │   │
│  │   │ orchestrator│  │   meta-pm   │  │  architect  │  │    chat     │  │   │
│  │   │  (broker    │  │  (strategy) │  │  (system    │  │  (workflow  │  │   │
│  │   │   tools)    │  │             │  │   design)   │  │   agent)    │  │   │
│  │   └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘  │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         WEBSOCKET SERVER (port 8766)                         │
│                                                                              │
│   Real-time event push to connected clients (agent status, lane events,      │
│   steering cues, approval requests)                                          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────────────┐
│                         CHECKPOINTER (SQLite)                                │
│                                                                              │
│   `.swarm/.checkpoints.db` — LangGraph checkpoint persistence               │
│   Keeps lane state across restarts (last 5 checkpoints per thread)          │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow: Starting a Lane

```
1. MCP client calls harness_start_lane(plan_id="plan-001")
        │
        ▼
2. Server checks plan status in broker.db
        │
        ▼
3. If PENDING → broker_claim_plan(plan_id, lane_id)
        │
        ▼
4. lane_runner.start_lane(plan_id, lane_id)
        │
        ├──▶ Create asyncio.Task(run_lane(...))
        │
        ▼
5. run_lane() → build_lane_graph().invoke(initial_state)
        │
        ├──▶ supervisor_node — reads work_items, routes to next node
        ├──▶ advisor_node — runs architect/meta-pm for guidance
        ├──▶ developer_node — runs DeepAgent with toolkit tools
        └──▶ qa_deploy_node — validates output, creates PR
        │
        ▼
6. Lane finishes → _on_done() callback updates DB, emits event
        │
        ▼
7. WebSocket pushes lane_finished event to subscribers
```

## Key Files

| Component | File |
|-----------|------|
| MCP Server | `agent-harness/src/agent_harness/server.py` |
| Broker DB | `agent-harness/src/agent_harness/broker/` |
| Lane Graph | `agent-harness/src/agent_harness/swarm/graph.py` |
| Lane Runner | `agent-harness/src/agent_harness/swarm/lane_runner.py` |
| Orchestrator Agent | `agent-harness/src/agent_harness/swarm/agents/orchestrator_agent.py` |
| Checkpointer | `agent-harness/src/agent_harness/swarm/checkpoint.py` |
| WebSocket | `agent-harness/src/agent_harness/websocket_server.py` |
