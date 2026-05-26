# Architecture Handoff — Meta-PM + Lane Advisor

## Decisions made

### 1. Move PM logic out of the graph

The existing `pm_node` is deterministic (no LLM) but it is **not** zero-value. It performs two real jobs:

1. **Hydrates `work_items`** from the broker plan — this is the task queue the lane uses to track pending/complete subtasks across dev iterations.
2. **Emits `plan_started`** event for telemetry.

`dev_dispatcher` does call `get_plan()` directly for spec content, but it still depends on `state["work_items"]` being populated to know what to run next. Without the PM node, `work_items` would be empty on first entry.

**Decision:** Remove `pm_node` as a graph node, but **retain its logic** as lane initialization code in `_run_lane()` (or make `dev_dispatcher` self-initialize when `work_items` is empty). The event emission (`plan_started`) also moves to initialization.

### 2. Add Lane Advisor

A new node inserted into the lane graph between the PM slot and `dev_dispatcher`, and between every dev handoff and the next dev.

**Role:** Per-plan architect. Knows the full execution plan for ONE lane. Reviews handoffs and emits architectural guidance for the next developer.

**Where it runs:**
```
Lane graph:
  Advisor → Dev #1 → Advisor → Dev #2 → Advisor → Dev #3 → QA-Deploy
```

**Input:**
- Full plan from broker (`get_plan(plan_id)`)
- Full handoff chain (`get_handoff_chain(plan_id)`)
- Current subtask spec

**Output:**
- `SystemMessage` with architectural guidance injected into the next dev's context

**Model:** Same as developer (`kimi-latest` via `ChatOpenAI`). Cost is negligible on Kimi $100 plan.

**Prompt file:** `agent-harness/src/agent_harness/swarm/prompts/advisor.md` (needs creation)

### 3. Add Meta-PM (top-level agent)

A LangGraph agent that sits ABOVE all lanes. Not inside any lane graph.

**Role:** Cross-part strategist. Has visibility into ALL plans (or a digest of all plans). Decides execution order, spots cross-plan conflicts, defines patterns.

**Scope:**
- Reads `list_plans()` — all 93 plans
- Reads `runnable_set()` — what's executable now
- Reads `conflicts_for()` — file collisions
- Decides `part_prefix` and `max_phase` for the Supervisor
- Can call `harness_start_lane(plan_id)` to spawn lanes manually
- Can call `broker_post_cue()` to steer active lanes

**Where it runs:**
```
Meta-PM (LangGraph agent with broker tools)
    │
    ├── decides: "Run Part 2 Phase 0 first"
    │
    ├── spawns: Supervisor(max_lanes=3, part_prefix="part2-", max_phase=0)
    │
    └── monitors: events + cues, steers as needed
```

**Model:** High-context model recommended (Claude 3.5 Sonnet or Kimi-latest with 200K context). Needs to hold summaries of many plans.

**Prompt file:** `agent-harness/src/agent_harness/swarm/prompts/meta_pm.md` (needs creation)

**MCP exposure:** `harness_meta_pm_recommend()` tool that returns the Meta-PM's current strategic recommendation.

### 4. Swarm communication layers

| Layer | Mechanism | What flows |
|-------|-----------|------------|
| **Meta-PM → Supervisor** | Config + tool calls | `part_prefix`, `max_phase`, `max_planes` |
| **Meta-PM → Lanes** | Cues + events | Steering messages, pattern definitions |
| **Advisor → Dev** | SystemMessage in lane state | Architectural guidance per subtask |
| **Dev → Dev** | Handoffs (broker) | Structured exit artifacts |
| **Lane → Lane** | Event bus + conflict matrix | File collisions, migration races |
| **QA → Meta-PM** | Events | `plan_completed`, `plan_failed` |

### 5. What the PM used to do → now distributed

| Old PM function | New owner |
|-----------------|-----------|
| Build `work_items` queue from plan | **Lane initialization** in `_run_lane()` (or self-init in `dev_dispatcher`) |
| Emit `plan_started` event | Lane initialization code |
| Validate plan completeness | **Lane Advisor** — reviews plan before first dev |
| Reorder subtasks | **Lane Advisor** — suggests optimal order |
| Spot missing subtasks | **Lane Advisor** — flags gaps |
| Cross-plan prioritization | **Meta-PM** — decides which Part to run |
| Define BDD specs | **Lane Advisor** — writes test templates |

