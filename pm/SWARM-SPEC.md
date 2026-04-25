# Agent Swarm Architecture Spec

## Core Concept

Replace the sequential pipeline with a **task swarm**: The orchestrator IS the swarm launcher. It manages agents internally as parallel threads/processes, NOT as OpenClaw subagents via `sessions_spawn`.

**Critical distinction:** The orchestrator does not output `AGENT_INSTRUCTION` markers and wait for a parent agent. It spawns and coordinates agents itself using file-based state and mailboxes.

---

## Current vs Swarm

| | Sequential Pipeline | Swarm |
|---|---|---|
| Agent spawning | `AGENT_INSTRUCTION` → parent calls `sessions_spawn` | Orchestrator spawns threads/processes directly |
| Execution | PM→Design→Arch→Dev→QA (one at a time) | PM decomposes, then Design+Arch+Dev run simultaneously |
| Communication | Fixed handoffs (file drops) | Shared mailboxes, async messages |
| Orchestrator | Runs phases, waits for completion | Manages task queue, monitors parallel agents |
| QA | End-of-pipeline gate | Continuous, runs in parallel with dev |
| Failure | Blocks entire pipeline | Isolated to the failing subtask, others continue |
| External deps | Needs OpenClaw session to spawn agents | Self-contained, runs standalone |

---

## How the Orchestrator IS the Swarm

```
Orchestrator.run_swarm(task):
  1. PM agent (internal function) decomposes task
  2. Writes subtasks to registry.json
  3. Spawns Designer + Architect as parallel threads/processes
  4. Each agent polls registry, claims subtask, works, writes result
  5. Orchestrator monitors registry, detects completion
  6. Unblocks dependent subtasks, spawns Frontend + Backend
  7. QA runs continuously in background
  8. When all subtasks done → complete
```

**Agents are internal to the harness.** They are:
- Python threads calling LLM APIs directly, OR
- Subprocesses running standalone `agent_worker.py` scripts, OR
- Simple functions that write to files

They are NOT OpenClaw subagents. The harness is self-contained.

---

## Swarm Components

### 1. Task Registry (Shared State)

Central JSON file: `.swarm/tasks/registry.json`

```json
{
  "task_id": "swarm-001",
  "description": "Implement login flow",
  "status": "in_progress",
  "subtasks": [
    {
      "id": "sub-1",
      "title": "Design login page UI",
      "status": "in_progress",
      "assigned_to": "designer",
      "depends_on": [],
      "started_at": "2026-04-25T12:00:00Z",
      "completed_at": null,
      "result_file": ".swarm/results/designer_sub-1.json"
    },
    {
      "id": "sub-2",
      "title": "Design auth API schema",
      "status": "in_progress",
      "assigned_to": "architect",
      "depends_on": [],
      "started_at": "2026-04-25T12:00:00Z",
      "completed_at": null
    },
    {
      "id": "sub-3",
      "title": "Implement frontend login component",
      "status": "queued",
      "assigned_to": null,
      "depends_on": ["sub-1"],
      "started_at": null
    },
    {
      "id": "sub-4",
      "title": "Implement auth Lambda handler",
      "status": "queued",
      "assigned_to": null,
      "depends_on": ["sub-2"],
      "started_at": null
    },
    {
      "id": "sub-5",
      "title": "TypeScript type check",
      "status": "queued",
      "assigned_to": "qa",
      "depends_on": ["sub-3", "sub-4"],
      "continuous": true
    }
  ],
  "agents": {
    "designer": { "status": "busy", "current_subtask": "sub-1" },
    "architect": { "status": "busy", "current_subtask": "sub-2" },
    "frontend": { "status": "idle" },
    "backend": { "status": "idle" },
    "qa": { "status": "idle" }
  }
}
```

### 2. Agent Lifecycle (Internal to Harness)

```python
def spawn_swarm_agent(self, role: str, subtask: dict):
    """Launch an agent as a parallel thread/process within the harness."""
    # Option A: Thread that calls LLM API directly
    thread = threading.Thread(
        target=self._agent_worker,
        args=(role, subtask)
    )
    thread.start()
    
    # Option B: Subprocess that runs a standalone agent script
    proc = subprocess.Popen([
        'python3', 'agent_worker.py',
        '--role', role,
        '--subtask', json.dumps(subtask),
        '--mailbox', f'.swarm/mailboxes/{role}.json'
    ])
    return proc
```

The `agent_worker.py` script:
- Reads its subtask from registry
- Calls LLM API (not sessions_spawn)
- Writes results to mailbox
- Updates registry when done

### 3. Communication Protocol

