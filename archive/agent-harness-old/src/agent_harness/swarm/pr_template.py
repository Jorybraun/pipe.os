"""Fixed PR description template + validator for swarm output."""
from __future__ import annotations

import re
from typing import Any


PR_TEMPLATE = """## Plan
{plan_path}

## Acceptance criteria
{acceptance}

## BDD tests
{bdd_tests}

## Unit tests
{unit_tests}

## Manual QA on staging
{manual_qa}

## Regression touchpoints
{regression}

## Rollback
{rollback}
"""


REQUIRED_SECTIONS = [
    "## Plan",
    "## Acceptance criteria",
    "## BDD tests",
    "## Unit tests",
    "## Manual QA on staging",
    "## Regression touchpoints",
    "## Rollback",
]


def validate_pr_description(text: str) -> dict[str, Any]:
    """Check that all required sections are present and non-empty."""
    missing: list[str] = []
    empty: list[str] = []

    for section in REQUIRED_SECTIONS:
        if section not in text:
            missing.append(section)
            continue
        # Extract content until next ## section or end
        pattern = re.escape(section) + r"\n(.*?)(?=\n##\s|\Z)"
        m = re.search(pattern, text, re.DOTALL)
        if not m or not m.group(1).strip():
            empty.append(section)

    return {
        "valid": not missing and not empty,
        "missing": missing,
        "empty": empty,
    }


def build_pr_description(
    plan_path: str,
    acceptance: list[str],
    bdd_tests: list[str],
    unit_tests: list[str],
    manual_qa: list[str],
    regression: list[str],
    rollback: list[str],
) -> str:
    """Build a PR description from structured fields."""
    def _bullet(items: list[str]) -> str:
        return "\n".join(f"- {item}" for item in items) if items else "- (none)"

    return PR_TEMPLATE.format(
        plan_path=plan_path,
        acceptance=_bullet(acceptance),
        bdd_tests=_bullet(bdd_tests),
        unit_tests=_bullet(unit_tests),
        manual_qa=_bullet(manual_qa),
        regression=_bullet(regression),
        rollback=_bullet(rollback),
    )