---

## Files to modify / create

### New files

```
agent-harness/src/agent_harness/swarm/agents/advisor.py       # Lane Advisor node
agent-harness/src/agent_harness/swarm/agents/meta_pm.py       # Meta-PM agent
agent-harness/src/agent_harness/swarm/prompts/advisor.md      # Lane Advisor system prompt
agent-harness/src/agent_harness/swarm/prompts/meta_pm.md      # Meta-PM system prompt
```

### Files to modify

```
agent-harness/src/agent_harness/swarm/graph.py
  - Remove pm_node from lane graph
  - Add advisor_node between PM slot and dev_dispatcher
  - Add advisor_node in the dev loop (between handoff and next dev)
  - Update route_after_dev to route through advisor

agent-harness/src/agent_harness/swarm/agents/pm.py
  - Delete or deprecate

agent-harness/src/agent_harness/server.py
  - Add harness_meta_pm_recommend() MCP tool
  - Wire Meta-PM agent into MCP
```

### Files to delete

```
agent-harness/src/agent_harness/swarm/agents/pm.py   # After moving work_items init to _run_lane()
```

---

## Lane graph (new topology)

```
START
  │
  ▼
Advisor (reviews plan, emits guidance for subtask-1)
  │
  ▼
Dev #1 on subtask-1
  │
  ▼
Route: complete → Advisor → Dev #2 on subtask-2
  │
  ▼
Route: context_exhausted → Advisor → Dev #2 on subtask-1 (fresh, gets Handoff + guidance)
  │
  ▼
Route: all subtasks done → QA-Deploy
  │
  ▼
Escalation gate → END
```

---

## Meta-PM tool surface

The Meta-PM agent needs these tools bound to its LangGraph:

| Tool | Purpose |
|------|---------|
| `broker_list_plans()` | See all plans with status |
| `broker_runnable_set()` | See what's executable now |
| `broker_conflicts_for()` | Check file collisions |
| `broker_get_plan()` | Read full plan content |
| `broker_get_events()` | See recent events |
| `broker_read_cues()` | Read operator steering |
| `harness_start_lane()` | Spawn a lane manually |
| `harness_list_active_lanes()` | See running lanes |
| `broker_sync_plans()` | Re-sync markdown to DB |

---

## Risks & open questions

1. **Advisor latency** — Adds 1 LLM call per subtask boundary. With 191 subtasks, that's ~191 extra calls. At ~$0.02/call = ~$4 total. Acceptable on $100 plan.

2. **Meta-PM context size** — 93 plans is too much for one context window. The Meta-PM needs a summarization strategy: read `plans` table (titles + statuses + phases) as a digest, then `get_plan()` individually for plans it wants to prioritize.

3. **Circular dependency** — If Advisor and Developer use the same model with the same prompt patterns, they might hallucinate similarly. Consider using a different temperature or model for the Advisor.

4. **PM removal safety** — `pm_node` is referenced in `build_lane_graph()`. Ensure clean removal without breaking the graph topology. **Crucially:** `work_items` must still be populated before the first `dev_dispatcher` call, either in `_run_lane()` initial state or via self-initialization in `dev_dispatcher`.

---

## Validation checklist

- [ ] Lane graph compiles without `pm_node`
- [ ] Advisor node runs before first dev and between devs
- [ ] Advisor guidance appears in developer's context
- [ ] Meta-PM agent can query broker and return recommendations
- [ ] `harness_meta_pm_recommend()` MCP tool works
- [ ] Phase 4 validation still passes (5/5)
- [ ] Handoff chain still works across context-exhaust boundaries

---

## Next steps (in order)

1. **Write `advisor.md` prompt** — Define what the Lane Advisor reviews and how it formats guidance
2. **Implement `advisor.py`** — Lane Advisor node with `ChatOpenAI` call
3. **Modify `graph.py`** — Remove PM node, move `work_items` init to `_run_lane()`, insert Advisor into dev loop
4. **Write `meta_pm.md` prompt** — Define Meta-PM's strategic reasoning scope
5. **Implement `meta_pm.py`** — LangGraph agent with broker tools
6. **Add MCP tool** — `harness_meta_pm_recommend()`
7. **Delete `pm.py`** — After validation
8. **Run Phase 4 validation** — Confirm 5/5 pass

---

Ready for the next agent to pick up.
