"""Lane runner — standalone module for spawning and managing lane graphs.

Used by both the MCP server (server.py) and the Orchestrator agent.
"""
from __future__ import annotations

import asyncio
import concurrent.futures
import threading
import time
from typing import Any

from langchain_core.messages import SystemMessage

from agent_harness.swarm.graph import build_lane_graph, _init_work_items
from agent_harness.swarm.checkpoint import get_checkpointer, get_ephemeral_checkpointer
from agent_harness.broker import emit as broker_emit, get_conn


# Thread-pool for lanes started from sync contexts (e.g. orchestrator agent)
_lane_executor: concurrent.futures.ThreadPoolExecutor | None = None
_lane_tasks: dict[str, asyncio.Task | concurrent.futures.Future] = {}
_lane_results: dict[str, dict[str, Any]] = {}
_lane_checkpointer = get_checkpointer()
_LANE_HISTORY_TTL_SECONDS = 60

# Track which plan_id has an active lane (guard against duplicate lanes)
_plan_to_lane: dict[str, str] = {}


def _get_lane_executor() -> concurrent.futures.ThreadPoolExecutor:
    global _lane_executor
    if _lane_executor is None:
        _lane_executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=10, thread_name_prefix="lane-runner-"
        )
    return _lane_executor


def _clear_lane_checkpoints(lane_id: str) -> None:
    """Delete stale checkpoints for this lane so LangGraph starts fresh."""
    try:
        conn = _lane_checkpointer.conn
        conn.execute(
            "DELETE FROM checkpoints WHERE thread_id = ?",
            (lane_id,),
        )
        conn.execute(
            "DELETE FROM writes WHERE thread_id = ?",
            (lane_id,),
        )
        conn.commit()
    except Exception:
        pass


_LANE_STALL_TIMEOUT_SECONDS = 20 * 60  # 20 min without progress = stall


