# Pipe Swarm Harness

Agent orchestration system for the Pipe technical interview platform. Coordinates PM, Designer, Architect, Frontend, and Backend agents through an approval-gated workflow with full telemetry.

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   harness_driver │────▶│  orchestrator   │────▶│   telemetry     │
│     (bridge)     │     │  (state machine)│     │  (event log)    │
└─────────────────┘     └─────────────────┘     └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
   sessions_spawn          file-based state        mailbox JSON
   (OpenClaw)              + approval gates        + JSONL events
```

## Quick Start

```bash
# Start a new task
cd .github/agents/harness
python harness_driver.py --task "Add skill-based candidate search"

# Resume after agents complete
python harness_driver.py --resume

# Check status
python harness_driver.py --status

# Full automation (skip approvals)
python harness_driver.py --task "Fix broken imports" --auto-approve
```

## Exit Codes

| Code | Meaning | Action |
|------|---------|--------|
| 0 | Success or in-progress | Nothing needed |
| 1 | Rejected | Review state.json, revise task |
| 2 | Needs agent | Spawn agent(s), then `--resume` |
| 3 | Needs approval | Approve/reject/revise, then `--resume` |

## Workflow Phases

```
Analysis → PM Decomposition → Design → Architecture → Implementation → QA → Final Approval → CD
```

Each phase has an approval gate. The orchestrator pauses for user input or exits with code 3 for non-interactive approval.

## Telemetry

Every workflow emits structured events to `.swarm/telemetry.jsonl`:

```json
{"timestamp": "2026-04-25T12:00:00+00:00", "task_id": "abc123", "event_type": "agent_assigned", "details": {"role": "backend", "task": "Implement API..."}}
```

### Event Types

- `task_started` — Workflow begins
- `agent_assigned` — Agent tasked with work
- `agent_spawned` — Agent actually dispatched (via sessions_spawn)
- `agent_completed` — Agent finished work
- `approval_requested` — Gate waiting for user
- `approval_granted` / `approval_rejected` / `approval_revise` — Gate decision
- `task_completed` — Phase finished
- `error` — Something broke
- `quality_gate_passed` / `quality_gate_failed` — QA check result
- `phase_transition` — Moving between phases
- `handoff` — Agent-to-agent transfer
- `cd_commit` / `cd_push` — Git operations
- `workflow_complete` / `workflow_rejected` — End state

### Reading Telemetry

```python
from telemetry import Telemetry

telem = Telemetry(".swarm")
summary = telem.get_summary()
print(f"Events: {summary['total_events']}")
print(f"Agents: {summary['agents_used']}")
print(f"Duration: {summary['duration_seconds']}s")
```

CLI:
```bash
python telemetry.py --task abc123 --summary
python telemetry.py --type agent_completed
```

## Machine-Readable Mode (for Automation)

```bash
# Get JSON output for scripts / OpenClaw integration
python harness_driver.py --task "Fix imports" --json
```

Output when agents needed:
```json
{
  "status": "waiting_for_agents",
  "agents_needed": [
    {
      "action": "spawn_agent",
      "role": "backend",
      "task_file": ".swarm/tasks/backend_20260425_120000.json",
      "result_file": ".swarm/tasks/backend_20260425_120000_result.md",
      "sessions_spawn_params": {
        "agent_id": "pipe-backend",
        "task": "Implement server-side logic...",
        "instructions": "Role: backend. Read full task spec...",
        "context": {...}
      }
    }
  ],
  "next_command": "python harness_driver.py --resume"
}
```

## Approval Gates

Interactive mode (default):
```
APPROVAL GATE: Design Review
[content preview]
[A]pprove  [R]eject  [Rev]ise
Your choice [A/R/Rev]: _
```

Non-interactive mode: the orchestrator exits with code 3 and saves state. Use `--auto-approve` for CI/automation, or manually edit `.swarm/state.json` to set the approval decision and resume.

## Agents

| Role | When Spawned | Output |
|------|-------------|--------|
| PM | Always (Phase 0.5) | Task decomposition with acceptance criteria |
| Designer | When task mentions UI/UX | Design specification document |
| Architect | When task mentions schema/API | Architecture specification with ADR flags |
| Frontend | When task needs React components | TSX files, hooks, types |
| Backend | When task needs server logic | Lambda handlers, API routes, schema |

## QA Gates

The orchestrator runs these checks automatically:

1. **TypeScript compilation** — `npx tsc --noEmit`
2. **No `any` types** — `grep -rn "\bany\b" src/ workers/`
3. **Named exports** — `grep -rn "export default"` (allowed only in `pages/`)
4. **CHANGELOG** — `[Unreleased]` section with content

If any gate fails, the workflow loops back to implementation.

## State File

`.swarm/state.json` tracks the full workflow state:

```json
{
  "task": "Add candidate search filter",
  "phase": "implementation_waiting",
  "status": "waiting_for_agents",
  "plan": {"needs_design": true, "needs_backend": true, "needs_pm": true},
  "outputs": {"pm": "...", "design": "..."},
  "approvals": {"pm": "approved", "design": "approved"},
  "pending_agents": [{"role": "backend", "task_file": "...", "result_file": "..."}],
  "qa_results": {},
  "qa_passed": false
}
```

Reset: `python harness_driver.py --reset`

## Integration with OpenClaw

The harness is designed to run inside OpenClaw. The typical flow:

1. OpenClaw agent runs `python harness_driver.py --task "..." --json`
2. If exit code 2 (needs agent), parse JSON output
3. Call `sessions_spawn` with the `sessions_spawn_params` from the JSON
4. The spawned agent reads its task spec, does work, writes to `result_file`
5. Optionally reports progress via telemetry mailbox
6. OpenClaw agent runs `python harness_driver.py --resume` to continue
7. Repeat until exit code 0

## Files

| File | Purpose |
|------|---------|
| `orchestrator.py` | Main state machine — phases, approvals, QA, CD |
| `telemetry.py` | Event emitter, mailbox system, status queries |
| `harness_driver.py` | Bridge script — runs orchestrator, outputs spawn instructions |
| `harness_runner.py` | Strategy-aware task builder for complex workflows |
| `team_graph_v2.py` | LangGraph structure with telemetry-aware nodes |
| `cd_coordinator.py` | Git pull/commit/push operations |
| `prompts/*.md` | System prompts for each role |
| `.swarm/state.json` | Workflow checkpoint |
| `.swarm/tasks/*.json` | Agent task specs |
| `.swarm/mailboxes/*.json` | Agent status via telemetry |
| `.swarm/telemetry.jsonl` | Event log |
| `.swarm/telemetry.log` | Human-readable log |

## Development

```bash
# Test telemetry
python telemetry.py --summary

# Test orchestrator directly
python orchestrator.py --task "Test task" --auto-approve

# Dry run
python harness_driver.py --task "Test task" --dry-run
```

## Constraints

- Keep telemetry lightweight — JSONL append, no database
- Backward compatible — orchestrator still writes legacy task specs
- Don't break existing APP code in pipe-os
- All approvals are human-gated by default (use `--auto-approve` for automation)
