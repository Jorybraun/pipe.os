#!/usr/bin/env python3
"""Phase 4 validation — handoff chain + multi-lane swarm topology."""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from langchain_core.messages import AIMessage, SystemMessage, ToolMessage

from agent_harness import config
from agent_harness.broker import init_db, get_handoff_chain, get_plan, sync_plans_to_db
from agent_harness.broker.db import get_conn
from agent_harness.swarm.checkpoint import get_checkpointer
from agent_harness.swarm.graph import (
    build_lane_graph,
    build_supervisor_graph,
    Supervisor,
    LaneState,
)
from agent_harness.swarm.agents import developer as dev_mod
from agent_harness.swarm.agents import qa_deploy as qa_mod

_TMPDIR = Path(tempfile.mkdtemp(prefix="validate_phase4_"))
config.DATA_DIR = _TMPDIR
DB_PATH = _TMPDIR / "broker.db"
CHECKPOINT_PATH = _TMPDIR / "checkpoints.db"


def setup():
    db = Path(DB_PATH)
    if db.exists():
        db.unlink()
    init_db(str(DB_PATH))
    for p in [Path(CHECKPOINT_PATH)]:
        if p.exists():
            p.unlink()
        for ext in ("-wal", "-shm"):
            wal = p.parent / (p.name + ext)
            if wal.exists():
                wal.unlink()


