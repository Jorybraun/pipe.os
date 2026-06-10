#!/usr/bin/env python3
"""Phase 3 validation — single ephemeral developer agent end-to-end."""
from __future__ import annotations

import json
import os
import sys
import tempfile
import uuid
from pathlib import Path

# Ensure src/ is on path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from langchain_core.messages import AIMessage, SystemMessage, ToolMessage
from langchain_core.runnables import RunnableLambda

from agent_harness import config
from agent_harness.broker import init_db, submit_handoff, get_handoff, get_handoff_chain
from agent_harness.broker.db import get_conn
from agent_harness.swarm.budget import TokenBudget, WARN_THRESHOLD, FORCE_THRESHOLD
from agent_harness.swarm.toolkit import get_developer_tools
from agent_harness.swarm.checkpoint import get_checkpointer
from agent_harness.swarm.agents.developer import (
    build_developer_graph,
    DevState,
    _build_system_message,
)

_TMPDIR = Path(tempfile.mkdtemp(prefix="validate_phase3_"))
config.DATA_DIR = _TMPDIR
DB_PATH = _TMPDIR / "broker.db"
CHECKPOINT_PATH = _TMPDIR / "checkpoints.db"


def setup():
    init_db(str(DB_PATH))
    # Clean checkpoint db
    cp = Path(CHECKPOINT_PATH)
    if cp.exists():
        cp.unlink()


def test_budget() -> bool:
    print("\n[test_budget] Token accounting...")
    b = TokenBudget()

    # Simulate a small turn (200 chars ≈ 50 tokens)
    ok = b.add_turn([SystemMessage(content="x" * 200)])
    assert ok["status"] == "ok", f"Expected ok, got {ok['status']}"

    # Cross warn threshold (~60K cumulative in this turn alone)
    warn = b.add_turn([SystemMessage(content="x" * (WARN_THRESHOLD * 4))])
    assert warn["status"] == "warn", f"Expected warn, got {warn['status']}"

    # Cross force threshold (~80K cumulative in this turn alone)
    exhaust = b.add_turn([SystemMessage(content="x" * (FORCE_THRESHOLD * 4))])
    assert exhaust["status"] == "exhausted", f"Expected exhausted, got {exhaust['status']}"
    assert "MUST exit" in exhaust["message"]

    print("  ✓ warn at 60K, exhaust at 80K")
    return True


def test_toolkit() -> bool:
    print("\n[test_toolkit] Developer tools...")
    tools = get_developer_tools()
    names = {t.name for t in tools}
    required = {
        "read_file",
        "write_file",
        "list_directory",
        "terminal",
        "navigate_browser",
        "extract_text",
        "click_element",
        "broker_submit_handoff_tool",
        "broker_emit_event_tool",
        "broker_get_plan_tool",
        "broker_reserve_migration_tool",
        "broker_post_cue_tool",
        "broker_read_cues_tool",
        "broker_ack_cue_tool",
    }
    missing = required - names
    assert not missing, f"Missing tools: {missing}"
    print(f"  ✓ {len(names)} tools available")
    return True


def test_handoff_registry() -> bool:
    print("\n[test_handoff_registry] Handoff CRUD...")
    from agent_harness.broker.db import get_conn
    plan_id = f"test-plan-{uuid.uuid4().hex[:8]}"
    # Insert dummy plan to satisfy FK
    conn = get_conn()
    conn.execute(
        "INSERT OR IGNORE INTO plans (plan_id, plan_path, title, parsed_at) VALUES (?, ?, ?, ?)",
        (plan_id, f"docs/plans/{plan_id}.md", plan_id, 0.0),
    )
    conn.commit()
    conn.close()

    h1 = submit_handoff(
        plan_id=plan_id,
        subtask_id="subtask-1",
        status="context_exhausted",
        handoff_to="next_dev",
        done=[{"type": "file", "path": "src/foo.ts", "summary": "WIP"}],
        next_actions=["finish test"],
        context_used=75000,
    )
    assert h1["sequence"] == 1

    h2 = submit_handoff(
        plan_id=plan_id,
        subtask_id="subtask-1",
        status="complete",
        handoff_to="qa_deploy",
        context_used=40000,
    )
    assert h2["sequence"] == 2

    latest = get_handoff(plan_id, "subtask-1")
    assert latest is not None
    assert latest["status"] == "complete"
    assert latest["sequence"] == 2

    first = get_handoff(plan_id, "subtask-1", sequence=1)
    assert first is not None
    assert first["status"] == "context_exhausted"
    assert first["done"][0]["path"] == "src/foo.ts"

    chain = get_handoff_chain(plan_id)
    assert len(chain) == 2
    assert chain[0]["sequence"] == 1
    assert chain[1]["sequence"] == 2

    print("  ✓ submit / get / chain handoffs")
    return True


