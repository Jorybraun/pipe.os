"""Ephemeral developer agent — one subtask, then Handoff."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Literal

from langchain_core.runnables import RunnableConfig

from langchain_openai import ChatOpenAI
from langchain_core.messages import AIMessage, BaseMessage, SystemMessage, ToolMessage, trim_messages
from langgraph.graph import END, StateGraph
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from typing_extensions import Annotated, TypedDict

from agent_harness.swarm.budget import FORCE_THRESHOLD
from agent_harness.swarm.checkpoint import get_checkpointer, get_ephemeral_checkpointer
from agent_harness.swarm.toolkit import get_developer_tools


type HandoffStatus = Literal["complete", "context_exhausted", "blocked"]
type HandoffTo = Literal["next_dev", "qa_deploy", "supervisor_reroute"]


MAX_TURNS_PER_DEV = 50
DUPLICATE_TOOL_WINDOW = 5


class DevState(TypedDict):
    messages: Annotated[list[BaseMessage], add_messages]
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
    if plan:
        parts.append(f"\n## Plan\n{plan}")
    if handoff:
        parts.append(f"\n## Previous Handoff\n{handoff}")
    return SystemMessage(content="\n".join(parts))


def _make_model() -> ChatOpenAI:
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY not set")
    return ChatOpenAI(
        model="kimi-latest",
        temperature=0.2,
        max_tokens=8192,
        api_key=api_key,
        base_url="https://api.moonshot.cn/v1",
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


def agent_node(state: DevState, config: RunnableConfig) -> dict[str, Any]:
    """Call the LLM with the current message history."""
    model = _make_model()
    messages = list(state["messages"])

    # Ensure system message is first
    if not messages or not isinstance(messages[0], SystemMessage):
        sys_msg = _build_system_message(state)
        messages = [sys_msg] + messages

    # Trim to last ~20 message pairs to prevent unbounded context growth
    # (preserves system message + recent history)
    if len(messages) > 41:
        trimmed = [messages[0]] + messages[-40:]
        messages = trimmed

    response = model.invoke(messages, config)
    return {"messages": [response], "turn_count": state.get("turn_count", 0) + 1}


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
    """Check token budget after an agent turn."""
    used = state.get("budget_used", 0)
    warned = state.get("budget_warned", False)
    turn_tokens = _count_turn_tokens(state["messages"])
    used += turn_tokens

    updates: dict[str, Any] = {"budget_used": used}
    if used >= FORCE_THRESHOLD and not warned:
        updates["budget_warned"] = True
        updates["messages"] = [
            SystemMessage(
                content=f"TOKEN WARNING: {used} / {FORCE_THRESHOLD} tokens used. "
                f"Start wrapping up and prepare your Handoff."
            )
        ]
    elif used >= FORCE_THRESHOLD:
        updates["messages"] = [
            SystemMessage(
                content=f"TOKEN LIMIT REACHED: {used} / {FORCE_THRESHOLD} tokens. "
                f"You MUST exit now via broker_submit_handoff_tool with status=context_exhausted."
            )
        ]
        updates["status"] = "context_exhausted"
    return updates


def should_continue(state: DevState) -> Literal["tools", "agent", "force_handoff", "__end__"]:
    """Route after the agent node."""
    last = state["messages"][-1]

    # If the last message is a tool result for submit_handoff, we're done
    if isinstance(last, ToolMessage) and last.name == "broker_submit_handoff_tool":
        return END

    # Hard turn cap — force exit to prevent infinite loops
    turn_count = state.get("turn_count", 0)
    if turn_count >= MAX_TURNS_PER_DEV:
        return END

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
    """Execute tool calls."""
    tool_node = ToolNode(_get_cached_tools())
    result = tool_node.invoke(state)
    # Track tool calls for loop detection
    msgs = result.get("messages", state.get("messages", []))
    recent = list(state.get("recent_tool_calls", []))
    for msg in msgs:
        if isinstance(msg, AIMessage) and msg.tool_calls:
            for tc in msg.tool_calls:
                recent.append({
                    "name": tc.get("name"),
                    "args": tc.get("args", tc.get("arguments", {})),
                })
    # Keep only the last N
    recent = recent[-DUPLICATE_TOOL_WINDOW:]
    result["recent_tool_calls"] = recent
    return result


def force_handoff_node(state: DevState) -> dict[str, Any]:
    """Programmatically submit a handoff when the agent failed to do so at budget limit."""
    from agent_harness.broker import submit_handoff

    plan_id = state["plan_id"]
    subtask_id = state["subtask_id"]

    record = submit_handoff(
        plan_id=plan_id,
        subtask_id=subtask_id,
        status="context_exhausted",
        handoff_to="next_dev",
        state_notes=["Forced handoff: developer token budget exhausted."],
    )

    return {
        "messages": [
            ToolMessage(
                content=json.dumps({"submitted": record, "forced": True}),
                name="broker_submit_handoff_tool",
                tool_call_id="forced-handoff",
            )
        ],
        "status": "context_exhausted",
    }


def build_developer_graph(checkpointer: Any | None = None):
    """Build and compile the ephemeral developer ReAct graph."""
    builder = StateGraph(DevState)
    builder.add_node("agent", agent_node)
    builder.add_node("tools", tools_node)
    builder.add_node("budget_guard", budget_guard_node)
    builder.add_node("force_handoff", force_handoff_node)

    builder.set_entry_point("agent")
    builder.add_conditional_edges(
        "agent",
        should_continue,
        {"tools": "tools", "agent": "agent", "force_handoff": "force_handoff", END: END},
    )
    builder.add_edge("tools", "budget_guard")
    builder.add_edge("budget_guard", "agent")
    builder.add_edge("force_handoff", END)

    return builder.compile(checkpointer=checkpointer)


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