def _insert_plan(plan_id: str, title: str, subtasks: list[dict], files: list[str] | None = None):
    """Insert a synthetic plan into the broker DB."""
    conn = get_conn()
    now = __import__("time").time()
    conn.execute(
        """
        INSERT OR REPLACE INTO plans (plan_id, plan_path, title, status, parsed_at)
        VALUES (?, ?, ?, ?, ?)
        """,
        (plan_id, f"docs/plans/strategy-v2/{plan_id}", title, "PENDING", now),
    )
    conn.execute("DELETE FROM plan_subtasks WHERE plan_id = ?", (plan_id,))
    conn.execute("DELETE FROM plan_files WHERE plan_id = ?", (plan_id,))
    for st in subtasks:
        conn.execute(
            """
            INSERT INTO plan_subtasks (plan_id, subtask_id, title, spec, files, migrations, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                plan_id,
                st["subtask_id"],
                st.get("title", st["subtask_id"]),
                st.get("spec", ""),
                json.dumps(st.get("files", [])),
                json.dumps(st.get("migrations", [])),
                st.get("status", "PENDING"),
            ),
        )
    for f in files or []:
        conn.execute(
            "INSERT OR IGNORE INTO plan_files (plan_id, file_path) VALUES (?, ?)",
            (plan_id, f),
        )
    conn.commit()
    conn.close()


def _make_fake_dev(sequencer: dict):
    """Return a patched agent_node that consumes a per-(plan,subtask) queue."""
    def patched_agent_node(state, config):
        # If tool result already processed, return final response to end the graph
        if state["messages"] and isinstance(state["messages"][-1], ToolMessage):
            return {"messages": [AIMessage(content="Handoff submitted. Exiting.")]}

        key = (state["plan_id"], state["subtask_id"])
        seq = sequencer.setdefault(key, [])
        if not seq:
            # Default: complete
            action = {"status": "complete", "handoff_to": "qa_deploy", "context_used": 1000}
        else:
            action = seq.pop(0)

        tool_call = {
            "name": "broker_submit_handoff_tool",
            "args": {
                "plan_id": state["plan_id"],
                "subtask_id": state["subtask_id"],
                "status": action["status"],
                "handoff_to": action.get("handoff_to", "qa_deploy"),
                "done": json.dumps(action.get("done", [])),
                "next_actions": json.dumps(action.get("next_actions", [])),
                "context_used": action.get("context_used", 1000),
            },
            "id": f"call_{uuid.uuid4().hex[:8]}",
        }
        return {
            "messages": [
                AIMessage(
                    content=f"Handoff {action['status']}",
                    tool_calls=[tool_call],
                )
            ]
        }

    return patched_agent_node


def _make_fake_qa():
    def patched_qa_agent_node(state, config):
        # If tool result already processed, return final response to end the graph
        if state["messages"] and isinstance(state["messages"][-1], ToolMessage):
            return {"messages": [AIMessage(content="Event emitted. Exiting.")], "status": "complete"}

        tool_call = {
            "name": "broker_emit_event_tool",
            "args": {
                "event_type": "plan_completed",
                "plan_id": state["plan_id"],
            },
            "id": f"call_{uuid.uuid4().hex[:8]}",
        }
        return {
            "messages": [
                AIMessage(
                    content="QA complete. PR opened.",
                    tool_calls=[tool_call],
                )
            ]
        }
    return patched_qa_agent_node


def test_pm_node() -> bool:
    print("\n[test_pm_node] PM expansion...")
    plan_id = f"test-pm-{uuid.uuid4().hex[:8]}"
    _insert_plan(
        plan_id,
        "PM Test Plan",
        [
            {"subtask_id": "subtask-1", "title": "Add helper", "spec": "Write add(a,b)", "files": ["src/lib.ts"]},
            {"subtask_id": "subtask-2", "title": "Add test", "spec": "Write vitest", "files": ["src/lib.test.ts"]},
        ],
    )

    # Mock dev + QA so we don't need ANTHROPIC_API_KEY
    original_dev = dev_mod.agent_node
    original_qa = qa_mod.qa_agent_node
    dev_mod.agent_node = _make_fake_dev({(plan_id, "subtask-1"): [{"status": "complete", "handoff_to": "qa_deploy", "context_used": 1000}],
                                          (plan_id, "subtask-2"): [{"status": "complete", "handoff_to": "qa_deploy", "context_used": 1000}]})
    qa_mod.qa_agent_node = _make_fake_qa()

    try:
        cp = get_checkpointer(CHECKPOINT_PATH)
        graph = build_lane_graph(checkpointer=cp)
        initial: LaneState = {
            "messages": [],
            "plan_path": "",
            "plan_id": plan_id,
            "lane_id": f"lane-{plan_id}",
            "work_items": [],
            "current_subtask_id": None,
            "current_handoff": None,
            "handoff_chain": [],
            "reserved_migrations": [],
            "pr_url": None,
            "plan_budget_used": 0,
            "iteration": 0,
            "status": "running",
        }
        final_state = None
        for event in graph.stream(initial, {"configurable": {"thread_id": f"lane-{plan_id}"}}, stream_mode="values"):
            final_state = event

        assert final_state is not None
        work_items = final_state["work_items"]
        assert len(work_items) == 2, f"Expected 2 work items, got {len(work_items)}"
        assert work_items[0]["subtask_id"] == "subtask-1"
        assert work_items[1]["subtask_id"] == "subtask-2"
        print("  ✓ PM expanded 2 subtasks into work_items")
        return True
    finally:
        dev_mod.agent_node = original_dev
        qa_mod.qa_agent_node = original_qa


def test_graph_compiles() -> bool:
    print("\n[test_graph_compiles] Lane + Supervisor graph compilation...")
    lane_graph = build_lane_graph()
    assert lane_graph is not None
    supervisor_graph = build_supervisor_graph()
    assert supervisor_graph is not None
    print("  ✓ lane graph and supervisor graph compiled")
    return True


def test_handoff_chain() -> bool:
    print("\n[test_handoff_chain] Context-exhaust → fresh dev → complete...")
    plan_id = f"test-chain-{uuid.uuid4().hex[:8]}"
    _insert_plan(
        plan_id,
        "Handoff Chain Plan",
        [
            {"subtask_id": "subtask-1", "title": "Big task", "spec": "Lots of work", "files": ["src/a.ts"]},
            {"subtask_id": "subtask-2", "title": "Small task", "spec": "Finish up", "files": ["src/b.ts"]},
        ],
    )

    sequencer = {
        (plan_id, "subtask-1"): [
            {"status": "context_exhausted", "handoff_to": "next_dev", "context_used": 79000},
            {"status": "complete", "handoff_to": "qa_deploy", "context_used": 15000},
        ],
        (plan_id, "subtask-2"): [
            {"status": "complete", "handoff_to": "qa_deploy", "context_used": 5000},
        ],
    }

    original_dev = dev_mod.agent_node
    original_qa = qa_mod.qa_agent_node
    dev_mod.agent_node = _make_fake_dev(sequencer)
    qa_mod.qa_agent_node = _make_fake_qa()

    try:
        cp = get_checkpointer(CHECKPOINT_PATH)
        graph = build_lane_graph(checkpointer=cp)
        initial: LaneState = {
            "messages": [],
            "plan_path": "",
            "plan_id": plan_id,
            "lane_id": f"lane-{plan_id}",
            "work_items": [],
            "current_subtask_id": None,
            "current_handoff": None,
            "handoff_chain": [],
            "reserved_migrations": [],
            "pr_url": None,
            "plan_budget_used": 0,
            "iteration": 0,
            "status": "running",
        }
        final_state = None
        for event in graph.stream(initial, {"configurable": {"thread_id": f"lane-{plan_id}"}}, stream_mode="values"):
            final_state = event

        assert final_state is not None
        chain = get_handoff_chain(plan_id)
        assert len(chain) == 3, f"Expected 3 handoffs, got {len(chain)}"
        assert chain[0]["status"] == "context_exhausted"
        assert chain[0]["subtask_id"] == "subtask-1"
        assert chain[1]["status"] == "complete"
        assert chain[1]["subtask_id"] == "subtask-1"
        assert chain[2]["status"] == "complete"
        assert chain[2]["subtask_id"] == "subtask-2"
        print("  ✓ 3 handoffs chained correctly (exhaust → complete → complete)")
        return True
    finally:
        dev_mod.agent_node = original_dev
        qa_mod.qa_agent_node = original_qa


async def test_multi_lane() -> bool:
    print("\n[test_multi_lane] Two non-conflicting plans in parallel...")
    plan_a = f"test-parallel-a-{uuid.uuid4().hex[:8]}"
    plan_b = f"test-parallel-b-{uuid.uuid4().hex[:8]}"
    _insert_plan(
        plan_a,
        "Plan A",
        [{"subtask_id": "subtask-1", "title": "Task A", "spec": "Do A", "files": ["src/a.ts"]}],
    )
    _insert_plan(
        plan_b,
        "Plan B",
        [{"subtask_id": "subtask-1", "title": "Task B", "spec": "Do B", "files": ["src/b.ts"]}],
    )

    # Reset sequencers
    dev_sequencer: dict = {}
    qa_sequencer: dict = {}

    original_dev = dev_mod.agent_node
    original_qa = qa_mod.qa_agent_node
    dev_mod.agent_node = _make_fake_dev(dev_sequencer)
    qa_mod.qa_agent_node = _make_fake_qa()

    try:
        sup = Supervisor(max_lanes=2, checkpointer=get_checkpointer(CHECKPOINT_PATH))
        # Manually dispatch both lanes
        lane_a = sup._lane_id_from_plan_id(plan_a)
        lane_b = sup._lane_id_from_plan_id(plan_b)

        task_a = asyncio.create_task(sup._run_lane(plan_a, lane_a))
        task_b = asyncio.create_task(sup._run_lane(plan_b, lane_b))

        final_a, final_b = await asyncio.gather(task_a, task_b)

        assert final_a["status"] == "complete", f"Lane A failed: {final_a}"
        assert final_b["status"] == "complete", f"Lane B failed: {final_b}"
        print("  ✓ Both parallel lanes completed")
        return True
    finally:
        dev_mod.agent_node = original_dev
        qa_mod.qa_agent_node = original_qa


async def test_conflict_prevention() -> bool:
    print("\n[test_conflict_prevention] Conflict matrix holds overlapping plan...")
    plan_x = f"test-conflict-x-{uuid.uuid4().hex[:8]}"
    plan_y = f"test-conflict-y-{uuid.uuid4().hex[:8]}"
    shared_file = "src/shared.ts"
    _insert_plan(
        plan_x,
        "Plan X",
        [{"subtask_id": "subtask-1", "title": "Task X", "spec": "Do X", "files": [shared_file]}],
        files=[shared_file],
    )
    _insert_plan(
        plan_y,
        "Plan Y",
        [{"subtask_id": "subtask-1", "title": "Task Y", "spec": "Do Y", "files": [shared_file]}],
        files=[shared_file],
    )

    # Insert an active lane for plan_x
    conn = get_conn()
    conn.execute(
        "INSERT OR REPLACE INTO lanes (lane_id, plan_id, status, started_at, last_heartbeat) VALUES (?, ?, ?, ?, ?)",
        ("lane-x", plan_x, "running", __import__("time").time(), __import__("time").time()),
    )
    conn.commit()
    conn.close()

    # Supervisor tick should skip plan_y because of active conflict
    sup = Supervisor(max_lanes=3, checkpointer=get_checkpointer(CHECKPOINT_PATH))
    await sup.tick()
    # plan_x already has a lane, so it won't be re-claimed
    # plan_y has conflict, so it won't be claimed
    assert plan_y not in sup._running_plan_ids(), "plan_y should be held back by conflict"
    # There may be other unrelated runnable plans from the repo; we only care about plan_y
    print("  ✓ Overlapping plan held back by conflict matrix")
    return True


async def main():
    setup()
    results = []
    tests = [
        test_pm_node,
        test_graph_compiles,
        test_handoff_chain,
        test_multi_lane,
        test_conflict_prevention,
    ]
    for t in tests:
        try:
            if asyncio.iscoroutinefunction(t):
                results.append(await t())
            else:
                results.append(t())
        except Exception as e:
            print(f"  ✗ FAILED: {e}")
            import traceback
            traceback.print_exc()
            results.append(False)

    passed = sum(results)
    total = len(results)
    print(f"\n{'='*50}")
    print(f"Phase 4 validation: {passed}/{total} passed")
    if passed == total:
        print("All green — Phase 4 complete.")
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    asyncio.run(main())
