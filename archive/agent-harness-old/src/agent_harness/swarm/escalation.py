"""Escalation detection for plan lanes.

Triggers human-in-the-loop interrupt when a plan touches sensitive files
or mentions regulated topics.
"""
from __future__ import annotations

import re
from typing import Any

ESCALATION_FILE_PATTERNS = [
    r"migrations[/\\]",
    r"lib/privacy[/\\]",
    r"routes/candidate[/\\]",
]

ESCALATION_TEXT_PATTERNS = [
    r"\bLL144\b",
    r"\bArticle\s+22\b",
    r"\bEEOC\b",
]


def should_escalate(plan: dict[str, Any] | None, lane_state: dict[str, Any] | None = None) -> tuple[bool, str]:
    """Return (True, reason) if the plan requires human approval before merge."""
    if not plan:
        return False, ""

    # Check plan-level files
    files = plan.get("files", [])
    for f in files:
        for pattern in ESCALATION_FILE_PATTERNS:
            if re.search(pattern, f):
                return True, f"Escalation file match: {f}"

    # Check subtask files
    for st in plan.get("subtasks", []):
        for f in st.get("files", []):
            for pattern in ESCALATION_FILE_PATTERNS:
                if re.search(pattern, f):
                    return True, f"Escalation subtask file match: {f}"

    # Check text content (title, acceptance, why)
    text_parts = [
        plan.get("title") or "",
        plan.get("acceptance") or "",
        plan.get("why") or "",
    ]
    text = " ".join(text_parts)
    for pattern in ESCALATION_TEXT_PATTERNS:
        if re.search(pattern, text, re.IGNORECASE):
            return True, f"Escalation text match: {pattern}"

    return False, ""
