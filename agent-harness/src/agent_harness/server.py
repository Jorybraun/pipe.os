#!/usr/bin/env python3
"""Agent Harness MCP Server

Run with stdio transport (for Kimi Code CLI / Claude Desktop):
    python -m agent_harness.server

Run with SSE transport (for HTTP clients):
    python -m agent_harness.server --transport sse --port 8765

WebSocket agent notifications run on port 8766 by default (or --ws-port).
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
from pathlib import Path
from typing import Any

from mcp.server.fastmcp import Context, FastMCP

from agent_harness.orchestrator import HarnessOrchestrator
from agent_harness.telemetry_queue import HarnessEvent
from agent_harness.websocket_server import AgentWebSocketServer
from agent_harness.broker import (
    init_db as init_broker_db,
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
)

PROMPTS_DIR = Path(__file__).parent / "prompts"
STATE_PATH = Path(".swarm") / "mcp_state.json"

orchestrator = HarnessOrchestrator(str(STATE_PATH))
ws_server: AgentWebSocketServer | None = None

mcp = FastMCP(
    "agent-harness",
    instructions=(
        "Agent Harness orchestrates multi-agent development workflows. "
        "Use the harness tools to start workflows, spawn agents, run QA gates, "
        "manage approval gates, and steer agents via real-time messaging."
    ),
)


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
    """Get the current status of a workflow."""
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
    """List all active workflows."""
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
    """Transition a workflow to a new phase."""
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
    """Run quality gates for a workflow."""
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
    """Get telemetry events for a workflow (includes persisted events across sessions)."""
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
    """Poll for new telemetry events with a timeout. Blocks until events arrive or timeout."""
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
    """Mark a workflow as complete or failed."""
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
    """Interrupt and pause a running workflow."""
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
    """Re-scan docs/plans/strategy-v2/**/*.md and sync to the broker database."""
    count = sync_plans_to_db()
    return json.dumps({"synced": count}, indent=2)


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

async def _run_stdio(ws_host: str, ws_port: int) -> None:
    """Run MCP stdio transport + WebSocket server concurrently."""
    global ws_server
    ws_server = AgentWebSocketServer(host=ws_host, port=ws_port)
    await ws_server.start()
    # FastMCP stdio blocks; run it in the same loop
    mcp.run(transport="stdio")


def main():
    parser = argparse.ArgumentParser(description="Agent Harness MCP Server")
    parser.add_argument("--transport", choices=["stdio", "sse"], default="stdio")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--ws-port", type=int, default=8766)
    parser.add_argument("--broker-db", default=".swarm/broker.db")
    args = parser.parse_args()

    # Initialise broker database
    broker_db_path = init_broker_db(args.broker_db)
    print(f"[broker] Database initialised: {broker_db_path}", file=sys.stderr)

    if args.transport == "stdio":
        try:
            asyncio.run(_run_stdio(args.host, args.ws_port))
        except KeyboardInterrupt:
            print("\n[harness] Shutting down...")
    else:
        global ws_server
        ws_server = AgentWebSocketServer(host=args.host, port=args.ws_port)
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        loop.run_until_complete(ws_server.start())
        print(f"[harness] MCP SSE server on http://{args.host}:{args.port}")
        mcp.run(transport="sse", host=args.host, port=args.port)


if __name__ == "__main__":
    main()
