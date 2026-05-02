# Agent Harness — Quick Start Guide for QA Swarms

## What This Is

The agent harness is a **LangGraph swarm** that reads plan files from `docs/plans/strategy-v2/` and executes them via LLM agents (Developer → Advisor → QA). Each plan becomes a "lane" — a state machine that runs through explore → implement → validate phases.

## Architecture

```
Plan files (docs/plans/strategy-v2/)
    ↓ sync_plans_to_db()
Broker DB (.swarm/broker.db)
    ↓ claim_plan()
Lane Graph (LangGraph)
    ├── Supervisor — picks next subtask, routes to advisor/dev/qa
    ├── Advisor — reviews plan/handoffs, gives architectural guidance
    ├── Developer (SCOUT) — explores codebase, writes spec, hands off
    ├── Developer (BUILDER) — implements from spec, writes code, runs tests
    └── QA-Deploy — validates tests pass, marks plan COMPLETE
```

## Prerequisites

```bash
# 1. Activate the harness virtualenv
cd agent-harness
source .venv/bin/activate

# 2. Ensure env vars are set (in .env)
KIMI_API_KEY=sk-...
KIMI_BASE_URL=https://api.kimi.com/coding/v1

# 3. Init broker DB (idempotent)
python3 -c "from agent_harness.broker.db import init_db; init_db('.swarm/broker.db')"

# 4. Sync plans from disk to broker
python3 -c "from agent_harness.broker import sync_plans_to_db; sync_plans_to_db()"
```

## Plan File Format

Every plan under `docs/plans/strategy-v2/` MUST follow this exact structure:

```markdown
# Plan Title

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 97–134)
**Phase:** 0
**Status:** PENDING
**Estimate:** 3 days

## Why

One paragraph explaining motivation.

## Subtasks (delegable)

### Subtask 1 — Title
**Files:**
- `workers/api/src/lib/foo.ts`
- `workers/api/migrations/00xx_foo.sql`

**Spec:**
What to build, constraints, edge cases.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: [other-plan](part4-candidate-ingestion/other-plan.md)
- Blocks: [downstream](part5-matching-migration/downstream.md)

## Acceptance criteria
- [ ] Criterion 1 — evidence: `workers/api/src/lib/foo.test.ts`
```

**Critical rules:**
- `**Files:**` block is parsed by the broker — use backtick-wrapped paths, one per line
- Migration numbers in filenames (e.g. `0045_*.sql`) are auto-extracted
- `**Status:**` must be `PENDING` for the swarm to pick it up
- `**Phase:**` controls ordering (lower = earlier)

## How to Run a Single Lane

```bash
cd /Users/hans/Code/PIPE/PIPE-OS
PYTHONPATH=agent-harness/src python3 agent-harness/manual_lane_run.py
```

This runs one plan (hardcoded in the script) step-by-step with console output.

## How to Run Multiple Lanes (Parallel QA Swarm)

Create a runner script:

```python
#!/usr/bin/env python3
import asyncio
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent.parent / "agent-harness/src"))

from agent_harness.broker.db import init_db
from agent_harness.broker import sync_plans_to_db, claim_plan
from agent_harness.swarm.graph import build_lane_graph
from agent_harness.swarm.checkpoint import get_checkpointer

PLAN_IDS = [
    "qa-swarm-bugfix/api-correctness.md",
    "qa-swarm-bugfix/observability-finish.md",
    "qa-swarm-bugfix/stub-to-real.md",
]

async def run_lane(plan_id: str):
    lane_id = f"lane-{plan_id.replace('/', '-')}"
    claim_plan(plan_id, lane_id)
    graph = build_lane_graph(checkpointer=get_checkpointer())
    # ... stream the graph ...

async def main():
    init_db("agent-harness/.swarm/broker.db")
    sync_plans_to_db()
    await asyncio.gather(*[run_lane(pid) for pid in PLAN_IDS])

if __name__ == "__main__":
    asyncio.run(main())
```

## Monitoring

```bash
# Tail all broker events
PYTHONPATH=agent-harness/src python3 agent-harness/scripts/console.py tail

# List active interrupts
PYTHONPATH=agent-harness/src python3 agent-harness/scripts/console.py interrupts

# Post a steering cue to a lane
PYTHONPATH=agent-harness/src python3 agent-harness/scripts/console.py cue "Focus on H3 first" --lane-id lane-qa-swarm-bugfix-api-correctness-md
```

## Agent Prompts

- **Developer:** `agent-harness/src/agent_harness/swarm/prompts/developer.md`
  - Mode: SCOUT (explore, spec) or BUILDER (implement, test)
  - Hard rules: BDD first, max 3 exploration turns, 180K token cap
- **Advisor:** `agent-harness/src/agent_harness/swarm/prompts/advisor.md`
  - Reviews plans and handoffs, gives architectural guidance
  - Convergence review when multiple devs exhaust context
- **QA:** `agent-harness/src/agent_harness/swarm/prompts/qa_deploy.md`
  - Runs tests, validates DoD, marks plan COMPLETE
  - Does NOT open PRs or merge

## Known Issues

1. **Advisor timeout:** Default 30s timeout is too short. Already patched to 120s in `graph.py`.
2. **Context exhaustion:** Developers often exhaust context on large files. The compaction node helps but isn't perfect.
3. **No parallel subtasks within a lane:** Subtasks run serially. For true parallelism, run multiple lanes.
4. **Migration number races:** If two lanes need migrations, they can collide. Use `broker_reserve_migration_tool`.

## Broker DB Schema (Key Tables)

```sql
-- Plans
SELECT plan_id, status, phase FROM plans WHERE status = 'PENDING';

-- Subtasks
SELECT plan_id, subtask_id, title FROM plan_subtasks;

-- Events
SELECT * FROM events ORDER BY emitted_at DESC LIMIT 20;

-- Handoffs
SELECT * FROM handoffs ORDER BY created_at DESC LIMIT 10;

-- Conflicts
SELECT * FROM conflicts;
```

## For Bug-Fix QA Swarms

The harness was designed for feature development, but works for bug fixes too:

1. Write plan files with `Phase: 0` and `Status: PENDING`
2. Each bug = one subtask with clear repro steps and expected behavior
3. Put plans in a dedicated folder: `docs/plans/strategy-v2/qa-swarm-bugfix/`
4. Run 3 lanes in parallel (one per plan)
5. Monitor via `console.py tail`

## Files You Care About

| File | Purpose |
|------|---------|
| `agent-harness/src/agent_harness/swarm/graph.py` | Lane graph topology (supervisor → advisor → dev → qa) |
| `agent-harness/src/agent_harness/swarm/agents/developer.py` | Developer agent implementation |
| `agent-harness/src/agent_harness/swarm/agents/advisor.py` | Advisor agent implementation |
| `agent-harness/src/agent_harness/swarm/toolkit.py` | Tools available to agents (read_file, write_file, grep, shell) |
| `agent-harness/src/agent_harness/broker/plan_walker.py` | Parses plan files and syncs to DB |
| `agent-harness/.swarm/broker.db` | Broker SQLite database |
| `agent-harness/manual_lane_run.py` | Example of running one lane manually |
| `agent-harness/scripts/console.py` | CLI for tailing events, posting cues, resuming interrupts |
