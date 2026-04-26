# Agent Harness

MCP broker + LangGraph swarm for autonomous execution of the PIPE-OS strategy backlog.

---

## Database

The broker uses SQLite at `broker.db` inside the data directory (default: `.swarm/`).
It is the source of truth for plan registry, runtime state, and coordination.

All persistence resolves through `--data-dir`:
```bash
python -m agent_harness.server --data-dir .swarm
```

Canonical files:
- `broker.db` — plans, conflicts, migrations, events, cues, lanes, handoffs, interrupts, messages
- `.checkpoints.db` — LangGraph checkpoints (all lanes + QA threads share one file, isolated by `thread_id`)

### Tables

#### `plans` — Plan registry

| Column | Type | Description |
|--------|------|-------------|
| `plan_id` | TEXT PK | Relative path under `docs/plans/strategy-v2/`, e.g. `part4-candidate-ingestion/candidate-nodes-schema.md` |
| `plan_path` | TEXT UNIQUE | Full path from repo root |
| `title` | TEXT | Plan title (from H1) |
| `source` | TEXT | Source strategy document, e.g. `knowledge/plan/pipe-strategy-v2-part4.md` |
| `phase` | INTEGER | Execution phase: 0=foundation, 1=schema, 2=algorithms, 3=integration, 4=polish |
| `status` | TEXT | `PENDING`, `COMPLETE`, `DONE`, `NEEDS-REFINEMENT`, `DEFERRED`, `REDIRECT` |
| `estimate` | TEXT | Rough sizing, e.g. "3 days" |
| `why` | TEXT | Markdown blob — the `## Why` section |
| `acceptance` | TEXT | Markdown blob — the `## Acceptance criteria` section |
| `parsed_at` | REAL | Unix timestamp of last sync |

**Indexes:** `idx_plans_status`, `idx_plans_phase`

**Lifecycle:**
```
PENDING → [lane starts] → [QA passes] → COMPLETE → [human merges] → DONE
```

- `PENDING` → `COMPLETE`: QA-Deploy calls `mark_plan_complete()`
- `COMPLETE` → `DONE`: Human operator after merging PR
- `NEEDS-REFINEMENT` / `DEFERRED` / `REDIRECT`: Swarm skips these

#### `plan_subtasks` — Work items

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `plan_id` | TEXT FK → plans | Parent plan |
| `subtask_id` | TEXT | Stable ID, e.g. `subtask-1` |
| `title` | TEXT | Subtask title from `### Subtask N — Title` |
| `spec` | TEXT | Markdown body of the subtask |
| `files` | TEXT (JSON) | List of file paths from `**Files:**` block |
| `migrations` | TEXT (JSON) | List of migration numbers extracted from filenames |
| `status` | TEXT | `PENDING` (swarm does not update this; lane state tracks progress) |

**Index:** `idx_subtasks_plan_subtask` (unique on plan_id + subtask_id)

#### `plan_dependencies` — Ordering graph

| Column | Type | Description |
|--------|------|-------------|
| `plan_id` | TEXT FK → plans | The plan that has the dependency |
| `depends_on` | TEXT FK → plans | The plan that must complete first |
| `relation` | TEXT | `depends_on` or `blocks` |

**Populated from:** `## Dependencies` section in markdown:
```markdown
## Dependencies
- Depends on: `phase2-role-nodes-migration.md`
- Blocks: [other-plan](path.md)
```

**Resolution:** Bare filenames like `phase2-role-nodes-migration.md` are resolved to full `plan_id`s by matching against `Path(plan_id).name`.

#### `plan_files` — Conflict detection

| Column | Type | Description |
|--------|------|-------------|
| `plan_id` | TEXT FK → plans | |
| `file_path` | TEXT | A file this plan touches |

**Index:** `idx_plan_files_path`

Used by `conflicts_for(plan_id)` to detect file-path overlap between active lanes.

#### `lanes` — Runtime lane state

