"""LangGraph swarm topology: Lane graph with native supervisor + Lane Advisor + Dev loop + QA."""
from __future__ import annotations

import asyncio
import json
import operator
import uuid
from typing import Any, Literal

from langchain_core.messages import AnyMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from langgraph.graph import END, START, StateGraph
from langgraph.graph.message import add_messages
from langgraph.types import Send, interrupt
from pydantic import BaseModel, Field
from typing_extensions import Annotated, TypedDict

from agent_harness.broker import (
    emit,
    get_handoff,
    get_handoff_chain,
    get_plan,
    mark_plan_complete,
    register_interrupt,
    runnable_set,
    conflicts_for,
    claim_plan,
    heartbeat,
)
from agent_harness.broker.db import get_conn
from agent_harness.swarm.agents.advisor import run_advisor
from agent_harness.swarm.agents.developer import run_developer
from agent_harness.swarm.agents.qa_deploy import run_qa_deploy
from agent_harness.swarm.budget import MAX_HANDOFFS_PER_SUBTASK, PLAN_BUDGET_LIMIT
from agent_harness.swarm.escalation import should_escalate
from agent_harness.swarm.checkpoint import get_checkpointer


# ---------------------------------------------------------------------------
# Lane state
# ---------------------------------------------------------------------------

class WorkItem(TypedDict):
    subtask_id: str
    title: str
    spec: str
    files: list[str]
    migrations: list[int]
    status: str


class LaneState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    plan_path: str
    plan_id: str
    lane_id: str
    work_items: list[WorkItem]
    current_subtask_id: str | None
    current_handoff: dict[str, Any] | None
    handoff_chain: Annotated[list[dict[str, Any]], operator.add]
    reserved_migrations: list[int]
    pr_url: str | None
    plan_budget_used: int
    iteration: int
    status: str
    advisor_guidance: str | None
    next_node: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _find_next_pending(work_items: list[WorkItem]) -> str | None:
    for wi in work_items:
        if wi["status"] == "pending":
            return wi["subtask_id"]
    return None


def _init_work_items(plan_id: str) -> list[WorkItem]:
    """Hydrate work_items from the broker plan."""
    plan = get_plan(plan_id)
    work_items: list[WorkItem] = []
    if not plan:
        return work_items
    for st in plan.get("subtasks", []):
        files = st.get("files", "[]")
        if isinstance(files, str):
            files = json.loads(files)
        migrations = st.get("migrations", "[]")
        if isinstance(migrations, str):
            migrations = json.loads(migrations)
        work_items.append({
            "subtask_id": st["subtask_id"],
            "title": st["title"],
            "spec": st.get("spec", ""),
            "files": files,
            "migrations": migrations,
            "status": "pending",
        })
    return work_items


def _make_supervisor_model() -> ChatOpenAI:
    import os
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY not set")
    return ChatOpenAI(
        model="kimi-latest",
        temperature=0.1,
        max_tokens=1024,
        api_key=api_key,
        base_url="https://api.moonshot.cn/v1",
    )


# ---------------------------------------------------------------------------
# Lane Supervisor — structured routing agent
# ---------------------------------------------------------------------------

class LaneRoutingDecision(BaseModel):
    next_node: Literal["advisor", "developer", "qa_deploy", "escalate", "end"] = Field(
        description="The next node to route to in the lane graph"
    )
    reasoning: str = Field(description="Why this routing decision was made")
    target_subtask_id: str | None = Field(
        default=None,
        description="Which subtask to focus on (for advisor/developer routing)",
    )


