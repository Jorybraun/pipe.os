# PIPE Self-Improving Harness Strategy

**Goal:** Turn PIPE-OS + its v2 strategy plans into a completely autonomous, 24/7 self-improving system. The harness (called PIPE) is the meta-layer that recursively plans, executes, validates, and improves both itself and PIPE-OS with zero human input after initial direction.

## Core Principles (non-negotiable)

1. **Planning-first**: Vision, Roadmap, Business Requirements, UX always take priority over feature work.
2. **Full initiative**: Orchestrator decides and executes without asking for confirmation or permission.
3. **Strict Kanban validation**: Every task must have explicit acceptance criteria + chrome-devtools-mcp proof that the feature is actually "done" (not assumed).
4. **Recursive**: The harness improves its own planning, execution, and validation loops.
5. **Multi-agent tmux swarm**: Orchestrator + role-specific workers (kanban-orchestrator profile, coding workers) running persistently.
6. **Evidence over assumption**: No task completes without tool-verified proof.

## Architecture of the Harness

**Orchestrator (kanban-orchestrator profile)**
- Maintains the master vision/roadmap from knowledge/plan/pipe-strategy-v2-*.md
- Runs recursive planning cycles (every N hours or on trigger)
- Decomposes work into Kanban tasks with acceptance criteria
- Delegates to workers via tmux sessions
- Monitors completion via chrome validation + session output
- Updates plans and creates new tasks from learnings

**Workers (dedicated profiles)**
- Execute scoped work (code, research, calibration, UI)
- Report structured results back to orchestrator
- Never ask for direction — only report blockers with evidence

**Validation Layer (kanban-chrome-validation skill)**
- Every task ends with chrome-devtools-mcp inspection
- Must produce binary "done" / "not done" evidence
- Blocks task completion on failure

**Memory & Planning Substrate**
- knowledge/plan/ is the living source of truth (pipe-strategy-v2 series)
- New plans are written here when the orchestrator identifies gaps or improvements
- Old STRATEGY.md is archived

**Calibration / Self-Improvement Loop**
- Reuses and extends the existing /calibrate skill + Arena concepts
- But now applied at the meta level: the harness calibrates its own planning quality, decomposition accuracy, and validation strictness
- Uses real PIPE-OS work as training signal

## Phase 0 of Harness (Immediate)

1. Audit complete knowledge/plan/ (current in progress)
2. Create this harness strategy document (done)
3. Initialize tmux session management for persistent agents
4. Stand up kanban-orchestrator profile with custom skills
5. Begin first recursive planning cycle against the v2 north-star

## Success Criteria for the Harness

- PIPE-OS ships real value continuously without founder input on task selection
- The harness detects and fixes its own drift from pipe-strategy-v2 plans
- Planning quality measurably improves over time (measured via downstream execution success rate)
- Every week the system produces a "state of the product" report from its own graph + plans

This document lives in knowledge/plan/ and will be updated by the orchestrator itself.