# Swarm Long-Horizon & Communication Plan

## Design Philosophy: "Write-Only Bulletin Board"

Swarm agents communicate **asynchronously through a shared scratchpad** — like a team wiki or GitHub issue thread. No direct messages, no real-time chat, no @mentions. Agents write their status once per turn, and read the board when they start.

This prevents "hammering" (excessive chatter) because:
- **Pull, not push** — agents read when they start; they don't get interrupted
- **One update per turn** — each agent appends exactly one structured line per turn
- **Supervisor mediates** — only the supervisor decides who talks to whom
- **Old entries compact** — scratchpad gets summarized when it grows too long

---

## Phase 1: Foundation (Context + Communication)

### 1.1 Lane Scratchpad
**Goal:** Shared append-only log in `LaneState` that all agents read/write.

```python
class LaneState(TypedDict):
    # ... existing fields ...
    scratchpad: list[ScratchpadEntry]  # NEW

class ScratchpadEntry(TypedDict):
    agent: str        # "supervisor" | "advisor" | "developer-1" | "qa-deploy"
    turn: int         # agent turn number
    type: str         # "status" | "blocker" | "decision" | "artifact" | "handoff"
    content: str      # terse, 1-2 sentences max
    timestamp: float  # epoch seconds
```

**Rules:**
- Each agent appends **exactly one** entry at the end of its turn
- Entries are terse: `"status: read types.ts, implementing handler next"`
- The scratchpad is injected into every agent's system prompt (last 20 entries)
- Old entries (>20) are compacted into a summary by the summarizer model

### 1.2 Agent Registry / Team Awareness
**Goal:** Every agent knows who its teammates are and what they do.

Add to every system prompt:
```
## Your Team
You are the {role}. Your teammates in this lane:
- Supervisor — routes tasks, monitors lane health
- Advisor — reviews plans and handoffs, gives architectural guidance
- Developer(s) — implement subtasks (you may be one of several)
- QA-Deploy — validates work and opens PRs

You communicate with teammates via the Lane Scratchpad (below).
Do not assume other agents can read your mind — write concise updates.
```

Inject the **last 20 scratchpad entries** into every system prompt so agents see what happened recently.

### 1.3 Auto-Cue Reading
**Goal:** Agents check for steering cues at the start of each turn.

In `agent_node`, before calling the LLM:
```python
# Pull new cues from broker
cues = read_cues(plan_id=state["plan_id"], lane_id=state["lane_id"], since=last_check)
if cues:
    messages.append(SystemMessage(content=f"New steering cues: {cues}"))
```

This is a **pull** — the agent checks once per turn. No push notifications.

### 1.4 Working Memory (Developer)
**Goal:** Developer agent keeps a private scratchpad of key facts.

Add to `DevState`:
```python
working_memory: str  # Key facts the dev wants to remember across turns
```

The developer can update it via a tool:
```python
@tool
def update_working_memory(notes: str) -> str:
    """Append notes to your working memory. Use this to remember:
    - Files you've read and what they contain
    - Decisions you've made
    - TODO items
    - Error messages and their solutions
    """
```

Working memory is injected into the developer's system prompt and survives compaction.

---

## Phase 2: Tooling & Git

### 2.1 Search/Replace Tool
**Goal:** Precise multi-line edits without sed fragility.

```python
@tool
def edit_file(file_path: str, old_string: str, new_string: str) -> str:
    """Replace old_string with new_string in a file.
    old_string must match exactly (including whitespace).
    Use read_file first to get the exact text to replace.
    """
```

### 2.2 Structured Test Runner
**Goal:** Parse test output into actionable data.

Wrap `npx vitest run` and parse output into:
```python
{"passed": 42, "failed": 3, "failures": [
    {"test": "foo.spec.ts:47", "error": "expected true, got false"}
]}
```

### 2.3 Git Strategy
**Goal:** Clean branch-per-plan workflow.

Add to developer prompt:
```
## Git Rules
- Branch name: `swarm/{plan_id}/{subtask_id}`
- Commit message format: `{subtask_id}: {description}`
- Commit after every green test run
- On context_exhausted: commit WIP with message `{subtask_id}: WIP — {brief status}`
- Never commit to main
```

Add git helper tools:
```python
@tool
def git_branch(name: str) -> str: ...

@tool
def git_commit(message: str, add_all: bool = False) -> str: ...

@tool
def git_status() -> str: ...
```

---

## Phase 3: Orchestration

### 3.1 Parallel Subtask Execution
**Goal:** Run independent subtasks simultaneously in a lane.

