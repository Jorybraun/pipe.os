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


MAX_TURNS_PER_DEV = 15
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
    budget_used: int
    budget_warned: bool
    status: str | None  # terminal status when graph ends
    turn_count: int
    recent_tool_calls: list[dict[str, Any]]


def _load_prompt() -> str:
    path = Path(__file__).parent.parent / "prompts" / "developer.md"
    if path.exists():
        return path.read_text()
    return "# Developer Agent\nImplement the subtask and submit a Handoff."


def _build_system_message(state: DevState) -> SystemMessage:
    base = _load_prompt()
    plan = state.get("plan_content", "")
    handoff = state.get("handoff_in")
    parts = [base]
    # CRITICAL: inject exact IDs so the LLM doesn't hallucinate them
    turn_count = state.get("turn_count", 0)
    parts.append(
        f"\n## Context\n"
        f"plan_id: {state.get('plan_id', '')}\n"
        f"subtask_id: {state.get('subtask_id', '')}\n"
        f"turn_count: {turn_count} / {MAX_TURNS_PER_DEV}\n"
        f"When calling broker_submit_handoff_tool, you MUST use these EXACT values for plan_id and subtask_id.\n"
        f"IMPORTANT: You have a limited number of turns. If you are near the limit ({MAX_TURNS_PER_DEV}), "
        f"wrap up your work and submit a handoff immediately using broker_submit_handoff_tool. "
        f"Do not start new exploration if you have fewer than 3 turns remaining."
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
    base_url = os.getenv("KIMI_BASE_URL", "https://api.kimi.com/coding/v1")
    model = os.getenv("KIMI_MODEL", "kimi-for-coding")
    return ChatOpenAI(
        model=model,
        temperature=0.2,
        max_tokens=8192,
        api_key=api_key,
        base_url=base_url,
        timeout=120,
        max_retries=2,
        model_kwargs={
            "extra_headers": {
                "User-Agent": "claude-code/0.1",
            }
        },
        extra_body={"reasoning": None},
    )


def _make_summarizer_model() -> ChatOpenAI:
    """Dedicated model for context compaction / summarization.

    Defaults to the same model as the agent, but can be overridden via
    KIMI_SUMMARIZER_MODEL to use a different model (e.g. kimi-k2-5 for
    its larger context window and stronger summarization capabilities).
    """
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY or OPENAI_API_KEY not set")
    base_url = os.getenv("KIMI_BASE_URL", "https://api.kimi.com/coding/v1")
    # Allow a dedicated summarizer model — e.g. export KIMI_SUMMARIZER_MODEL=kimi-k2-6
    model = os.getenv("KIMI_SUMMARIZER_MODEL") or os.getenv("KIMI_STRATEGIC_MODEL") or os.getenv("KIMI_MODEL", "kimi-for-coding")
    # Summarizer can use a larger output budget since it's writing structured summaries
    max_tokens = int(os.getenv("KIMI_SUMMARIZER_MAX_TOKENS", "4096"))
    return ChatOpenAI(
        model=model,
        temperature=0.1,  # Lower temp for consistent structured output
        max_tokens=max_tokens,
        api_key=api_key,
        base_url=base_url,
        timeout=120,
        max_retries=2,
        model_kwargs={
            "extra_headers": {
                "User-Agent": "claude-code/0.1",
            }
        },
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

def agent_node(state: DevState, config: RunnableConfig) -> dict[str, Any]:
    """Call the LLM with the current message history."""
    model = _make_model()
    messages = list(state["messages"])

    # Ensure system message is first
    if not messages or not isinstance(messages[0], SystemMessage):
        sys_msg = _build_system_message(state)
        messages = [sys_msg] + messages

    # Token-aware trim: keep last ~50K tokens so we stay well under 80K budget
    messages = trim_messages(
        messages,
        max_tokens=50000,
        token_counter="approximate",
        strategy="last",
        include_system=True,
    )

    # Bind tools so the model knows to generate tool_calls
    tools = _get_cached_tools()
    model_with_tools = model.bind_tools(tools)
    response = model_with_tools.invoke(messages, config)

    # Return FULL merged message list (trimmed input + response)
    return {"messages": messages + [response], "turn_count": state.get("turn_count", 0) + 1}


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

    # Token-aware trim: prevent unbounded state growth. Keep ~55K tokens.
    final_messages = updates["messages"]
    updates["messages"] = trim_messages(
        final_messages,
        max_tokens=55000,
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


def force_handoff_node(state: DevState) -> dict[str, Any]:
    """Programmatically submit a handoff when the agent failed to do so at budget limit."""
    from agent_harness.broker import submit_handoff

    plan_id = state["plan_id"]
    subtask_id = state["subtask_id"]

    # Extract files touched from message history
    files_touched: list[str] = []
    state_notes: list[str] = ["Forced handoff: developer turn budget exhausted."]
    for msg in state.get("messages", []):
        if isinstance(msg, ToolMessage) and msg.name in ("read_file", "write_file", "shell"):
            content = str(msg.content)[:200]
            files_touched.append(f"{msg.name}: {content}")
        elif isinstance(msg, AIMessage) and msg.content:
            # Capture the developer's reasoning as state notes
            content = str(msg.content)[:500]
            if content and content not in state_notes[-1] if state_notes else True:
                state_notes.append(f"Dev thought: {content}")

    record = submit_handoff(
        plan_id=plan_id,
        subtask_id=subtask_id,
        status="context_exhausted",
        handoff_to="next_dev",
        state_notes=state_notes[-5:] if len(state_notes) > 5 else state_notes,
        files_touched=files_touched[-10:] if len(files_touched) > 10 else files_touched,
    )

    existing = list(state.get("messages", []))
    return {
        "messages": existing + [
            ToolMessage(
                content=json.dumps({"submitted": record, "forced": True}),
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

    This is the 'smart' layer on top of prune_node.  It runs only when the
    conversation has grown beyond a threshold AND there are old messages
    worth summarizing.
    """
    messages = list(state.get("messages", []))

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
    if total_old_chars < 8_000:
        return {"messages": messages}  # Not worth the LLM call

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

    return {"messages": compacted}


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


def _run_developer_plain(
    plan_id: str,
    subtask_id: str,
    plan_content: str,
    handoff_in: dict[str, Any] | None = None,
    thread_id: str | None = None,
) -> DevState:
    """Run developer ReAct loop without nested LangGraph (avoids executor deadlock)."""
    from langchain_core.runnables import RunnableConfig

    config = RunnableConfig(configurable={"thread_id": thread_id or str(uuid.uuid4())})
    state: DevState = {
        "messages": [],
        "plan_id": plan_id,
        "subtask_id": subtask_id,
        "plan_content": plan_content,
        "handoff_in": handoff_in,
        "budget_used": 0,
        "budget_warned": False,
        "status": None,
        "turn_count": 0,
        "recent_tool_calls": [],
    }

    for turn in range(MAX_TURNS_PER_DEV + 2):
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
        "budget_used": 0,
        "budget_warned": False,
        "status": None,
        "turn_count": 0,
        "recent_tool_calls": [],
    }

    final_state = None
    for event in graph.stream(initial_state, config, stream_mode="values"):
        final_state = event

    return final_state  # type: ignore[return-value]
