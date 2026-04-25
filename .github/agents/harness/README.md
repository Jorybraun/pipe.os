# Pipe Swarm Harness

Multi-agent development team for the Pipe technical interview platform.

## Team Structure

| Role | Responsibility | When Spawned |
|---|---|---|
| **Orchestrator** (main agent) | Analyzes tasks, manages gates, presents to user | Always active |
| **Designer** | UI/UX specs, wireframes, component usage | When UI changes needed |
| **Architect** | Technical design, schema, API contracts | When structural changes needed |
| **Frontend** | React/TypeScript implementation | After design + architecture approved |
| **Backend** | Lambda, API, database implementation | After architecture approved |

## Workflow with Approval Gates

```
User Request
    ↓
Orchestrator analyzes
    ↓
┌─────────────────────────────┐
│ Gate 1: Design Review       │
│ Designer → Orchestrator     │
│ → Present to user           │
│ → [A]pprove [R]eject [Rev]ise
└─────────────────────────────┘
    ↓ (Approved)
┌─────────────────────────────┐
│ Gate 2: Architecture Review │
│ Architect → Orchestrator    │
│ → Present to user           │
│ → [A]pprove [R]eject [Rev]ise
└─────────────────────────────┘
    ↓ (Approved)
┌─────────────────────────────┐
│ Gate 3: Implementation      │
│ Frontend + Backend          │
│ (parallel if possible)      │
└─────────────────────────────┘
    ↓
Type Check + QA
    ↓
┌─────────────────────────────┐
│ Gate 4: Final PR Review     │
│ Present diff to user        │
│ → [A]pprove → Commit & Push │
│ → [R]eject → Revise         │
└─────────────────────────────┘
```

## Approval Rules

- **No task proceeds without user approval.**
- Designer works with the Orchestrator (not directly with user).
- Orchestrator synthesizes agent output into a clean proposal for the user.
- User gives red/green light at each gate.
- Rejected work loops back to the relevant agent with revision notes.

## Files

- `team_graph_v2.py` — LangGraph swarm with approval gate tracking
- `orchestrator_v2.py` — Approval-gated workflow runner
- `git_tools.py` — Git operations for agents
- `requirements.txt` — Python dependencies

## Usage

```bash
# Test workflow with auto-approve (no user gates)
python orchestrator_v2.py --task "Add search filter" --auto-approve

# Normal workflow (waits for user at each gate)
python orchestrator_v2.py --task "task-spec.json"
```

## Quality Gates

Before any commit:
1. `npx tsc --noEmit` must pass
2. No `any` types
3. CHANGELOG.md updated
4. ADR if schema changed