When the supervisor sees multiple pending subtasks with no dependencies:
```
supervisor → [developer-A, developer-B, developer-C] → qa_deploy
```

Each developer gets its own thread ID. LaneState tracks multiple `current_subtask_id`s.

### 3.2 Retry with Backoff
**Goal:** Failed lanes retry automatically.

```python
retry_count: int = 0
max_retries: int = 3
backoff_seconds: int = 2 ** retry_count  # 2, 4, 8
```

On failure:
1. Emit `lane_failed` event with reason
2. Wait `backoff_seconds`
3. Re-dispatch with `retry_count + 1`
4. If `retry_count >= max_retries`, route to escalate

### 3.3 Circuit Breaker
**Goal:** Stop retrying lanes that consistently fail.

Track failures per plan_id. If a plan fails 3×, mark it as `broken` and require human intervention to retry.

### 3.4 Lane Timeout Handling
**Goal:** Graceful degradation when lanes stall.

Current: hard kill after 30 min.
Improvement:
- 5 min no progress → inject "Are you stuck?" cue
- 15 min no progress → force handoff with `status: "blocked"`
- 30 min → kill lane, emit `lane_timeout` event

---

## Phase 4: Observability & Safety

### 4.1 Structured Logging
**Goal:** Every action is logged in JSON for debugging.

```json
{
  "timestamp": "2026-04-26T12:34:28Z",
  "lane_id": "lane-part2-...",
  "agent": "developer-1",
  "turn": 7,
  "action": "tool_call",
  "tool": "read_file",
  "tokens_used": 15234,
  "duration_ms": 4200
}
```

### 4.2 Cost Accounting
**Goal:** Track spend per plan, per lane, per agent.

Add to LaneState:
```python
cost_usd: float  # accumulated API spend
```

Approximate: input_tokens * $0.60/M + output_tokens * $2.50/M (Kimi K2.5 pricing).

### 4.3 Secret Detection
**Goal:** Block commits that touch secrets.

Pre-commit check:
```python
if re.search(r'(?i)(api.key|password|secret|token)', diff):
    return "BLOCKED: diff contains potential secret"
```

### 4.4 Migration Safety Gates
**Goal:** Validate migrations before PR.

QA-Deploy checks:
1. Migration number was reserved via ledger
2. No duplicate migration numbers
3. Migration is idempotent (has `IF NOT EXISTS` or similar)

---

## Implementation Order

| Phase | Item | Effort | Impact |
|-------|------|--------|--------|
| 1.1 | Lane Scratchpad | Medium | 🔥 High |
| 1.2 | Agent Registry | Low | 🔥 High |
| 1.3 | Auto-Cue Reading | Low | Medium |
| 1.4 | Working Memory | Medium | Medium |
| 2.1 | Search/Replace Tool | Medium | 🔥 High |
| 2.2 | Structured Test Runner | Medium | Medium |
| 2.3 | Git Strategy | Medium | Medium |
| 3.1 | Parallel Subtasks | High | Medium |
| 3.2 | Retry with Backoff | Low | Medium |
| 3.3 | Circuit Breaker | Low | Low |
| 3.4 | Lane Timeout | Low | Medium |
| 4.1 | Structured Logging | Low | Medium |
| 4.2 | Cost Accounting | Low | Low |
| 4.3 | Secret Detection | Low | 🔥 High |
| 4.4 | Migration Safety | Medium | Medium |

**Recommended first 3:**
1. **Lane Scratchpad** (1.1) — enables swarm communication
2. **Agent Registry** (1.2) — gives agents team awareness
3. **Search/Replace Tool** (2.1) — fixes the sed fragility problem

Want me to implement these three now?

---

## ✅ Already Done

These items were implemented during the current session and are in `main`:

