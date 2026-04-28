#!/usr/bin/env python3
"""Agent Harness MCP Server

Run with stdio transport (for Kimi Code CLI / Claude Desktop):
    python -m agent_harness.server

Run with SSE transport (for HTTP clients):
    python -m agent_harness.server --transport sse --port 8765
    python -m agent_harness.server --transport streamable-http --port 8765

WebSocket agent notifications run on port 8766 by default (or --ws-port).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import sys
import time
import warnings
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

# Set up file logging before anything else so startup errors are captured
_log_dir = Path(__file__).parent.parent.parent.parent / "logs"
_log_dir.mkdir(exist_ok=True)
_log_file = _log_dir / "agent-harness-server.log"
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
    handlers=[
        logging.FileHandler(_log_file, mode="a"),
        logging.StreamHandler(sys.stderr),
    ],
)
logger = logging.getLogger("agent-harness")
logger.info("=== Server starting ===")
logger.info(f"Python: {sys.executable}")
logger.info(f"CWD: {os.getcwd()}")

# Load .env — prefer CWD, then project root (search upward from this module)
_cwd_env = Path(".env").resolve()
if _cwd_env.exists():
    load_dotenv(_cwd_env)
    logger.info(f"Loaded .env from CWD: {_cwd_env}")
else:
    _project_root = Path(__file__).resolve()
    for _ in range(5):
        _project_root = _project_root.parent
        _env_file = _project_root / ".env"
        if _env_file.exists():
            load_dotenv(_env_file)
            logger.info(f"Loaded .env from: {_env_file}")
            break
    else:
        logger.warning("No .env file found")

# Ensure KIMI_API_KEY propagates into os.environ for child modules
if os.getenv("KIMI_API_KEY"):
    os.environ.setdefault("KIMI_API_KEY", os.getenv("KIMI_API_KEY"))
if os.getenv("OPENAI_API_KEY"):
    os.environ.setdefault("OPENAI_API_KEY", os.getenv("OPENAI_API_KEY"))

from mcp.server.fastmcp import Context, FastMCP

from agent_harness import config
from agent_harness.orchestrator import HarnessOrchestrator
from agent_harness.telemetry_queue import HarnessEvent
from agent_harness.websocket_server import AgentWebSocketServer
from agent_harness.swarm.graph import build_lane_graph, Orchestrator, _init_work_items
from agent_harness.swarm.checkpoint import get_checkpointer
from agent_harness.swarm.agents.meta_pm import run_meta_pm
from agent_harness.swarm.agents.orchestrator_agent import run_orchestrator
from agent_harness.broker import (
    init_db as init_broker_db,
    get_conn,
    list_plans as broker_list_plans,
    get_plan as broker_get_plan,
    runnable_set as broker_runnable_set,
    conflicts_for as broker_conflicts_for,
    sync_plans_to_db,
    emit as broker_emit,
    get_events as broker_get_events,
    post_cue as broker_post_cue,
    read_cues as broker_read_cues,
    ack_cue as broker_ack_cue,
    reserve_migration as broker_reserve_migration,
    release_migration as broker_release_migration,
    list_reserved as broker_list_reserved,
    register_interrupt as broker_register_interrupt,
    resume_interrupt as broker_resume_interrupt,
    get_interrupt as broker_get_interrupt,
    list_interrupts as broker_list_interrupts,
    submit_handoff as broker_submit_handoff,
    get_handoff as broker_get_handoff,
    get_handoff_chain as broker_get_handoff_chain,
    claim_plan as broker_claim_plan,
    heartbeat as broker_heartbeat,
)
from agent_harness.broker.event_bus import prune_events as broker_prune_events
from agent_harness.broker.migration_ledger import prune_released as broker_prune_migration_ledger
from agent_harness.swarm.checkpoint import prune_checkpoints
from agent_harness.swarm.agents.architect import run_architect
from agent_harness.swarm.agents.chat_agent import run_chat_agent_for_workflow
from agent_harness.swarm.lane_runner import (
    start_lane as lane_start_lane,
    stop_lane as lane_stop_lane,
    get_lane_status as lane_get_lane_status,
    list_running_lanes as lane_list_running_lanes,
    lane_id_from_plan_id as _lane_lane_id_from_plan_id,
)

PROMPTS_DIR = Path(__file__).parent / "prompts"

orchestrator: HarnessOrchestrator | None = None
ws_server: AgentWebSocketServer | None = None
_lane_tasks: dict[str, asyncio.Task] = {}
_agent_tasks: dict[str, asyncio.Task] = {}
_lane_checkpointer = get_checkpointer()

mcp = FastMCP(
    "agent-harness",
    instructions=(
        "Agent Harness orchestrates multi-agent development workflows. "
        "Use the harness tools to start workflows, spawn agents, run QA gates, "
        "manage approval gates, and steer agents via real-time messaging."
    ),
)


# ---------------------------------------------------------------------------
# Helpers — Lane runner
# ---------------------------------------------------------------------------

def _lane_id_from_plan_id(plan_id: str) -> str:
    return f"lane-{plan_id.replace('/', '-')}"


# ---------------------------------------------------------------------------
# Tools — Workflow lifecycle
# ---------------------------------------------------------------------------

@mcp.tool()
async def harness_start_workflow(
    task: str,
    repo_path: str = ".",
    auto_approve: bool = False,
    stack: str = "generic",
    qa_config: str = "",
    ctx: Context | None = None,
) -> str:
    """Start a new harness workflow.

    .. deprecated::
        Use broker_claim_plan_tool + harness_start_lane instead.
        The workflow-centric API is being replaced by the plan-centric broker API.

    Args:
        task: Description of the feature or fix to implement.
        repo_path: Absolute or relative path to the git repository.
        auto_approve: Skip all approval gates (default False).
        stack: Project stack — generic, typescript, python, go, rust.
        qa_config: Optional JSON string with custom QA check definitions.

    Returns:
        JSON string with workflow_id and initial status.
    """
    parsed_qa = {}
    if qa_config.strip():
        try:
            parsed_qa = json.loads(qa_config)
        except json.JSONDecodeError as e:
            return json.dumps({"error": f"Invalid qa_config JSON: {e}"}, indent=2)

    state = await orchestrator.create_workflow(
        task, repo_path, auto_approve, stack=stack, qa_config=parsed_qa
    )
    return json.dumps({
        "workflow_id": state.workflow_id,
        "status": state.status,
        "repo_path": state.repo_path,
        "stack": state.stack,
    }, indent=2)


@mcp.tool()
async def harness_get_status(
    workflow_id: str,
    ctx: Context | None = None,
) -> str:
    """Get the current status of a workflow.

    .. deprecated::
        Use broker_get_plan_tool or broker_list_plans_tool instead.
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    state = await orchestrator.get_workflow(workflow_id)
    if not state:
        return json.dumps({"error": "Workflow not found"}, indent=2)
    return json.dumps(orchestrator.to_dict(state), indent=2)