def lane_supervisor_node(state: LaneState, config: RunnableConfig) -> dict[str, Any]:
    """Lane supervisor — reads state and makes structured routing decisions."""
    work_items = state.get("work_items", [])
    pending = [w for w in work_items if w["status"] == "pending"]
    complete = [w for w in work_items if w["status"] == "complete"]
    blocked = [w for w in work_items if w["status"] == "blocked"]
    current_id = state.get("current_subtask_id")
    last_handoff = state.get("current_handoff")
    lane_status = state.get("status", "running")
    guidance = state.get("advisor_guidance")

    # If the lane is already blocked/escalated/failed, route to escalate or end
    if lane_status in ("blocked", "escalated", "failed"):
        return {
            "next_node": "escalate",
            "messages": [SystemMessage(content=f"Supervisor: lane status={lane_status}, routing to escalate.")],
        }

    # Budget guard: if plan budget exhausted, escalate immediately
    plan_budget_used = state.get("plan_budget_used", 0)
    if plan_budget_used >= PLAN_BUDGET_LIMIT:
        return {
            "next_node": "escalate",
            "messages": [SystemMessage(content=f"Supervisor: plan budget exhausted ({plan_budget_used} >= {PLAN_BUDGET_LIMIT}), routing to escalate.")],
        }

    # Build supervisor prompt
    prompt_parts = [
        "You are a lane supervisor. Decide the next step for this plan lane.",
        f"\nPlan: {state['plan_id']}",
        f"Lane: {state['lane_id']}",
        f"Total subtasks: {len(work_items)}",
        f"Pending: {len(pending)} | Complete: {len(complete)} | Blocked: {len(blocked)}",
    ]

    if current_id:
        prompt_parts.append(f"Current subtask: {current_id}")
    else:
        prompt_parts.append("Current subtask: None (need to pick next pending)")

    if last_handoff:
        prompt_parts.append(f"Last handoff status: {last_handoff.get('status', 'unknown')}")
        prompt_parts.append(f"Last handoff subtask: {last_handoff.get('subtask_id', 'unknown')}")
    else:
        prompt_parts.append("Last handoff: None (first run)")

    if guidance:
        prompt_parts.append(f"Advisor guidance present: yes (will be cleared after dev)")
    else:
        prompt_parts.append("Advisor guidance present: no")

    prompt_parts.append("\nAvailable nodes:")
    prompt_parts.append("- advisor: Review plan/handoff and emit architectural guidance")
    prompt_parts.append("- developer: Run developer on current subtask")
    prompt_parts.append("- qa_deploy: All subtasks done, run QA")
    prompt_parts.append("- escalate: Something is blocked/escalated")
    prompt_parts.append("- end: Lane is finished")

    prompt_parts.append("\nRouting rules:")
    prompt_parts.append("1. If no current subtask and pending exist → route to advisor (to review plan before first dev)")
    prompt_parts.append("2. If current subtask exists and no advisor guidance → route to advisor (review handoff before next dev)")
    prompt_parts.append("3. If current subtask exists and advisor guidance present → route to developer")
    prompt_parts.append("4. If no pending subtasks and all complete → route to qa_deploy")
    prompt_parts.append("5. If blocked subtasks exist → route to escalate")
    prompt_parts.append("6. If qa_deploy finished → route to end")

    prompt_parts.append("\nMake your routing decision.")

    model = _make_supervisor_model()
    response = model.with_structured_output(LaneRoutingDecision).invoke([
        SystemMessage(content="\n".join(prompt_parts))
    ])

    updates: dict[str, Any] = {
        "next_node": response.next_node,
        "messages": [SystemMessage(content=f"Supervisor: {response.reasoning} → {response.next_node}")],
    }

    if response.target_subtask_id:
        updates["current_subtask_id"] = response.target_subtask_id
    elif response.next_node == "advisor" and not current_id and pending:
        # Pick first pending subtask for advisor to review
        updates["current_subtask_id"] = pending[0]["subtask_id"]

    # Heartbeat: supervisor is alive and making routing decisions
    heartbeat(state["lane_id"], agent_id="supervisor")

    return updates


def route_from_supervisor(state: LaneState) -> str:
    """Conditional edge routing from supervisor node."""
    next_node = state.get("next_node", "end")
    if next_node == "end":
        return END
    return next_node


# ---------------------------------------------------------------------------
# Lane Advisor
# ---------------------------------------------------------------------------

def advisor_node(state: LaneState, config: RunnableConfig) -> dict[str, Any]:
    """Run the lane advisor and emit guidance."""
    plan_id = state["plan_id"]
    current_id = state.get("current_subtask_id")
    lane_id = state["lane_id"]

    result = run_advisor(plan_id=plan_id, current_subtask_id=current_id, lane_id=lane_id)

    updates: dict[str, Any] = {
        "advisor_guidance": result.guidance,
        "messages": [
            SystemMessage(content=f"Advisor: {result.reasoning}"),
            SystemMessage(content=f"Advisor guidance:\n{result.guidance}"),
        ],
    }

    if result.recommend_escalation:
        updates["status"] = "escalated"
        updates["messages"].append(
            SystemMessage(content="Advisor recommended escalation due to plan health issues.")
        )

    return updates


