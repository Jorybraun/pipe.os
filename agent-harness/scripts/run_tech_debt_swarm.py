#!/usr/bin/env python3
"""Run the tech-debt swarm in isolation (edits go to SWARM_SUBTREE)."""
import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from agent_harness.broker import init_db, sync_plans_to_db
from agent_harness.swarm.graph import Orchestrator
from agent_harness.swarm.checkpoint import get_checkpointer


async def main():
    init_db()
    synced = sync_plans_to_db()
    print(f"[sync] {synced}", flush=True)

    orch = Orchestrator(
        max_lanes=4,
        checkpointer=get_checkpointer(),
        part_prefix="tech-debt/",
        max_plans=4,
    )

    print("[swarm] Starting tech-debt swarm...", flush=True)

    # Run the orchestrator tick loop manually so we can log progress
    while True:
        results = await orch.tick()
        if results:
            for r in results:
                print(f"[tick-result] {r}", flush=True)

        running = list(orch._running.keys())
        if running:
            print(f"[running] {len(running)} lane(s): {running}", flush=True)
        elif orch._plans_claimed >= 4:
            print("[swarm] All claimed plans finished.", flush=True)
            break
        elif not running and orch._plans_claimed == 0:
            # Nothing claimed yet — maybe plans aren't runnable
            print("[swarm] No lanes running and nothing claimed yet. Waiting...", flush=True)

        await asyncio.sleep(5)

    print("[swarm] Done.", flush=True)


if __name__ == "__main__":
    asyncio.run(main())