@mcp.tool()
async def harness_list_workflows(
    ctx: Context | None = None,
) -> str:
    """List all active workflows.

    .. deprecated::
        Use broker_list_plans_tool with status filter instead.
    """
    states = await orchestrator.list_workflows()
    summaries = [
        {
            "workflow_id": s.workflow_id,
            "status": s.status,
            "current_phase": s.current_phase,
            "task": s.task[:80],
        }
        for s in states
    ]
    return json.dumps({"workflows": summaries}, indent=2)


@mcp.tool()
async def harness_transition_phase(
    workflow_id: str,
    phase: str,
    ctx: Context | None = None,
) -> str:
    """Transition a workflow to a new phase.

    .. deprecated::
        The workflow-centric phase model is being replaced by broker plan status.
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    state = await orchestrator.get_workflow(workflow_id)
    if not state:
        return json.dumps({"error": "Workflow not found"}, indent=2)
    await orchestrator.transition(workflow_id, phase)
    return json.dumps({"workflow_id": workflow_id, "phase": phase, "ok": True}, indent=2)


@mcp.tool()
async def harness_submit_output(
    workflow_id: str,
    phase: str,
    output: str,
    changed_files: list[str] | None = None,
    ctx: Context | None = None,
) -> str:
    """Submit the output from an agent phase."""
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    state = await orchestrator.get_workflow(workflow_id)
    if not state:
        return json.dumps({"error": "Workflow not found"}, indent=2)
    await orchestrator.submit_output(workflow_id, phase, output, changed_files or [])
    return json.dumps({"workflow_id": workflow_id, "phase": phase, "ok": True}, indent=2)


@mcp.tool()
async def harness_request_approval(
    workflow_id: str,
    phase: str,
    content: str,
    ctx: Context | None = None,
) -> str:
    """Request user approval for a phase."""
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    state = await orchestrator.get_workflow(workflow_id)
    if not state:
        return json.dumps({"error": "Workflow not found"}, indent=2)
    await orchestrator.request_approval(workflow_id, phase, content)
    return json.dumps({
        "workflow_id": workflow_id,
        "phase": phase,
        "status": "waiting_approval",
        "message": "Use harness_submit_approval to respond",
    }, indent=2)


@mcp.tool()
async def harness_submit_approval(
    workflow_id: str,
    phase: str,
    decision: str,
    feedback: str = "",
    ctx: Context | None = None,
) -> str:
    """Submit an approval decision (approved, rejected, or revise)."""
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    state = await orchestrator.get_workflow(workflow_id)
    if not state:
        return json.dumps({"error": "Workflow not found"}, indent=2)
    await orchestrator.submit_approval(workflow_id, phase, decision, feedback)
    return json.dumps({
        "workflow_id": workflow_id,
        "phase": phase,
        "decision": decision,
        "ok": True,
    }, indent=2)


@mcp.tool()
async def harness_run_qa(
    workflow_id: str,
    ctx: Context | None = None,
) -> str:
    """Run quality gates for a workflow.

    .. deprecated::
        QA gates are integrated into the lane graph qa_deploy_node (no deploy).
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    state = await orchestrator.get_workflow(workflow_id)
    if not state:
        return json.dumps({"error": "Workflow not found"}, indent=2)
    results = await orchestrator.run_qa(workflow_id)
    return json.dumps(results, indent=2)


@mcp.tool()
async def harness_get_telemetry(
    workflow_id: str,
    since: float = 0.0,
    ctx: Context | None = None,
) -> str:
    """Get telemetry events for a workflow (includes persisted events across sessions).

    .. deprecated::
        Use broker_get_events_tool instead.
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    queue = await orchestrator.event_bus.get_queue(workflow_id)
    events = queue.get_history(since) if queue else []
    log_events = []
    if orchestrator._telemetry_path.exists():
        with open(orchestrator._telemetry_path) as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                entry = json.loads(line)
                if entry.get("workflow_id") == workflow_id and entry.get("timestamp", 0) >= since:
                    log_events.append(HarnessEvent(
                        event_id=entry.get("event_id", ""),
                        timestamp=entry.get("timestamp", 0),
                        event_type=entry.get("event_type", ""),
                        phase=entry.get("phase"),
                        agent_role=entry.get("agent_role"),
                        message=entry.get("message", ""),
                        data=entry.get("data", {}),
                    ))
    seen = {e.event_id for e in events}
    for e in log_events:
        if e.event_id not in seen:
            events.append(e)
            seen.add(e.event_id)
    events.sort(key=lambda e: e.timestamp)
    return json.dumps({
        "workflow_id": workflow_id,
        "events": [
            {
                "event_id": e.event_id,
                "timestamp": e.timestamp,
                "event_type": e.event_type,
                "phase": e.phase,
                "agent_role": e.agent_role,
                "message": e.message,
                "data": e.data,
            }
            for e in events
        ],
    }, indent=2)


@mcp.tool()
async def harness_poll_events(
    workflow_id: str,
    timeout: float = 5.0,
    ctx: Context | None = None,
) -> str:
    """Poll for new telemetry events with a timeout. Blocks until events arrive or timeout.

    .. deprecated::
        Use broker_get_events_tool or await the planned SSE subscribe endpoint.
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    queue = await orchestrator.event_bus.get_queue(workflow_id)
    if not queue:
        return json.dumps({"error": "Workflow not found"}, indent=2)
    polled = queue.drain(max_events=100)
    if not polled:
        try:
            event = await asyncio.wait_for(queue.get(), timeout=timeout)
            polled.append(event)
            polled.extend(queue.drain(max_events=99))
        except asyncio.TimeoutError:
            pass
    return json.dumps({
        "workflow_id": workflow_id,
        "events": [
            {
                "event_id": e.event_id,
                "timestamp": e.timestamp,
                "event_type": e.event_type,
                "phase": e.phase,
                "agent_role": e.agent_role,
                "message": e.message,
                "data": e.data,
            }
            for e in polled
        ],
    }, indent=2)


