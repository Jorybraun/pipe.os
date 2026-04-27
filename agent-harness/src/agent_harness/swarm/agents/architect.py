"""Ephemeral System Architect — on-demand deep design consultation."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field

from agent_harness.broker import emit, get_plan, get_handoff_chain, read_cues


class ArchitectOutput(BaseModel):
    problem_statement: str = Field(description="The architectural problem being solved")
    proposed_solution: str = Field(description="High-level proposed solution")
    data_model_changes: str = Field(description="Schema or data model changes, if any")
    api_contracts: str = Field(description="API contracts or interfaces defined")
    file_structure: str = Field(description="Recommended file structure or module layout")
    integration_points: str = Field(description="How this integrates with existing systems")
    risks_and_mitigations: str = Field(description="Risks and how to mitigate them")
    adr_required: str = Field(description="Whether an ADR is required (yes/no, with rationale)")


def _load_prompt() -> str:
    path = Path(__file__).parent.parent.parent / "prompts" / "architect.md"
    if path.exists():
        return path.read_text()
    return (
        "You are the System Architect. "
        "Return a structured architecture spec with: Problem, Solution, Data model, "
        "API contracts, File structure, Integration points, Risks, ADR required."
    )


def _make_model() -> ChatOpenAI:
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY or OPENAI_API_KEY not set")
    # Architect uses same model resolution as dev agent to avoid kimi-for-coding hangs
    model = os.getenv("KIMI_ARCHITECT_MODEL") or os.getenv("KIMI_STRATEGIC_MODEL") or os.getenv("KIMI_DEV_MODEL") or os.getenv("KIMI_MODEL", "kimi-k2-6")
    default_base = (
        "https://api.kimi.com/coding/v1"
        if model == "kimi-for-coding"
        else "https://api.moonshot.cn/v1"
    )
    base_url = os.getenv("KIMI_DEV_BASE_URL") or os.getenv("KIMI_BASE_URL", default_base)
    return ChatOpenAI(
        model=model,
        temperature=0.2,
        max_tokens=4096,
        api_key=api_key,
        base_url=base_url,
        timeout=30,
        max_retries=2,
        default_headers={"User-Agent": "claude-code/0.1"},
        extra_body={"reasoning": None},
    )


def _build_architect_prompt(
    plan_id: str,
    subtask_id: str | None,
    question: str,
    plan: dict[str, Any] | None,
    chain: list[dict[str, Any]],
    cues: list[dict[str, Any]],
) -> str:
    base = _load_prompt()
    parts = [base]

    parts.append(
        f"\n## Consultation Context\n"
        f"Plan: {plan_id}\n"
        f"Subtask: {subtask_id or 'None (plan-level)'}\n"
        f"Question: {question}\n"
    )

    if plan:
        parts.append(f"\n## Plan: {plan.get('title', plan_id)}\n")
        parts.append(f"Phase: {plan.get('phase', '?')}\nStatus: {plan.get('status', '?')}\n")
        subtasks = plan.get("subtasks", [])
        parts.append(f"Subtasks ({len(subtasks)}):\n")
        for st in subtasks:
            parts.append(f"- {st.get('subtask_id')}: {st.get('title')} [{st.get('status', 'pending')}]")
            if st.get("files"):
                parts.append(f"  Files: {st.get('files')}")
            if st.get("migrations"):
                parts.append(f"  Migrations: {st.get('migrations')}")

    if chain:
        parts.append(f"\n## Handoff Chain ({len(chain)} items)\n")
        for h in chain:
            parts.append(
                f"- {h.get('subtask_id')} seq={h.get('sequence')} "
                f"status={h.get('status')} handoff_to={h.get('handoff_to')}")
            notes = h.get("state_notes", [])
            if isinstance(notes, list) and notes:
                parts.append(f"  Notes: {notes[0] if notes else ''}")

    if cues:
        parts.append(f"\n## Operator Cues ({len(cues)} items)\n")
        for c in cues:
            parts.append(f"- {c.get('content', '')}")

    if subtask_id and plan:
        subtask = next(
            (s for s in plan.get("subtasks", []) if s.get("subtask_id") == subtask_id),
            None,
        )
        if subtask:
            parts.append(f"\n## Current Subtask Detail\n")
            parts.append(f"ID: {subtask.get('subtask_id')}")
            parts.append(f"Title: {subtask.get('title')}")
            parts.append(f"Spec: {subtask.get('spec', '(no spec)')}")
            files = subtask.get("files", [])
            if isinstance(files, str):
                files = json.loads(files)
            if files:
                parts.append(f"Files: {', '.join(files)}")
            migrations = subtask.get("migrations", [])
            if isinstance(migrations, str):
                migrations = json.loads(migrations)
            if migrations:
                parts.append(f"Migrations: {migrations}")

    parts.append(
        "\n## Instructions\n"
        "Answer the developer's specific question above. "
        "Be explicit about interfaces and contracts. "
        "Do not write implementation code — write design guidance.\n"
    )

    return "\n".join(parts)


def run_architect(
    plan_id: str,
    subtask_id: str | None = None,
    question: str = "",
    lane_id: str = "",
) -> dict[str, Any]:
    """Run the System Architect for a one-shot consultation and return structured guidance."""
    plan = get_plan(plan_id)
    chain = get_handoff_chain(plan_id)
    cues = read_cues(plan_id=plan_id, lane_id=lane_id)

    prompt = _build_architect_prompt(plan_id, subtask_id, question, plan, chain, cues)
    model = _make_model()

    response = model.with_structured_output(ArchitectOutput).invoke([
        SystemMessage(content=prompt)
    ])

    result = response.model_dump()

    # Emit audit event
    emit(
        event_type="architect_consulted",
        payload={
            "plan_id": plan_id,
            "subtask_id": subtask_id,
            "lane_id": lane_id,
            "question": question,
            "summary": result.get("proposed_solution", "")[:200],
        },
    )

    return result