| Column | Type | Description |
|--------|------|-------------|
| `lane_id` | TEXT PK | e.g. `lane-part4-candidate-ingestion-candidate-nodes-schema-md` |
| `plan_id` | TEXT FK → plans | |
| `status` | TEXT | `running`, `paused`, `complete`, `failed` |
| `started_at` | REAL | Unix timestamp |
| `last_heartbeat` | REAL | Unix timestamp |
| `budget_used` | INTEGER | Cumulative tokens across all devs in this lane |
| `pr_url` | TEXT | Set by QA-Deploy on completion |

**Indexes:** `idx_lanes_plan`, `idx_lanes_status`

Created when Supervisor dispatches. Deleted when lane finishes (or kept for audit depending on config).

#### `events` — Append-only event log

| Column | Type | Description |
|--------|------|-------------|
| `event_id` | TEXT PK | UUID |
| `event_type` | TEXT | `plan_started`, `subtask_complete`, `dev_exited`, `lane_killed`, etc. |
| `plan_id` | TEXT | |
| `lane_id` | TEXT | |
| `agent_id` | TEXT | |
| `payload` | TEXT (JSON) | |
| `emitted_at` | REAL | Unix timestamp |

**Indexes:** `idx_events_type`, `idx_events_plan`, `idx_events_lane`

All agents publish here. Supervisor and console subscribe.

#### `cues` — Operator steering

| Column | Type | Description |
|--------|------|-------------|
| `cue_id` | TEXT PK | UUID |
| `plan_id` | TEXT | Target plan (optional) |
| `lane_id` | TEXT | Target lane (optional) |
| `content` | TEXT | Steering message |
| `content_hash` | TEXT | Dedupe hash |
| `posted_at` | REAL | |
| `acked_at` | REAL | Set when an agent acknowledges |

**Indexes:** `idx_cues_plan`, `idx_cues_hash`

Human operator posts cues. Agents read between tool calls and ack by ID.

#### `handoffs` — Developer exit artifacts

| Column | Type | Description |
|--------|------|-------------|
| `handoff_id` | TEXT PK | `{plan_id}:{subtask_id}:{sequence}` |
| `plan_id` | TEXT FK → plans | |
| `subtask_id` | TEXT | |
| `sequence` | INTEGER | 1, 2, 3... for context-exhaust chains |
| `status` | TEXT | `complete`, `context_exhausted`, `blocked` |
| `done` | TEXT (JSON) | List of {type, path, summary} |
| `next_actions` | TEXT (JSON) | List of strings |
| `state_notes` | TEXT (JSON) | List of strings — gotchas, open questions |
| `files_touched` | TEXT (JSON) | List of file paths |
| `migrations_reserved` | TEXT (JSON) | List of ints |
| `context_used` | INTEGER | Approximate tokens consumed |
| `handoff_to` | TEXT | `next_dev`, `qa_deploy`, `supervisor_reroute` |
| `dod_checklist` | TEXT (JSON) | Self-certification checklist — see Definition of Done below |
| `created_at` | REAL | |

**Index:** `idx_handoffs_plan` (plan_id, subtask_id, sequence)

Every developer's exit produces a Handoff. The supervisor passes it to the next dev as input.

#### Definition of Done (DoD)

Before a developer may submit a handoff with `status: "complete"`, they must self-certify against the following checklist. The result is stored in `handoffs.dod_checklist` as a JSON array of `{item: str, checked: bool, justification: str}`.

**Developer DoD:**
1. **Acceptance criteria met** — The plan's `## Acceptance criteria` are satisfied (or explicitly noted why not).
2. **BDD first** — A failing Playwright spec was written in `e2e/` **before** implementation.
3. **Minimal change** — Implementation is scoped to this subtask only; no scope creep.
4. **Unit tests pass** — `npx vitest run <relevant-path>` is green.
5. **Type check passes** — `npx tsc --noEmit` exits 0.
6. **Lint passes** — `npm run lint` exits 0.
7. **Path compliance** — No edits outside `src/`, `workers/`, `e2e/`, `public/`, `agent-harness/`.
8. **Migration safety** — If schema changed, a migration number was reserved via `broker_reserve_migration_tool`.
9. **PR template ready** — If this is the final subtask, the PR description template sections are filled.
10. **Accurate `done` list** — `done` field describes all files written, tests added, and commits made.

