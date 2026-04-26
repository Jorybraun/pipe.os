"""Orchestrator Agent — the CEO of the swarm.

Built on DeepAgents (LangGraph) with custom broker tools for full swarm control.
"""
from __future__ import annotations

import json
import os
from typing import Any

from langchain_core.tools import tool
from langchain_openai import ChatOpenAI
from deepagents import create_deep_agent

# ---------------------------------------------------------------------------
# Patch: Kimi API requires reasoning_content on assistant messages with
# tool_calls, but LangChain doesn't preserve it. We need to:
# 1. Save reasoning_content from API responses into additional_kwargs
# 2. Include reasoning_content when serializing messages back to dict
# ---------------------------------------------------------------------------
from langchain_openai.chat_models import base as _openai_base

_original_msg_to_dict = _openai_base._convert_message_to_dict
_original_dict_to_msg = _openai_base._convert_dict_to_message


def _patched_convert_dict_to_message(_dict):
    msg = _original_dict_to_msg(_dict)
    if _dict.get("role") == "assistant" and "reasoning_content" in _dict:
        # Store reasoning_content so it survives round-trips
        msg.additional_kwargs["reasoning_content"] = _dict["reasoning_content"]
    return msg


def _patched_convert_message_to_dict(message, api="chat/completions"):
    result = _original_msg_to_dict(message, api=api)
    if result.get("role") == "assistant":
        # Prefer stored reasoning_content, fallback to empty string
        rc = message.additional_kwargs.get("reasoning_content", "")
        if rc or "reasoning_content" not in result:
            result["reasoning_content"] = rc
    return result


_openai_base._convert_dict_to_message = _patched_convert_dict_to_message
_openai_base._convert_message_to_dict = _patched_convert_message_to_dict

from agent_harness.broker import (
    list_plans,
    runnable_set,
    get_plan,
    claim_plan,
    conflicts_for,
    get_events,
    post_cue,
    read_cues,
    list_interrupts,
    get_conn,
)
from agent_harness.swarm.lane_runner import (
    start_lane,
    stop_lane,
    get_lane_status,
    list_running_lanes,
    lane_id_from_plan_id,
)
from deepagents.middleware._tool_exclusion import _ToolExclusionMiddleware


def _make_model() -> ChatOpenAI:
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY or OPENAI_API_KEY not set")
    return ChatOpenAI(
        model=os.getenv("KIMI_MODEL", "kimi-for-coding"),
        temperature=0.3,
        max_tokens=4096,
        api_key=api_key,
        base_url=os.getenv("KIMI_BASE_URL", "https://api.kimi.com/coding/v1"),
        model_kwargs={"extra_headers": {"User-Agent": "claude-code/0.1"}},
        extra_body={"reasoning": None},  # Disable reasoning to avoid 400 on tool calls
    )


# ---------------------------------------------------------------------------
# Orchestrator tools
# ---------------------------------------------------------------------------