Agents communicate via **async mailboxes**:

**Mailbox format:** `.swarm/mailboxes/{agent_id}.json`

```json
{
  "agent_id": "frontend",
  "inbox": [
    {
      "from": "designer",
      "timestamp": "2026-04-25T12:05:00Z",
      "type": "design_ready",
      "content": {
        "files": ["design/login-page.md"],
        "schema": { "fields": ["email", "password"] }
      }
    }
  ],
  "outbox": [],
  "status": "working",
  "current_task": "sub-3",
  "progress": {
    "percent": 60,
    "last_update": "2026-04-25T12:08:00Z",
    "message": "Building Login.tsx component"
  }
}
```

**Message types:**
- `design_ready` — Designer finished, frontend can start
- `schema_defined` — Architect defined API, backend can start
- `help_request` — Agent stuck, asks another agent for input
- `conflict_detected` — Two agents touched same file, needs resolution
- `code_review` — Agent requests review from another

### 4. Orchestrator Logic (Swarm Mode)

```python
class SwarmOrchestrator:
    def run_swarm(self, task):
        # Phase 1: PM decomposes (still sequential, needs human-level planning)
        subtasks = self.pm_agent.decompose(task)
        self.registry.write(subtasks)
        
        # Phase 2: Swarm execution (parallel)
        while not self.registry.all_done():
            ready = self.registry.get_ready_subtasks()  # dependencies met
            
            for subtask in ready:
                agent_type = subtask.assigned_to or self.pick_agent(subtask)
                self.spawn_swarm_agent(agent_type, subtask)
            
            # Wait for any agent to complete (not all)
            completed = self.wait_for_any_completion(timeout=30)
            
            for subtask in completed:
                self.registry.mark_done(subtask)
                # Notify dependent subtasks
                for dependent in self.registry.get_dependents(subtask):
                    self.notify_agent(dependent.assigned_to, {
                        "type": "dependency_met",
                        "subtask_id": subtask.id
                    })
            
            # Check for continuous QA tasks
            qa_ready = self.registry.get_ready_qa_tasks()
            for qa_task in qa_ready:
                self.spawn_swarm_agent("qa", qa_task)
        
        return self.registry.compile_results()
    
    def pick_agent(self, subtask):
        """Map subtask type to agent type."""
        mapping = {
            "ui": "designer",
            "api_schema": "architect", 
            "frontend_impl": "frontend",
            "backend_impl": "backend",
            "test": "qa",
            "review": "qa"
        }
        return mapping.get(subtask.type, "frontend")
```

### 5. Conflict Resolution

When two agents modify the same file:

1. **Detection:** Git diff shows overlapping changes
2. **Strategy:** 
   - If one agent is "designer" and other is "frontend" → designer wins (spec overrides implementation)
   - If both are devs → spawn "merge_agent" to resolve
   - If QA and dev → dev wins, QA opens bug ticket
3. **Action:** Write conflict to `.swarm/conflicts.json`, notify orchestrator

---

## Implementation Plan

### Files to Create/Modify

1. **`harness/orchestrator.py`** — Add `run_swarm()` method with threading. Keep `run_workflow()` as sequential fallback.
2. **`harness/agent_worker.py`** — **NEW** — Standalone agent process that reads subtask from registry, calls LLM API, writes results.
3. **`harness/swarm_state.py`** — **NEW** — Task registry with dependency resolution, conflict detection.
4. **`harness/telemetry.py`** — Add swarm events: `subtask_assigned`, `subtask_completed`, `agent_message`, `conflict_detected`

### Telemetry Events (Swarm)

```json
{"event_type": "subtask_assigned", "details": {"subtask_id": "sub-1", "agent": "designer"}}
{"event_type": "subtask_completed", "details": {"subtask_id": "sub-1", "agent": "designer", "files_changed": [...]}}
{"event_type": "dependency_met", "details": {"subtask_id": "sub-3", "unblocked_by": "sub-1"}}
{"event_type": "agent_message", "details": {"from": "designer", "to": "frontend", "type": "design_ready"}}
{"event_type": "conflict_detected", "details": {"file": "src/pages/Login.tsx", "agents": ["frontend", "backend"]}}
{"event_type": "swarm_complete", "details": {"task_id": "swarm-001", "subtasks_completed": 5}}
```

### Dashboard Integration (Unchanged)

The dashboard observer model still works — it reads `.swarm/tasks/registry.json` and `.swarm/telemetry.jsonl`, then displays:
- Active subtasks with assigned agents
- Dependency graph (which subtask blocks which)
- Live agent status (busy/idle)
- Conflict alerts
- Overall swarm progress

