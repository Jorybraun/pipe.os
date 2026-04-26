"""Smoke tests for the LangGraph-native orchestrator refactor."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


def test_lane_graph_compiles():
    from agent_harness.swarm.graph import build_lane_graph
    graph = build_lane_graph()
    assert graph is not None


def test_lane_graph_has_expected_nodes():
    from agent_harness.swarm.graph import build_lane_graph
    graph = build_lane_graph()
    nodes = set(graph.get_graph().nodes.keys())
    expected = {"supervisor", "advisor", "developer", "qa_deploy", "escalate", "escalation_gate"}
    assert expected.issubset(nodes), f"Missing nodes: {expected - nodes}"


def test_lane_state_schema():
    from agent_harness.swarm.graph import LaneState
    state: LaneState = {
        "messages": [],
        "plan_path": "",
        "plan_id": "test-plan",
        "lane_id": "lane-test",
        "work_items": [],
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
    assert state["advisor_guidance"] is None
    assert state["next_node"] == "supervisor"


def test_developer_json_import():
    from agent_harness.swarm.agents.developer import _hash_tool_call
    result = _hash_tool_call({"name": "test", "args": {"a": 1}})
    assert result == 'test:{"a": 1}'


def test_heartbeat_updates_lane():
    """heartbeat() should update last_heartbeat in the lanes table."""
    import tempfile
    from pathlib import Path
    from agent_harness.broker.db import init_db, get_conn
    from agent_harness.broker.plan_walker import heartbeat

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        init_db(db_path)
        conn = get_conn(db_path)
        conn.execute(
            "INSERT INTO plans (plan_id, plan_path, title, status, parsed_at) VALUES (?, ?, ?, ?, ?)",
            ("plan-test", "plan-test.md", "Test", "PENDING", 0.0),
        )
        conn.execute(
            "INSERT INTO lanes (lane_id, plan_id, status, started_at, last_heartbeat) VALUES (?, ?, ?, ?, ?)",
            ("lane-test", "plan-test", "running", 0.0, 0.0),
        )
        conn.commit()
        conn.close()

        heartbeat("lane-test", agent_id="dev", conn=get_conn(db_path))

        conn = get_conn(db_path)
        row = conn.execute("SELECT last_heartbeat FROM lanes WHERE lane_id = ?", ("lane-test",)).fetchone()
        assert row["last_heartbeat"] > 0.0
        conn.close()


def test_meta_pm_has_action_tools():
    """Meta-PM toolkit must include claim_plan and post_cue tools."""
    import os
    os.environ.setdefault("KIMI_API_KEY", "sk-fake")
    from agent_harness.swarm.agents.meta_pm import _get_meta_pm_tools
    tools = _get_meta_pm_tools()
    names = {getattr(t, "name", None) for t in tools}
    assert "broker_claim_plan_tool" in names, f"broker_claim_plan_tool missing from {names}"
    assert "broker_post_cue_tool" in names, f"broker_post_cue_tool missing from {names}"


def test_meta_pm_agent_builds_with_api_key():
    from agent_harness.swarm.agents.meta_pm import build_meta_pm_agent
    os.environ.setdefault("KIMI_API_KEY", "sk-fake")
    agent = build_meta_pm_agent()
    assert agent is not None


def test_pm_py_is_deleted():
    pm_path = Path(__file__).parent.parent / "src" / "agent_harness" / "swarm" / "agents" / "pm.py"
    assert not pm_path.exists(), "pm.py should have been deleted"


def test_server_has_meta_pm_tool():
    import inspect
    from agent_harness.server import harness_meta_pm_recommend
    assert inspect.iscoroutinefunction(harness_meta_pm_recommend)


def test_lane_routing_decision_schema():
    from agent_harness.swarm.graph import LaneRoutingDecision
    decision = LaneRoutingDecision(next_node="developer", reasoning="test", target_subtask_id="st-1")
    assert decision.next_node == "developer"
    assert decision.target_subtask_id == "st-1"


def test_sync_plans_with_existing_migration_ledger():
    """Regression: sync_plans_to_db must not crash when migration_ledger references plans."""
    import sqlite3
    import tempfile
    from pathlib import Path
    from agent_harness.broker.db import init_db, get_conn
    from agent_harness.broker.plan_walker import sync_plans_to_db

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        init_db(db_path)
        conn = get_conn(db_path)
        # Insert a plan and a migration ledger entry that references it
        conn.execute(
            "INSERT INTO plans (plan_id, plan_path, title, status, parsed_at) VALUES (?, ?, ?, ?, ?)",
            ("test-plan", "test-plan.md", "Test", "PENDING", 0.0),
        )
        conn.execute(
            "INSERT INTO migration_ledger (number, env, plan_id, reserved_at) VALUES (?, ?, ?, ?)",
            (1, "test", "test-plan", 0.0),
        )
        conn.commit()
        conn.close()

        # This used to raise sqlite3.IntegrityError: FOREIGN KEY constraint failed
        count = sync_plans_to_db(plans=[], conn=get_conn(db_path))
        assert count == 0

        # Verify migration ledger row still exists but plan_id is now NULL
        conn = get_conn(db_path)
        row = conn.execute("SELECT plan_id FROM migration_ledger WHERE number = 1").fetchone()
        assert row["plan_id"] is None
        conn.close()


def test_qa_deploy_pr_creation():
    """QA-Deploy create_pr_tool should return a PR URL on successful gh CLI call."""
    import json
    from unittest.mock import patch, MagicMock
    from agent_harness.swarm.agents.qa_deploy import _get_qa_tools

    tools = _get_qa_tools()
    create_pr = next((t for t in tools if getattr(t, "name", None) == "create_pr_tool"), None)
    assert create_pr is not None, "create_pr_tool not found in QA toolkit"

    mock_stdout = json.dumps({"url": "https://github.com/org/repo/pull/42"})
    with patch("agent_harness.swarm.agents.qa_deploy.subprocess.run") as mock_run:
        mock_run.side_effect = [
            MagicMock(stdout="", stderr="", returncode=0),  # gh pr create
            MagicMock(stdout=mock_stdout, stderr="", returncode=0),  # gh pr view
        ]
        result = create_pr.invoke({
            "title": "Test PR",
            "body": "## Plan\nTest plan\n## Acceptance criteria\n- ok\n## BDD tests\n- ok\n## Unit tests\n- ok\n## Manual QA on staging\n- ok\n## Regression touchpoints\n- ok\n## Rollback\n- ok",
            "head": "feature/test",
            "base": "main",
        })
        data = json.loads(result)
        assert data["pr_url"] == "https://github.com/org/repo/pull/42"
        assert data["method"] == "gh"


def test_plan_budget_enforcement():
    """Lane supervisor should escalate when plan_budget_used >= PLAN_BUDGET_LIMIT."""
    from agent_harness.swarm.graph import lane_supervisor_node
    from agent_harness.swarm.budget import PLAN_BUDGET_LIMIT

    state = {
        "messages": [],
        "plan_path": "",
        "plan_id": "test-plan",
        "lane_id": "lane-test",
        "work_items": [{"subtask_id": "st-1", "title": "T", "spec": "", "files": [], "migrations": [], "status": "pending"}],
        "current_subtask_id": None,
        "current_handoff": None,
        "handoff_chain": [],
        "reserved_migrations": [],
        "pr_url": None,
        "plan_budget_used": PLAN_BUDGET_LIMIT + 1,
        "iteration": 0,
        "status": "running",
        "advisor_guidance": None,
        "next_node": "supervisor",
    }
    result = lane_supervisor_node(state, {"configurable": {"thread_id": "test"}})
    assert result["next_node"] == "escalate"


def test_developer_forced_handoff():
    """When budget is exhausted and no handoff was submitted, should_continue routes to force_handoff."""
    from agent_harness.swarm.agents.developer import should_continue
    from langchain_core.messages import SystemMessage

    state = {
        "messages": [SystemMessage(content="test")],
        "plan_id": "p",
        "subtask_id": "st-1",
        "plan_content": "",
        "handoff_in": None,
        "budget_used": 0,
        "budget_warned": False,
        "status": "context_exhausted",
        "turn_count": 1,
        "recent_tool_calls": [],
    }
    result = should_continue(state)
    assert result == "force_handoff"


def test_claim_plan_atomicity():
    """Only one caller should successfully claim a PENDING plan."""
    import tempfile
    from pathlib import Path
    import threading
    from agent_harness.broker.db import init_db, get_conn
    from agent_harness.broker.plan_walker import claim_plan

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        init_db(db_path)
        conn = get_conn(db_path)
        conn.execute(
            "INSERT INTO plans (plan_id, plan_path, title, status, parsed_at) VALUES (?, ?, ?, ?, ?)",
            ("race-plan", "race-plan.md", "Race", "PENDING", 0.0),
        )
        conn.commit()
        conn.close()

        results = []

        def try_claim(lane_id):
            ok = claim_plan("race-plan", lane_id, conn=get_conn(db_path))
            results.append((lane_id, ok))

        threads = [threading.Thread(target=try_claim, args=(f"lane-{i}",)) for i in range(10)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()

        successes = [lane_id for lane_id, ok in results if ok]
        assert len(successes) == 1, f"Expected exactly 1 claim success, got {len(successes)}"

        # Verify status is now CLAIMED
        conn = get_conn(db_path)
        row = conn.execute("SELECT status FROM plans WHERE plan_id = ?", ("race-plan",)).fetchone()
        assert row["status"] == "CLAIMED"
        conn.close()


def test_developer_toolkit_has_consult_architect_tool():
    """Developer toolkit must include consult_architect_tool."""
    from agent_harness.swarm.toolkit import get_developer_tools
    tools = get_developer_tools()
    names = {getattr(t, "name", None) for t in tools}
    assert "consult_architect_tool" in names, f"consult_architect_tool missing from {names}"


def test_consult_architect_tool_smoke():
    """consult_architect_tool should invoke the architect and return structured JSON."""
    import json
    from unittest.mock import patch, MagicMock
    from agent_harness.swarm.toolkit import get_developer_tools

    tools = get_developer_tools()
    consult = next((t for t in tools if getattr(t, "name", None) == "consult_architect_tool"), None)
    assert consult is not None, "consult_architect_tool not found in toolkit"

    mock_output = MagicMock()
    mock_output.model_dump.return_value = {
        "problem_statement": "Need a WebSocket contract",
        "proposed_solution": "Create WebSocketManager",
        "data_model_changes": "None",
        "api_contracts": "JSON over WebSocket",
        "file_structure": "src/lib/websocket/",
        "integration_points": "Hook into NotificationService",
        "risks_and_mitigations": "Scale — use Redis pub/sub",
        "adr_required": "no",
    }

    mock_model = MagicMock()
    mock_model.with_structured_output.return_value.invoke.return_value = mock_output

    with (
        patch("agent_harness.swarm.agents.architect._make_model", return_value=mock_model),
        patch("agent_harness.swarm.agents.architect.get_plan", return_value=None),
        patch("agent_harness.swarm.agents.architect.get_handoff_chain", return_value=[]),
        patch("agent_harness.swarm.agents.architect.read_cues", return_value=[]),
        patch("agent_harness.swarm.agents.architect.emit") as mock_emit,
    ):
        result = consult.invoke({
            "plan_id": "test-plan",
            "subtask_id": "st-1",
            "question": "Should I use WebSockets or SSE?",
            "lane_id": "lane-test",
        })
        data = json.loads(result)
        assert data["problem_statement"] == "Need a WebSocket contract"
        assert data["adr_required"] == "no"
        mock_emit.assert_called_once()
        assert mock_emit.call_args.kwargs["event_type"] == "architect_consulted"


def test_handoff_stores_dod_checklist():
    """submit_handoff must persist dod_checklist and round-trip it."""
    import tempfile
    from pathlib import Path
    from agent_harness.broker.db import init_db, get_conn, _DB_PATH
    from agent_harness.broker.handoff_registry import submit_handoff, get_handoff

    with tempfile.TemporaryDirectory() as tmp:
        db_path = Path(tmp) / "test.db"
        init_db(db_path)
        conn = get_conn(db_path)
        conn.execute(
            "INSERT INTO plans (plan_id, plan_path, title, status, parsed_at) VALUES (?, ?, ?, ?, ?)",
            ("dod-plan", "dod-plan.md", "DoD Test", "PENDING", 0.0),
        )
        conn.commit()
        conn.close()

        # Temporarily point the module-level DB path at our test DB
        original_db_path = _DB_PATH
        from agent_harness.broker import db as db_module
        db_module._DB_PATH = db_path

        try:
            checklist = [
                {"item": "BDD first", "checked": True, "justification": "Wrote e2e/notification.spec.ts"},
                {"item": "Type check passes", "checked": True, "justification": "npx tsc --noEmit green"},
                {"item": "Lint passes", "checked": False, "justification": "TODO: fix trailing commas"},
            ]

            record = submit_handoff(
                plan_id="dod-plan",
                subtask_id="st-1",
                status="complete",
                handoff_to="qa_deploy",
                dod_checklist=checklist,
            )
            assert record["handoff_id"] == "dod-plan:st-1:1"

            handoff = get_handoff("dod-plan", "st-1")
            assert handoff is not None
            assert handoff["dod_checklist"] == checklist
        finally:
            db_module._DB_PATH = original_db_path