def test_graph_compiles() -> bool:
    print("\n[test_graph_compiles] Developer graph...")
    cp = get_checkpointer(CHECKPOINT_PATH)
    graph = build_developer_graph(checkpointer=cp)
    assert graph is not None
    print("  ✓ graph compiled with checkpointer")
    return True


def _fake_llm_for_handoff(state: DevState) -> AIMessage:
    """Mock LLM that submits a handoff, then stops."""
    # If the last message is the handoff tool result, return final response
    if state["messages"] and isinstance(state["messages"][-1], ToolMessage):
        last = state["messages"][-1]
        if last.name == "broker_submit_handoff_tool":
            return AIMessage(content="Handoff submitted. Exiting.")
    # Otherwise, emit the handoff tool call
    return AIMessage(
        content="Task complete. Submitting handoff.",
        tool_calls=[{
            "name": "broker_submit_handoff_tool",
            "args": {
                "plan_id": state["plan_id"],
                "subtask_id": state["subtask_id"],
                "status": "complete",
                "handoff_to": "qa_deploy",
                "done": json.dumps([{"type": "test", "path": "e2e/smoke.spec.ts", "summary": "Added smoke test"}]),
                "next_actions": json.dumps(["run vitest", "open PR"]),
            },
            "id": "call_handoff_1",
        }],
    )


def test_mock_e2e() -> bool:
    print("\n[test_mock_e2e] Mock end-to-end developer run...")

    # Patch the agent node to use our fake LLM
    from agent_harness.swarm import agents as dev_mod
    original_agent_node = dev_mod.developer.agent_node

    def patched_agent_node(state, config):
        response = _fake_llm_for_handoff(state)
        return {"messages": [response]}

    dev_mod.developer.agent_node = patched_agent_node

    try:
        cp = get_checkpointer(CHECKPOINT_PATH)
        graph = build_developer_graph(checkpointer=cp)

        plan_id = f"mock-plan-{uuid.uuid4().hex[:8]}"
        # Insert dummy plan to satisfy FK in handoff submit
        conn = get_conn()
        conn.execute(
            "INSERT OR IGNORE INTO plans (plan_id, plan_path, title, parsed_at) VALUES (?, ?, ?, ?)",
            (plan_id, f"docs/plans/{plan_id}.md", plan_id, 0.0),
        )
        conn.commit()
        conn.close()
        thread_id = str(uuid.uuid4())
        initial: DevState = {
            "messages": [],
            "plan_id": plan_id,
            "subtask_id": "subtask-1",
            "plan_content": "## Subtask-1\nWrite a helper function `add(a, b)` and a unit test.",
            "handoff_in": None,
            "budget_used": 0,
            "budget_warned": False,
            "status": None,
        }

        final_state = None
        for event in graph.stream(initial, {"configurable": {"thread_id": thread_id}}, stream_mode="values"):
            final_state = event

        assert final_state is not None
        # Find the ToolMessage for the handoff submission
        handoff_msgs = [
            m for m in final_state["messages"]
            if isinstance(m, ToolMessage) and m.name == "broker_submit_handoff_tool"
        ]
        assert handoff_msgs, "Expected a ToolMessage for broker_submit_handoff_tool in message history"
        result = json.loads(handoff_msgs[-1].content)
        assert "submitted" in result
        assert result["submitted"]["status"] == "complete"
        assert result["submitted"]["handoff_to"] == "qa_deploy"

        # Verify handoff is in registry
        chain = get_handoff_chain(plan_id)
        assert len(chain) == 1
        assert chain[0]["status"] == "complete"

        print("  ✓ mock e2e: handoff submitted and persisted")
        return True
    finally:
        dev_mod.developer.agent_node = original_agent_node


def main():
    setup()
    results = []
    tests = [
        test_budget,
        test_toolkit,
        test_handoff_registry,
        test_graph_compiles,
        test_mock_e2e,
    ]
    for t in tests:
        try:
            results.append(t())
        except Exception as e:
            print(f"  ✗ FAILED: {e}")
            results.append(False)

    passed = sum(results)
    total = len(results)
    print(f"\n{'='*50}")
    print(f"Phase 3 validation: {passed}/{total} passed")
    if passed == total:
        print("All green — Phase 3 complete.")
        sys.exit(0)
    else:
        sys.exit(1)


if __name__ == "__main__":
    main()
