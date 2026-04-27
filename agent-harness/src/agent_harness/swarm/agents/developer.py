"""Ephemeral developer agent — one subtask, then Handoff."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Literal

from langchain_core.runnables import RunnableConfig

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage, trim_messages
from langgraph.graph import END, StateGraph
from typing_extensions import Annotated, TypedDict

from agent_harness.swarm.budget import FORCE_THRESHOLD
from agent_harness.swarm.checkpoint import get_checkpointer, get_ephemeral_checkpointer
from agent_harness.swarm.toolkit import get_developer_tools


type HandoffStatus = Literal["complete", "context_exhausted", "blocked"]
type HandoffTo = Literal["next_dev", "qa_deploy", "supervisor_reroute"]


MAX_TURNS_PER_DEV = 1000  # Context window is the real guardrail, not turns
DUPLICATE_TOOL_WINDOW = 5

# Rolling prune: keep tool results from the last N agent turns
PRUNE_KEEP_TURNS = 2
PRUNE_THRESHOLD_CHARS = 2_000

# Compaction: only summarize when old context exceeds this threshold
COMPACT_THRESHOLD_CHARS = 20_000


def _replace_messages(old: list[BaseMessage], new: list[BaseMessage]) -> list[BaseMessage]:
    """Replace message list entirely (nodes must return the full merged list)."""
    return new


class DevState(TypedDict):
    messages: Annotated[list[BaseMessage], _replace_messages]
    plan_id: str
    subtask_id: str
    plan_content: str
    handoff_in: dict[str, Any] | None
    handoff_count: int  # 0 = first dev (scout), 1+ = subsequent (builder)
    budget_used: int
    budget_warned: bool
    status: str | None  # terminal status when graph ends
    turn_count: int
    recent_tool_calls: list[dict[str, Any]]
    compacted: bool  # compaction runs once per developer
    exploration_turns: int  # turns spent on reads/greps/shell (no writes)


def _load_prompt() -> str:
    path = Path(__file__).parent.parent / "prompts" / "developer.md"
    if path.exists():
        return path.read_text()
    return "# Developer Agent\nImplement the subtask and submit a Handoff."


def _build_system_message(state: DevState) -> SystemMessage:
    base = _load_prompt()
    plan = state.get("plan_content", "")
    handoff = state.get("handoff_in")
    handoff_count = state.get("handoff_count", 0)
    exploration_turns = state.get("exploration_turns", 0)
    parts = [base]

    # Determine mode
    mode = "BUILDER" if handoff_count > 0 else "SCOUT"

    # CRITICAL: inject exact IDs so the LLM doesn't hallucinate them
    turn_count = state.get("turn_count", 0)
    parts.append(
        f"\n## Context\n"
        f"plan_id: {state.get('plan_id', '')}\n"
        f"subtask_id: {state.get('subtask_id', '')}\n"
        f"turn_count: {turn_count} / {MAX_TURNS_PER_DEV}\n"
        f"exploration_turns: {exploration_turns} / 3 (MAX)\n"
        f"MODE: {mode}\n"
        f"handoff_count: {handoff_count} (0 = scout, 1+ = builder)\n"
        f"\n"
        f"When calling broker_submit_handoff_tool, you MUST use these EXACT values for plan_id and subtask_id.\n"
    )

    if mode == "SCOUT":
        parts.append(
            f"\n## SCOUT MODE\n"
            f"You are the FIRST developer on this subtask. Your job is to EXPLORE and WRITE AN IMPLEMENTATION SPEC.\n"
            f"You have used {exploration_turns}/3 exploration turns.\n"
            f"After 3 exploration turns, you MUST stop exploring and write the spec.\n"
            f"DO NOT write code. DO NOT create files. DO NOT run tests.\n"
            f"Your handoff MUST contain a detailed implementation_spec in state_notes.\n"
        )
    else:
        parts.append(
            f"\n## BUILDER MODE\n"
            f"You are developer #{handoff_count + 1} on this subtask.\n"
            f"A scout has already explored the codebase. READ THEIR SPEC FIRST.\n"
            f"Your job is to EXECUTE the implementation spec — write code, run tests, ship.\n"
            f"You may do 1–2 targeted file reads to verify the spec, but NO broad exploration.\n"
            f"Start implementing IMMEDIATELY.\n"
        )

    if plan:
        parts.append(f"\n## Plan\n{plan}")
    if handoff:
        parts.append(f"\n## Previous Handoff\n{handoff}")
    return SystemMessage(content="\n".join(parts))


def _make_model() -> ChatOpenAI:
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY or OPENAI_API_KEY not set")
    # Dev agent uses its own model + base URL so it can run on kimi-k2-6
    # while other agents stay on kimi-for-coding if desired.
    model = os.getenv("KIMI_DEV_MODEL") or os.getenv("KIMI_MODEL", "kimi-k2-6")
    # Auto-detect base URL: kimi-for-coding -> kimi.com, everything else -> moonshot.cn
    default_base = (
        "https://api.kimi.com/coding/v1"
        if model == "kimi-for-coding"
        else "https://api.moonshot.cn/v1"
    )
    base_url = os.getenv("KIMI_DEV_BASE_URL") or os.getenv("KIMI_BASE_URL", default_base)
    return ChatOpenAI(
        model=model,
        temperature=0.2,
        max_tokens=8192,
        api_key=api_key,
        base_url=base_url,
        timeout=30,          # cap each turn at 30 s (was 120)
        max_retries=2,
        default_headers={"User-Agent": "claude-code/0.1"},
        extra_body={"reasoning": None},
    )


def _make_summarizer_model() -> ChatOpenAI:
    """Dedicated model for context compaction / summarization.

    Defaults to the dev agent model, but can be overridden via
    KIMI_SUMMARIZER_MODEL to use a different model.
    """
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY or OPENAI_API_KEY not set")
    # Follow the same model + base-url resolution as the dev agent
    dev_model = os.getenv("KIMI_DEV_MODEL") or os.getenv("KIMI_MODEL", "kimi-k2-6")
    model = os.getenv("KIMI_SUMMARIZER_MODEL") or os.getenv("KIMI_STRATEGIC_MODEL") or dev_model
    default_base = (
        "https://api.kimi.com/coding/v1"
        if model == "kimi-for-coding"
        else "https://api.moonshot.cn/v1"
    )
    base_url = os.getenv("KIMI_DEV_BASE_URL") or os.getenv("KIMI_BASE_URL", default_base)
    max_tokens = int(os.getenv("KIMI_SUMMARIZER_MAX_TOKENS", "4096"))
    return ChatOpenAI(
        model=model,
        temperature=0.1,
        max_tokens=max_tokens,
        api_key=api_key,
        base_url=base_url,
        timeout=30,          # cap summarizer at 30 s too
        max_retries=2,
        default_headers={"User-Agent": "claude-code/0.1"},
        extra_body={"reasoning": None},
    )


def _hash_tool_call(tc: dict[str, Any]) -> str:
    """Stable hash for duplicate detection."""
    args = tc.get("args", tc.get("arguments", {}))
    return f"{tc.get('name')}:{json.dumps(args, sort_keys=True, default=str)}"


def _detect_tool_loop(recent: list[dict[str, Any]]) -> tuple[bool, str]:
    """Detect if the same tool+args has been called repeatedly."""
    if len(recent) < 3:
        return False, ""
    hashes = [_hash_tool_call(tc) for tc in recent]
    # Check if the last 3 calls are identical
    if len(hashes) >= 3 and hashes[-1] == hashes[-2] == hashes[-3]:
        return True, f"Tool loop detected: {hashes[-1]} called 3x in a row"
    # Check if any call appears >50% in the window
    from collections import Counter
    counts = Counter(hashes)
    most_common, count = counts.most_common(1)[0]
    if count >= 4 and len(hashes) >= DUPLICATE_TOOL_WINDOW:
        return True, f"Tool loop detected: {most_common} called {count}x in last {len(hashes)} turns"
    return False, ""


# ── Rolling Tool Output Pruning ────────────────────────────────────────────

def _prune_old_tool_results(
    messages: list[BaseMessage],
    keep_turns: int = PRUNE_KEEP_TURNS,
    prune_threshold: int = PRUNE_THRESHOLD_CHARS,
) -> list[BaseMessage]:
    """Replace old large ToolMessages with compact summaries.

    Keeps all messages from the last `keep_turns` agent turns untouched.
    An "agent turn" is an AIMessage that contains tool_calls.
    """
    # Find indices of AIMessages that have tool_calls (turn boundaries)
    ai_indices = [
        i
        for i, m in enumerate(messages)
        if isinstance(m, AIMessage) and getattr(m, "tool_calls", None)
    ]

    # Not enough turns to prune anything
    if len(ai_indices) <= keep_turns:
        return messages

    # Everything from the Nth-to-last turn onward is protected
    cutoff_index = ai_indices[-keep_turns]

    result: list[BaseMessage] = []
    for i, msg in enumerate(messages):
        if i >= cutoff_index:
            # Recent message — keep as-is
            result.append(msg)
            continue

        if (
            isinstance(msg, ToolMessage)
            and isinstance(msg.content, str)
            and len(msg.content) > prune_threshold
        ):
            name = msg.name or "unknown"
            # Never prune handoff results — they're terminal signals
            if name == "broker_submit_handoff_tool":
                result.append(msg)
                continue

            preview = msg.content[:200].replace("\n", " ")
            summary = (
                f"[Earlier {name} result pruned — {len(msg.content)} chars. "
                f"Preview: {preview}...]"
            )
            result.append(
                ToolMessage(
                    content=summary,
                    tool_call_id=msg.tool_call_id,
                    name=name,
                )
            )
        else:
            result.append(msg)

    return result


def prune_node(state: DevState) -> dict[str, Any]:
    """Prune old tool results to prevent context bloat."""
    messages = list(state.get("messages", []))
    pruned = _prune_old_tool_results(messages)
    return {"messages": pruned}


# ── Agent & Budget Nodes ──────────────────────────────────────────────────

def _is_exploration_tool_call(tc: dict[str, Any]) -> bool:
    """Check if a tool call is exploratory (read/grep/shell) vs productive (write/edit)."""
    name = tc.get("name", "")
    return name in ("read_file", "grep", "shell", "list_directory", "search_files")


def agent_node(state: DevState, config: RunnableConfig) -> dict[str, Any]:
    """Call the LLM with the current message history."""
    model = _make_model()
    messages = list(state["messages"])
    handoff_count = state.get("handoff_count", 0)
    exploration_turns = state.get("exploration_turns", 0)

    # Ensure system message is first
    if not messages or not isinstance(messages[0], SystemMessage):
        sys_msg = _build_system_message(state)
        messages = [sys_msg] + messages

    # Scout/builder exploration enforcement
    if handoff_count == 0 and exploration_turns >= 3:
        # Scout has exceeded exploration budget — force them to write the spec
        messages = messages + [
            SystemMessage(
                content="EXPLORATION BUDGET EXHAUSTED (3/3 turns used). "
                "You are a SCOUT. Stop reading files immediately. "
                "Write your implementation spec NOW and submit a handoff. "
                "DO NOT call any more read_file, grep, or shell tools."
            )
        ]
    elif handoff_count > 0 and exploration_turns >= 2:
        # Builder has done enough verification
        messages = messages + [
            SystemMessage(
                content="EXPLORATION BUDGET EXHAUSTED (2/2 turns used). "
                "You are a BUILDER. Stop verifying and START IMPLEMENTING. "
                "DO NOT call any more read_file, grep, or shell tools. "
                "Write code, run tests, and submit your handoff."
            )
        ]

    # Token-aware trim: keep last ~120K tokens (model limit is 128K)
    messages = trim_messages(
        messages,
        max_tokens=120000,
        token_counter="approximate",
        strategy="last",
        include_system=True,
    )

    # Bind tools so the model knows to generate tool_calls
    tools = _get_cached_tools()
    model_with_tools = model.bind_tools(tools)
    response = model_with_tools.invoke(messages, config)

    # Count exploration turns from the last AIMessage's tool_calls
    new_exploration_turns = exploration_turns
    if isinstance(response, AIMessage) and response.tool_calls:
        if all(_is_exploration_tool_call(tc) for tc in response.tool_calls):
            new_exploration_turns = exploration_turns + 1

    # Return FULL merged message list (trimmed input + response)
    return {
        "messages": messages + [response],
        "turn_count": state.get("turn_count", 0) + 1,
        "exploration_turns": new_exploration_turns,
    }


def _count_turn_tokens(messages: list[BaseMessage]) -> int:
    """Approximate tokens for the latest turn."""
    turn_tokens = 0
    for msg in messages:
        if isinstance(msg, AIMessage):
            meta = msg.usage_metadata or {}
            turn_tokens += meta.get("input_tokens", 0) or meta.get("prompt_tokens", 0)
        else:
            turn_tokens += len(msg.content) // 4 if isinstance(msg.content, str) else 0
    return turn_tokens


def budget_guard_node(state: DevState) -> dict[str, Any]:
    """Check token budget after an agent turn and hard-trim message state."""
    used = state.get("budget_used", 0)
    warned = state.get("budget_warned", False)

    # Count only the latest AIMessage's input tokens (prevents exponential overcounting)
    turn_tokens = 0
    for msg in reversed(state["messages"]):
        if isinstance(msg, AIMessage):
            meta = msg.usage_metadata or {}
            turn_tokens += meta.get("input_tokens", 0) or meta.get("prompt_tokens", 0)
            break
        elif isinstance(msg.content, str):
            turn_tokens += len(msg.content) // 4

    used += turn_tokens

    messages = list(state["messages"])
    updates: dict[str, Any] = {"budget_used": used, "messages": messages}

    if used >= FORCE_THRESHOLD and not warned:
        updates["budget_warned"] = True
        messages = messages + [
            SystemMessage(
                content=f"TOKEN WARNING: {used} / {FORCE_THRESHOLD} tokens used. "
                f"Start wrapping up and prepare your Handoff."
            )
        ]
        updates["messages"] = messages
    elif used >= FORCE_THRESHOLD:
        messages = messages + [
            SystemMessage(
                content=f"TOKEN LIMIT REACHED: {used} / {FORCE_THRESHOLD} tokens. "
                f"You MUST exit now via broker_submit_handoff_tool with status=context_exhausted."
            )
        ]
        updates["messages"] = messages
        updates["status"] = "context_exhausted"

    # Token-aware trim: keep ~120K tokens (model limit is 128K)
    final_messages = updates["messages"]
    updates["messages"] = trim_messages(
        final_messages,
        max_tokens=120000,
        token_counter="approximate",
        strategy="last",
        include_system=True,
    )

    return updates


def should_continue(state: DevState) -> Literal["tools", "agent", "force_handoff", "__end__"]:
    """Route after the agent node."""
    last = state["messages"][-1]

    # If the last message is a tool result for submit_handoff, we're done
    if isinstance(last, ToolMessage) and last.name == "broker_submit_handoff_tool":
        return END

    # Hard turn cap — force a handoff so the lane can cycle to a fresh dev
    turn_count = state.get("turn_count", 0)
    if turn_count >= MAX_TURNS_PER_DEV:
        return "force_handoff"

    # Duplicate tool call loop detection
    recent = state.get("recent_tool_calls", [])
    is_loop, loop_msg = _detect_tool_loop(recent)
    if is_loop:
        # Inject a system message forcing the agent to stop
        return END

    # If budget exhausted, ensure a handoff is submitted programmatically
    if state.get("status") == "context_exhausted":
        if isinstance(last, ToolMessage) and last.name == "broker_submit_handoff_tool":
            return END
        if isinstance(last, AIMessage) and last.tool_calls:
            # Agent already generated tool calls (hopefully the handoff)
            return "tools"
        # Force a programmatic handoff rather than relying on the LLM
        return "force_handoff"

    # Normal ReAct routing
    if isinstance(last, AIMessage) and last.tool_calls:
        return "tools"

    return END


_TOOLS: list[Any] | None = None


def _get_cached_tools() -> list[Any]:
    global _TOOLS
    if _TOOLS is None:
        _TOOLS = get_developer_tools()
    return _TOOLS


def tools_node(state: DevState) -> dict[str, Any]:
    """Execute tool calls and merge results into the full message list."""
    tools_by_name = {t.name: t for t in _get_cached_tools()}
    messages = list(state.get("messages", []))
    recent = list(state.get("recent_tool_calls", []))

    # Find the last AIMessage with tool_calls
    last_ai = None
    for msg in reversed(messages):
        if isinstance(msg, AIMessage) and msg.tool_calls:
            last_ai = msg
            break

    if last_ai:
        for tc in last_ai.tool_calls:
            tool_name = tc.get("name")
            tool = tools_by_name.get(tool_name)
            if tool:
                try:
                    # CRITICAL: prevent LLM from hallucinating plan_id / subtask_id
                    if tool_name == "broker_submit_handoff_tool":
                        tc = dict(tc)
                        tc_args = dict(tc.get("args", tc.get("arguments", {})))
                        tc_args["plan_id"] = state.get("plan_id", tc_args.get("plan_id", ""))
                        tc_args["subtask_id"] = state.get("subtask_id", tc_args.get("subtask_id", ""))

                        # COMPILATION GATE: if agent claims complete, run type check
                        if tc_args.get("status") == "complete":
                            typecheck_result = _run_typecheck()
                            if typecheck_result.startswith("FAIL"):
                                # Block the handoff — force status to blocked
                                tc_args["status"] = "blocked"
                                # Inject the type error into state_notes
                                notes = _safe_json_loads(tc_args.get("state_notes", "[]"), [])
                                notes.append(f"TYPE CHECK BLOCKED HANDOFF: {typecheck_result}")
                                tc_args["state_notes"] = json.dumps(notes)
                                # Still execute the tool but with blocked status
                            else:
                                # Pass — append confirmation to state_notes
                                notes = _safe_json_loads(tc_args.get("state_notes", "[]"), [])
                                notes.append(typecheck_result)
                                tc_args["state_notes"] = json.dumps(notes)

                        tc["args"] = tc_args
                    result = tool.invoke(tc)
                except Exception as exc:
                    result = ToolMessage(
                        content=f"Error: {exc}",
                        name=tool_name,
                        tool_call_id=tc.get("id", ""),
                    )
                messages.append(result)
                recent.append({
                    "name": tool_name,
                    "args": tc.get("args", tc.get("arguments", {})),
                })
            else:
                messages.append(ToolMessage(
                    content=f"Error: tool '{tool_name}' not found",
                    name=tool_name,
                    tool_call_id=tc.get("id", ""),
                ))

    recent = recent[-DUPLICATE_TOOL_WINDOW:]
    return {"messages": messages, "recent_tool_calls": recent}


def _extract_file_paths_from_messages(messages: list[BaseMessage]) -> tuple[list[str], list[dict[str, Any]]]:
    """Extract file paths from write_file and edit_file tool results in message history.

    Returns (files_touched, done_items).
    """
    import re
    files_touched: list[str] = []
    done_items: list[dict[str, Any]] = []

    for msg in messages:
        if not isinstance(msg, ToolMessage):
            continue
        content = str(msg.content)
        name = msg.name or ""

        if name == "write_file":
            # Match patterns like:
            # "File written successfully to /path/to/file"
            # "Successfully wrote to /path/to/file"
            # Or just look for path-like strings in the result
            m = re.search(r"(?:written successfully to|Successfully wrote to|wrote to)\s+(.+?)(?:\n|$|\[WARNING)", content, re.IGNORECASE)
            if m:
                path = m.group(1).strip().rstrip(".").strip()
                files_touched.append(path)
                done_items.append({"type": "file", "path": path, "summary": "File written"})
            else:
                # Fallback: try to find any absolute/relative path in the output
                m = re.search(r"([\w\-/]+\.[\w]+)", content)
                if m:
                    files_touched.append(m.group(1))

        elif name == "edit_file":
            m = re.search(r"Successfully replaced text in\s+(.+?)\s*\(", content)
            if m:
                path = m.group(1).strip()
                files_touched.append(path)
                done_items.append({"type": "file", "path": path, "summary": "File edited"})

        elif name == "shell":
            # Look for git add or file creation in shell output
            for line in content.splitlines():
                if line.startswith("git add ") or line.startswith("+ "):
                    path = line.split()[-1]
                    if "." in path:
                        files_touched.append(path)

    return files_touched, done_items


def _run_typecheck(root_dir: str | None = None) -> str:
    """Run TypeScript type checker. Returns result message."""
    import subprocess
    from pathlib import Path
    root = Path(root_dir) if root_dir else Path.cwd()
    try:
        result = subprocess.run(
            ["npx", "tsc", "--noEmit"],
            cwd=str(root),
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0:
            return "PASS: TypeScript compilation check passed."
        stdout = result.stdout or ""
        stderr = result.stderr or ""
        combined = (stdout + "\n" + stderr).strip()[:2000]
        return f"FAIL: TypeScript compilation errors:\n{combined}"
    except Exception as e:
        return f"SKIP: Could not run type check: {e}"


def force_handoff_node(state: DevState) -> dict[str, Any]:
    """Programmatically submit a handoff when the agent failed to do so at budget limit."""
    from agent_harness.broker import submit_handoff

    plan_id = state["plan_id"]
    subtask_id = state["subtask_id"]
    handoff_count = state.get("handoff_count", 0)
    mode = "SCOUT" if handoff_count == 0 else "BUILDER"
    exploration_turns = state.get("exploration_turns", 0)
    turn_count = state.get("turn_count", 0)

    files_touched, done_items = _extract_file_paths_from_messages(state.get("messages", []))

    state_notes: list[str] = [
        f"Forced handoff: {mode} mode, {turn_count} turns, {exploration_turns} exploration turns.",
        f"Files touched: {', '.join(files_touched[-10:]) if files_touched else 'none'}",
    ]

    # Run type check if any files were written (best-effort)
    if files_touched:
        typecheck_result = _run_typecheck()
        state_notes.append(typecheck_result)

    record = submit_handoff(
        plan_id=plan_id,
        subtask_id=subtask_id,
        status="context_exhausted",
        handoff_to="next_dev",
        state_notes=state_notes[-5:] if len(state_notes) > 5 else state_notes,
        files_touched=files_touched[-10:] if files_touched else [],
        done=done_items,
    )

    existing = list(state.get("messages", []))
    return {
        "messages": existing + [
            ToolMessage(
                content=json.dumps({"submitted": record, "forced": True, "mode": mode}),
                name="broker_submit_handoff_tool",
                tool_call_id="forced-handoff",
            )
        ],
        "status": "context_exhausted",
    }


# ── Summarizer Agent (optional compaction layer) ──────────────────────────

def _build_compaction_prompt(messages: list[BaseMessage]) -> str:
    """Build a prompt that asks an LLM to compact old conversation context."""
    parts = [
        "The following is a list of messages in an agent conversation. "
        "Compact this conversation context according to the priorities and rules below.",
        "",
        "**Compression Priorities (in order):**",
        "1. Current Task State: What is being worked on RIGHT NOW",
        "2. Errors & Solutions: All encountered errors and their resolutions",
        "3. Code Evolution: Final working versions only (remove intermediate attempts)",
        "4. System Context: Project structure, dependencies, environment setup",
        "5. Design Decisions: Architectural choices and their rationale",
        "6. TODO Items: Unfinished tasks and known issues",
        "",
        "**Compression Rules:**",
        "- MUST KEEP: Error messages, stack traces, working solutions, current task",
        "- MERGE: Similar discussions into single summary points",
        "- REMOVE: Redundant explanations, failed attempts (keep lessons learned), verbose comments",
        "- CONDENSE: Long code blocks → keep signatures + key logic only",
        "",
        "**Required Output Structure:**",
        "<current_focus>[What we're working on now]</current_focus>",
        "<completed_tasks>- [Task]: [Brief outcome]</completed_tasks>",
        "<active_issues>- [Issue]: [Status/Next steps]</active_issues>",
        "<important_context>[Any crucial information not covered above]</important_context>",
        "",
        "--- Messages to compact ---",
        "",
    ]

    for i, msg in enumerate(messages):
        role = type(msg).__name__.replace("Message", "").lower()
        if isinstance(msg, ToolMessage):
            name = msg.name or "unknown"
            content = msg.content if isinstance(msg.content, str) else str(msg.content)
            # Truncate very long tool results in the compaction prompt itself
            if len(content) > 2000:
                content = content[:2000] + f"\n... [{len(content) - 2000} more chars]"
            parts.append(f"## Message {i + 1}\nRole: {role} (tool={name})\nContent:\n{content}\n")
        elif isinstance(msg.content, str):
            content = msg.content
            if len(content) > 2000:
                content = content[:2000] + f"\n... [{len(content) - 2000} more chars]"
            parts.append(f"## Message {i + 1}\nRole: {role}\nContent:\n{content}\n")
        else:
            parts.append(f"## Message {i + 1}\nRole: {role}\nContent: {str(msg.content)[:2000]}\n")

    return "\n".join(parts)


def compact_node(state: DevState) -> dict[str, Any]:
    """Compact old messages using a summarizer LLM call.

    Runs ONCE per developer when context has grown large.
    Preserves the last 2 agent turns verbatim.
    """
    messages = list(state.get("messages", []))

    # Only compact once per developer
    if state.get("compacted"):
        return {"messages": messages}

    # Find the last 2 agent turns — these are preserved verbatim
    ai_indices = [
        i
        for i, m in enumerate(messages)
        if isinstance(m, AIMessage) and getattr(m, "tool_calls", None)
    ]
    if len(ai_indices) <= 2:
        return {"messages": messages}  # Nothing old enough to compact

    cutoff = ai_indices[-2]  # Start of the 2nd-to-last turn
    to_compact = messages[:cutoff]
    to_preserve = messages[cutoff:]

    # Quick token estimate — skip compaction if the old stuff is small
    total_old_chars = sum(
        len(m.content) if isinstance(m.content, str) else 0
        for m in to_compact
    )
    if total_old_chars < 30_000:  # ~120K tokens approx
        return {"messages": messages}  # Not worth the LLM call yet

    # Run compaction via the dedicated summarizer model
    compaction_prompt = _build_compaction_prompt(to_compact)
    try:
        summarizer = _make_summarizer_model()
        summary_response = summarizer.invoke([
            SystemMessage(content="You are a helpful assistant that compacts conversation context."),
            HumanMessage(content=compaction_prompt),
        ])
    except Exception:
        # If compaction fails, fall back to simple pruning
        return {"messages": _prune_old_tool_results(messages)}

    summary_text = (
        summary_response.content
        if isinstance(summary_response.content, str)
        else str(summary_response.content)
    )

    # Build the compacted message list
    compacted: list[BaseMessage] = [
        SystemMessage(
            content="Previous context has been compacted. Here is the compaction output:\n\n"
            + summary_text
        )
    ]
    compacted.extend(to_preserve)

    return {"messages": compacted, "compacted": True}


# ── Graph Builder ─────────────────────────────────────────────────────────

def build_developer_graph(checkpointer: Any | None = None):
    """Build and compile the ephemeral developer ReAct graph."""
    builder = StateGraph(DevState)
    builder.add_node("agent", agent_node)
    builder.add_node("tools", tools_node)
    builder.add_node("compact", compact_node)
    builder.add_node("budget_guard", budget_guard_node)
    builder.add_node("force_handoff", force_handoff_node)

    builder.set_entry_point("agent")
    builder.add_conditional_edges(
        "agent",
        should_continue,
        {"tools": "tools", "agent": "agent", "force_handoff": "force_handoff", END: END},
    )
    builder.add_edge("tools", "compact")
    builder.add_edge("compact", "budget_guard")
    builder.add_edge("budget_guard", "agent")
    builder.add_edge("force_handoff", END)

    return builder.compile(checkpointer=checkpointer)


# Hard ceiling: if a single developer invocation exceeds this, force handoff.
MAX_DEV_RUNTIME_SECONDS = 5 * 60


def _run_developer_plain(
    plan_id: str,
    subtask_id: str,
    plan_content: str,
    handoff_in: dict[str, Any] | None = None,
    handoff_count: int = 0,
    thread_id: str | None = None,
) -> DevState:
    """Run developer ReAct loop without nested LangGraph (avoids executor deadlock)."""
    from langchain_core.runnables import RunnableConfig
    import time

    config = RunnableConfig(configurable={"thread_id": thread_id or str(uuid.uuid4())})
    state: DevState = {
        "messages": [],
        "plan_id": plan_id,
        "subtask_id": subtask_id,
        "plan_content": plan_content,
        "handoff_in": handoff_in,
        "handoff_count": handoff_count,
        "budget_used": 0,
        "budget_warned": False,
        "status": None,
        "turn_count": 0,
        "recent_tool_calls": [],
        "compacted": False,
        "exploration_turns": 0,
    }

    start_time = time.time()

    for turn in range(MAX_TURNS_PER_DEV + 2):
        # Wall-clock safety valve — if the LLM API hangs, we bail out
        elapsed = time.time() - start_time
        if elapsed >= MAX_DEV_RUNTIME_SECONDS:
            state["messages"] = list(state.get("messages", [])) + [
                SystemMessage(
                    content=f"HARD TIMEOUT: developer exceeded {MAX_DEV_RUNTIME_SECONDS}s wall-clock limit. "
                    "Forcing handoff now."
                )
            ]
            handoff_updates = force_handoff_node(state)
            state.update(handoff_updates)
            break

        # Agent turn
        agent_updates = agent_node(state, config)
        state.update(agent_updates)

        # Route
        route = should_continue(state)
        if route == "__end__":
            break
        if route == "force_handoff":
            handoff_updates = force_handoff_node(state)
            state.update(handoff_updates)
            break
        if route == "tools":
            tools_updates = tools_node(state)
            state.update(tools_updates)

            # If the developer submitted a handoff in this tools turn, exit
            # immediately. Do NOT run compaction or budget guard — they would
            # inject system messages that confuse the LLM into continuing.
            messages_after_tools = state.get("messages", [])
            handoff_submitted = any(
                isinstance(m, ToolMessage) and m.name == "broker_submit_handoff_tool"
                for m in messages_after_tools
            )
            if handoff_submitted:
                break

            compact_updates = compact_node(state)
            state.update(compact_updates)
            guard_updates = budget_guard_node(state)
            state.update(guard_updates)
            if state.get("status") == "context_exhausted":
                handoff_updates = force_handoff_node(state)
                state.update(handoff_updates)
                break
            # Loop back to agent
            continue
        # Unknown route — break to avoid infinite loop
        break

    # Safety net: if the loop exited without a handoff, force one now
    if not any(
        isinstance(m, ToolMessage) and m.name == "broker_submit_handoff_tool"
        for m in state.get("messages", [])
    ):
        handoff_updates = force_handoff_node(state)
        state.update(handoff_updates)

    return state


def run_developer(
    plan_id: str,
    subtask_id: str,
    plan_content: str,
    handoff_in: dict[str, Any] | None = None,
    handoff_count: int = 0,
    thread_id: str | None = None,
    checkpointer: Any | None = None,
) -> DevState:
    """Run a single ephemeral developer to completion on one subtask.

    Returns the final DevState (includes messages and terminal status).
    Uses an in-memory checkpointer by default to avoid unbounded disk growth.
    Pass a custom checkpointer only if you need resumability.
    """
    cp = checkpointer or get_ephemeral_checkpointer()
    graph = build_developer_graph(checkpointer=cp)

    config = {"configurable": {"thread_id": thread_id or str(uuid.uuid4())}}
    initial_state: DevState = {
        "messages": [],
        "plan_id": plan_id,
        "subtask_id": subtask_id,
        "plan_content": plan_content,
        "handoff_in": handoff_in,
        "handoff_count": handoff_count,
        "budget_used": 0,
        "budget_warned": False,
        "status": None,
        "turn_count": 0,
        "recent_tool_calls": [],
        "compacted": False,
        "exploration_turns": 0,
    }

    final_state = None
    for event in graph.stream(initial_state, config, stream_mode="values"):
        final_state = event

    return final_state  # type: ignore[return-value]