| # | Item | What Changed |
|---|------|-------------|
| 1 | **Compaction node** | `compact_node` added to developer graph (`tools → compact → budget_guard`). Uses `_make_summarizer_model()` to summarize old context via LLM. Keeps last 2 turns verbatim. Falls back to `_prune_old_tool_results()` on failure. |
| 2 | **Rolling prune fallback** | `_prune_old_tool_results()` replaces old large ToolMessages (>2K chars) with compact placeholders. Keeps last 2 agent turns untouched. Handoff results never pruned. |
| 3 | **Higher budget thresholds** | `WARN_THRESHOLD=120K`, `FORCE_THRESHOLD=180K`, `PLAN_BUDGET_LIMIT=1M`, `MAX_HANDOFFS_PER_SUBTASK=10`, `MAX_TURNS_PER_DEV=100`. |
| 4 | **Token-aware trimming** | `trim_messages` in `agent_node` (50K cap) and `budget_guard_node` (55K cap) using `token_counter="approximate"`. |
| 5 | **`read_file` with pagination** | `line_offset` (1-indexed, negative for tail) and `n_lines` params. Max 1000 lines / 64KB / 2K chars per line. |
| 6 | **`grep` tool** | ripgrep → grep → Python regex fallback. Returns line numbers + context. Capped at 100 matches. |
| 7 | **Role-specific model env vars** | `KIMI_META_PM_MODEL`, `KIMI_ORCHESTRATOR_MODEL`, `KIMI_ADVISOR_MODEL`, `KIMI_ARCHITECT_MODEL`, `KIMI_QA_MODEL`, `KIMI_CHAT_MODEL`, `KIMI_SUMMARIZER_MODEL`. |
| 8 | **`KIMI_STRATEGIC_MODEL` catch-all** | All non-coding agents fall back to `KIMI_STRATEGIC_MODEL` before `KIMI_MODEL`. Coding agents (developer) use `KIMI_MODEL=kimi-for-coding`. |
| 9 | **Coding rules in prompt** | 6 rules added to `developer.md`: discover before edit, minimal changes, verify after every edit, don't break repo, one logical change per turn, escalate if stuck. |
| 10 | **Updated budget numbers in prompt** | Developer prompt now says 180K force / 120K warn / 100 max turns (was 80K/60K/50). |
| 11 | **Global `reasoning_content` patch** | `agent_harness/__init__.py` patches LangChain OpenAI converters to preserve `reasoning_content` across Kimi API round-trips. |
| 12 | **`extra_body={"reasoning": None}`** | All agents pass this to prevent 400 errors on tool calls. |
| 13 | **Handoff fix** | `broker_submit_handoff_tool` handles empty JSON strings safely (`""` → `"[]"`). |
| 14 | **Developer graph compilation fix** | `model.bind_tools(_get_cached_tools())` added so the agent generates actual tool calls instead of just chatting. |

---

## 📋 Next Steps

### Immediate (do these first)

1. **Lane Scratchpad (1.1)**
   - Add `scratchpad: list[dict]` to `LaneState` in `swarm/graph.py`
   - Add `ScratchpadEntry` TypedDict
   - Each node appends one entry at end of turn
   - Inject last 20 entries into every agent's system prompt
   - Compact old entries via `compact_node` logic

2. **Agent Registry / Team Awareness (1.2)**
   - Add "Your Team" section to all agent prompts (`developer.md`, `advisor.md`, `qa_deploy.md`, `supervisor.md`)
   - Inject teammate list + recent scratchpad into system prompts
   - Add `agent_name` field to each node's state so it knows who it is

3. **Search/Replace Tool (2.1)**
   - Add `edit_file(old_string, new_string)` tool to `toolkit.py`
   - Validate exact match before replacement
   - Return clear error if old_string not found
   - Update developer prompt to prefer `edit_file` over `sed`

### Short-term (next 1–2 sessions)

4. **Working Memory (1.4)** — Dev-only scratchpad for key facts
5. **Auto-Cue Reading (1.3)** — Pull cues at start of each agent turn
6. **Git Strategy (2.3)** — Branch naming, commit format, git helper tools
7. **Structured Test Runner (2.2)** — Parse vitest/tsc output into JSON

### Medium-term (when swarm is running end-to-end)

8. **Parallel Subtask Execution (3.1)** — Multiple devs in one lane
9. **Retry with Backoff (3.2)** — Failed lanes auto-retry
10. **Lane Timeout Handling (3.4)** — Stuck lane detection & recovery
11. **Structured Logging (4.1)** — JSON logs for all agent actions
12. **Secret Detection (4.3)** — Block commits touching secrets

### Long-term / Research

13. **File Content Cache (1.x)** — Don't re-read same files across turns
14. **Streaming Compaction (1.x)** — Background compaction while agent works
15. **Event Subscriptions (1.x)** — Agents subscribe to event types from other agents
16. **Circuit Breaker (3.3)** — Stop retrying consistently failing lanes
17. **Cost Accounting (4.2)** — Track $ per plan/lane/agent
18. **Lane Progress Dashboard (4.x)** — Real-time web UI
19. **Lane Replay / Time Travel (4.x)** — Debug by replaying from checkpoint
20. **Human-in-the-Loop (4.x)** — Pause lanes for approval at checkpoints

---

*Last updated: 2026-04-26*
