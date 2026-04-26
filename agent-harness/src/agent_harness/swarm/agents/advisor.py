"""Lane Advisor — per-plan architect that reviews plans and handoffs."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from langchain_core.messages import SystemMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from agent_harness.broker import get_plan, get_handoff_chain, read_cues


class AdvisorOutput(BaseModel):
    reasoning: str = Field(description="Why you gave this guidance")
    guidance: str = Field(description="Architectural guidance for the next developer")
    plan_health: str = Field(description="Plan health assessment")
    recommend_escalation: bool = Field(description="Whether to escalate this plan")


def _load_prompt() -> str:
    path = Path(__file__).parent.parent / "prompts" / "advisor.md"
    if path.exists():
        return path.read_text()
    return "# Lane Advisor\nReview plan and handoffs, emit architectural guidance."


def _make_model() -> ChatOpenAI:
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY or OPENAI_API_KEY not set")
    base_url = os.getenv("KIMI_BASE_URL", "https://api.kimi.com/coding/v1")
    # Advisor does architectural reasoning — can use a stronger model (e.g. kimi-k2-6)
    model = os.getenv("KIMI_ADVISOR_MODEL") or os.getenv("KIMI_STRATEGIC_MODEL") or os.getenv("KIMI_MODEL", "kimi-for-coding")
    return ChatOpenAI(
        model=model,
        temperature=0.2,
        max_tokens=8192,
        api_key=api_key,
        base_url=base_url,
        timeout=120,
        max_retries=2,
        model_kwargs={
            "extra_headers": {
                "User-Agent": "claude-code/0.1",
            }
        },
        extra_body={"reasoning": None},
    )


def _build_advisor_prompt(
    plan_id: str,
    current_subtask_id: str | None,
    plan: dict[str, Any] | None,
    chain: list[dict[str, Any]],
    cues: list[dict[str, Any]],
) -> str:
    base = _load_prompt()
    parts = [base]

    parts.append(f"\n## Current Context\nPlan: {plan_id}\nSubtask: {current_subtask_id or 'None (plan-level review)'}\n")

    if plan:
        parts.append(f"\n## Plan: {plan.get('title', plan_id)}\n")
        parts.append(f"Phase: {plan.get('phase', '?')}\nStatus: {plan.get('status', '?')}\n")
        subtasks = plan.get("subtasks", [])
        parts.append(f"Subtasks ({len(subtasks)}):\n")
        for st in subtasks:
            parts.append(f"- {st.get('subtask_id')}: {st.get('title')} [{st.get('status', 'pending')}]\n")
            if st.get("files"):
                parts.append(f"  Files: {st.get('files')}\n")
            if st.get("migrations"):
                parts.append(f"  Migrations: {st.get('migrations')}\n")

    if chain:
        parts.append(f"\n## Handoff Chain ({len(chain)} items)\n")
        for h in chain:
            parts.append(
                f"- {h.get('subtask_id')} seq={h.get('sequence')} "
                f"status={h.get('status')} handoff_to={h.get('handoff_to')}\n"
            )
            if h.get("state_notes"):
                notes = h.get("state_notes", [])
                if isinstance(notes, list) and notes:
                    parts.append(f"  Notes: {notes[0] if notes else ''}\n")

    if cues:
        parts.append(f"\n## Operator Cues ({len(cues)} items)\n")
        for c in cues:
            parts.append(f"- {c.get('content', '')}\n")

    # Focus on current subtask if specified
    if current_subtask_id and plan:
        subtask = next(
            (s for s in plan.get("subtasks", []) if s.get("subtask_id") == current_subtask_id),
            None,
        )
        if subtask:
            parts.append(f"\n## Current Subtask Detail\n")
            parts.append(f"ID: {subtask.get('subtask_id')}\n")
            parts.append(f"Title: {subtask.get('title')}\n")
            parts.append(f"Spec: {subtask.get('spec', '(no spec)')}\n")
            files = subtask.get("files", [])
            if isinstance(files, str):
                files = json.loads(files)
            if files:
                parts.append(f"Files: {', '.join(files)}\n")
            migrations = subtask.get("migrations", [])
            if isinstance(migrations, str):
                migrations = json.loads(migrations)
            if migrations:
                parts.append(f"Migrations: {migrations}\n")

    return "\n".join(parts)


def run_advisor(
    plan_id: str,
    current_subtask_id: str | None = None,
    lane_id: str = "",
) -> AdvisorOutput:
    """Run the lane advisor and return structured guidance."""
    plan = get_plan(plan_id)
    chain = get_handoff_chain(plan_id)
    cues = read_cues(plan_id=plan_id, lane_id=lane_id)

    prompt = _build_advisor_prompt(plan_id, current_subtask_id, plan, chain, cues)
    model = _make_model()

    response = model.with_structured_output(AdvisorOutput).invoke([
        SystemMessage(content=prompt)
    ])

    return response