@mcp.tool()
async def harness_mark_complete(
    workflow_id: str,
    success: bool = True,
    ctx: Context | None = None,
) -> str:
    """Mark a workflow as complete or failed.

    .. deprecated::
        Use broker_complete_plan_tool instead.
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    state = await orchestrator.get_workflow(workflow_id)
    if not state:
        return json.dumps({"error": "Workflow not found"}, indent=2)
    if success:
        await orchestrator.mark_complete(workflow_id)
    else:
        await orchestrator.mark_failed(workflow_id, "Marked as failed by operator")
    return json.dumps({"workflow_id": workflow_id, "status": "complete" if success else "failed"}, indent=2)


@mcp.tool()
async def harness_interrupt(
    workflow_id: str,
    ctx: Context | None = None,
) -> str:
    """Interrupt and pause a running workflow.

    .. deprecated::
        Use broker_escalate_tool instead.
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    state = await orchestrator.get_workflow(workflow_id)
    if not state:
        return json.dumps({"error": "Workflow not found"}, indent=2)
    state.status = "paused"
    async with orchestrator._lock:
        orchestrator._save_state()
    await orchestrator._emit(workflow_id, "interrupted", message="Workflow interrupted by operator")
    return json.dumps({"workflow_id": workflow_id, "status": "paused"}, indent=2)


# ---------------------------------------------------------------------------
# Agent job tracking
# ---------------------------------------------------------------------------

import uuid


async def _run_agent_job(job_id: str, workflow_id: str, role: str) -> None:
    """Background task: run chat agent and store response."""
    try:
        result = await run_chat_agent_for_workflow(workflow_id, role, orchestrator)
        if "error" in result:
            broker_emit(
                event_type="agent_response_failed",
                payload={"job_id": job_id, "workflow_id": workflow_id, "role": role, "error": result["error"]},
            )
        else:
            broker_emit(
                event_type="agent_response_ready",
                payload={"job_id": job_id, "workflow_id": workflow_id, "role": role, "message_id": result.get("message_id")},
            )
    except Exception as exc:
        broker_emit(
            event_type="agent_response_failed",
            payload={"job_id": job_id, "workflow_id": workflow_id, "role": role, "error": str(exc)},
        )
    finally:
        _agent_tasks.pop(job_id, None)


@mcp.tool()
async def harness_run_agent(
    workflow_id: str,
    role: str,
    ctx: Context | None = None,
) -> str:
    """Run an agent for a workflow role asynchronously.

    Spawns a background task so the MCP call returns immediately.
    Poll harness_get_agent_status(job_id) for the result.

    Roles: pm, designer, architect, frontend, backend
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    if not role:
        return json.dumps({"error": "role is required"}, indent=2)

    job_id = f"ag-{uuid.uuid4().hex[:8]}"
    task = asyncio.create_task(_run_agent_job(job_id, workflow_id, role), name=job_id)
    _agent_tasks[job_id] = task

    return json.dumps({
        "status": "processing",
        "job_id": job_id,
        "workflow_id": workflow_id,
        "role": role,
        "message": "Agent is running in the background. Poll harness_get_agent_status().",
    }, indent=2)


@mcp.tool()
async def harness_get_agent_status(
    job_id: str,
    ctx: Context | None = None,
) -> str:
    """Get the status of an async agent job."""
    task = _agent_tasks.get(job_id)
    if task is not None and not task.done():
        return json.dumps({"job_id": job_id, "status": "running"}, indent=2)

    # Job finished — look up the response in the conversation history
    # We need to find the workflow_id and role from the task name/context
    # Since we don't store that mapping, scan recent events
    events = broker_get_events(event_type="agent_response_ready", since=0, limit=100)
    for evt in events:
        payload = json.loads(evt["payload"]) if evt.get("payload") else {}
        if payload.get("job_id") == job_id:
            workflow_id = payload.get("workflow_id")
            role = payload.get("role")
            if workflow_id and role:
                conv = await orchestrator.get_conversation(workflow_id, role)
                if conv:
                    last_msg = conv[-1]
                    return json.dumps({
                        "job_id": job_id,
                        "status": "completed",
                        "workflow_id": workflow_id,
                        "role": role,
                        "message_id": last_msg.get("id"),
                        "response": last_msg.get("content"),
                    }, indent=2)
            return json.dumps({"job_id": job_id, "status": "completed", "message_id": payload.get("message_id")}, indent=2)

    failed_events = broker_get_events(event_type="agent_response_failed", since=0, limit=100)
    for evt in failed_events:
        payload = json.loads(evt["payload"]) if evt.get("payload") else {}
        if payload.get("job_id") == job_id:
            return json.dumps({
                "job_id": job_id,
                "status": "failed",
                "error": payload.get("error", "Unknown error"),
            }, indent=2)

    return json.dumps({"job_id": job_id, "status": "not_found"}, indent=2)


_ORCHESTRATOR_CONVERSATIONS: dict[str, list[dict[str, str]]] = {}


def _build_orchestrator_context() -> str:
    """Fetch swarm state and format it for the orchestrator prompt."""
    try:
        plans = broker_list_plans()
        runnable = broker_runnable_set()
        conn = get_conn()
        lanes_rows = conn.execute(
            "SELECT lane_id, plan_id, status, started_at, last_heartbeat, budget_used FROM lanes WHERE status = 'running'"
        ).fetchall()
        lanes = [dict(row) for row in lanes_rows]
        conn.close()
        recent_events = broker_get_events(since=time.time() - 3600, limit=20)
        interrupts = broker_list_interrupts()
        cues = broker_read_cues(since=time.time() - 3600)

        lines = [
            "# Swarm State",
            f"- Total plans: {len(plans)}",
            f"- Runnable plans: {len(runnable)}",
            f"- Needs refinement: {sum(1 for p in plans if p.get('status') == 'NEEDS-REFINEMENT')}",
            f"- Active lanes: {len(lanes)}",
        ]
        if lanes:
            lines.append("- Active lanes:")
            for lane in lanes:
                lines.append(f"  - {lane['lane_id']} (plan: {lane['plan_id']}, budget: {lane.get('budget_used', 0)})")
        if recent_events:
            lines.append("- Recent events:")
            for evt in recent_events[-5:]:
                lines.append(f"  - [{evt.get('event_type')}] plan={evt.get('plan_id')} lane={evt.get('lane_id')}")
        if interrupts:
            lines.append(f"- Active interrupts: {len(interrupts)}")
            for intr in interrupts[:3]:
                lines.append(f"  - {intr.get('plan_id')}: {intr.get('reason', '')}")
        if cues:
            lines.append(f"- Pending cues: {len(cues)}")
        return "\n".join(lines)
    except Exception as exc:
        return f"# Swarm State\nError fetching state: {exc}"


@mcp.tool()
async def harness_chat(
    message: str,
    thread_id: str = "orchestrator-main",
    ctx: Context | None = None,
) -> str:
    """Talk to the swarm orchestrator. Ask for status, steer lanes, or query agents.

    The orchestrator is a LangGraph DeepAgent with full tool access to the broker.
    It can query plans, check lanes, post cues, claim plans, and escalate to humans.
    """
    if not message:
        return json.dumps({"error": "message is required"}, indent=2)

    try:
        # run_orchestrator is sync; run in thread pool so MCP doesn't block
        loop = asyncio.get_running_loop()
        result = await loop.run_in_executor(None, run_orchestrator, message, thread_id)
        return json.dumps({
            "thread_id": thread_id,
            "response": result.get("response", ""),
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
async def harness_status(
    ctx: Context | None = None,
) -> str:
    """Get a fast snapshot of the entire swarm state.

    Returns plan counts, active lanes, recent events, active interrupts,
    and pending cues. No LLM involved — pure DB queries.
    """
    try:
        plans = broker_list_plans()
        runnable = broker_runnable_set()

        # Active lanes from DB
        conn = get_conn()
        lanes_rows = conn.execute(
            "SELECT lane_id, plan_id, status, started_at, last_heartbeat, budget_used FROM lanes WHERE status = 'running'"
        ).fetchall()
        lanes = [dict(row) for row in lanes_rows]
        conn.close()

        recent_events = broker_get_events(since=time.time() - 3600, limit=20)
        active_interrupts = broker_list_interrupts()
        recent_cues = broker_read_cues(since=time.time() - 3600)

        return json.dumps({
            "plans": {
                "total": len(plans),
                "runnable": len(runnable),
                "needs_refinement": sum(1 for p in plans if p.get("status") == "NEEDS-REFINEMENT"),
            },
            "lanes": {
                "active": lanes,
                "count": len(lanes),
            },
            "recent_events": {
                "count": len(recent_events),
                "events": [
                    {
                        "event_id": e.get("event_id"),
                        "event_type": e.get("event_type"),
                        "plan_id": e.get("plan_id"),
                        "lane_id": e.get("lane_id"),
                        "emitted_at": e.get("emitted_at"),
                    }
                    for e in recent_events
                ],
            },
            "active_interrupts": active_interrupts,
            "recent_cues": {
                "count": len(recent_cues),
                "cues": recent_cues[:10],
            },
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


# ---------------------------------------------------------------------------
# Tools — Steering / Messaging
# ---------------------------------------------------------------------------

@mcp.tool()
async def harness_publish_message(
    workflow_id: str,
    role: str,
    content: str,
    sender: str = "operator",
    msg_type: str = "steering",
    data: str = "",
    ctx: Context | None = None,
) -> str:
    """Publish a message to an agent's channel.

    .. deprecated::
        Use broker_post_cue_tool or broker_emit_event_tool instead.

    Use this to steer, advise, or query an agent during a workflow.
    The message is persisted and pushed to any connected WebSocket clients.

    Args:
        workflow_id: Target workflow.
        role: Target agent role — pm, designer, architect, frontend, backend, broadcast.
        content: The message content.
        sender: Who is sending — operator, system, or another agent role.
        msg_type: steering | output | approval | system | qa
        data: Optional JSON string with structured data.

    Returns:
        JSON with the published message id and channel.
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    parsed_data = {}
    if data.strip():
        try:
            parsed_data = json.loads(data)
        except json.JSONDecodeError as e:
            return json.dumps({"error": f"Invalid data JSON: {e}"}, indent=2)

    msg = await orchestrator.send_message(
        workflow_id, role, sender, content, msg_type=msg_type, data=parsed_data
    )
    if "error" in msg:
        return json.dumps(msg, indent=2)

    return json.dumps({
        "workflow_id": workflow_id,
        "role": role,
        "message_id": msg.get("id"),
        "channel": f"workflow:{workflow_id}:{role}",
        "sender": sender,
        "msg_type": msg_type,
        "ok": True,
    }, indent=2)