---

## Key Differences from Current Code

| Aspect | Current (Sequential) | Swarm |
|---|---|---|
| Agent spawn | `spawn_agent()` outputs `AGENT_INSTRUCTION` for parent | `spawn_swarm_agent()` launches threads/processes directly |
| State | `phase`, `approvals`, `qa_results` | `subtasks[]`, `agents{}`, `conflicts[]` |
| Execution | One agent at a time, waits for completion | Multiple agents at once, monitors all |
| Mailbox | Write-only progress updates | Bidirectional inbox/outbox |
| External deps | Needs OpenClaw session | Self-contained |
| QA | Final phase gate | Continuous subtask |
| Failure handling | Rejects entire workflow | Marks subtask failed, retries or reassigns |

---

## v1 Scope: Parallel Pipeline

Don't rebuild everything. Start with **parallel PM + Designer + Architect**:

1. PM decomposes (as now)
2. Instead of waiting, immediately spawn Designer AND Architect as parallel threads
3. Both work in parallel on different files
4. When both done, spawn Frontend and Backend (still parallel)
5. QA runs as final parallel check

This is a "parallel pipeline" — still has phases, but agents within a phase run simultaneously. True swarm (dynamic task claiming, recursive decomposition) comes in v2.

**Why v1 first:**
- Easier to build and debug
- Leverages existing orchestrator logic
- Proves parallel execution works
- Dashboard can observe it immediately

---

## Questions for Desktop

1. **Agent implementation:** Threads calling LLM APIs directly, or subprocess workers?
2. **Message broker:** Direct mailboxes, or orchestrator brokers all messages?
3. **Max parallel agents:** Resource limit — how many threads/processes?
4. **Dashboard view:** Task dependency graph, agent grid, or both?

Define the scope and build v1 (parallel pipeline) first.

    },
    {
      "id": "sub-3",
      "title": "Implement frontend login component",
      "status": "queued",
      "assigned_to": null,
      "depends_on": ["sub-1"],
      "started_at": null
    },
    {
      "id": "sub-4",
      "title": "Implement auth Lambda handler",
      "status": "queued",
      "assigned_to": null,
      "depends_on": ["sub-2"],
      "started_at": null
    },
    {
      "id": "sub-5",
      "title": "TypeScript type check",
      "status": "queued",
      "assigned_to": "qa",
      "depends_on": ["sub-3", "sub-4"],
      "continuous": true
    }
  ],
  "agents": {
    "designer": { "status": "busy", "current_subtask": "sub-1" },
    "architect": { "status": "busy", "current_subtask": "sub-2" },
    "frontend": { "status": "idle" },
    "backend": { "status": "idle" },
    "qa": { "status": "idle" }
  }
}
```

### 2. Agent Lifecycle

```
PM decomposes → writes subtasks to registry
    ↓
Orchestrator scans registry for ready subtasks (dependencies met)
    ↓
Spawns agents for ready subtasks in parallel
    ↓
Agents work, write results to their mailbox
    ↓
Orchestrator detects completion, marks subtask done
    ↓
Unblocks dependent subtasks, spawns new agents
    ↓
When all subtasks done → workflow complete
```

### 3. Communication Protocol

Agents communicate via **async mailboxes**:

**Mailbox format:** `.swarm/mailboxes/{agent_id}.json`

```json
{
  "agent_id": "frontend",
  "inbox": [
    {
      "from": "designer",
      "timestamp": "2026-04-25T12:05:00Z",
      "type": "design_ready",
      "content": {
        "files": ["design/login-page.md"],
        "schema": { "fields": ["email", "password"] }
      }
    }
  ],
  "outbox": [],
  "status": "working",
  "current_task": "sub-3",
  "progress": {
    "percent": 60,
    "last_update": "2026-04-25T12:08:00Z",
    "message": "Building Login.tsx component"
  }
}
```

**Message types:**
- `design_ready` — Designer finished, frontend can start
- `schema_defined` — Architect defined API, backend can start
- `help_request` — Agent stuck, asks another agent for input
- `conflict_detected` — Two agents touched same file, needs resolution
- `code_review` — Agent requests review from another

### 4. Orchestrator Logic (Pseudocode)

```python
class SwarmOrchestrator:
    def run(self, task):
        # Phase 1: PM decomposes (still sequential, needs human-level planning)
        subtasks = pm_agent.decompose(task)
        registry.write(subtasks)
        
        # Phase 2: Swarm execution (parallel)
        while not registry.all_done():
            ready = registry.get_ready_subtasks()  # dependencies met
            
            for subtask in ready:
                agent_type = subtask.assigned_to or self.pick_agent(subtask)
                self.spawn_agent(agent_type, subtask)
            
            # Wait for any agent to complete (not all)
            completed = self.wait_for_any_completion(timeout=30)
            
            for subtask in completed:
                registry.mark_done(subtask)
                # Notify dependent subtasks
                for dependent in registry.get_dependents(subtask):
                    self.notify_agent(dependent.assigned_to, {
                        "type": "dependency_met",
                        "subtask_id": subtask.id
                    })
            
            # Check for continuous QA tasks
            qa_ready = registry.get_ready_qa_tasks()
            for qa_task in qa_ready:
                self.spawn_agent("qa", qa_task)
        
        return registry.compile_results()
    
    def pick_agent(self, subtask):
        """Map subtask type to agent type."""
        mapping = {
            "ui": "designer",
            "api_schema": "architect", 
            "frontend_impl": "frontend",
            "backend_impl": "backend",
            "test": "qa",
            "review": "qa"
        }
        return mapping.get(subtask.type, "frontend")
