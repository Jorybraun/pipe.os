#!/usr/bin/env python3
"""Agent Harness — QA Gates

Run quality checks for PIPE-OS and output JSON results.

Usage:
    python qa_gates.py --repo ~/Code/PIPE/PIPE-OS
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path


def run_tsc(repo_path: Path) -> tuple[bool, list[str]]:
    """Run TypeScript compilation check."""
    try:
        result = subprocess.run(
            ["npx", "tsc", "--noEmit"],
            capture_output=True,
            text=True,
            timeout=120,
            cwd=str(repo_path),
        )
        passed = result.returncode == 0
        errors = [result.stderr] if result.stderr else []
        if not passed and result.stdout:
            errors.append(result.stdout)
        return passed, errors
    except Exception as e:
        return False, [str(e)]


def check_any_types(repo_path: Path) -> tuple[bool, list[str]]:
    """Check for 'any' types in TypeScript source."""
    try:
        result = subprocess.run(
            [
                "grep",
                "-rn",
                r"\bany\b",
                "src/",
                "workers/",
                "--include=*.ts",
                "--include=*.tsx",
            ],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(repo_path),
        )
        lines = [l for l in result.stdout.strip().split("\n") if l.strip()]
        return not lines, lines
    except Exception as e:
        return False, [str(e)]


def check_named_exports(repo_path: Path) -> tuple[bool, list[str]]:
    """Check for default exports outside pages/."""
    try:
        result = subprocess.run(
            [
                "grep",
                "-rn",
                "export default",
                "src/",
                "workers/",
                "--include=*.ts",
                "--include=*.tsx",
            ],
            capture_output=True,
            text=True,
            timeout=30,
            cwd=str(repo_path),
        )
        lines = [l for l in result.stdout.strip().split("\n") if l.strip()]
        non_page_defaults = [l for l in lines if "pages/" not in l]
        return not non_page_defaults, non_page_defaults
    except Exception as e:
        return False, [str(e)]


def check_changelog(repo_path: Path) -> tuple[bool, list[str]]:
    """Check CHANGELOG.md has an Unreleased section."""
    changelog_path = repo_path / "CHANGELOG.md"
    if not changelog_path.exists():
        return True, []  # No changelog is not a failure
    content = changelog_path.read_text()
    has_unreleased = "## [Unreleased]" in content or "## Unreleased" in content
    return has_unreleased, [] if has_unreleased else ["No [Unreleased] section found"]


def main():
    parser = argparse.ArgumentParser(description="Agent Harness QA Gates")
    parser.add_argument("--repo", "-r", default=".", help="Path to repository")
    args = parser.parse_args()

    repo = Path(args.repo).expanduser().resolve()

    tsc_passed, tsc_errors = run_tsc(repo)
    any_passed, any_errors = check_any_types(repo)
    exports_passed, exports_errors = check_named_exports(repo)
    changelog_passed, changelog_errors = check_changelog(repo)

    errors = []
    if not tsc_passed:
        errors.extend(tsc_errors)
    if not any_passed:
        errors.extend(any_errors)
    if not exports_passed:
        errors.extend(exports_errors)
    if not changelog_passed:
        errors.extend(changelog_errors)

    overall = tsc_passed and any_passed and exports_passed

    result = {
        "tsc_passed": tsc_passed,
        "no_any_types": any_passed,
        "named_exports": exports_passed,
        "changelog_updated": changelog_passed,
        "overall": overall,
        "errors": errors,
    }

    print(json.dumps(result, indent=2))
    sys.exit(0 if overall else 1)


if __name__ == "__main__":
    main()
