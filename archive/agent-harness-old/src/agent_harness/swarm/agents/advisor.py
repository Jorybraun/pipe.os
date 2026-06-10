"""Lane Advisor — per-plan architect that reviews plans and handoffs."""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from langchain_core.messages import SystemMessage
from langchain_openai import ChatOpenAI

from agent_harness.broker import get_plan, get_handoff_chain, read_cues


def _load_prompt() -> str:
    path = Path(__file__).parent.parent / "prompts" / "advisor.md"
    if path.exists():
        return path.read_text()
    return "# Lane Advisor\nReview plan and handoffs, emit architectural guidance."


def _make_model() -> ChatOpenAI:
    api_key = os.getenv("KIMI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("KIMI_API_KEY or OPENAI_API_KEY not set")
    model = os.getenv("KIMI_ADVISOR_MODEL") or os.getenv("KIMI_STRATEGIC_MODEL") or os.getenv("KIMI_DEV_MODEL") or os.getenv("KIMI_MODEL", "kimi-k2-6")
    default_base = (
        "https://api.kimi.com/coding/v1"
        if model == "kimi-for-coding"
        else "https://api.moonshot.cn/v1"
    )
    base_url = os.getenv("KIMI_DEV_BASE_URL") or os.getenv("KIMI_BASE_URL", default_base)
    return ChatOpenAI(
        model=model,
        temperature=0.2,
        max_tokens=1500,
        api_key=api_key,
        base_url=base_url,
        timeout=120,
        max_retries=2,
        default_headers={
            "User-Agent": "claude-code/0.1",
            "x-stainless-os": "MacOS",
            "x-stainless-arch": "arm64",
            "x-stainless-runtime": "python",
            "x-stainless-runtime-version": "3.12",
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
    subtask = None
    if plan and current_subtask_id:
        subtask = next(
            (s for s in plan.get("subtasks", []) if s.get("subtask_id") == current_subtask_id),
            None,
        )

    # Concise handoff summary
    handoff_lines = []
    for h in chain:
        line = f"- {h.get('subtask_id')} seq={h.get('sequence')} {h.get('status')}"
        done = h.get("done", [])
        if done:
            line += f" | done:{len(done)}"
        files = h.get("files_touched", [])
        if files:
            line += f" | files:{len(files)}"
        notes = h.get("state_notes", [])
        if notes:
            note = str(notes[0])[:60] if isinstance(notes, list) else str(notes)[:60]
            line += f" | note:{note}"
        handoff_lines.append(line)

    parts = [
        "You are the Lane Advisor — a software architect reviewing a development plan.",
        f"\n## Plan: {plan.get('title', plan_id) if plan else plan_id}",
        f"Phase: {plan.get('phase', '?') if plan else '?'} | Status: {plan.get('status', '?') if plan else '?'}",
    ]

    if subtask:
        parts.append(f"\n## Current Subtask: {current_subtask_id}")
        parts.append(f"Title: {subtask.get('title', '')}")
        spec = subtask.get("spec", "")
        if spec:
            parts.append(f"Spec: {spec[:600]}")
        files = subtask.get("files", [])
        if files:
            if isinstance(files, str):
                files = json.loads(files)
            parts.append(f"Files: {', '.join(files)}")
        migrations = subtask.get("migrations", [])
        if migrations:
            if isinstance(migrations, str):
                migrations = json.loads(migrations)
            parts.append(f"Migrations: {migrations}")

    if handoff_lines:
        parts.append(f"\n## Handoff Chain ({len(chain)} items)")
        parts.extend(handoff_lines)

    if cues:
        parts.append(f"\n## Operator Cues ({len(cues)} items)")
        for c in cues:
            parts.append(f"- {c.get('content', '')}")

    parts.append(
        "\n\n## Your Task\n"
        "Review the handoff chain and current subtask. Provide concise architectural guidance "
        "for the next developer (under 800 characters). Be specific and actionable. "
        "If multiple developers have explored without progress, recommend BUILDER mode with exact steps. "
        "If a scout produced a good spec, recommend BUILDER mode. "
        "If no spec exists after 2+ handoffs, recommend a focused SCOUT with strict limits."
    )

    return "\n".join(parts)


def run_advisor(
    plan_id: str,
    current_subtask_id: str | None = None,
    lane_id: str = "",
) -> dict[str, Any]:
    """Run the lane advisor and return guidance dict."""
    plan = get_plan(plan_id)
    chain = get_handoff_chain(plan_id)
    cues = read_cues(plan_id=plan_id, lane_id=lane_id)

    prompt = _build_advisor_prompt(plan_id, current_subtask_id, plan, chain, cues)
    model = _make_model()

    response = model.invoke([SystemMessage(content=prompt)])
    guidance = (response.content or "").strip()

    # Truncate if too long
    if len(guidance) > 3000:
        guidance = guidance[:3000] + "\n... [truncated]"

    return {
        "reasoning": "Advisor reviewed plan and handoffs",
        "guidance": guidance,
        "plan_health": "reviewed",
        "recommend_escalation": False,
    }