async def run_lane(plan_id: str, lane_id: str) -> dict[str, Any]:
    """Run a single lane graph and return final state.

    Uses heartbeat-based stall detection instead of a fixed wall-clock timeout.
    The lane runs until completion as long as nodes keep emitting heartbeats.
    """
    import time as _time

    # Start fresh — old checkpoints corrupt resumed state
    _clear_lane_checkpoints(lane_id)

    # Ensure a lanes row exists so heartbeats register
    conn = get_conn()
    conn.execute(
        """
        INSERT OR REPLACE INTO lanes (lane_id, plan_id, status, started_at, last_heartbeat)
        VALUES (?, ?, ?, ?, ?)
        """,
        (lane_id, plan_id, "running", _time.time(), _time.time()),
    )
    conn.commit()
    conn.close()

    graph = build_lane_graph(checkpointer=_lane_checkpointer)
    work_items = _init_work_items(plan_id)
    initial = {
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

    def _stream():
        fs = None
        for event in graph.stream(initial, {"configurable": {"thread_id": lane_id}}, stream_mode="values"):
            fs = event
        return fs

    loop = asyncio.get_running_loop()
    future = loop.run_in_executor(None, _stream)

    # Poll heartbeat instead of using a fixed timeout.
    # The lane is alive as long as nodes keep writing heartbeats.
    last_heartbeat = _time.time()
    while not future.done():
        await asyncio.sleep(30)

        try:
            conn = get_conn()
            row = conn.execute(
                "SELECT last_heartbeat FROM lanes WHERE lane_id = ?",
                (lane_id,),
            ).fetchone()
            conn.close()
            if row and row["last_heartbeat"]:
                last_heartbeat = max(last_heartbeat, row["last_heartbeat"])
        except Exception:
            pass

        stall = _time.time() - last_heartbeat
        if stall >= _LANE_STALL_TIMEOUT_SECONDS:
            print(f"[STALL] {lane_id} stalled: no heartbeat for {stall:.0f}s", flush=True)
            # Mark stalled in DB and return
            conn = get_conn()
            conn.execute(
                "UPDATE lanes SET status = ? WHERE lane_id = ?",
                ("failed", lane_id),
            )
            conn.commit()
            conn.close()
            return {
                "status": "failed",
                "messages": [SystemMessage(content=f"Lane stalled: no heartbeat for {stall:.0f}s")],
            }

    # Lane finished normally
    result = future.result()
    final_status = result.get("status", "unknown")
    print(f"[LANE DONE] {lane_id} status={final_status}", flush=True)
    conn = get_conn()
    conn.execute(
        "UPDATE lanes SET status = ? WHERE lane_id = ?",
        ("stopped", lane_id),
    )
    conn.commit()
    conn.close()
    return result


def _cleanup_zombie_lanes(plan_id: str) -> None:
    """Mark stale DB lanes as stopped and evict dead tasks from memory."""
    # Evict finished tasks from memory
    for lid, t in list(_lane_tasks.items()):
        if t.done():
            _lane_tasks.pop(lid, None)

    # Mark DB lanes older than 5 min without heartbeat as stopped
    try:
        conn = get_conn()
        stale = conn.execute(
            "SELECT lane_id FROM lanes WHERE plan_id = ? AND status = 'running' AND (last_heartbeat < ? OR started_at < ?)",
            (plan_id, time.time() - 300, time.time() - 600),
        ).fetchall()
        for row in stale:
            conn.execute("UPDATE lanes SET status = 'stopped' WHERE lane_id = ?", (row["lane_id"],))
        conn.commit()
        conn.close()
    except Exception:
        pass


def start_lane(plan_id: str, lane_id: str) -> asyncio.Task | concurrent.futures.Future:
    """Start a lane as a background task. Returns the Task or Future object."""
    # Guard 1: only one lane per plan_id
    existing_lane = _plan_to_lane.get(plan_id)
    if existing_lane and existing_lane in _lane_tasks and not _lane_tasks[existing_lane].done():
        raise RuntimeError(f"Plan {plan_id} already has running lane {existing_lane}")

    # Guard 2: dedupe by lane_id
    if lane_id in _lane_tasks and not _lane_tasks[lane_id].done():
        raise RuntimeError(f"Lane {lane_id} is already running")

    # Guard 3: clean up zombie lanes for this plan
    _cleanup_zombie_lanes(plan_id)

    try:
        loop = asyncio.get_running_loop()
        task = loop.create_task(run_lane(plan_id, lane_id), name=lane_id)
    except RuntimeError:
        # No running event loop (e.g. orchestrator agent in a thread-pool thread).
        # Use a thread-pool executor to run the lane.
        task = _get_lane_executor().submit(_run_lane_sync, plan_id, lane_id)

    _lane_tasks[lane_id] = task
    _plan_to_lane[plan_id] = lane_id

    def _on_done(t: Any) -> None:
        _lane_tasks.pop(lane_id, None)
        _plan_to_lane.pop(plan_id, None)
        try:
            final = t.result()
            # Always mark successful completion as "completed" regardless of
            # what the final state dict claims (LangGraph doesn't auto-set it).
            _lane_results[lane_id] = {"status": "completed", "result": final, "finished_at": time.time()}
            broker_emit(event_type="lane_finished", plan_id=plan_id, lane_id=lane_id, payload={"status": "completed"})
        except (asyncio.CancelledError, concurrent.futures.CancelledError):
            _lane_results[lane_id] = {"status": "cancelled", "error": "cancelled", "finished_at": time.time()}
            broker_emit(event_type="lane_failed", plan_id=plan_id, lane_id=lane_id, payload={"error": "cancelled"})
        except Exception as e:
            _lane_results[lane_id] = {"status": "failed", "error": str(e), "finished_at": time.time()}
            broker_emit(event_type="lane_failed", plan_id=plan_id, lane_id=lane_id, payload={"error": str(e)})

    task.add_done_callback(_on_done)
    return task


def _run_lane_sync(plan_id: str, lane_id: str) -> dict[str, Any]:
    """Synchronous wrapper used by the thread-pool executor."""
    return asyncio.run(run_lane(plan_id, lane_id))


def stop_lane(lane_id: str) -> bool:
    """Cancel a running lane task. Returns True if cancelled."""
    task = _lane_tasks.get(lane_id)
    if task is None:
        return False
    if task.done():
        _lane_tasks.pop(lane_id, None)
        return False
    task.cancel()
    _lane_tasks.pop(lane_id, None)
    return True


def get_lane_status(lane_id: str) -> dict[str, Any]:
    """Get status of a lane task."""
    task = _lane_tasks.get(lane_id)
    if task is not None:
        elapsed = None
        if not task.done():
            # Try to get elapsed time from DB
            try:
                from agent_harness.broker.db import get_conn
                conn = get_conn()
                row = conn.execute("SELECT started_at FROM lanes WHERE lane_id = ?", (lane_id,)).fetchone()
                conn.close()
                if row and row["started_at"]:
                    elapsed = round(time.time() - row["started_at"], 1)
            except Exception:
                pass
            return {"lane_id": lane_id, "status": "running", "elapsed_seconds": elapsed}
        try:
            final = task.result()
            return {"lane_id": lane_id, "status": "completed", "result": final}
        except (asyncio.CancelledError, concurrent.futures.CancelledError):
            return {"lane_id": lane_id, "status": "cancelled"}
        except Exception as e:
            return {"lane_id": lane_id, "status": "failed", "error": str(e)}

    # Check history for recently finished lanes
    hist = _lane_results.get(lane_id)
    if hist is not None:
        if time.time() - hist["finished_at"] > _LANE_HISTORY_TTL_SECONDS:
            _lane_results.pop(lane_id, None)
            return {"lane_id": lane_id, "status": "not_found"}
        return {
            "lane_id": lane_id,
            "status": hist["status"],
            "result": hist.get("result"),
            "error": hist.get("error"),
        }

    return {"lane_id": lane_id, "status": "not_found"}


def list_running_lanes() -> list[dict[str, Any]]:
    """List all currently running lanes."""
    running = [
        {"lane_id": lid, "status": "running"}
        for lid, task in _lane_tasks.items()
        if not task.done()
    ]
    # Also include recently finished lanes so users can see completion status
    now = time.time()
    for lid, hist in list(_lane_results.items()):
        if now - hist["finished_at"] <= _LANE_HISTORY_TTL_SECONDS:
            running.append({"lane_id": lid, "status": hist["status"]})
        else:
            _lane_results.pop(lid, None)
    return running


def lane_id_from_plan_id(plan_id: str) -> str:
    """Generate a lane_id from a plan_id."""
    return f"lane-{plan_id.replace('/', '-')}"
