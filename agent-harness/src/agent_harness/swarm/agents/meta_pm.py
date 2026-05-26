"""Meta-PM — top-level strategic agent that sees all plans and decides execution order."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from agent_harness.broker import (
    list_plans,
    runnable_set,
    conflicts_for,
    get_plan,
    get_events,
    read_cues,
    sync_plans_to_db,
    claim_plan,
    post_cue,
)


def _load_prompt() -> str:
    path = Path(__file__).parent.parent / "prompts" / "meta_pm.md"
    if path.exists():
        return path.read_text()
    return "# Meta-PM\nStrategic agent that decides execution order for the swarm."


def _make_model() -> ChatOpenAI:
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY or OPENAI_API_KEY not set")
    # Allow a dedicated model for the Meta-PM (e.g. kimi-k2-6 for stronger reasoning)
    model = os.getenv("KIMI_META_PM_MODEL") or os.getenv("KIMI_STRATEGIC_MODEL") or os.getenv("KIMI_DEV_MODEL") or os.getenv("KIMI_MODEL", "kimi-k2-6")
    default_base = (
        "https://api.kimi.com/coding/v1"
        if model == "kimi-for-coding"
        else "https://api.moonshot.cn/v1"
    )
    base_url = os.getenv("KIMI_DEV_BASE_URL") or os.getenv("KIMI_BASE_URL", default_base)
    return ChatOpenAI(
        model=model,
        temperature=0.3,
        max_tokens=4096,
        api_key=api_key,
        base_url=base_url,
        timeout=120,
        max_retries=2,
        default_headers={
            "User-Agent": "claude-code/0.1",
            "x-stainless-os": "MacOS",
            "x-stainless-arch": "arm64",
            "x-stainless-runtime": "python",
            "x-stainless-runtime-version": "3.12",
        },
        extra_body={"reasoning": None},
    )


def _get_meta_pm_tools() -> list[Any]:
    """Tools the Meta-PM uses to observe and steer the swarm."""
    from langchain_core.tools import tool

    @tool
    def broker_list_plans_tool(filter_status: str = "") -> str:
        """List all strategy-v2 plans with optional status filter."""
        plans = list_plans(status=filter_status or None)
        return json.dumps({
            "count": len(plans),
            "plans": [
                {
                    "plan_id": p["plan_id"],
                    "title": p["title"],
                    "phase": p["phase"],
                    "status": p["status"],
                    "estimate": p["estimate"],
                }
                for p in plans
            ],
        }, indent=2)

    @tool
    def broker_runnable_set_tool() -> str:
        """Return the set of plan_ids that are runnable right now."""
        plan_ids = runnable_set()
        return json.dumps({"count": len(plan_ids), "plan_ids": plan_ids}, indent=2)

    @tool
    def broker_conflicts_for_tool(plan_id: str) -> str:
        """Return file-path and migration-number conflicts for a plan."""
        result = conflicts_for(plan_id)
        return json.dumps(result, indent=2)

    @tool
    def broker_get_plan_tool(plan_id: str) -> str:
        """Get full plan content including subtasks, dependencies, and files."""
        plan = get_plan(plan_id)
        if not plan:
            return json.dumps({"error": f"Plan not found: {plan_id}"})
        return json.dumps(plan, indent=2)

    @tool
    def broker_get_events_tool(
        event_type: str = "",
        plan_id: str = "",
        lane_id: str = "",
        since: float = 0.0,
        limit: int = 100,
    ) -> str:
        """Query recent events from the broker event bus."""
        rows = get_events(
            event_type=event_type or None,
            plan_id=plan_id or None,
            lane_id=lane_id or None,
            since=since,
            limit=limit,
        )
        return json.dumps({"count": len(rows), "events": rows}, indent=2)

    @tool
    def broker_read_cues_tool(plan_id: str = "", lane_id: str = "", since: float = 0.0) -> str:
        """Read pending (unacked) steering cues."""
        rows = read_cues(
            plan_id=plan_id or None,
            lane_id=lane_id or None,
            since=since,
        )
        return json.dumps({"count": len(rows), "cues": rows}, indent=2)

    @tool
    def broker_sync_plans_tool() -> str:
        """Re-scan knowledge/plan/strategy-v2/**/*.md and sync to the broker database."""
        result = sync_plans_to_db()
        return json.dumps({"synced": result}, indent=2)

    @tool
    def broker_claim_plan_tool(plan_id: str) -> str:
        """Atomically claim a PENDING plan so it can be dispatched."""
        ok = claim_plan(plan_id, lane_id=f"meta-pm-{plan_id}")
        return json.dumps({"claimed": ok, "plan_id": plan_id}, indent=2)

    @tool
    def broker_post_cue_tool(content: str, plan_id: str = "", lane_id: str = "") -> str:
        """Post a steering cue to the swarm (deduped by content hash)."""
        result = post_cue(
            content=content,
            plan_id=plan_id or None,
            lane_id=lane_id or None,
        )
        return json.dumps(result, indent=2)

    return [
        broker_list_plans_tool,
        broker_runnable_set_tool,
        broker_conflicts_for_tool,
        broker_get_plan_tool,
        broker_get_events_tool,
        broker_read_cues_tool,
        broker_sync_plans_tool,
        broker_claim_plan_tool,
        broker_post_cue_tool,
    ]


def build_meta_pm_agent():
    """Build and return the Meta-PM ReAct agent."""
    model = _make_model()
    tools = _get_meta_pm_tools()
    prompt = _load_prompt()

    agent = create_react_agent(
        model=model,
        tools=tools,
        prompt=prompt,
    )
    return agent


def run_meta_pm(
    thread_id: str = "meta-pm",
    message: str = "Analyze the current swarm state and recommend next actions.",
) -> dict[str, Any]:
    """Run the Meta-PM agent and return its recommendation."""
    agent = build_meta_pm_agent()
    result = agent.invoke(
        {"messages": [{"role": "user", "content": message}]},
        config={"configurable": {"thread_id": thread_id}},
    )
    return result
