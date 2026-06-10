#!/usr/bin/env python3
"""Run 3 QA swarm lanes in parallel."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import time
from pathlib import Path

repo_root = Path(__file__).resolve().parent.parent
os.chdir(repo_root)
sys.path.insert(0, str(repo_root / "agent-harness/src"))

from agent_harness.broker.db import init_db
from agent_harness.broker import sync_plans_to_db, claim_plan, emit, get_plan
from agent_harness.swarm.graph import build_lane_graph, _init_work_items
from agent_harness.swarm.checkpoint import get_checkpointer

PLAN_IDS = [
    "qa-swarm-bugfix/api-correctness.md",
    "qa-swarm-bugfix/observability-finish.md",
    "qa-swarm-bugfix/stub-to-real.md",
]


async def run_lane(plan_id: str):
    lane_id = f"lane-{plan_id.replace('/', '-')}"
    print(f"\n🚀 [{lane_id}] Starting...")

    claim_plan(plan_id, lane_id)
    plan = get_plan(plan_id)
    work_items = _init_work_items(plan_id)

    print(f"   Plan: {plan.get('title', plan_id)}")
    print(f"   Work items: {len(work_items)}")
    for wi in work_items:
        print(f"     - {wi['subtask_id']}: {wi['title']}")

    graph = build_lane_graph(checkpointer=get_checkpointer())

    initial_state = {
        "messages": [],
        "plan_path": "",
        "plan_id": plan_id,
        "lane_id": lane_id,
        "work_items": work_items,
        "current_subtask_id": None,
        "current_handoff": None,
        "handoff_chain": [],
        "reserved_migrations": [],
        "pr_url": None,
        "plan_budget_used": 0,
        "iteration": 0,
        "status": "running",
        "advisor_guidance": None,
        "next_node": "supervisor",
    }

    config = {"configurable": {"thread_id": lane_id}}

    step = 0
    final_state = None
    try:
        for event in graph.stream(initial_state, config, stream_mode="values"):
            step += 1
            final_state = event

            msgs = event.get("messages", [])
            if msgs:
                last_msg = msgs[-1]
                content = getattr(last_msg, "content", "")
                if content:
                    print(f"\n   [{lane_id}] Step {step}: {content[:200]}...")

            next_node = event.get("next_node", "?")
            status = event.get("status", "?")
            subtask = event.get("current_subtask_id", "?")
            budget = event.get("plan_budget_used", 0)

            print(f"   [{lane_id}] Step {step}: next={next_node} status={status} subtask={subtask} budget={budget}")

            for wi in event.get("work_items", []):
                if wi["status"] != "pending":
                    print(f"   [{lane_id}] Work item {wi['subtask_id']}: {wi['status']}")

            if status in ("complete", "failed", "escalated"):
                break
    except Exception as e:
        print(f"\n   [{lane_id}] ERROR: {e}")
        import traceback
        traceback.print_exc()

    print(f"\n🏁 [{lane_id}] FINISHED")
    if final_state:
        print(f"   Final status: {final_state.get('status')}")
        print(f"   PR URL: {final_state.get('pr_url')}")
        print(f"   Handoffs: {len(final_state.get('handoff_chain', []))}")
    return final_state


async def main():
    print("=" * 60)
    print("PIPE-OS QA SWARM — 3 Lanes Parallel")
    print("=" * 60)

    init_db("agent-harness/.swarm/broker.db")
    sync_plans_to_db()

    # Run all 3 lanes concurrently
    results = await asyncio.gather(
        run_lane(PLAN_IDS[0]),
        run_lane(PLAN_IDS[1]),
        run_lane(PLAN_IDS[2]),
        return_exceptions=True,
    )

    print("\n" + "=" * 60)
    print("ALL LANES COMPLETE")
    print("=" * 60)
    for i, (plan_id, result) in enumerate(zip(PLAN_IDS, results)):
        lane_id = f"lane-{plan_id.replace('/', '-')}"
        if isinstance(result, Exception):
            print(f"\n❌ [{lane_id}] FAILED with exception:")
            print(f"   {result}")
        elif result:
            status = result.get("status", "unknown")
            emoji = "✅" if status == "complete" else "⚠️"
            print(f"\n{emoji} [{lane_id}] status={status}")
            print(f"   PR: {result.get('pr_url', 'N/A')}")
        else:
            print(f"\n⚠️ [{lane_id}] No final state")


if __name__ == "__main__":
    asyncio.run(main())
