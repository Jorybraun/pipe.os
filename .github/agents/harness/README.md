# Agent Harness

OpenClaw skill for orchestrating PM, architect, dev, QA agents via `sessions_spawn`.

## Installation

```bash
# Copy to OpenClaw skills directory
cp -r ~/.agents/skills/agent-harness ~/.agents/skills/

# Or symlink for development
ln -s ~/Code/PIPE/PIPE-OS/.github/agents/harness ~/.agents/skills/agent-harness
```

## Usage

```python
from harness import run

result = run(
    task="Fix broken evaluator imports",
    repo_path="~/Code/PIPE/PIPE-OS",
    auto_approve=False
)
```

## Architecture

- `harness/__init__.py` — Entry point
- `harness/orchestrator.py` — 6-phase workflow orchestrator
- `harness/telemetry.py` — Event logging + mailbox system
- `harness/cd_coordinator.py` — Git operations
- `harness/prompts/` — Role prompts (PM, Designer, Architect, Frontend, Backend, QA)

## Workflow

1. **PM** breaks down task into phases
2. **Designer** creates UI/UX spec (if needed)
3. **Architect** designs technical solution (if needed)
4. **Backend + Frontend** implement (parallel or sequential)
5. **QA** runs quality gates
6. **Approval gates** at each phase

## Quality Gates

- `npx tsc --noEmit` must pass
- No `any` types in new code
- Named exports preferred
- CHANGELOG.md updated

## Telemetry

All agent activity logged to `.swarm/telemetry.jsonl` in the repo.
