# agent-harness

Orchestrates PM, architect, dev, QA agents via `sessions_spawn` for pipe-os tasks.

## Description

The agent-harness skill manages the full development workflow for PIPE-OS features:
1. **PM** breaks down the task into design/architecture/implementation phases
2. **Designer** creates UI/UX specs
3. **Architect** designs technical solution
4. **Backend + Frontend** implement in parallel or sequence
5. **QA** runs quality gates (`tsc --noEmit`, no `any` types, named exports)
6. **Approval gates** at each phase — user approves/rejects/revises

## Inputs

| Parameter | Type | Default | Description |
|---|---|---|---|
| `task` | string | required | Task description |
| `repo_path` | string | "." | Path to the git repository |
| `auto_approve` | bool | false | Skip approval gates |
| `phase` | string | "all" | Run specific phase only |

## Outputs

| Field | Type | Description |
|---|---|---|
| `workflow_status` | string | `complete`, `failed`, `rejected_at_design`, etc. |
| `approvals` | int | Number of approval gates passed |
| `qa_results` | dict | tsc, any-types, named-exports, changelog results |
| `telemetry_summary` | dict | Agent events, durations, errors |
| `changed_files` | list[str] | Files modified by the swarm |

## Usage

```python
from harness import run

result = run(
    task="Fix broken evaluator imports",
    repo_path="~/Code/PIPE/PIPE-OS",
    auto_approve=False
)

print(result["workflow_status"])  # "complete"
print(result["changed_files"])    # ["workers/api/src/lib/evaluator.ts"]
```

## Dependencies

- python3
- git
- npx tsc (for QA gate)

## Architecture

- `harness/__init__.py` — Entry point
- `harness/orchestrator.py` — Workflow orchestrator with 6 phases
- `harness/telemetry.py` — Event logging + mailbox system
- `harness/cd_coordinator.py` — Git operations
- `harness/prompts/` — Role prompts (PM, Designer, Architect, Frontend, Backend, QA)

## Telemetry

All agent activity is logged to `.swarm/telemetry.jsonl` in the repo. Mailboxes in `.swarm/mailboxes/` enable two-way communication between orchestrator and agents.