```

### 5. Conflict Resolution

When two agents modify the same file:

1. **Detection:** Git diff shows overlapping changes
2. **Strategy:** 
   - If one agent is "designer" and other is "frontend" → designer wins (spec overrides implementation)
   - If both are devs → spawn "merge_agent" to resolve
   - If QA and dev → dev wins, QA opens bug ticket
3. **Action:** Write conflict to `.swarm/conflicts.json`, notify orchestrator

---

## Implementation Plan

### Files to Modify

1. **`harness/orchestrator.py`** — Replace `run_phases()` with `run_swarm()`
2. **`harness/telemetry.py`** — Add swarm-specific events: `subtask_assigned`, `subtask_completed`, `agent_message`, `conflict_detected`
3. **`harness/team_graph_v2.py`** — Replace sequential graph with parallel task graph
4. **New: `harness/swarm_state.py`** — Task registry, dependency resolver, conflict detector
5. **New: `harness/agent_pool.py`** — Manages active agents, resource limits, spawning

### Telemetry Events (New)

```json
{"event_type": "subtask_assigned", "details": {"subtask_id": "sub-1", "agent": "designer"}}
{"event_type": "subtask_completed", "details": {"subtask_id": "sub-1", "agent": "designer", "files_changed": [...]}}
{"event_type": "dependency_met", "details": {"subtask_id": "sub-3", "unblocked_by": "sub-1"}}
{"event_type": "agent_message", "details": {"from": "designer", "to": "frontend", "type": "design_ready"}}
{"event_type": "conflict_detected", "details": {"file": "src/pages/Login.tsx", "agents": ["frontend", "backend"]}}
{"event_type": "swarm_complete", "details": {"task_id": "swarm-001", "subtasks_completed": 5}}
```

### Dashboard Integration

The dashboard observer model still works — it reads `.swarm/tasks/registry.json` and displays:
- Active subtasks with assigned agents
- Dependency graph (which subtask blocks which)
- Live agent status (busy/idle)
- Conflict alerts
- Overall swarm progress

---

## Key Differences from Current Code

| Aspect | Current | Swarm |
|---|---|---|
| `orchestrator.py` | `run_phases()` loops through `PHASES` | `run_swarm()` polls task registry |
| State | `phase`, `approvals`, `qa_results` | `subtasks[]`, `agents{}`, `conflicts[]` |
| Agent spawn | One at a time, waits for completion | Multiple at once, monitors all |
| Mailbox | Write-only progress updates | Bidirectional inbox/outbox |
| QA | Final phase gate | Continuous subtask |
| Failure handling | Rejects entire workflow | Marks subtask failed, retries or reassigns |

---

## Suggested First Implementation

Don't rebuild everything. Start with **parallel PM + Designer + Architect**:

1. PM decomposes (as now)
2. Instead of waiting, immediately spawn Designer AND Architect
3. Both work in parallel on different files
4. When both done, spawn Frontend and Backend (still parallel)
5. QA runs as final parallel check

This is a "parallel pipeline" — still has phases, but agents within a phase run simultaneously. True swarm (dynamic task claiming, recursive decomposition) comes in v2.

---

## Questions for Desktop

1. Do you want **parallel pipeline** (phases still exist, but agents in each phase run together) or **true swarm** (no phases, agents dynamically claim tasks)?
2. Should agents communicate via mailboxes, or should the orchestrator broker all messages?
3. What's the max parallel agents? (Resource limit — each agent is a process/subagent)
4. How should the dashboard show a swarm? (Task dependency graph? Agent grid? Both?)

Define the scope and I'll refine the spec.