@mcp.tool()
async def harness_get_conversation(
    workflow_id: str,
    role: str,
    ctx: Context | None = None,
) -> str:
    """Get the full conversation thread for a role on a workflow.

    .. deprecated::
        Use broker_read_cues_tool + broker_get_events_tool instead.

    Returns messages from the persistent queue (survives restarts).
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    messages = await orchestrator.get_conversation(workflow_id, role)
    return json.dumps({
        "workflow_id": workflow_id,
        "role": role,
        "message_count": len(messages),
        "messages": messages,
    }, indent=2)


@mcp.tool()
async def harness_get_advisory_context(
    workflow_id: str,
    role: str,
    ctx: Context | None = None,
) -> str:
    """Get rich advisory context for an agent role.

    .. deprecated::
        This workflow-centric helper is being replaced by broker-native tools.

    Returns: workflow state, recent events, conversation thread, outputs,
    approvals, QA results, and errors. Use this to ground advice generation.
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    context = await orchestrator.get_advisory_context(workflow_id, role)
    if not context:
        return json.dumps({"error": "Workflow not found"}, indent=2)
    return json.dumps(context, indent=2)


@mcp.tool()
async def harness_poll_messages(
    workflow_id: str,
    roles: list[str],
    since: float = 0.0,
    ctx: Context | None = None,
) -> str:
    """Poll for undelivered messages on role channels for a workflow.

    .. deprecated::
        Use broker_read_cues_tool instead.

    Agents call this to pull messages when not connected via WebSocket.
    Messages are marked delivered on read.
    """
    if not workflow_id:
        return json.dumps({"error": "workflow_id is required"}, indent=2)
    channels = [f"workflow:{workflow_id}:{r}" for r in roles]
    channels.append(f"workflow:{workflow_id}:broadcast")
    messages = await orchestrator.message_queue.poll_undelivered(workflow_id, channels)
    return json.dumps({
        "workflow_id": workflow_id,
        "channels": channels,
        "message_count": len(messages),
        "messages": [
            {
                "id": m.id,
                "sender": m.sender,
                "recipient_role": m.recipient_role,
                "content": m.content,
                "timestamp": m.timestamp,
                "msg_type": m.msg_type,
                "data": m.data,
            }
            for m in messages
        ],
    }, indent=2)


# ---------------------------------------------------------------------------
# Tools — Broker / Plan registry (Phase 1)
# ---------------------------------------------------------------------------