# ---------------------------------------------------------------------------
# Developer
# ---------------------------------------------------------------------------

def developer_node(state: LaneState, config: RunnableConfig) -> dict[str, Any]:
    """Run one ephemeral developer for the current subtask, then update lane state."""
    plan_id = state["plan_id"]
    work_items = list(state["work_items"])
    current_id = state.get("current_subtask_id")

    if not current_id:
        return {
            "status": "failed",
            "messages": [SystemMessage(content="Developer node called with no current_subtask_id")],
        }

    # Fetch plan content focused on this subtask
    plan = get_plan(plan_id)
    if not plan:
        return {"status": "failed", "messages": [SystemMessage(content="Plan not found in broker")]}

    subtask = next(
        (s for s in plan.get("subtasks", []) if s.get("subtask_id") == current_id),
        None,
    )
    plan_content = (
        f"# {plan.get('title', plan_id)}\n\n"
        f"## Subtask {current_id}\n"
        f"{subtask.get('spec', '(no spec)') if subtask else '(no spec)'}"
    )

    # Inject advisor guidance if present
    guidance = state.get("advisor_guidance")
    if guidance:
        plan_content += f"\n\n## Architectural Guidance from Lane Advisor\n{guidance}"

    # Latest handoff for this subtask (input to next dev)
    latest_handoff = get_handoff(plan_id, current_id)

    # Check per-subtask handoff cap
    handoff_count = sum(1 for h in state.get("handoff_chain", []) if h.get("subtask_id") == current_id)
    if handoff_count >= MAX_HANDOFFS_PER_SUBTASK:
        return {
            "status": "escalated",
            "messages": [SystemMessage(content=f"Handoff cap exceeded for {current_id}")],
        }

    # Emit event
    emit(
        event_type="subtask_started",
        payload={"plan_id": plan_id, "lane_id": state["lane_id"], "subtask_id": current_id, "dev_sequence": handoff_count + 1},
    )

    # Run ephemeral developer
    dev_thread_id = f"{state['lane_id']}:{current_id}:{handoff_count + 1}"
    dev_final = run_developer(
        plan_id=plan_id,
        subtask_id=current_id,
        plan_content=plan_content,
        handoff_in=latest_handoff,
        thread_id=dev_thread_id,
    )

    # Read back the handoff the developer submitted
    new_handoff = get_handoff(plan_id, current_id)
    if not new_handoff:
        return {
            "status": "failed",
            "messages": [SystemMessage(content="Developer did not submit a handoff.")],
        }

    # Update work item status
    for wi in work_items:
        if wi["subtask_id"] == current_id:
            if new_handoff["status"] == "complete":
                wi["status"] = "complete"
            elif new_handoff["status"] == "blocked":
                wi["status"] = "blocked"
            # context_exhausted stays pending for next dev
            break

    new_budget = state.get("plan_budget_used", 0) + (dev_final.get("budget_used") or 0)

    # Write budget to lanes table for external watchdog visibility
    conn = get_conn()
    conn.execute(
        "UPDATE lanes SET budget_used = ? WHERE lane_id = ?",
        (new_budget, state["lane_id"]),
    )
    conn.commit()
    conn.close()

    updates: dict[str, Any] = {
        "handoff_chain": [new_handoff],
        "current_handoff": new_handoff,
        "plan_budget_used": new_budget,
        "work_items": work_items,
        "advisor_guidance": None,  # Clear guidance after dev run
    }

    if new_handoff["status"] == "complete":
        # Clear current subtask so supervisor picks the next pending one
        updates["current_subtask_id"] = None
        emit(event_type="subtask_complete", payload={"plan_id": plan_id, "subtask_id": current_id})
    elif new_handoff["status"] == "context_exhausted":
        # Keep same subtask for next dev iteration
        updates["current_subtask_id"] = current_id
    elif new_handoff["status"] == "blocked":
        updates["status"] = "blocked"
        updates["current_subtask_id"] = current_id

    # Heartbeat: developer finished a turn
    heartbeat(state["lane_id"], agent_id="developer")

    return updates