@tool
def get_swarm_status() -> str:
    """Get a comprehensive snapshot of the entire swarm state.

    Returns: plan counts, runnable plans, active lanes, recent events,
    active interrupts, and pending cues.
    """
    try:
        plans = list_plans()
        runnable = runnable_set()
        conn = get_conn()
        lanes_rows = conn.execute(
            "SELECT lane_id, plan_id, status, started_at, last_heartbeat, budget_used FROM lanes WHERE status = 'running'"
        ).fetchall()
        lanes = [dict(row) for row in lanes_rows]
        conn.close()

        import time
        recent_events = get_events(since=time.time() - 3600, limit=20)
        interrupts = list_interrupts()
        cues = read_cues(since=time.time() - 3600)

        return json.dumps({
            "plans": {"total": len(plans), "runnable": len(runnable), "needs_refinement": sum(1 for p in plans if p.get("status") == "NEEDS-REFINEMENT")},
            "lanes": {"active": lanes, "count": len(lanes)},
            "recent_events": {"count": len(recent_events), "events": [{"event_type": e.get("event_type"), "plan_id": e.get("plan_id"), "lane_id": e.get("lane_id")} for e in recent_events[-10:]]},
            "active_interrupts": interrupts,
            "recent_cues": {"count": len(cues), "cues": cues[:5]},
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def claim_runnable_plan(plan_id: str) -> str:
    """Atomically claim a runnable plan so it can be dispatched as a lane.

    Args:
        plan_id: The plan ID to claim (e.g., "part2-candidate-ingestion/candidate-nodes-schema")
    """
    try:
        ok = claim_plan(plan_id, lane_id=f"lane-{plan_id.replace('/', '-')}")
        return json.dumps({"claimed": ok, "plan_id": plan_id}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def list_all_plans(filter_status: str = "") -> str:
    """List all strategy-v2 plans with optional status filter.

    Args:
        filter_status: Optional status filter (e.g., "PENDING", "DONE", "NEEDS-REFINEMENT")
    """
    try:
        plans = list_plans(status=filter_status or None)
        return json.dumps({
            "count": len(plans),
            "plans": [{"plan_id": p["plan_id"], "title": p["title"], "phase": p["phase"], "status": p["status"]} for p in plans[:20]],
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def list_runnable_plans() -> str:
    """Return the set of plan_ids that are runnable right now.

    A plan is runnable when: status is PENDING, all dependencies are DONE,
    and it is not flagged NEEDS-REFINEMENT.
    """
    try:
        plan_ids = runnable_set()
        return json.dumps({"count": len(plan_ids), "plan_ids": plan_ids[:20]}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def get_plan_details(plan_id: str) -> str:
    """Get full plan content including subtasks, dependencies, and files.

    Args:
        plan_id: The plan ID to look up.
    """
    try:
        plan = get_plan(plan_id)
        if not plan:
            return json.dumps({"error": f"Plan not found: {plan_id}"})
        return json.dumps(plan, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def check_conflicts(plan_id: str) -> str:
    """Return file-path and migration-number conflicts for a plan.

    Args:
        plan_id: The plan ID to check.
    """
    try:
        result = conflicts_for(plan_id)
        return json.dumps(result, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def post_steering_cue(content: str, plan_id: str = "", lane_id: str = "") -> str:
    """Post a steering cue to the swarm (deduped by content hash).

    Args:
        content: The cue content / instruction.
        plan_id: Optional target plan_id.
        lane_id: Optional target lane_id.
    """
    try:
        result = post_cue(content=content, plan_id=plan_id or None, lane_id=lane_id or None)
        return json.dumps(result, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def get_recent_events(since_minutes: int = 60, limit: int = 20) -> str:
    """Query recent events from the broker event bus.

    Args:
        since_minutes: How many minutes back to look.
        limit: Max events to return.
    """
    try:
        import time
        events = get_events(since=time.time() - since_minutes * 60, limit=limit)
        return json.dumps({"count": len(events), "events": [{"event_type": e.get("event_type"), "plan_id": e.get("plan_id"), "lane_id": e.get("lane_id"), "emitted_at": e.get("emitted_at")} for e in events]}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def escalate_to_human(plan_id: str, reason: str) -> str:
    """Escalate a plan to human-in-the-loop. Pauses the lane until resume.

    Args:
        plan_id: The plan to escalate.
        reason: Why human input is needed.
    """
    try:
        from agent_harness.broker.interrupt_registry import register_interrupt
        register_interrupt(plan_id=plan_id, thread_id=plan_id, reason=reason)
        return json.dumps({"escalated": True, "plan_id": plan_id, "reason": reason}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def get_active_interrupts() -> str:
    """List all active human-in-the-loop escalations."""
    try:
        interrupts = list_interrupts()
        return json.dumps({"count": len(interrupts), "interrupts": interrupts}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def start_lane_tool(plan_id: str) -> str:
    """Start a swarm lane for a specific plan.

    Args:
        plan_id: The plan ID to dispatch as a lane.
    """
    try:
        lane_id = lane_id_from_plan_id(plan_id)
        task = start_lane(plan_id, lane_id)
        return json.dumps({"started": True, "plan_id": plan_id, "lane_id": lane_id}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def stop_lane_tool(lane_id: str) -> str:
    """Stop a running lane.

    Args:
        lane_id: The lane ID to stop.
    """
    try:
        stopped = stop_lane(lane_id)
        return json.dumps({"stopped": stopped, "lane_id": lane_id}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def get_lane_status_tool(lane_id: str) -> str:
    """Get the status of a lane.

    Args:
        lane_id: The lane ID to query.
    """
    try:
        status = get_lane_status(lane_id)
        return json.dumps(status, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


@tool
def list_running_lanes_tool() -> str:
    """List all currently running lanes."""
    try:
        lanes = list_running_lanes()
        return json.dumps({"count": len(lanes), "lanes": lanes}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)})


_ORCHESTRATOR_SYSTEM_PROMPT = """You are the Swarm Orchestrator — the single CEO that controls everything.

You have full visibility into ALL plans, ALL lanes, ALL events, and ALL interrupts across the entire system. There is no one above you. You are the top of the pyramid.

Your responsibilities:
1. Answer the operator's questions about swarm status concisely and accurately.
2. Recommend which plans to start, stop, or steer.
3. When the operator wants action, use your tools to execute.
4. When you need human input, escalate via escalate_to_human.

Available tools:
- get_swarm_status() → full snapshot
- list_all_plans(filter_status?) → all plans
- list_runnable_plans() → plans ready to run
- get_plan_details(plan_id) → full plan content
- check_conflicts(plan_id) → file/migration conflicts
- claim_runnable_plan(plan_id) → claim a plan
- start_lane_tool(plan_id) → dispatch a lane
- stop_lane_tool(lane_id) → cancel a lane
- get_lane_status_tool(lane_id) → lane progress
- list_running_lanes_tool() → active lanes
- post_steering_cue(content, plan_id?, lane_id?) → steer a lane
- get_recent_events(since_minutes?, limit?) → recent events
- escalate_to_human(plan_id, reason) → pause for human input
- get_active_interrupts() → list escalations

Be decisive. The operator expects clear answers and direct action.

DO NOT use filesystem, shell, or todo tools. Use only the tools listed above.
"""


# DeepAgents injects filesystem, shell, todo, and subagent tools by default.
# The Orchestrator should ONLY use broker tools, so we strip the defaults.
_EXCLUDED_DEFAULT_TOOLS = frozenset({
    "write_todos",
    "ls",
    "read_file",
    "write_file",
    "edit_file",
    "glob",
    "grep",
    "execute",
    "task",
})


def build_orchestrator_agent():
    """Build and return the Orchestrator DeepAgent (LangGraph CompiledStateGraph)."""
    model = _make_model()
    tools = [
        get_swarm_status,
        list_all_plans,
        list_runnable_plans,
        get_plan_details,
        check_conflicts,
        claim_runnable_plan,
        start_lane_tool,
        stop_lane_tool,
        get_lane_status_tool,
        list_running_lanes_tool,
        post_steering_cue,
        get_recent_events,
        escalate_to_human,
        get_active_interrupts,
    ]
    return create_deep_agent(
        model=model,
        tools=tools,
        system_prompt=_ORCHESTRATOR_SYSTEM_PROMPT,
        name="orchestrator",
        middleware=[_ToolExclusionMiddleware(excluded=_EXCLUDED_DEFAULT_TOOLS)],
    )


def run_orchestrator(message: str, thread_id: str = "orchestrator-main") -> dict[str, Any]:
    """Run the Orchestrator agent and return its response.

    Returns {"response": str, "messages": list}.
    """
    agent = build_orchestrator_agent()
    result = agent.invoke(
        {"messages": [{"role": "user", "content": message}]},
        config={"configurable": {"thread_id": thread_id}},
    )
    messages = result.get("messages", [])
    response_text = ""
    for msg in reversed(messages):
        content = getattr(msg, "content", None) or getattr(msg, "text", None)
        if content:
            response_text = str(content)
            break
    return {"response": response_text, "messages": messages}
