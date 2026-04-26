# Plan: Autonomous LangGraph Swarm + MCP Broker for Strategy-v2 Backlog

## Context

The Pipe codebase has 100 plan files in docs/plans/strategy-v2/ (71 with ## Subtasks, 17 flagged NEEDS-REFINEMENT). At ~1 week per plan executed serially,
the backlog is 18+ months of solo work. Two prior harness iterations (.github/agents/harness/ outer driver and inner OpenClaw skill, plus pm/ Kanban
dashboard) never converged on a usable execution model — they're disconnected from the plan files, lack conflict detection, and have no bidirectional
steering channel.

This plan replaces both with a single coherent system:

- MCP broker server (Python, FastMCP, SQLite) — owns plan registry, conflict matrix, migration ledger, event bus, steering cues, LangGraph interrupt() resume
- LangGraph swarm — 5-agent topology (Meta-PM, Supervisor, Lane Advisor, Developer, QA-Deploy) executing plan files autonomously
- Staging environment (provisioned, currently a skeleton) — the swarm's deployment target; merge to main remains human-gated
- Bidirectional control — events stream out via the broker, steering cues flow in, escalations use LangGraph interrupt() for human-in-the-loop

Outcome: backlog executes through the swarm at multi-lane parallelism (3–5 lanes gated by conflict matrix), each PR carrying full test evidence to staging,
prod merges remain human-gated, ~83 runnable plans converge in weeks.

---
## Architecture Decisions (captured from implementation)

### 1. The Orchestrator is ONE singleton CEO

There is exactly one Orchestrator. Not one per swarm. Not one per plan. Not one per phase. **ONE.** It sits at the top of the pyramid and has full visibility into every plan, lane, event, and interrupt across the entire system. It is the single point of conversational control.

### 2. Conversational interface is the primary control surface

The operator talks to the Orchestrator via `harness_chat(message, thread_id)`. The Orchestrator is a LangGraph DeepAgent with broker tools. It can answer status questions, recommend actions, start/stop lanes, post steering cues, and escalate to humans when it needs input. The operator never talks to individual agents (PM, dev, QA) directly — the Orchestrator proxies everything.

### 3. Orchestrator is a LangGraph agent, not a Python class

The Orchestrator is built with `deepagents.create_deep_agent()`, which returns a compiled LangGraph `CompiledStateGraph`. It has:
- Full tool access (broker tools + lane control)
- LangGraph checkpointing for persistent conversation state
- `interrupt()` support for human-in-the-loop
- No iteration cap — it manages long-running processes continuously

### 4. Lane control is part of the Orchestrator's tool set

The Orchestrator does not just advise — it executes. Its tools include:
- `get_swarm_status()` — full snapshot
- `list_all_plans()`, `list_runnable_plans()` — plan queries
- `claim_runnable_plan(plan_id)` — claim a plan
- `start_lane(plan_id)`, `stop_lane(lane_id)` — dispatch/cancel lanes
- `post_steering_cue(content, plan_id, lane_id)` — steer active lanes
- `escalate_to_human(plan_id, reason)` — pause for operator input
- `get_active_interrupts()` — list human-in-the-loop items

### 5. Escalation flow: Orchestrator → Kimi Code → User

When the Orchestrator needs clarification:
1. Calls `escalate_to_human(plan_id, reason)`
2. Lane pauses at LangGraph checkpoint
3. Broker emits `escalation_created` event
4. Kimi Code (the initiator) polls events/cues and asks the user
5. User answers → Kimi Code calls `broker_resume_tool(plan_id, payload)`
6. LangGraph thread resumes from checkpoint

### 6. API configuration: kimi.com

All agents use the Kimi Code API:
- Base URL: `https://api.kimi.com/coding/v1`
- Model: `kimi-for-coding`
- User-Agent: `claude-code/0.1` (required for model access)
- `reasoning: None` in request body (disables thinking to avoid 400 on tool calls)
- LangChain message converter patched to preserve `reasoning_content` on assistant messages

---
## Architecture

This is a real swarm: many short-lived workers, one atomic unit each, dying at the boundary, handing off via structured protocol. At full throttle, expect
8–15 ephemeral developer agents alive across 3–5 plan lanes at any moment, plus the long-lived Meta-PM, Orchestrator, Lane Advisor, and QA-Deploy roles.

**Conversational control:** The operator talks to the Orchestrator via `harness_chat`. The Orchestrator has full context of all plans, lanes, events, and interrupts, and answers questions or recommends actions. The operator never talks to individual agents directly — the Orchestrator proxies everything.

```
                  ┌──────────────────────────────────────┐
                  │       MCP Broker Server              │
                  │  plans · conflicts · migration ledger│
                  │  events · cues · interrupt registry  │
                  │  handoff store · heartbeats          │
                  └──────┬─────────────────────┬─────────┘
                         │ events (SSE)        │ cues / interrupts
                         ▼                     ▲
       ┌────────────────────────────────────────────────────┐
       │  Orchestrator (conversational hub + lane dispatcher)│
       │  └─ MCP: harness_chat, harness_status              │
       │  └─ broker tools: list_plans, runnable_set, events │
       │  └─ can escalate → human via broker_escalate_tool  │
       └────────────────────┬───────────────────────────────┘
                            │ spawns lanes / posts cues
                            ▼
       ┌────────────────────────────────────────────────────┐
       │  Meta-PM (strategic ReAct agent)                    │
       │  └─ broker tools: list_plans, runnable_set, events  │
       │  └─ MCP: harness_meta_pm_recommend()                │
       └────────────────────┬───────────────────────────────┘
                            │ spawns lanes / posts cues
                            ▼
       ┌────────────────────────────────────────────────────┐
       │  Lane graph (one per plan, LangGraph StateGraph)    │
       │                                                     │
       │  START → lane_supervisor ──► [advisor | dev | QA]   │
       │            ▲                    │                   │
       │            └────────────────────┘                   │
       │                                                     │
       │  Each Devⁿ is ephemeral: one subtask, then dies.    │
       │  Devⁿ → Devⁿ⁺¹ via Handoff doc (broker).            │
       │  Same subtask, fresh 100K context window.           │
       │                                                     │
       │  advisor: reviews plan/handoff → guidance           │
       │  developer: ephemeral, one subtask → Handoff        │
       │  qa_deploy: terminal, opens PR                      │
       │                                                     │
       │  langgraph-checkpoint-sqlite at every boundary      │
       └──────┬──────────────────────────────────────────────┘
              │
              ▼
   ┌─────────────────────────────────────┐
   │ deploy-staging.yml on PR push       │
   │ → wrangler deploy --env staging     │
   │ → Playwright smoke against staging  │
   │ → STOPS — operator merges manually  │
   └─────────────────────────────────────┘
```

### Agent topology (4 long-lived roles + N ephemeral developers)

| Agent | Lifetime | Responsibility |
|-------|----------|----------------|
| Orchestrator | One. Singleton. The CEO. | **Conversational hub + async dispatcher + ultimate authority.** The operator talks to the Orchestrator via `harness_chat`. It has full context of ALL plans, ALL lanes, ALL events across the entire system. It answers status questions, recommends actions, starts/stops/steers any lane, and can launch QA swarms for smoke testing. When the Orchestrator needs human input, it escalates via `broker_escalate_tool`; Kimi Code (the initiator) receives the question and asks the user. There is ONE Orchestrator. Not one per swarm. Not one per plan. ONE. |
| Meta-PM | Long-lived (one per swarm) | Strategic ReAct agent that sees all plans, lanes, and events. Recommends execution order. Used internally by the Orchestrator for deep analysis. Exposed via `harness_meta_pm_recommend()` MCP tool. |
| Lane Advisor | Per-lane, invoked by lane supervisor | Reviews plan + handoff chain + operator cues before each developer run. Emits architectural guidance injected into the next dev's prompt. Can recommend escalation. |
| Developer (ephemeral) | One subtask, dies | Writes failing BDD test → implements → runs vitest/tsc/lint → commits → emits Handoff. At 80K context, exits early with status: "context_exhausted" and Orchestrator routes back for next dev. |
| QA-Deploy | Per-plan, terminal | Reads full Handoff chain, runs test suite on clean checkout, executes manual QA via Playwright, opens PR with bundle, terminal action |

Why this is a swarm: N developers per plan (where N = number of subtasks, possibly more if context-exhaust handoffs trigger). Across 3–5 lanes, you have 8–15
dev agents alive, each on a tiny atomic unit. Workers spawn and die routinely. Coordination via broker, not direct chat.

### Communication channels (structured, not free-form chat)

| Channel | Who | What flows |
|---------|-----|------------|
| LangGraph state | Agents in same lane thread | work_items, messages (auto-trimmed), pr_url, reserved_migrations, current_handoff |
| Handoff doc | Dev → Dev (context exhausted), Dev → QA-Deploy (subtask done), final Dev → QA-Deploy (plan done) | Stored in broker keyed by (plan_id, subtask_id, sequence) |
| Broker events | All agents publish; supervisor + console subscribe | plan_started, subtask_started, subtask_complete, dev_spawned, dev_exited, migration_reserved, heartbeat, pr_opened |
| Migration ledger | Devs request, broker arbitrates | reserve_migration(env) atomic |
| Conflict matrix | Supervisor pre-flight before Send() | Pre-empts collisions before lanes start |
| Steering cues | Operator → any agent | Read between tool calls; ack'd by ID |

Agents do not chat directly with each other. The Handoff doc is the structured equivalent — bounded, persisted, replayable.

### The Handoff artifact

Every developer's exit produces a Handoff. Stored in the broker, never in agent free-form output.

```
Handoff {
  plan_path: str
  subtask_id: str
  sequence: int                      # 1, 2, 3... if multiple devs touched same subtask
  status: "complete" | "context_exhausted" | "blocked"
  done: list[{type, path, summary}]  # files written, tests added, commits made
  next: list[str]                    # next concrete actions: file:line, command, "ready for QA"
  state: list[str]                   # open questions, gotchas, why-this-not-that
  files_touched: list[str]           # for conflict matrix updates
  migrations_reserved: list[int]
  context_used: int
  handoff_to: "next_dev" | "qa_deploy" | "supervisor_reroute"
}
```

status: "context_exhausted" is a normal exit, not a failure. Supervisor sees the event, calls Send() to spawn a fresh dev with the Handoff as starting
context. The new dev's prompt: plan file + Handoff. Nothing else. Fresh 100K window.

### Test handoff (lightweight, no Pydantic dance)

The Developer agent's exit deliverable is a PR description template with these required sections:

## Plan
docs/plans/strategy-v2/.../<plan>.md

## Acceptance criteria
- [x] <criterion> — evidence: <spec path / file:line>

## BDD tests
- e2e/<new-spec>.spec.ts — <scenarios>

## Unit tests
- workers/api/src/.../__tests__/<test>.test.ts

## Manual QA on staging
- Visit https://staging.pipe.build/<path>
- Verify <expected behavior>

## Regression touchpoints
- <file>: <why> → re-run <test>

## Rollback
- git revert <sha>
- (if migration applied) manual D1 reversal: <steps>

QA-Deploy validates the template is filled, runs the listed tests, executes manual QA via Playwright. No separate TestingStrategy Pydantic model. The PR is
the artifact. CI green + filled template + smoke pass = PR opened.

### Hard limits (non-negotiable)

- No auto-merge to main, ever. Merge auto-fires deploy-production.yml. Swarm's terminal action is gh pr create. Operator merges.
- Migration ledger is the sole allocator. Broker holds a BEGIN IMMEDIATE SQLite lock; no agent reads workers/api/migrations/ to pick a number.
reserve_migration("staging") is the only path.
- Per-developer context cap: 80K tokens. At 80K, dev must exit with status: "context_exhausted" + Handoff. Supervisor spawns fresh dev. Reserves 20K for the
Handoff write itself.
- Per-plan budget. Default 500K total input across all devs on a single plan. Supervisor halts the lane and escalates if exceeded (catches infinite handoff
loops).
- Per-subtask handoff cap: 5. If a subtask requires more than 5 sequential context-exhausted devs, supervisor escalates — the subtask is too large and needs
splitting in the plan file.
- NEEDS-REFINEMENT plans auto-skip. Filtered out of runnable_set(). Parked in operator queue.
- Liveness watchdog. 30s heartbeats; supervisor kills agents silent >5 min and re-dispatches the subtask with last good Handoff (or re-initializes work_items if no
Handoff yet).

---
## Components & File Paths

New: agent-harness/ (top-level, replaces .github/agents/harness/)

```
agent-harness/
├── pyproject.toml              # langgraph, langgraph-supervisor, langgraph-checkpoint-sqlite,
│                               #   langchain-anthropic, langchain-community, langchain-mcp-adapters,
│                               #   fastmcp, sqlite-utils
├── broker/
│   ├── server.py               # FastMCP server, exposes tools below
│   ├── schema.sql              # SQLite: plans, conflicts, migrations, events, cues, lanes
│   ├── plan_walker.py          # Parses docs/plans/strategy-v2/**/*.md
│   ├── conflict_matrix.py      # File-path + migration-number overlap detection
│   ├── migration_ledger.py     # Atomic per-env reserve + rollback
│   ├── event_bus.py            # Append-only event log + SSE subscribe
│   ├── cue_channel.py          # Operator → swarm, dedupe + ack
│   └── interrupt_registry.py   # Maps plan_id ↔ LangGraph thread for resume
├── swarm/
│   ├── graph.py                # langgraph-supervisor topology + Send() dispatch
│   ├── checkpoint.py           # SqliteSaver wiring
│   ├── budget.py               # Per-plan token accounting
│   ├── agents/
│   │   ├── meta_pm.py          # strategic PM — sees all plans, decides execution order
│   │   ├── advisor.py          # per-lane architect; reviews plan/handoff, emits guidance
│   │   ├── developer.py        # ReAct agent with FileMgmt + Shell + MCP tools
│   │   └── qa_deploy.py        # ReAct agent with Shell + Playwright + MCP + gh tools
│   ├── prompts/
│   │   ├── supervisor.md
│   │   ├── meta_pm.md
│   │   ├── advisor.md
│   │   ├── developer.md
│   │   └── qa_deploy.md
│   ├── toolkit.py              # FileManagementToolkit, ShellTool, PlaywrightBrowserTool,
│   │                           #   langchain-mcp-adapters → broker tools
│   └── pr_template.py          # Fixed PR description template + validator
└── README.md
```

### MCP Broker tool surface

| Tool | Caller | Purpose |
|------|--------|---------|
| **harness_chat(message, thread_id)** | Operator | Talk to the Orchestrator. Status, steering, lane control. |
| **harness_status()** | Operator | Fast swarm snapshot (plans, lanes, events, interrupts). No LLM. |
| **harness_run_agent(workflow_id, role)** | Operator | Async agent invocation. Returns job_id; poll harness_get_agent_status(). |
| **harness_get_agent_status(job_id)** | Operator | Poll for async agent response. |
| list_plans(filter?) | Orchestrator, console | All plans w/ status, phase, conflicts |
| runnable_set() | Orchestrator | PENDING + deps DONE + not NEEDS-REFINEMENT + no active conflicts |
| get_plan(path) | Lane Advisor, Developer | Full content + parsed sections |
| claim_plan(path, lane_id) | Orchestrator | Atomic; emits plan_started; idempotent |
| conflicts_for(path) | Orchestrator | Files + migrations vs active lanes |
| reserve_migration(env) | Developer | Atomic next number; rollback on plan_failed |
| release_migration(num, env) | Orchestrator | Called on lane abort |
| submit_handoff(handoff) | Developer | Required exit; stores in broker, emits dev_exited event |
| get_handoff(plan_id, subtask_id, sequence?) | Orchestrator, Developer, QA-Deploy | Read latest or specific Handoff |
| get_handoff_chain(plan_id) | QA-Deploy | Full Handoff history for a plan |
| consult_architect(question, context) | Developer | Bounded one-shot architect agent; returns design answer; dies after one turn |
| emit(event_type, payload) | All agents | Push to event bus |
| subscribe(filter?, since?) | Console | SSE stream |
| read_cues(plan_id, since) | All agents | Pending operator nudges |
| post_cue(plan_id, cue) | Operator, Orchestrator | Steering input |
| escalate(plan_id, reason) | Orchestrator, any agent | Pause lane, register interrupt(), await human |
| resume(plan_id, payload) | Operator | Resume LangGraph thread from checkpoint |
| complete_plan(path, result) | QA-Deploy | Atomic transition to PR_OPEN; emits plan_completed |
| heartbeat(lane_id, agent_id) | All agents | Liveness; Orchestrator watchdog reads |

### LangGraph state schema

Per-lane state (one plan = one thread = one state object):

```python
class LaneState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]   # auto-trimmed
    plan_path: str
    plan_id: str
    lane_id: str
    work_items: list[WorkItem]              # hydrated by _init_work_items() before lane starts
    current_subtask_id: str | None
    current_handoff: Handoff | None         # last Handoff; input to next ephemeral dev
    handoff_chain: list[Handoff]            # full history for QA-Deploy
    reserved_migrations: list[int]
    pr_url: str | None
    plan_budget_used: int                   # cumulative across all devs in lane
    iteration: int
    advisor_guidance: str | None            # emitted by Lane Advisor, consumed by next Developer
    next_node: str                          # routing decision from lane_supervisor_node
```

Each ephemeral developer is a sub-graph spawned via Send() from the supervisor. The dev's input is (plan_file_content, current_handoff) — not the full lane
state. The dev's output is a new Handoff that the supervisor writes back into current_handoff and handoff_chain, then dispatches the next dev or routes to
QA-Deploy.

Persisted via langgraph-checkpoint-sqlite to agent-harness/.checkpoints.db. Checkpoints fire at every dev boundary, so supervisor restarts resume cleanly
mid-lane.

### Files to delete (after swarm v1 ships)

- pm/ (entire directory — gut, replaced by SSE tail script)
- .github/agents/harness/ (entire directory — replaced by agent-harness/)

### Files to modify

| File | Change |
|------|--------|
| workers/api/wrangler.jsonc | Uncomment [env.staging] D1, Vectorize, R2 bindings; provide real IDs after wrangler d1 create pipe-db-staging etc. |
| .github/workflows/deploy-staging.yml | Uncomment Pages deploy line once pipe-app-staging Pages project exists |
| CLAUDE.md | Update Documentation Map + Commands to reference agent-harness/ instead of legacy pm/ and .github/agents/harness/ |
| docs/plans/strategy-v2/README.md | Add note that swarm uses staging env; runnable plans filtered to exclude NEEDS-REFINEMENT |

### New strategy-v2 plan to write first

docs/plans/strategy-v2/staging-environment-provisioning.md — Phase 0 prerequisite. Subtasks: D1 create + bind, Vectorize indexes (×3), R2 bucket, Clerk
staging app, Pages project, DNS for staging.pipe.build, GitHub secrets, smoke test seed data. Acceptance criteria: wrangler deploy --env staging succeeds
end-to-end and a Playwright smoke test passes against https://staging.pipe.build.

This plan is the swarm's first lane once it's running. The provisioning itself is human-driven (Clerk app creation, DNS) but the wrangler.jsonc edits +
GitHub Actions wiring are agent-doable.

---
## Phased Build Order

### Phase 0 — Staging environment (operator-driven, ~1–2 days)

Done before swarm code runs. Deliverables:

1. wrangler d1 create pipe-db-staging → write ID into wrangler.jsonc
2. Create three Vectorize indexes: candidate-searchable-profiles-staging, role-searchable-profiles-staging, repo-searchable-profiles-staging
3. wrangler r2 bucket create pipe-assets-staging
4. Create Cloudflare Pages project pipe-app-staging, point to staging.pipe.build subdomain
5. Create Clerk staging app, add CLERK_PUBLISHABLE_KEY_STAGING and CLERK_SECRET_KEY_STAGING to GitHub secrets and .dev.vars.staging
6. Apply all existing migrations to pipe-db-staging: wrangler d1 migrations apply pipe-db-staging --env staging --remote
7. Uncomment + verify staging blocks in wrangler.jsonc and deploy-staging.yml
8. Manual smoke: open PR → confirm staging deploys → confirm Pages serves

### Phase 1 — MCP Broker (read-only)

Builds the broker with no swarm yet; console-only consumption.

1. pyproject.toml deps + skeleton FastMCP server
2. schema.sql — tables: plans, subtasks, dependencies, migrations, lanes, events, cues
3. plan_walker.py — walk docs/plans/strategy-v2/**/*.md, parse frontmatter + sections, populate plans table; recompute on file change
4. conflict_matrix.py — for any plan, return list of plans sharing files or migration numbers
5. Tools exposed: list_plans, runnable_set, get_plan, conflicts_for
6. Validation: spot-check 10 plans against the file system; confirm runnable_set() excludes the 17 NEEDS-REFINEMENT plans; confirm conflict matrix flags the
documented 0045–0052 races and the candidateNodes.ts overlap.

### Phase 2 — Event Bus + Cue Channel + Migration Ledger

7. event_bus.py — append-only events, SSE subscribe (FastMCP supports streaming)
8. cue_channel.py — post_cue / read_cues with dedupe by content hash
9. migration_ledger.py — reserve_migration(env) atomic, with rollback on release_migration
10. interrupt_registry.py — store (plan_id, thread_id, checkpoint_id) for resume
11. Validation: from a Python script, post a synthetic event stream and a cue; verify SSE subscriber receives them; reserve and release a migration number
twice in a race condition test.

### Phase 3 — Single Ephemeral Dev (one subtask)

12. toolkit.py — wire FileManagementToolkit, ShellTool, PlaywrightBrowserTool; use langchain-mcp-adapters to expose broker tools
13. checkpoint.py — SqliteSaver at .checkpoints.db
14. prompts/developer.md — system prompt: read plan + Handoff (if any), write BDD first per CLAUDE.md, implement ONE subtask, monitor context, exit at 80K
with Handoff
15. agents/developer.py — create_react_agent. Hard exit logic: when context > 80K tokens, force-call submit_handoff tool with status=context_exhausted
16. Token accounting helper — count input tokens per turn, warn at 60K, force-exit at 80K
17. Validation: hand-craft a small subtask (e.g., one helper function with one unit test). Run a single ephemeral dev. Confirm: BDD test added to e2e/,
function written, vitest passes, Handoff emitted with status: "complete" and handoff_to: "qa_deploy".

### Phase 4 — Handoff Chain + Full Swarm Topology

18. agents/meta_pm.py — strategic ReAct agent with broker tools (list_plans, runnable_set, conflicts_for, events, cues). Decides what gets built and in what order.
19. agents/advisor.py — per-lane architect invoked by lane_supervisor_node. Reviews plan + handoff chain + operator cues. Emits structured guidance.
20. swarm/graph.py — lane_supervisor_node (structured routing agent with LaneRoutingDecision), advisor_node, developer_node, qa_deploy_node, escalate_node,
escalation_gate_node. Dev N → Dev N+1 handoff chaining preserved via current_subtask_id + get_handoff().
21. agents/qa_deploy.py — reads handoff_chain, runs full suite on clean checkout, executes manual QA from PR template, opens PR
22. Supervisor class in graph.py — long-lived async dispatcher that claims plans, maintains lane task pool, watchdog, re-dispatch on timeout
23. budget.py — per-dev (80K), per-plan (500K), per-subtask handoff cap (5)
24. Liveness watchdog: 30s heartbeats, 5min timeout, re-dispatch with last Handoff
25. Validation Phase 4a (handoff chain): synthetically force a context exhaust on a multi-subtask plan; confirm 3 ephemeral devs chain via Handoffs and
produce one PR
26. Validation Phase 4b (multi-lane): run two non-conflicting plans in parallel; confirm both lanes' Handoff chains progress independently; confirm conflict
matrix prevents a third plan that overlaps

### Phase 5 — Escalation Surface + Human-in-the-Loop

24. Wire LangGraph interrupt() calls in supervisor for plans whose paths/files match the escalation regex (migrations/, lib/privacy/, routes/candidate/,
LL144|Article 22|EEOC)
25. Escalated lanes: deploy to staging → run smoke → open PR → call interrupt() → wait for resume(plan_id, "merge_approved") cue
26. Console (minimal): SSE tail script that prints events + a CLI for posting cues. Defer the full pm/-replacement console.
27. Validation: run a plan that touches migrations/ (e.g., candidate-nodes-schema.md). Confirm swarm pauses at PR-open with interrupt(), console shows the
cue request, posting a cue resumes the thread.

### Phase 6 — Cutover & Cleanup

28. Move first 5 non-escalated runnable plans through the swarm; review staging behavior on each before merge
29. Delete pm/ directory
30. Delete .github/agents/harness/ directory
31. Update CLAUDE.md Documentation Map
32. Open the throttle: 3–5 concurrent lanes, autonomous through the runnable backlog

---
## Reusing What Exists

| Need | Reuse | Path |
|------|-------|------|
| BDD test runner | Existing Playwright config | playwright.config.ts |
| BDD spec patterns | 31 existing specs | e2e/*.spec.ts |
| Unit test runner | Existing vitest | workers/api/vitest.config.ts |
| Type check | Existing | npx tsc --noEmit |
| Lint | Existing scripts | package.json scripts |
| CI | Existing | .github/workflows/ci.yml |
| Test env deployment pattern | Existing E2E pipeline | .github/workflows/e2e-test.yml (model staging deploy after this) |
| Staging deploy workflow | Already scaffolded | .github/workflows/deploy-staging.yml |
| File / shell / browser tools | langchain-community | Don't reinvent |
| Multi-agent orchestration | langgraph-supervisor | Don't build a custom dispatcher |
| Persistence | langgraph-checkpoint-sqlite | Don't roll our own |
| Context trimming | langgraph.prebuilt.trim_messages | Don't write a context manager |
| MCP adapter | langchain-mcp-adapters | Don't write tool wrappers |
| Plan source of truth | docs/plans/strategy-v2/**/*.md (100 files) | Don't duplicate into a separate task DB |

---
## Verification

### Phase 0 (staging provisioning)

- wrangler d1 list shows pipe-db-staging
- wrangler vectorize list shows three *-staging indexes
- Open a noop PR, confirm deploy-staging.yml succeeds and https://staging.pipe.build returns 200

### Phase 1–2 (broker)

- python -m agent_harness.broker.server starts FastMCP server
- Manual call to runnable_set() returns ~83 plan paths (excludes 17 NEEDS-REFINEMENT)
- conflicts_for("part4-candidate-ingestion/candidate-nodes-schema.md") returns plans sharing candidateNodes.ts or migration 0045
- reserve_migration("staging") returns 0045 first call, 0046 second; rollback returns 0045 to pool
- SSE subscriber receives synthetic events in real time

### Phase 3 (single-agent pilot)

- Run reliability-retry-and-error-classification.md end-to-end
- PR opened with filled template
- Staging deploys successfully
- Playwright smoke green against staging
- Swarm stopped at PR-open (did not auto-merge)
- LangGraph checkpoint exists at .checkpoints.db

### Phase 4 (multi-lane)

- Two non-conflicting plans run in parallel; both PRs open
- Third plan with file overlap is held by supervisor until a lane frees
- Liveness watchdog kills a manually frozen agent and re-dispatches

### Phase 5 (escalation)

- candidate-nodes-schema.md (migration plan) triggers interrupt()
- Console shows escalation cue
- post_cue(plan_id, "merge_approved") resumes the LangGraph thread from checkpoint

### Phase 6 (cutover)

- pm/ deleted, no broken imports (grep -r "pm/" workers/ src/ docs/ clean except archived references)
- .github/agents/harness/ deleted
- CLAUDE.md updated
- Five plans land green to staging, merged manually, prod healthy

### Long-running (post-Phase 6)

- At least 10 plans complete via swarm in week 1 of full-throttle operation
- No migration-number collision events
- No prod incidents traceable to swarm output
- escalate() correctly fires on every plan whose acceptance-criteria mentions LL144/Article 22/EEOC

---
## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Agent prompt drift across 4 roles → inconsistent output | One source-of-truth prompt directory swarm/prompts/; supervisor injects plan content + broker-served context, not free-form delegation |
| LangGraph state explosion at 5 parallel lanes | Each lane is an independent graph thread; trim_messages + summarization node enforce token bounds |
| Broker as single point of failure | SQLite WAL + retry on transient lock errors; broker restart resumes from persistent state; LangGraph checkpoint resumes lanes |
| Hallucinated migration number despite ledger | Developer prompt forbids reading migrations/ directly; QA-Deploy validates that any new migration number was issued by the ledger before opening PR |
| Auto-PR-merge by accident (e.g., GitHub auto-merge label) | No agent has gh pr merge in its tool list. Period. |
| Vectorize cost on staging | Use small test indexes; cap candidate count in seed data |
| Token budget overrun | Per-plan budget halt at 200K input / 50K output; supervisor escalates instead of killing |
| Agent edits production wrangler.jsonc by mistake | Developer prompt restricts edits via path glob; QA-Deploy re-validates before PR open; wrangler.jsonc production block protected by escalation regex |

---
## Out of Scope

- Auto-deploy to production (forbidden architecturally — merge to main is human-only)
- Auto-merge of PRs (no agent has the tool)
- Plans flagged NEEDS-REFINEMENT (auto-skipped; operator queue)
- Full pm/ replacement console UI (Phase 4 SSE tail is sufficient for v1; richer UI is post-cutover work)
- LinkedIn enrichment, candidate-surfaced URLs, Neo4j migration (Phase 5 strategy-v2 work; runs through the swarm like any other plan)
- Multi-repo coordination (single-repo only; the swarm operates inside PIPE-OS)