# ---------------------------------------------------------------------------
# QA-Deploy, Escalate, Escalation Gate
# ---------------------------------------------------------------------------

def qa_deploy_node(state: LaneState, config: RunnableConfig) -> dict[str, Any]:
    """Run QA-Deploy agent and finalize the lane."""
    plan_id = state["plan_id"]
    lane_id = state["lane_id"]

    qa_final = run_qa_deploy(plan_id=plan_id, lane_id=lane_id, thread_id=f"{lane_id}:qa")

    qa_status = qa_final.get("status") if qa_final else "failed"
    pr_url = qa_final.get("pr_url") if qa_final else None

    if qa_status == "complete":
        final_status = "complete"
        event_type = "plan_completed"
        mark_plan_complete(plan_id)
    else:
        final_status = "failed"
        event_type = "plan_failed"

    # Heartbeat: QA-Deploy finished
    heartbeat(lane_id, agent_id="qa_deploy")

    conn = get_conn()
    conn.execute(
        """
        UPDATE lanes SET status = ?, pr_url = ?, last_heartbeat = ?
        WHERE lane_id = ?
        """,
        (final_status, pr_url, __import__("time").time(), lane_id),
    )
    conn.commit()
    conn.close()

    emit(event_type=event_type, payload={"plan_id": plan_id, "lane_id": lane_id, "pr_url": pr_url})

    return {
        "status": final_status,
        "pr_url": pr_url,
        "messages": [SystemMessage(content=f"QA-Deploy finished with status={final_status} pr={pr_url}")],
    }


def escalate_node(state: LaneState, config: RunnableConfig) -> dict[str, Any]:
    thread_id = config.get("configurable", {}).get("thread_id", "unknown")
    register_interrupt(
        plan_id=state["plan_id"],
        thread_id=thread_id,
        reason=state.get("status", "unknown"),
        lane_id=state["lane_id"],
    )
    emit(
        event_type="escalated",
        payload={"plan_id": state["plan_id"], "lane_id": state["lane_id"], "reason": state.get("status")},
    )
    return {"status": "escalated"}


def escalation_gate_node(state: LaneState, config: RunnableConfig) -> dict[str, Any]:
    """Check if plan requires human approval before terminal completion."""
    plan = get_plan(state["plan_id"])
    escalate, reason = should_escalate(plan, state)
    if escalate:
        decision = interrupt({
            "reason": reason,
            "pr_url": state.get("pr_url"),
            "plan_id": state["plan_id"],
            "lane_id": state["lane_id"],
        })
        if decision == "merge_approved":
            return {
                "status": "complete",
                "messages": [SystemMessage(content="Escalation approved. Lane complete.")],
            }
        return {
            "status": "escalated",
            "messages": [SystemMessage(content=f"Escalation rejected or paused: {decision}")],
        }
    return {"status": "complete"}


# ---------------------------------------------------------------------------
# Lane graph builder
# ---------------------------------------------------------------------------

def build_lane_graph(checkpointer: Any | None = None):
    """Build and compile a lane graph: Supervisor → Advisor → Dev → QA-Deploy → Escalation gate."""
    builder = StateGraph(LaneState)
    builder.add_node("supervisor", lane_supervisor_node)
    builder.add_node("advisor", advisor_node)
    builder.add_node("developer", developer_node)
    builder.add_node("qa_deploy", qa_deploy_node)
    builder.add_node("escalate", escalate_node)
    builder.add_node("escalation_gate", escalation_gate_node)

    builder.add_edge(START, "supervisor")
    builder.add_conditional_edges(
        "supervisor",
        route_from_supervisor,
        {
            "advisor": "advisor",
            "developer": "developer",
            "qa_deploy": "qa_deploy",
            "escalate": "escalate",
            END: END,
        },
    )
    builder.add_edge("advisor", "supervisor")
    builder.add_edge("developer", "supervisor")
    builder.add_edge("qa_deploy", "escalation_gate")
    builder.add_edge("escalation_gate", END)
    builder.add_edge("escalate", END)

    return builder.compile(checkpointer=checkpointer)


# ---------------------------------------------------------------------------
# Supervisor async loop (production dispatcher)
# ---------------------------------------------------------------------------

