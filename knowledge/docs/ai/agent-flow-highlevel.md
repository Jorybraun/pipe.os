# High-Level Agent Flow

> End-to-end flow of the **Agent Harness** — from plan ingestion through lane execution to completion.

---

## 1. Overview

The Agent Harness is an autonomous execution layer that sits on top of the PIPE-OS strategy backlog. It reads markdown plans, dispatches them as lanes, runs a LangGraph swarm to implement the work, and validates the result before marking it complete.

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Plans     │───▶│   Broker    │───▶│    Lane     │───▶│  QA Deploy  │
│  (markdown) │    │   (SQLite)  │    │  (LangGraph)│    │   (gate)    │
└─────────────┘    └─────────────┘    └─────────────┘    └─────────────┘
```

---

## 2. Plan Ingestion

Strategy documents live in `docs/plans/strategy-v2/**/*.md`. Each file is a **plan** with:

- A `## Why` section
- A `## Acceptance criteria` section
- `### Subtask N — Title` work items
- A `## Dependencies` section (ordering graph)
- A `**Files:**` block (conflict detection)

The `plan_walker` parses these files and syncs them into the broker database (`broker.db`).

```
docs/plans/strategy-v2/
├── part1-foundation/
│   └── auth-refactor.md
├── part2-role-nodes/
│   └── schema-migration.md
└── part4-candidate-ingestion/
    └── candidate-nodes-schema.md
         │
         ▼
    ┌─────────────┐
    │ plan_walker │
    └──────┬──────┘
           ▼
    ┌─────────────┐
    │  broker.db  │  ← plans, subtasks, dependencies, files
    └─────────────┘
```

### Plan Status Lifecycle

```
PENDING ──[lane starts]──▶ COMPLETE ──[human merges PR]──▶ DONE
   │
   └── NEEDS-REFINEMENT, DEFERRED, REDIRECT  (swarm skips)
```

---

## 3. Claim & Dispatch

The **Orchestrator** continuously queries for runnable plans:

```sql
SELECT plan_id FROM plans
WHERE status = 'PENDING'
  AND plan_id NOT IN (
      SELECT plan_id FROM plan_dependencies d
      JOIN plans p ON p.plan_id = d.depends_on
      WHERE d.plan_id = plans.plan_id
        AND p.status NOT IN ('COMPLETE', 'DONE', 'PR_OPEN')
  )
ORDER BY phase, plan_id;
```

When a plan is claimable:

1. `broker_claim_plan(plan_id)` reserves it
2. A `lane_id` is generated
3. `lane_runner.start_lane(plan_id, lane_id)` is called

```
┌─────────────┐     claimable?      ┌─────────────┐
│   plans     │ ──────────────────▶ │   lanes     │
│  PENDING    │                     │  running    │
└─────────────┘                     └──────┬──────┘
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │ lane_runner │
                                    │  .start()   │
                                    └─────────────┘
```

---

## 4. Lane Execution (LangGraph)

A **lane** is a single plan being executed by a swarm of agents. The lane graph is a deterministic state machine — no LLM decides routing; state predicates do.

### 4.1 Graph Nodes

```
┌───────────┐      ┌───────────┐      ┌───────────┐      ┌───────────┐
│ supervisor│─────▶│  advisor  │─────▶│ developer │─────▶│ qa_deploy │
│   node    │◀─────│   node    │◀─────│   node    │◀─────│   node    │
└───────────┘      └───────────┘      └───────────┘      └───────────┘
      ▲                                                    │
      └────────────────────────────────────────────────────┘
                  deterministic routing (state machine)
```

| Node | Responsibility |
|------|----------------|
| **supervisor** | Reads work items from the plan, checks handoff chains, decides the next node |
| **advisor** | Runs architect / meta-pm to produce guidance before implementation |
| **developer** | Runs a ReAct DeepAgent with toolkit tools (file edit, test, git, etc.) |
| **qa_deploy** | Validates output against acceptance criteria, verifies DoD, opens PR |

### 4.2 Developer Loop

The developer node is the workhorse. It operates in a ReAct loop:

```
┌─────────────┐
│   Observe   │  ← read files, test output, handoff context
└──────┬──────┘
       ▼
┌─────────────┐
│   Think     │  ← LLM reasoning
└──────┬──────┘
       ▼
┌─────────────┐
│    Act      │  ← tool call (edit, test, git, migrate, etc.)
└──────┬──────┘
       │
       └──────▶ repeat until done or context exhausted
```

### 4.3 Handoff Protocol

When a developer exits, it produces a **Handoff** artifact stored in `broker.db`:

