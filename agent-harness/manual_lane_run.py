#!/usr/bin/env python3
"""Manual lane runner — watch every node execute step by step."""
import asyncio
import json
import time

from agent_harness.broker.db import init_db
from agent_harness.broker import sync_plans_to_db, claim_plan, emit, get_plan
from agent_harness.swarm.graph import build_lane_graph, _init_work_items
from agent_harness.swarm.checkpoint import get_checkpointer

PLAN_ID = "part2-role-discovery/phase0-cockpit-rcd-cutover.md"
LANE_ID = f"lane-{PLAN_ID.replace('/', '-')}"


def main():
    import os
    # Developer tools use CWD as root_dir — must be repo root
    repo_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    os.chdir(repo_root)
    print("=== MANUAL LANE RUNNER ===")
    print(f"Plan: {PLAN_ID}")
    print(f"CWD: {os.getcwd()}")
    print()

    # Init
    init_db()
    sync_plans_to_db()
    claim_plan(PLAN_ID, LANE_ID)

    # Build graph (no checkpointer — in-memory, no persistence conflicts)
    graph = build_lane_graph(checkpointer=None)
    work_items = _init_work_items(PLAN_ID)

    print(f"Work items: {len(work_items)}")
    for wi in work_items:
        print(f"  - {wi['subtask_id']}: {wi['title']}")
    print()

    initial_state = {
        "messages": [],
        "plan_path": "",
        "plan_id": PLAN_ID,
        "lane_id": LANE_ID,
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

    config = {"configurable": {"thread_id": LANE_ID}}

    print("Streaming lane graph...")
    print("-" * 60)

    step = 0
    final_state = None
    for event in graph.stream(initial_state, config, stream_mode="values"):
        step += 1
        final_state = event

        # Print what changed
        msgs = event.get("messages", [])
        if msgs:
            last_msg = msgs[-1]
            content = getattr(last_msg, "content", "")
            if content:
                print(f"\n[Step {step}] Message: {content[:200]}...")

        next_node = event.get("next_node", "?")
        status = event.get("status", "?")
        subtask = event.get("current_subtask_id", "?")
        guidance = event.get("advisor_guidance")
        budget = event.get("plan_budget_used", 0)

        print(f"[Step {step}] next_node={next_node} status={status} subtask={subtask} budget={budget}")
        if guidance:
            print(f"[Step {step}] Advisor guidance: {guidance[:200]}...")

        # Print work item statuses
        for wi in event.get("work_items", []):
            if wi["status"] != "pending":
                print(f"[Step {step}] Work item {wi['subtask_id']}: {wi['status']}")

    print("-" * 60)
    print("LANE FINISHED")
    print(f"Final status: {final_state.get('status')}")
    print(f"Final pr_url: {final_state.get('pr_url')}")
    print(f"Handoff chain length: {len(final_state.get('handoff_chain', []))}")

    # Check for events in broker
    print("\nRecent broker events:")
    events = __import__("agent_harness.broker", fromlist=["get_events"]).get_events(since=time.time() - 300, limit=20)
    for e in events:
        print(f"  [{e.get('event_type')}] plan={e.get('plan_id')} lane={e.get('lane_id')}")


if __name__ == "__main__":
    main()