MAX_LANE_RUNTIME_SECONDS = 30 * 60  # 30 minutes per lane
LANE_STALL_TIMEOUT_SECONDS = 5 * 60  # 5 minutes without progress


class Orchestrator:
    """Long-lived orchestrator that maintains a pool of running lane graphs."""

    def __init__(
        self,
        max_lanes: int = 3,
        checkpointer: Any | None = None,
        part_prefix: str | None = None,
        max_phase: int | None = None,
        max_plans: int | None = None,
        max_subtasks: int | None = None,
    ):
        self.max_lanes = max_lanes
        self.checkpointer = checkpointer or get_checkpointer()
        self.part_prefix = part_prefix
        self.max_phase = max_phase
        self.max_plans = max_plans
        self.max_subtasks = max_subtasks
        self._running: dict[str, asyncio.Task] = {}
        self._lane_start_times: dict[str, float] = {}
        self._lane_last_progress: dict[str, float] = {}
        self._plans_claimed: int = 0
        self._subtasks_completed: int = 0
        self._completed_plan_ids: set[str] = set()

    def _running_plan_ids(self) -> set[str]:
        return {self._plan_id_from_lane_id(lid) for lid in self._running}

    @staticmethod
    def _plan_id_from_lane_id(lane_id: str) -> str:
        prefix = "lane-"
        if lane_id.startswith(prefix):
            return lane_id[len(prefix):].replace("-", "/")
        return lane_id

    @staticmethod
    def _lane_id_from_plan_id(plan_id: str) -> str:
        return f"lane-{plan_id.replace('/', '-')}"

    async def tick(self) -> list[dict[str, Any]]:
        """Claim runnable plans and dispatch up to max_lanes lanes."""
        now = asyncio.get_event_loop().time()

        # Clean up finished tasks
        done_lanes = [lid for lid, task in self._running.items() if task.done()]
        results = []
        for lid in done_lanes:
            task = self._running.pop(lid)
            self._lane_start_times.pop(lid, None)
            self._lane_last_progress.pop(lid, None)
            try:
                results.append({"lane_id": lid, "final_state": task.result()})
            except Exception as exc:
                results.append({"lane_id": lid, "error": str(exc)})

        # Watchdog: kill stalled or timed-out lanes
        conn = get_conn()
        for lid, task in list(self._running.items()):
            start = self._lane_start_times.get(lid, now)
            runtime = now - start

            if runtime >= MAX_LANE_RUNTIME_SECONDS:
                task.cancel()
                results.append({"lane_id": lid, "error": f"Lane exceeded max runtime ({MAX_LANE_RUNTIME_SECONDS}s)"})
                self._running.pop(lid, None)
                self._lane_start_times.pop(lid, None)
                self._lane_last_progress.pop(lid, None)
                emit(event_type="lane_killed", payload={"lane_id": lid, "reason": "max_runtime_exceeded", "runtime": runtime})
                continue

            # Use DB heartbeat for stall detection (more accurate than task runtime proxy)
            row = conn.execute(
                "SELECT last_heartbeat FROM lanes WHERE lane_id = ?",
                (lid,),
            ).fetchone()
            last_heartbeat = row["last_heartbeat"] if row and row["last_heartbeat"] else start
            stall = now - last_heartbeat
            if stall >= LANE_STALL_TIMEOUT_SECONDS:
                task.cancel()
                results.append({"lane_id": lid, "error": f"Lane stalled ({stall}s since last heartbeat)"})
                self._running.pop(lid, None)
                self._lane_start_times.pop(lid, None)
                self._lane_last_progress.pop(lid, None)
                emit(event_type="lane_killed", payload={"lane_id": lid, "reason": "stalled", "stall_seconds": stall})
        conn.close()

        # Watchdog: kill lanes that exceeded plan budget
        conn = get_conn()
        for lid, task in list(self._running.items()):
            row = conn.execute(
                "SELECT budget_used FROM lanes WHERE lane_id = ?",
                (lid,),
            ).fetchone()
            budget_used = row["budget_used"] if row else 0
            if budget_used >= PLAN_BUDGET_LIMIT:
                task.cancel()
                results.append({"lane_id": lid, "error": f"Plan budget exceeded ({budget_used} >= {PLAN_BUDGET_LIMIT})"})
                self._running.pop(lid, None)
                self._lane_start_times.pop(lid, None)
                self._lane_last_progress.pop(lid, None)
                emit(event_type="lane_killed", payload={"lane_id": lid, "reason": "plan_budget_exceeded", "budget_used": budget_used})
        conn.close()

        # Claim new plans
        plan_ids = runnable_set(part_prefix=self.part_prefix, max_phase=self.max_phase)
        running_plans = self._running_plan_ids()
        available = []
        for pid in plan_ids:
            if pid in running_plans:
                continue
            cf = conflicts_for(pid)
            if cf["has_conflict"]:
                continue
            available.append(pid)

        # Hard cap: stop claiming if we've hit max_plans
        if self.max_plans is not None:
            remaining = self.max_plans - self._plans_claimed
            if remaining <= 0:
                available = []
            else:
                available = available[:remaining]

        slots = self.max_lanes - len(self._running)
        for pid in available[:slots]:
            lane_id = self._lane_id_from_plan_id(pid)

            # Atomic claim before dispatching
            if not claim_plan(pid, lane_id):
                continue

            # Insert lane record
            conn = get_conn()
            conn.execute(
                """
                INSERT OR IGNORE INTO lanes (lane_id, plan_id, status, started_at, last_heartbeat)
                VALUES (?, ?, ?, ?, ?)
                """,
                (lane_id, pid, "running", __import__("time").time(), __import__("time").time()),
            )
            conn.commit()
            conn.close()

            task = asyncio.create_task(self._run_lane(pid, lane_id))
            self._running[lane_id] = task
            self._lane_start_times[lane_id] = asyncio.get_event_loop().time()
            self._lane_last_progress[lane_id] = asyncio.get_event_loop().time()
            self._plans_claimed += 1
            emit(event_type="lane_dispatched", payload={"plan_id": pid, "lane_id": lane_id})

        return results

    async def _run_lane(self, plan_id: str, lane_id: str) -> LaneState:
        graph = build_lane_graph(checkpointer=self.checkpointer)

        # Hydrate work_items from plan before starting
        work_items = _init_work_items(plan_id)

        initial: LaneState = {
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

        # Emit plan_started event
        emit(
            event_type="plan_started",
            payload={"plan_id": plan_id, "lane_id": lane_id, "subtask_count": len(work_items)},
        )

        def _stream():
            fs = None
            for event in graph.stream(initial, {"configurable": {"thread_id": lane_id}}, stream_mode="values"):
                fs = event
            return fs

        loop = asyncio.get_running_loop()
        final_state = await loop.run_in_executor(None, _stream)
        return final_state  # type: ignore[return-value]

    async def run_until_done(self) -> list[dict[str, Any]]:
        """Block until all claimed lanes finish."""
        while self._running:
            await self.tick()
            if self._running:
                await asyncio.sleep(1)
        return []


# ---------------------------------------------------------------------------
# Supervisor graph with Send() (demonstrates map-reduce topology)
# ---------------------------------------------------------------------------

class SupervisorState(TypedDict):
    messages: Annotated[list[AnyMessage], add_messages]
    claimed_plans: list[str]
    results: list[dict[str, Any]]


def supervisor_claim_node(state: SupervisorState) -> dict[str, Any]:
    plans = runnable_set()[:3]
    return {"claimed_plans": plans}


def supervisor_dispatch_node(state: SupervisorState) -> list[Send]:
    return [
        Send("lane", {"plan_id": pid, "lane_id": f"lane-{pid.replace('/', '-')}"})
        for pid in state["claimed_plans"]
    ]


def supervisor_collect_node(state: SupervisorState) -> dict[str, Any]:
    return {"results": [], "messages": [SystemMessage(content="Supervisor collected lane results.")]}


def build_supervisor_graph():
    """Build a supervisor graph that dispatches lanes via Send().

    Note: lanes run as detached subgraphs; results are written to the broker.
    """
    builder = StateGraph(SupervisorState)
    builder.add_node("claim", supervisor_claim_node)
    builder.add_node("dispatch", supervisor_dispatch_node)
    builder.add_node("lane", build_lane_graph())
    builder.add_node("collect", supervisor_collect_node)

    builder.add_edge(START, "claim")
    builder.add_edge("claim", "dispatch")
    builder.add_edge("dispatch", "collect")
    builder.add_edge("collect", END)

    return builder.compile()