```json
{
  "handoff_id": "plan-001:subtask-1:1",
  "status": "complete",
  "done": [
    {"type": "file", "path": "src/foo.ts", "summary": "added auth guard"}
  ],
  "next_actions": ["wire up route in App.tsx"],
  "state_notes": ["needs clerk token for e2e"],
  "files_touched": ["src/foo.ts"],
  "dod_checklist": [
    {"item": "Acceptance criteria met", "checked": true, "justification": ""}
  ],
  "handoff_to": "next_dev"
}
```

The supervisor reads the handoff and either:
- Routes to the **next developer** (context-exhaust chain)
- Sends to **qa_deploy** (final subtask done)
- **Reroutes** back to advisor (blocked / needs refinement)

---

## 5. Human-in-the-Loop

At any point, the swarm can raise an **interrupt**:

- Budget threshold exceeded
- Conflict with another active lane (same files)
- Unclear acceptance criteria
- Tool failure / test red after N retries

```
┌─────────────┐     interrupt()      ┌─────────────┐
│   swarm     │ ───────────────────▶ │ interrupts  │
│   node      │                      │   active    │
└─────────────┘                      └──────┬──────┘
                                            │
                                            ▼
                                    ┌─────────────┐
                                    │   human     │
                                    │  operator   │
                                    └──────┬──────┘
                                           │
                              broker_resume_tool()
                                           │
                                           ▼
                                    ┌─────────────┐
                                    │   swarm     │
                                    │  resumes    │
                                    └─────────────┘
```

Operators can also post **cues** (steering messages) at any time:

```sql
INSERT INTO cues (plan_id, lane_id, content) VALUES (?, ?, ?);
```

Agents read cues between tool calls and acknowledge them.

---

## 6. QA & Completion

The **qa_deploy** node is the final gate before a plan is considered complete.

### 6.1 Definition of Done (DoD) Verification

| Check | Verified By |
|-------|-------------|
| Acceptance criteria met | qa_deploy + advisor |
| BDD first (failing Playwright spec written) | developer self-certifies |
| Minimal change (no scope creep) | developer self-certifies |
| Unit tests pass | developer self-certifies |
| Type check passes (`tsc --noEmit`) | developer self-certifies |
| Lint passes | developer self-certifies |
| Path compliance (no edits outside allowed dirs) | developer self-certifies |
| Migration safety (number reserved) | developer self-certifies |
| PR template ready | developer self-certifies |

### 6.2 Completion Flow

```
qa_deploy node
     │
     ├──▶ DoD checklist valid? ──NO──▶ REJECT → back to developer
     │
     ├──▶ Tests pass? ──NO──▶ REJECT → back to developer
     │
     ├──▶ Acceptance criteria met? ──NO──▶ REJECT → back to developer
     │
     └──▶ ALL PASS
              │
              ▼
       mark_plan_complete()
              │
              ▼
    ┌─────────────────┐
    │  plan status →  │
    │   COMPLETE      │
    └─────────────────┘
              │
              ▼
       WebSocket event
              │
              ▼
    Human merges PR → plan status → DONE
```

---

## 7. Observability

Three real-time channels surface lane activity:

| Channel | Purpose |
|---------|---------|
| **Events table** | Append-only audit log (`plan_started`, `subtask_complete`, `dev_exited`, `lane_killed`, ...) |
| **WebSocket** | Live push to connected clients (agent status, lane events, approval requests) |
| **Checkpointer** | LangGraph state snapshots in `.swarm/.checkpoints.db` (last 5 per thread) |

---

## 8. Component Map

| Layer | File | Role |
|-------|------|------|
| MCP Server | `agent-harness/src/agent_harness/server.py` | Entry point (stdio + SSE) |
| Broker DB | `agent-harness/src/agent_harness/broker/db.py` | SQLite schema & connection |
| Plan Sync | `agent-harness/src/agent_harness/broker/plan_walker.py` | Markdown → DB ingestion |
| Lane Graph | `agent-harness/src/agent_harness/swarm/graph.py` | LangGraph state machine |
| Lane Runner | `agent-harness/src/agent_harness/swarm/lane_runner.py` | Asyncio task orchestration |
| Supervisor | `agent-harness/src/agent_harness/swarm/agents/orchestrator_agent.py` | Plan routing logic |
| Developer | `agent-harness/src/agent_harness/swarm/agents/developer.py` | ReAct implementation agent |
| QA Deploy | `agent-harness/src/agent_harness/swarm/agents/qa_deploy.py` | Validation & PR gate |
| Advisor | `agent-harness/src/agent_harness/swarm/agents/advisor.py` | Guidance node |
| Checkpointer | `agent-harness/src/agent_harness/swarm/checkpoint.py` | SQLite persistence for LangGraph |
| WebSocket | `agent-harness/src/agent_harness/websocket_server.py` | Real-time event push |