@mcp.tool()
async def broker_list_plans_tool(
    filter_status: str = "",
    ctx: Context | None = None,
) -> str:
    """List all strategy-v2 plans with optional status filter.

    Args:
        filter_status: Optional status to filter by — PENDING, NEEDS-REFINEMENT, DONE, etc.
    """
    plans = broker_list_plans(status=filter_status or None)
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


@mcp.tool()
async def broker_runnable_set_tool(
    ctx: Context | None = None,
) -> str:
    """Return the set of plan_ids that are runnable right now.

    A plan is runnable when:
    - Status is PENDING (not NEEDS-REFINEMENT, DONE, or COMPLETE)
    - All dependencies are DONE / COMPLETE
    """
    plan_ids = broker_runnable_set()
    return json.dumps({
        "count": len(plan_ids),
        "plan_ids": plan_ids,
    }, indent=2)


@mcp.tool()
async def broker_get_plan_tool(
    plan_id: str,
    ctx: Context | None = None,
) -> str:
    """Get full plan content including subtasks, dependencies, and files."""
    if not plan_id:
        return json.dumps({"error": "plan_id is required"}, indent=2)
    plan = broker_get_plan(plan_id)
    if not plan:
        return json.dumps({"error": f"Plan not found: {plan_id}"}, indent=2)
    return json.dumps(plan, indent=2)


@mcp.tool()
async def broker_conflicts_for_tool(
    plan_id: str,
    ctx: Context | None = None,
) -> str:
    """Return file-path and migration-number conflicts for a plan.

    Checks overlap with other plans and active swarm lanes."""
    if not plan_id:
        return json.dumps({"error": "plan_id is required"}, indent=2)
    result = broker_conflicts_for(plan_id)
    return json.dumps(result, indent=2)


@mcp.tool()
async def broker_sync_plans(
    ctx: Context | None = None,
) -> str:
    """Re-scan knowledge/plan/strategy-v2/**/*.md and sync to the broker database."""
    result = sync_plans_to_db()
    return json.dumps({"synced": result}, indent=2)


@mcp.tool()
async def broker_claim_plan_tool(
    plan_id: str,
    lane_id: str = "",
    ctx: Context | None = None,
) -> str:
    """Atomically claim a PENDING plan for a lane.

    Returns {"claimed": true} on success, {"claimed": false} if already claimed.
    """
    ok = broker_claim_plan(plan_id, lane_id or f"lane-{plan_id.replace('/', '-')}")
    return json.dumps({"claimed": ok, "plan_id": plan_id, "lane_id": lane_id}, indent=2)


