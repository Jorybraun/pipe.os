# Pipe Swarm Harness v3

True parallel swarm, not sequential sub-agents.

## What's different

**v2 (old):** Task → PM (wait) → Architect (wait) → Designer (wait) → Backend (wait) → Frontend (wait) → QA

**v3 (new):** Task → Swarm Broadcast → All agents start simultaneously → Work in parallel → Converge

## How it works

1. **Analyze task** — determine which agents needed
2. **Spawn swarm** — all agents start in parallel
3. **Shared telemetry** — agents read/write to `.swarm/telemetry.jsonl`
4. **Event-driven** — agents react to each other's progress, not orchestrator commands
5. **Converge** — when all agents complete, results are synthesized

## Usage

```bash
# Start swarm on a task
python swarm.py --task "Add candidate search filter"

# Check swarm status
python swarm.py --status

# Monitor until convergence
python swarm.py --monitor

# Present final results
python swarm.py --converge

# Reset telemetry for new task
python swarm.py --reset
```

## Agent roles

| Role | Triggered when |
|---|---|
| PM | Always (for complex tasks) |
| Designer | UI/UX keywords |
| Architect | Schema/API keywords |
| Backend | Server/API keywords |
| Frontend | React/component keywords |
| QA | Always |

## Integration with OpenClaw

The swarm script outputs `AGENT_INSTRUCTION|role|task|task_file` markers. The parent agent parses these and calls `sessions_spawn` for each agent in parallel.

Agents write to shared telemetry so they can see each other's progress in real-time.