**QA-Deploy verification:**
- Reject any handoff where `status == "complete"` but `dod_checklist` is missing or has unchecked items without justification.
- The advisor also checks DoD completeness when reviewing handoffs between developers.

#### `interrupts` — Human-in-the-loop

| Column | Type | Description |
|--------|------|-------------|
| `interrupt_id` | TEXT PK | UUID |
| `plan_id` | TEXT FK → plans | |
| `lane_id` | TEXT | |
| `thread_id` | TEXT | LangGraph thread ID |
| `checkpoint_id` | TEXT | LangGraph checkpoint ID |
| `reason` | TEXT | Why escalation happened |
| `status` | TEXT | `active`, `resumed`, `aborted` |
| `payload` | TEXT (JSON) | Operator payload at resume time |
| `created_at` | REAL | |
| `resumed_at` | REAL | |

**Indexes:** `idx_interrupts_plan`, `idx_interrupts_thread`

LangGraph `interrupt()` fires here. Operator calls `broker_resume_tool()` to resume.

#### `migration_ledger` — Atomic allocator

| Column | Type | Description |
|--------|------|-------------|
| `number` | INTEGER | Migration number, e.g. 45 |
| `env` | TEXT | `staging`, `production` |
| `plan_id` | TEXT FK → plans | Who reserved it |
| `lane_id` | TEXT | |
| `reserved_at` | REAL | |
| `released_at` | REAL | Set if rolled back |

**PK:** `(number, env)`

**Index:** `idx_migration_ledger_env`

Developers must call `broker_reserve_migration_tool` to get a number. Never read `workers/api/migrations/` directly.

---

## Schema initialization

```python
from agent_harness.broker.db import init_db
init_db()  # resolves to DATA_DIR / "broker.db"
```

## Re-sync plans from markdown

```python
from agent_harness.broker import sync_plans_to_db
sync_plans_to_db()  # walks docs/plans/strategy-v2/**/*.md
```

## Query examples

### Count by status and phase
```sql
SELECT phase, status, COUNT(*) FROM plans GROUP BY phase, status;
```

### Runnable set (what the supervisor claims)
```sql
SELECT plan_id FROM plans
WHERE status = 'PENDING'
  AND plan_id NOT IN (
      SELECT plan_id FROM plan_dependencies d
      JOIN plans p ON p.plan_id = d.depends_on
      WHERE d.plan_id = plans.plan_id AND p.status NOT IN ('COMPLETE', 'DONE', 'PR_OPEN')
  )
ORDER BY phase, plan_id;
```

### Active lanes
```sql
SELECT lane_id, plan_id, status, datetime(started_at, 'unixepoch')
FROM lanes WHERE status = 'running';
```

### Handoff chain for a plan
```sql
SELECT * FROM handoffs WHERE plan_id = 'part4-candidate-ingestion/candidate-nodes-schema.md'
ORDER BY sequence;
```

### Recent events
```sql
SELECT event_type, plan_id, lane_id, datetime(emitted_at, 'unixepoch')
FROM events ORDER BY emitted_at DESC LIMIT 20;
```

---

## Files

| File | Purpose |
|------|---------|
| `src/agent_harness/server.py` | MCP server (stdio + SSE transports) |
| `src/agent_harness/broker/plan_walker.py` | Markdown parser + DB sync |
| `src/agent_harness/broker/db.py` | Schema + connection |
| `src/agent_harness/swarm/graph.py` | Lane + Supervisor graphs |
| `src/agent_harness/swarm/agents/developer.py` | Ephemeral dev ReAct agent |
| `src/agent_harness/swarm/agents/pm.py` | Plan expansion node |
| `src/agent_harness/swarm/agents/qa_deploy.py` | QA + PR opening node |
| `src/agent_harness/swarm/budget.py` | Token accounting |
| `src/agent_harness/swarm/escalation.py` | Human-in-the-loop triggers |
| `src/agent_harness/config.py` | Shared data-dir configuration |
| `src/agent_harness/swarm/checkpoint.py` | SQLite checkpointer for LangGraph |