@mcp.tool()
async def broker_consult_architect_tool(
    plan_id: str,
    subtask_id: str,
    question: str,
    lane_id: str = "",
    ctx: Context | None = None,
) -> str:
    """Consult the System Architect for deep architectural guidance.

    Use this when you encounter missing API contracts, schema ambiguity,
    or integration questions. Returns a structured 8-point architecture spec.
    """
    try:
        result = run_architect(
            plan_id=plan_id,
            subtask_id=subtask_id or None,
            question=question,
            lane_id=lane_id,
        )
        return json.dumps(result, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


# ---------------------------------------------------------------------------
# Tools — Broker Phase 2 (event bus, cues, migration ledger, interrupts)
# ---------------------------------------------------------------------------

@mcp.tool()
async def broker_reserve_migration_tool(
    env: str,
    plan_id: str = "",
    lane_id: str = "",
    ctx: Context | None = None,
) -> str:
    """Atomically reserve the next migration number for an environment."""
    if not env:
        return json.dumps({"error": "env is required"}, indent=2)
    try:
        num = broker_reserve_migration(
            env=env,
            plan_id=plan_id or None,
            lane_id=lane_id or None,
        )
        return json.dumps({"reserved": num, "env": env}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
async def broker_release_migration_tool(
    number: int,
    env: str,
    ctx: Context | None = None,
) -> str:
    """Soft-release (tombstone) a previously reserved migration number."""
    ok = broker_release_migration(number, env)
    return json.dumps({"released": ok, "number": number, "env": env}, indent=2)


@mcp.tool()
async def broker_list_reserved_migrations_tool(
    env: str = "",
    ctx: Context | None = None,
) -> str:
    """List all reserved (not released) migration numbers."""
    rows = broker_list_reserved(env=env or None)
    return json.dumps({"count": len(rows), "reservations": rows}, indent=2)


@mcp.tool()
async def broker_emit_event_tool(
    event_type: str,
    payload: str = "",
    plan_id: str = "",
    lane_id: str = "",
    agent_id: str = "",
    ctx: Context | None = None,
) -> str:
    """Append an event to the broker event bus."""
    parsed_payload = {}
    if payload.strip():
        try:
            parsed_payload = json.loads(payload)
        except json.JSONDecodeError as e:
            return json.dumps({"error": f"Invalid payload JSON: {e}"}, indent=2)
    event_id = broker_emit(
        event_type=event_type,
        payload=parsed_payload or None,
        plan_id=plan_id or None,
        lane_id=lane_id or None,
        agent_id=agent_id or None,
    )
    return json.dumps({"event_id": event_id}, indent=2)


@mcp.tool()
async def broker_get_events_tool(
    event_type: str = "",
    plan_id: str = "",
    lane_id: str = "",
    since: float = 0.0,
    limit: int = 1000,
    ctx: Context | None = None,
) -> str:
    """Query events from the broker event bus."""
    rows = broker_get_events(
        event_type=event_type or None,
        plan_id=plan_id or None,
        lane_id=lane_id or None,
        since=since,
        limit=limit,
    )
    return json.dumps({"count": len(rows), "events": rows}, indent=2)


@mcp.tool()
async def broker_post_cue_tool(
    content: str,
    plan_id: str = "",
    lane_id: str = "",
    ctx: Context | None = None,
) -> str:
    """Post a steering cue to the swarm (deduped by content hash)."""
    result = broker_post_cue(
        content=content,
        plan_id=plan_id or None,
        lane_id=lane_id or None,
    )
    return json.dumps(result, indent=2)


@mcp.tool()
async def broker_read_cues_tool(
    plan_id: str = "",
    lane_id: str = "",
    since: float = 0.0,
    ctx: Context | None = None,
) -> str:
    """Read pending (unacked) steering cues."""
    rows = broker_read_cues(
        plan_id=plan_id or None,
        lane_id=lane_id or None,
        since=since,
    )
    return json.dumps({"count": len(rows), "cues": rows}, indent=2)


@mcp.tool()
async def broker_ack_cue_tool(
    cue_id: str,
    ctx: Context | None = None,
) -> str:
    """Acknowledge a cue by ID."""
    ok = broker_ack_cue(cue_id)
    return json.dumps({"acked": ok, "cue_id": cue_id}, indent=2)


@mcp.tool()
async def broker_escalate_tool(
    plan_id: str,
    reason: str,
    thread_id: str,
    lane_id: str = "",
    checkpoint_id: str = "",
    ctx: Context | None = None,
) -> str:
    """Register an interrupt for human-in-the-loop escalation.

    Pauses the lane until broker_resume is called.
    """
    if not plan_id or not reason or not thread_id:
        return json.dumps({"error": "plan_id, reason, and thread_id are required"}, indent=2)
    record = broker_register_interrupt(
        plan_id=plan_id,
        thread_id=thread_id,
        reason=reason,
        lane_id=lane_id or None,
        checkpoint_id=checkpoint_id or None,
    )
    return json.dumps({"interrupt": record}, indent=2)


@mcp.tool()
async def broker_resume_tool(
    plan_id: str,
    payload: str = "",
    ctx: Context | None = None,
) -> str:
    """Resume a plan lane from an active interrupt."""
    if not plan_id:
        return json.dumps({"error": "plan_id is required"}, indent=2)
    parsed_payload = {}
    if payload.strip():
        try:
            parsed_payload = json.loads(payload)
        except json.JSONDecodeError as e:
            return json.dumps({"error": f"Invalid payload JSON: {e}"}, indent=2)
    record = broker_resume_interrupt(plan_id=plan_id, payload=parsed_payload or None)
    if not record:
        return json.dumps({"error": f"No active interrupt found for {plan_id}"}, indent=2)
    return json.dumps({"resumed": record}, indent=2)


@mcp.tool()
async def broker_list_interrupts_tool(
    status: str = "",
    plan_id: str = "",
    ctx: Context | None = None,
) -> str:
    """List interrupts with optional filters."""
    rows = broker_list_interrupts(
        status=status or None,
        plan_id=plan_id or None,
    )
    return json.dumps({"count": len(rows), "interrupts": rows}, indent=2)


@mcp.tool()
async def broker_heartbeat_tool(
    lane_id: str,
    agent_id: str = "",
    ctx: Context | None = None,
) -> str:
    """Update the last_heartbeat timestamp for a lane.

    Agents should call this every ~30s while alive.
    """
    if not lane_id:
        return json.dumps({"error": "lane_id is required"}, indent=2)
    broker_heartbeat(lane_id, agent_id=agent_id)
    return json.dumps({"lane_id": lane_id, "agent_id": agent_id, "ok": True}, indent=2)


@mcp.tool()
async def broker_submit_handoff_tool(
    plan_id: str,
    subtask_id: str,
    status: str,
    handoff_to: str,
    sequence: int = 0,
    done: str = "",
    next_actions: str = "",
    state_notes: str = "",
    files_touched: str = "",
    migrations_reserved: str = "",
    context_used: int = 0,
    ctx: Context | None = None,
) -> str:
    """Submit a developer handoff (required exit artifact).

    status: complete | context_exhausted | blocked
    handoff_to: next_dev | qa_deploy | supervisor_reroute
    """
    if not plan_id or not subtask_id or not status or not handoff_to:
        return json.dumps({"error": "plan_id, subtask_id, status, and handoff_to are required"}, indent=2)

    def _parse_json(field: str, name: str) -> list:
        if not field.strip():
            return []
        try:
            return json.loads(field)
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid JSON for {name}: {e}")

    try:
        record = broker_submit_handoff(
            plan_id=plan_id,
            subtask_id=subtask_id,
            status=status,
            handoff_to=handoff_to,
            sequence=sequence or None,
            done=_parse_json(done, "done"),
            next_actions=_parse_json(next_actions, "next_actions"),
            state_notes=_parse_json(state_notes, "state_notes"),
            files_touched=_parse_json(files_touched, "files_touched"),
            migrations_reserved=_parse_json(migrations_reserved, "migrations_reserved"),
            context_used=context_used or None,
        )
        return json.dumps({"submitted": record}, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)


@mcp.tool()
async def broker_get_handoff_tool(
    plan_id: str,
    subtask_id: str,
    sequence: int = 0,
    ctx: Context | None = None,
) -> str:
    """Get a specific handoff, or the latest for a (plan_id, subtask_id)."""
    if not plan_id or not subtask_id:
        return json.dumps({"error": "plan_id and subtask_id are required"}, indent=2)
    handoff = broker_get_handoff(plan_id, subtask_id, sequence=sequence or None)
    if not handoff:
        return json.dumps({"error": "Handoff not found"}, indent=2)
    return json.dumps(handoff, indent=2)


@mcp.tool()
async def broker_get_handoff_chain_tool(
    plan_id: str,
    ctx: Context | None = None,
) -> str:
    """Get the full handoff chain for a plan."""
    if not plan_id:
        return json.dumps({"error": "plan_id is required"}, indent=2)
    chain = broker_get_handoff_chain(plan_id)
    return json.dumps({"count": len(chain), "handoffs": chain}, indent=2)


# ---------------------------------------------------------------------------
# Tools — Swarm lane control
# ---------------------------------------------------------------------------

@mcp.tool()
async def harness_start_lane(
    plan_id: str,
    ctx: Context | None = None,
) -> str:
    """Start a swarm lane for a specific plan.

    The lane runs in the background (PM → Devs → QA-Deploy).
    Use harness_get_lane_status() to poll progress.
    """
    plan = broker_get_plan(plan_id)
    if not plan:
        return json.dumps({"error": f"Plan not found: {plan_id}"}, indent=2)
    if plan.get("status") not in ("PENDING", "CLAIMED"):
        return json.dumps({"error": f"Plan status is {plan.get('status')}, not PENDING or CLAIMED"}, indent=2)

    lane_id = _lane_id_from_plan_id(plan_id)
    running = {l["lane_id"] for l in lane_list_running_lanes()}
    if lane_id in running:
        return json.dumps({"error": f"Lane {lane_id} is already running"}, indent=2)

    # Atomic claim: prevent race conditions on concurrent starts
    if plan.get("status") == "PENDING":
        if not broker_claim_plan(plan_id, lane_id):
            return json.dumps({"error": f"Plan {plan_id} is already claimed or not PENDING"}, indent=2)

    try:
        lane_start_lane(plan_id, lane_id)
    except RuntimeError as e:
        return json.dumps({"error": str(e)}, indent=2)

    # Track in DB for observability
    try:
        conn = get_conn()
        conn.execute(
            "INSERT OR REPLACE INTO lanes (lane_id, plan_id, status, started_at, last_heartbeat, budget_used) VALUES (?, ?, ?, ?, ?, ?)",
            (lane_id, plan_id, "running", time.time(), time.time(), 0),
        )
        conn.commit()
        conn.close()
    except Exception:
        pass

    return json.dumps({
        "lane_id": lane_id,
        "plan_id": plan_id,
        "status": "started",
        "message": "Lane is running in the background. Poll with harness_get_lane_status().",
    }, indent=2)


@mcp.tool()
async def harness_get_lane_status(
    lane_id: str,
    ctx: Context | None = None,
) -> str:
    """Get the status of a running or finished lane.

    Queries the shared lane registry so lanes started by the orchestrator
    agent are visible here too.
    """
    status = lane_get_lane_status(lane_id)
    if status.get("status") == "not_found":
        return json.dumps({"lane_id": lane_id, "status": "not_found", "message": "No active lane with this ID."}, indent=2)

    if status.get("status") == "running":
        return json.dumps({"lane_id": lane_id, "status": "running"}, indent=2)

    if status.get("status") == "cancelled":
        return json.dumps({"lane_id": lane_id, "status": "cancelled"}, indent=2)

    final = status.get("result")
    return json.dumps({
        "lane_id": lane_id,
        "status": status.get("status", "complete"),
        "pr_url": final.get("pr_url") if final else None,
        "plan_budget_used": final.get("plan_budget_used") if final else None,
    }, indent=2)


@mcp.tool()
async def harness_stop_lane(
    lane_id: str,
    ctx: Context | None = None,
) -> str:
    """Stop (cancel) a running lane by its lane_id."""
    ok = lane_stop_lane(lane_id)
    try:
        conn = get_conn()
        conn.execute("UPDATE lanes SET status = 'stopped' WHERE lane_id = ?", (lane_id,))
        conn.commit()
        conn.close()
    except Exception:
        pass
    if ok:
        return json.dumps({"lane_id": lane_id, "stopped": True}, indent=2)
    return json.dumps({"lane_id": lane_id, "stopped": False, "message": "Lane not found or already finished."}, indent=2)


@mcp.tool()
async def harness_list_active_lanes(
    ctx: Context | None = None,
) -> str:
    """List all currently running lanes."""
    lanes = lane_list_running_lanes()
    return json.dumps({"count": len(lanes), "lanes": lanes}, indent=2)


@mcp.tool()
async def harness_run_swarm(
    max_lanes: int = 3,
    part_prefix: str = "",
    max_phase: int = 4,
    max_plans: int = 0,
    ctx: Context | None = None,
) -> str:
    """Auto-dispatch the swarm: claim runnable plans and run lanes until done.

    This blocks until all claimed plans finish. Use harness_list_active_lanes()
    to monitor progress from another context.

    Args:
        max_lanes: Parallel lanes (default 3).
        part_prefix: Filter to plans starting with this, e.g. "part2-".
        max_phase: Only claim plans with phase <= this.
        max_plans: Stop after claiming this many plans (0 = unlimited).
    """
    orchestrator = Orchestrator(
        max_lanes=max_lanes,
        checkpointer=_lane_checkpointer,
        part_prefix=part_prefix or None,
        max_phase=max_phase if max_phase >= 0 else None,
        max_plans=max_plans if max_plans > 0 else None,
    )

    # Run supervisor in background so MCP can still respond
    async def _run():
        while True:
            results = await orchestrator.tick()
            if not orchestrator._running and not results:
                break
            await asyncio.sleep(1)
        return orchestrator._plans_claimed

    task = asyncio.create_task(_run(), name="swarm-orchestrator")
    _lane_tasks["swarm-orchestrator"] = task

    return json.dumps({
        "status": "started",
        "message": f"Swarm orchestrator running with max_lanes={max_lanes}, part_prefix={part_prefix or 'all'}, max_phase={max_phase}",
        "monitor": "Use harness_list_active_lanes() to watch progress.",
    }, indent=2)




@mcp.tool()
async def broker_complete_plan_tool(
    plan_id: str,
    ctx: Context | None = None,
) -> str:
    """Mark a plan as COMPLETE in the broker registry.

    Use this to manually complete a plan when QA cannot,
    or as a terminal action from the QA agent.
    """
    if not plan_id:
        return json.dumps({"error": "plan_id is required"}, indent=2)
    from agent_harness.broker import mark_plan_complete
    ok = mark_plan_complete(plan_id)
    return json.dumps({"plan_id": plan_id, "marked_complete": ok}, indent=2)


@mcp.tool()
async def harness_meta_pm_recommend(
    message: str = "Analyze the current swarm state and recommend next actions.",
    ctx: Context | None = None,
) -> str:
    """Run the Meta-PM strategic agent and return its recommendation.

    The Meta-PM reviews all plans, runnable sets, conflicts, and recent
    events to decide which plans should run next and in what order.
    """
    try:
        result = run_meta_pm(message=message)
        # result is an AgentState-like dict with messages
        messages = result.get("messages", [])
        # Return the final AI message content as the recommendation
        final_content = ""
        for msg in reversed(messages):
            if hasattr(msg, "content") and msg.content:
                final_content = msg.content
                break
            if isinstance(msg, dict) and msg.get("content"):
                final_content = msg["content"]
                break
        return json.dumps({
            "recommendation": final_content,
            "message_count": len(messages),
        }, indent=2)
    except Exception as e:
        return json.dumps({"error": str(e)}, indent=2)

# ---------------------------------------------------------------------------
# Prompts
# ---------------------------------------------------------------------------


def _load_prompt(name: str) -> str:
    path = PROMPTS_DIR / f"{name}.md"
    if path.exists():
        return path.read_text()
    return f"# {name.title()} Prompt\nPrompt file not found."


@mcp.prompt()
def harness_pm_prompt() -> str:
    """Product Manager role prompt for harness workflows."""
    return _load_prompt("pm")


@mcp.prompt()
def harness_designer_prompt() -> str:
    """UI/UX Designer role prompt for harness workflows."""
    return _load_prompt("designer")


@mcp.prompt()
def harness_architect_prompt() -> str:
    """System Architect role prompt for harness workflows."""
    return _load_prompt("architect")


@mcp.prompt()
def harness_frontend_prompt() -> str:
    """Frontend Developer role prompt for harness workflows."""
    return _load_prompt("frontend")


@mcp.prompt()
def harness_backend_prompt() -> str:
    """Backend Developer role prompt for harness workflows."""
    return _load_prompt("backend")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

# ---------------------------------------------------------------------------
# Custom stdio transport — auto-detects Content-Length vs line-delimited JSON
# Kimi CLI (and Python mcp SDK) use line-delimited JSON.
# Claude Desktop (and TypeScript MCP SDK) use Content-Length framing.
# This transport speaks both — auto-detecting from the first message.
# ---------------------------------------------------------------------------

from contextlib import asynccontextmanager

import anyio
import anyio.lowlevel
from anyio.streams.memory import MemoryObjectReceiveStream, MemoryObjectSendStream

import mcp.types as types
from mcp.shared.message import SessionMessage


@asynccontextmanager
async def _stdio_server_dual():
    """Stdio server transport supporting both Content-Length and line-delimited JSON."""
    stdin = anyio.wrap_file(sys.stdin.buffer)
    stdout = anyio.wrap_file(sys.stdout.buffer)

    read_stream_writer, read_stream = anyio.create_memory_object_stream(0)
    write_stream, write_stream_reader = anyio.create_memory_object_stream(0)

    # Detected protocol: "content-length" or "line-delimited"
    _protocol: str | None = None

    async def _read_line() -> bytes:
        """Read until \\n."""
        line = b""
        while b"\n" not in line:
            try:
                chunk = await stdin.read(1)
            except anyio.ClosedResourceError:
                return b""
            if not chunk:
                return b""
            line += chunk
        return line

    async def stdin_reader():
        nonlocal _protocol
        try:
            async with read_stream_writer:
                while True:
                    first_line = await _read_line()
                    if not first_line:
                        return

                    stripped = first_line.strip()

                    # Auto-detect protocol from first message
                    if stripped.lower().startswith(b"content-length:"):
                        _protocol = "content-length"
                        # Parse Content-Length value
                        cl = int(stripped.split(b":", 1)[1].strip())

                        # Read separator empty line (\r\n or just \n)
                        if first_line.endswith(b"\r\n"):
                            # Need to read \r\n
                            sep = b""
                            while b"\n" not in sep:
                                chunk = await stdin.read(1)
                                if not chunk:
                                    return
                                sep += chunk

                        # Read exactly cl bytes
                        body = b""
                        while len(body) < cl:
                            chunk = await stdin.read(cl - len(body))
                            if not chunk:
                                return
                            body += chunk

                        try:
                            message = types.JSONRPCMessage.model_validate_json(body.decode("utf-8"))
                        except Exception as exc:
                            await read_stream_writer.send(exc)
                            continue

                    else:
                        _protocol = "line-delimited"
                        try:
                            message = types.JSONRPCMessage.model_validate_json(stripped.decode("utf-8"))
                        except Exception as exc:
                            await read_stream_writer.send(exc)
                            continue

                    session_message = SessionMessage(message)
                    await read_stream_writer.send(session_message)
        except anyio.ClosedResourceError:
            await anyio.lowlevel.checkpoint()

    async def stdout_writer():
        try:
            async with write_stream_reader:
                async for session_message in write_stream_reader:
                    json_bytes = session_message.message.model_dump_json(
                        by_alias=True, exclude_none=True
                    ).encode("utf-8")

                    # Mirror the detected input protocol for output
                    if _protocol == "content-length":
                        payload = f"Content-Length: {len(json_bytes)}\r\n\r\n".encode("utf-8") + json_bytes
                    else:
                        # Default to line-delimited (also works for undetected)
                        payload = json_bytes + b"\n"

                    await stdout.write(payload)
                    await stdout.flush()
        except anyio.ClosedResourceError:
            await anyio.lowlevel.checkpoint()

    async with anyio.create_task_group() as tg:
        tg.start_soon(stdin_reader)
        tg.start_soon(stdout_writer)
        yield read_stream, write_stream


async def _run_stdio(ws_host: str, ws_port: int) -> None:
    """Run MCP stdio transport + WebSocket server concurrently."""
    global ws_server
    ws_server = AgentWebSocketServer(host=ws_host, port=ws_port)
    try:
        await ws_server.start()
    except OSError as e:
        logger.warning(f"Could not start WebSocket server ({e})")
        ws_server = None
    # Use dual-protocol transport
    async with _stdio_server_dual() as (read_stream, write_stream):
        await mcp._mcp_server.run(
            read_stream,
            write_stream,
            mcp._mcp_server.create_initialization_options(),
        )


def main():
    parser = argparse.ArgumentParser(description="Agent Harness MCP Server")
    parser.add_argument("--transport", choices=["stdio", "sse", "streamable-http"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--ws-port", type=int, default=8766)
    parser.add_argument("--data-dir", default=".swarm", help="Base directory for all persistence (broker.db, checkpoints, messages, state)")
    parser.add_argument("--broker-db", default=None, help="Override broker DB path (default: DATA_DIR/broker.db)")
    args = parser.parse_args()

    # Resolve data directory before any module initializes its defaults
    config.DATA_DIR = Path(args.data_dir).resolve()

    # Initialise broker database BEFORE orchestrator (orchestrator reads from DB)
    broker_db_path = init_broker_db(args.broker_db)
    logger.info(f"Database initialised: {broker_db_path}")

    # Re-initialize the orchestrator now that data_dir is known
    global orchestrator
    orchestrator = HarnessOrchestrator()

    # Run retention pruning on startup to prevent unbounded DB growth
    try:
        deleted_events = broker_prune_events(max_age_days=30, max_rows=50000)
        deleted_migrations = broker_prune_migration_ledger(max_age_days=30)
        deleted_checkpoints = prune_checkpoints(keep_per_thread=5)
        deleted_messages = 0
        if orchestrator and orchestrator.message_queue:
            deleted_messages = orchestrator.message_queue._prune_sync(max_age_days=30, max_rows=10000)
        print(
            f"[retention] Pruned {deleted_events} events, "
            f"{deleted_migrations} migration ledger entries, "
            f"{deleted_checkpoints} checkpoints, "
            f"{deleted_messages} messages",
            file=sys.stderr,
        )
    except Exception as e:
        logger.warning(f"Retention pruning failed ({e})")

    if args.transport == "stdio":
        try:
            asyncio.run(_run_stdio(args.host, args.ws_port))
        except KeyboardInterrupt:
            logger.info("Shutting down...")
    else:
        global ws_server
        ws_server = AgentWebSocketServer(host=args.host, port=args.ws_port)
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(ws_server.start())
        mcp.settings.host = args.host
        mcp.settings.port = args.port
        print(f"[harness] MCP {args.transport} server on http://{args.host}:{args.port}")
        mcp.run(transport=args.transport)


if __name__ == "__main__":
    main()
