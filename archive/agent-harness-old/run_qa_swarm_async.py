#!/usr/bin/env python3
"""Run 3 QA swarm lanes concurrently with asyncio (keeps process alive)."""
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
from agent_harness.broker import sync_plans_to_db, claim_plan, get_events, get_plan
from agent_harness.swarm.lane_runner import run_lane, get_lane_status, list_running_lanes

PLAN_IDS = [
    "qa-swarm-bugfix/api-correctness.md",
    "qa-swarm-bugfix/observability-finish.md",
    "qa-swarm-bugfix/stub-to-real.md",
]


async def monitor_lanes(interval: float = 5.0):
    """Background task: print lane status every N seconds."""
    while True:
        await asyncio.sleep(interval)
        lanes = list_running_lanes()
        if not lanes:
            break
        print(f"\n[{time.strftime('%H:%M:%S')}] {len(lanes)} lane(s) running:")
        for lane in lanes:
            lane_id = lane["lane_id"]
            status = get_lane_status(lane_id)
            print(f"  {lane_id}: subtask={status.get('current_subtask_id')} next={status.get('next_node')} budget={status.get('budget_used', 0)}")


async def run_single_lane(plan_id: str) -> dict:
    lane_id = f"lane-{plan_id.replace('/', '-')}"
    print(f"\n🚀 [{lane_id}] Starting {plan_id}...")

    try:
        final_state = await run_lane(plan_id, lane_id)
        return {"lane_id": lane_id, "plan_id": plan_id, "state": final_state}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"lane_id": lane_id, "plan_id": plan_id, "error": str(e)}


async def main():
    print("=" * 60)
    print("PIPE-OS QA SWARM — 3 Lanes Async")
    print("=" * 60)

    init_db("agent-harness/.swarm/broker.db")
    sync_plans_to_db()

    # Claim plans
    for pid in PLAN_IDS:
        lane_id = f"lane-{pid.replace('/', '-')}"
        ok = claim_plan(pid, lane_id)
        print(f"Claim {pid}: {ok}")

    # Start monitor + lanes
    monitor_task = asyncio.create_task(monitor_lanes())
    lane_tasks = [asyncio.create_task(run_single_lane(pid)) for pid in PLAN_IDS]

    # Wait for all lanes
    results = await asyncio.gather(*lane_tasks, return_exceptions=True)

    # Cancel monitor
    monitor_task.cancel()
    try:
        await monitor_task
    except asyncio.CancelledError:
        pass

    print("\n" + "=" * 60)
    print("ALL LANES COMPLETE")
    print("=" * 60)

    for result in results:
        if isinstance(result, Exception):
            print(f"\n❌ ERROR: {result}")
        elif "error" in result:
            print(f"\n❌ [{result['lane_id']}] FAILED: {result['error']}")
        elif result.get("state"):
            state = result["state"]
            status = state.get("status", "unknown")
            emoji = "✅" if status == "complete" else "⚠️"
            print(f"\n{emoji} [{result['lane_id']}] status={status}")
            print(f"   PR: {state.get('pr_url', 'N/A')}")
            print(f"   Handoffs: {len(state.get('handoff_chain', []))}")
        else:
            print(f"\n⚠️ [{result['lane_id']}] No final state")


if __name__ == "__main__":
    asyncio.run(main())
