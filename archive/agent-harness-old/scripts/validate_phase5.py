#!/usr/bin/env python3
"""Phase 5 validation — escalation surface + human-in-the-loop interrupt()."""
from __future__ import annotations

import json
import sys
import tempfile
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langgraph.types import Command

from agent_harness import config
from agent_harness.broker import init_db, get_handoff_chain
from agent_harness.broker.db import get_conn
from agent_harness.swarm.checkpoint import get_checkpointer
from agent_harness.swarm.graph import build_lane_graph, LaneState
from agent_harness.swarm.escalation import should_escalate
from agent_harness.swarm.agents import developer as dev_mod
from agent_harness.swarm.agents import qa_deploy as qa_mod

_TMPDIR = Path(tempfile.mkdtemp(prefix="validate_phase5_"))
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
    conn = get_conn()
    now = __import__("time").time()
    conn.execute(
        """
        INSERT OR REPLACE INTO plans (plan_id, plan_path, title, status, parsed_at, acceptance)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (plan_id, f"docs/plans/strategy-v2/{plan_id}", title, "PENDING", now, ""),
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


def _make_fake_dev():
    def patched_agent_node(state, config):
        if state["messages"] and isinstance(state["messages"][-1], ToolMessage):
            return {"messages": [AIMessage(content="Handoff submitted. Exiting.")]}
        tool_call = {
            "name": "broker_submit_handoff_tool",
            "args": {
                "plan_id": state["plan_id"],
                "subtask_id": state["subtask_id"],
                "status": "complete",
                "handoff_to": "qa_deploy",
                "done": "[]",
                "next_actions": "[]",
                "context_used": 1000,
            },
            "id": f"call_{uuid.uuid4().hex[:8]}",
        }
        return {"messages": [AIMessage(content="Done", tool_calls=[tool_call])]}
    return patched_agent_node


def _make_fake_qa():
    def patched_qa_agent_node(state, config):
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
        return {"messages": [AIMessage(content="QA complete. PR opened.", tool_calls=[tool_call])]}
    return patched_qa_agent_node


def test_escalation_detection() -> bool:
    print("\n[test_escalation_detection] Detect sensitive files and regulated text...")
    plan = {
        "title": "Candidate nodes schema",
        "acceptance": "",
        "why": "",
        "files": ["workers/api/migrations/0045_candidate_nodes.sql", "src/lib.ts"],
        "subtasks": [],
    }
    escalate, reason = should_escalate(plan)
    assert escalate is True, f"Expected escalation for migration file, got {escalate}"
    assert "migrations" in reason

    plan2 = {
        "title": "Privacy helper",
        "acceptance": "",
        "why": "",
        "files": ["lib/privacy/encrypt.ts"],
        "subtasks": [],
    }
    escalate2, reason2 = should_escalate(plan2)
    assert escalate2 is True, f"Expected escalation for privacy file, got {escalate2}"

    plan3 = {
        "title": "EEOC compliance check",
        "acceptance": "",
        "why": "",
        "files": ["src/utils.ts"],
        "subtasks": [],
    }
    escalate3, reason3 = should_escalate(plan3)
    assert escalate3 is True, f"Expected escalation for EEOC text, got {escalate3}"

    plan_safe = {
        "title": "UI button color",
        "acceptance": "",
        "why": "",
        "files": ["src/components/Button.tsx"],
        "subtasks": [],
    }
    escalate_safe, _ = should_escalate(plan_safe)
    assert escalate_safe is False, f"Expected no escalation for safe plan, got {escalate_safe}"

    print("  ✓ Escalation detection catches migrations, privacy, EEOC")
    return True


def test_interrupt_and_resume() -> bool:
    print("\n[test_interrupt_and_resume] Lane pauses at escalation gate, resumes on cue...")
    plan_id = f"test-migration-{uuid.uuid4().hex[:8]}"
    _insert_plan(
        plan_id,
        "Migration Plan",
        [
            {"subtask_id": "subtask-1", "title": "Add migration", "spec": "Create table", "files": ["workers/api/migrations/0045_test.sql"]},
        ],
        files=["workers/api/migrations/0045_test.sql"],
    )

    original_dev = dev_mod.agent_node
    original_qa = qa_mod.qa_agent_node
    dev_mod.agent_node = _make_fake_dev()
    qa_mod.qa_agent_node = _make_fake_qa()

    try:
        cp = get_checkpointer(CHECKPOINT_PATH)
        graph = build_lane_graph(checkpointer=cp)
        thread_id = f"lane-{plan_id}"
        initial: LaneState = {
            "messages": [],
            "plan_path": "",
            "plan_id": plan_id,
            "lane_id": thread_id,
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

        # First run — should pause at escalation_gate
        events = list(graph.stream(initial, {"configurable": {"thread_id": thread_id}}, stream_mode="values"))
        final_before = events[-1]
        assert "__interrupt__" in final_before, f"Expected interrupt pause, got keys: {list(final_before.keys())}"
        interrupt_value = final_before["__interrupt__"][0].value
        assert "migrations" in interrupt_value["reason"]
        print("  ✓ Lane paused at escalation gate with correct reason")

        # Resume with merge_approved
        resume_events = list(graph.stream(Command(resume="merge_approved"), {"configurable": {"thread_id": thread_id}}, stream_mode="values"))
        final_after = resume_events[-1]
        assert final_after.get("status") == "complete", f"Expected complete after resume, got {final_after.get('status')}"
        print("  ✓ Lane resumed and completed after merge_approved")
        return True
    finally:
        dev_mod.agent_node = original_dev
        qa_mod.qa_agent_node = original_qa


def main():
    setup()
    results = []
    tests = [
        test_escalation_detection,
        test_interrupt_and_resume,
    ]
    for t in tests:
        try:
            results.append(t())
        except Exception as e:
            print(f"  ✗ FAILED: {e}")
            import traceback
            traceback.print_exc()
            results.append(False)

    passed = sum(results)
    total = len(results)
    print(f"\n{'='*50}")
    print(f"Phase 5 validation: {passed}/{total} passed")
    if passed == total:
        print("All green — Phase 5 complete.")
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
