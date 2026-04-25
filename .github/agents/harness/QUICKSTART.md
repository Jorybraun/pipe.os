Pipe Swarm Harness — Quick Start

## What this is
An executable orchestrator that delegates tasks to specialized agents (Designer, Architect, Frontend, Backend) with user approval gates at each phase.

## How to use

### 1. Run a task (with approval gates)
```bash
cd .github/agents/harness
python3 orchestrator.py --task "Add a candidate search filter by skill"
```
The orchestrator will pause at each approval gate and wait for your input:
- `[A]pprove` — proceed to next phase
- `[R]eject` — stop the workflow
- `[Rev]ise` — loop back with feedback

### 2. Run a task (auto-approve for testing)
```bash
python3 orchestrator.py --task "Fix broken evaluator imports" --auto-approve
```

### 3. Resume a workflow
```bash
python3 orchestrator.py --resume
```

### 4. Check status
```bash
python3 orchestrator.py --status
```

### 5. Reset and start fresh
```bash
python3 orchestrator.py --reset
```

## Workflow phases

```
User Request
    ↓
Phase 0: Orchestrator analyzes task
    ↓
┌─────────────────────────────┐
│ Phase 1: Design (if needed) │
│ Designer → User approval    │
└─────────────────────────────┘
    ↓ (Approved)
┌─────────────────────────────┐
│ Phase 2: Architecture       │
│ Architect → User approval   │
└─────────────────────────────┘
    ↓ (Approved)
┌─────────────────────────────┐
│ Phase 3: Implementation     │
│ Frontend + Backend          │
│ (parallel or sequential)    │
└─────────────────────────────┘
    ↓
Phase 4: QA (typecheck, standards)
    ↓
┌─────────────────────────────┐
│ Phase 5: Final PR Review    │
│ User approval → Commit      │
└─────────────────────────────┘
```

## Task analysis heuristics

The orchestrator auto-detects which agents are needed:
- **Designer**: keywords like "ui", "page", "component", "layout", "design", "modal", "form", "color"
- **Architect**: keywords like "schema", "model", "api", "database", "migration", "adr", "architecture"
- **Frontend**: triggered by design OR keywords like "react", "component", "page", "hook", "tsx"
- **Backend**: triggered by architecture OR keywords like "api", "lambda", "database", "scorer", "pipeline", "crawler"

## Files

- `orchestrator.py` — Main workflow runner
- `prompts/designer.md` — Designer agent prompt
- `prompts/architect.md` — Architect agent prompt
- `prompts/frontend.md` — Frontend agent prompt
- `prompts/backend.md` — Backend agent prompt
- `.swarm/state.json` — Workflow checkpoint
- `.swarm/tasks/` — Task history

## Integration with OpenClaw

In practice, the orchestrator runs as part of the main agent (me). When it says "AGENT_INSTRUCTION: Spawn Backend agent", I execute that by calling `sessions_spawn` with the backend prompt and the specific task.

The Python script is the reference implementation. The actual execution happens through OpenClaw's agent system.
