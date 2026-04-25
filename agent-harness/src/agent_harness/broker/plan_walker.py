"""Walk docs/plans/strategy-v2/**/*.md, parse frontmatter + sections, populate SQLite."""
from __future__ import annotations

import json
import re
import sqlite3
import time
from pathlib import Path
from typing import Any

from agent_harness.broker.db import get_conn, row_to_dict

def _find_repo_root() -> Path:
    """Find the repo root by searching upward for docs/plans/strategy-v2."""
    start = Path(__file__).resolve().parent
    for parent in [start, *start.parents]:
        if (parent / "docs" / "plans" / "strategy-v2").exists():
            return parent
    return Path.cwd()


_REPO_ROOT = _find_repo_root()
_PLANS_ROOT = _REPO_ROOT / "docs" / "plans" / "strategy-v2"

# Regexes for plan metadata
_RE_SOURCE = re.compile(r"\*\*Source:\*\*\s*(.+)")
_RE_PHASE = re.compile(r"\*\*Phase:\*\*\s*(\d+)")
_RE_STATUS = re.compile(r"\*\*Status:\*\*\s*([\w-]+)")
_RE_ESTIMATE = re.compile(r"\*\*Estimate:\*\*\s*(.+)")

# Regex for subtask files block
_RE_FILES_BLOCK = re.compile(r"\*\*Files:\*\*\n((?:- `.+?`\n)+)", re.MULTILINE)
_RE_FILE_ITEM = re.compile(r"- `(.+?)`")

# Regex for migration numbers in text (0045, 0045_candidate_nodes.sql, etc.)
_RE_MIGRATION_NUM = re.compile(r"(?:migrations[/\\])?(\d{4})[_\-]\w+\.sql")
_RE_MIGRATION_NUM_STANDALONE = re.compile(r"\b(\d{4})\b")


def _extract_metadata(text: str) -> dict[str, Any]:
    meta: dict[str, Any] = {}
    m = _RE_SOURCE.search(text)
    if m:
        meta["source"] = m.group(1).strip()
    m = _RE_PHASE.search(text)
    if m:
        meta["phase"] = int(m.group(1))
    m = _RE_STATUS.search(text)
    if m:
        meta["status"] = m.group(1).strip()
    m = _RE_ESTIMATE.search(text)
    if m:
        meta["estimate"] = m.group(1).strip()
    return meta


def _extract_section(text: str, heading: str) -> str | None:
    """Extract content under a ## heading until the next ## heading."""
    pattern = re.compile(rf"##\s+{re.escape(heading)}\s*\n(.*?)(?=\n##\s|\Z)", re.DOTALL | re.IGNORECASE)
    m = pattern.search(text)
    return m.group(1).strip() if m else None


def _extract_subtasks(text: str) -> list[dict[str, Any]]:
    """Parse ### Subtask N blocks."""
    subtasks: list[dict[str, Any]] = []
    # Match ### Subtask N — Title or ### Subtask N — Title
    pattern = re.compile(r"###\s+Subtask\s+(\d+)\s*[—–-]\s*(.+?)\n(.*?)(?=\n###\s+Subtask|\n##\s|\Z)", re.DOTALL)
    for m in pattern.finditer(text):
        num = int(m.group(1))
        title = m.group(2).strip()
        body = m.group(3).strip()

        # Extract files
        files: list[str] = []
        fb = _RE_FILES_BLOCK.search(body)
        if fb:
            files = _RE_FILE_ITEM.findall(fb.group(1))

        # Extract migration numbers from files and body
        migrations: list[int] = []
        for f in files:
            mm = _RE_MIGRATION_NUM.search(f)
            if mm:
                migrations.append(int(mm.group(1)))
        for mm in _RE_MIGRATION_NUM.finditer(body):
            n = int(mm.group(1))
            if n not in migrations:
                migrations.append(n)

        # Extract status line if present
        st_match = re.search(r"\*\*Status:\*\*\s*(.+)", body)
        st = st_match.group(1).strip() if st_match else "PENDING"

        subtasks.append({
            "subtask_id": f"subtask-{num}",
            "title": title,
            "spec": body,
            "files": files,
            "migrations": sorted(migrations),
            "status": st,
        })
    return subtasks


def _extract_dependencies(text: str) -> list[dict[str, str]]:
    """Parse ## Dependencies block."""
    deps: list[dict[str, str]] = []
    section = _extract_section(text, "Dependencies")
    if not section:
        return deps
    for line in section.splitlines():
        line = line.strip()
        if line.startswith("- Depends on:") or line.startswith("- Blocks:"):
            relation = "depends_on" if "Depends on" in line else "blocks"
            # Try to extract a plan file reference
            m = re.search(r"\[`?([^`\]]+?)`?\]\([^)]*\)", line)
            if m:
                deps.append({"depends_on": m.group(1), "relation": relation})
            else:
                # Plain text fallback
                rest = line.split(":", 1)[1].strip()
                rest = rest.rstrip(".")
                if rest:
                    deps.append({"depends_on": rest, "relation": relation})
    return deps


def parse_plan_file(path: Path) -> dict[str, Any] | None:
    """Parse a single plan markdown file into a dict."""
    text = path.read_text(encoding="utf-8")
    if not text.strip():
        return None

    # Title is first H1
    title_match = re.search(r"^#\s+(.+)$", text, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else path.stem

    meta = _extract_metadata(text)
    why = _extract_section(text, "Why") or ""
    acceptance = _extract_section(text, "Acceptance criteria") or ""
    subtasks = _extract_subtasks(text)
    dependencies = _extract_dependencies(text)

    # Plan ID is the relative path under strategy-v2/
    try:
        plan_id = str(path.relative_to(_PLANS_ROOT))
    except ValueError:
        plan_id = path.name

    return {
        "plan_id": plan_id,
        "plan_path": str(path.relative_to(_REPO_ROOT)),
        "title": title,
        "source": meta.get("source"),
        "phase": meta.get("phase"),
        "status": meta.get("status", "PENDING"),
        "estimate": meta.get("estimate"),
        "why": why,
        "acceptance": acceptance,
        "subtasks": subtasks,
        "dependencies": dependencies,
        "files": list({f for st in subtasks for f in st["files"]}),
        "migrations": sorted({m for st in subtasks for m in st["migrations"]}),
    }


def walk_plans(root: Path | str | None = None) -> list[dict[str, Any]]:
    """Walk the plan directory and parse all .md files."""
    root = Path(root) if root else _PLANS_ROOT
    plans: list[dict[str, Any]] = []
    for path in sorted(root.rglob("*.md")):
        if path.name == "README.md" or path.name == "INDEX.md":
            continue
        parsed = parse_plan_file(path)
        if parsed:
            plans.append(parsed)
    return plans


def sync_plans_to_db(plans: list[dict[str, Any]] | None = None, conn: sqlite3.Connection | None = None) -> int:
    """Upsert parsed plans into the broker database. Returns count inserted/updated."""
    if plans is None:
        plans = walk_plans()

    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    now = time.time()
    count = 0

    valid_plan_ids = {p["plan_id"] for p in plans}

    with conn:
        # Wipe and rebuild (plans are source of truth in markdown)
        conn.execute("DELETE FROM plan_files")
        conn.execute("DELETE FROM plan_dependencies")
        conn.execute("DELETE FROM plan_subtasks")
        conn.execute("DELETE FROM plans")

        for p in plans:
            conn.execute(
                """
                INSERT INTO plans (plan_id, plan_path, title, source, phase, status, estimate, why, acceptance, parsed_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    p["plan_id"],
                    p["plan_path"],
                    p["title"],
                    p.get("source"),
                    p.get("phase"),
                    p["status"],
                    p.get("estimate"),
                    p.get("why"),
                    p.get("acceptance"),
                    now,
                ),
            )

            for st in p.get("subtasks", []):
                conn.execute(
                    """
                    INSERT INTO plan_subtasks (plan_id, subtask_id, title, spec, files, migrations, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        p["plan_id"],
                        st["subtask_id"],
                        st["title"],
                        st["spec"],
                        json.dumps(st["files"]),
                        json.dumps(st["migrations"]),
                        st["status"],
                    ),
                )

            for dep in p.get("dependencies", []):
                if dep["depends_on"] in valid_plan_ids:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO plan_dependencies (plan_id, depends_on, relation)
                        VALUES (?, ?, ?)
                        """,
                        (p["plan_id"], dep["depends_on"], dep["relation"]),
                    )

            for f in p.get("files", []):
                conn.execute(
                    """
                    INSERT OR IGNORE INTO plan_files (plan_id, file_path)
                    VALUES (?, ?)
                    """,
                    (p["plan_id"], f),
                )

            count += 1

    if close_conn:
        conn.close()
    return count


def list_plans(status: str | None = None, conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """Return all plans, optionally filtered by status."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cursor = conn.cursor()
    if status:
        cursor.execute("SELECT * FROM plans WHERE status = ? ORDER BY phase, plan_id", (status,))
    else:
        cursor.execute("SELECT * FROM plans ORDER BY phase, plan_id")
    rows = [row_to_dict(r) for r in cursor.fetchall()]

    if close_conn:
        conn.close()
    return rows


def get_plan(plan_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any] | None:
    """Return a single plan with its subtasks, dependencies, and files."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cursor = conn.cursor()
    cursor.execute("SELECT * FROM plans WHERE plan_id = ?", (plan_id,))
    row = cursor.fetchone()
    if not row:
        if close_conn:
            conn.close()
        return None

    plan = row_to_dict(row)
    cursor.execute("SELECT * FROM plan_subtasks WHERE plan_id = ?", (plan_id,))
    plan["subtasks"] = [row_to_dict(r) for r in cursor.fetchall()]
    cursor.execute("SELECT * FROM plan_dependencies WHERE plan_id = ?", (plan_id,))
    plan["dependencies"] = [row_to_dict(r) for r in cursor.fetchall()]
    cursor.execute("SELECT file_path FROM plan_files WHERE plan_id = ?", (plan_id,))
    plan["files"] = [r["file_path"] for r in cursor.fetchall()]

    if close_conn:
        conn.close()
    return plan


def runnable_set(conn: sqlite3.Connection | None = None) -> list[str]:
    """Return plan_ids that are PENDING, not NEEDS-REFINEMENT, and have no unmet deps."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cursor = conn.cursor()
    # All non-NEEDS-REFINEMENT, non-complete plans
    cursor.execute("""
        SELECT plan_id FROM plans
        WHERE status NOT IN ('NEEDS-REFINEMENT', 'DONE', 'COMPLETE', 'PR_OPEN')
        ORDER BY phase, plan_id
    """)
    candidates = [r["plan_id"] for r in cursor.fetchall()]

    # Filter out plans with incomplete dependencies
    runnable: list[str] = []
    for pid in candidates:
        cursor.execute("""
            SELECT 1 FROM plan_dependencies d
            JOIN plans p ON p.plan_id = d.depends_on
            WHERE d.plan_id = ? AND p.status NOT IN ('DONE', 'COMPLETE', 'PR_OPEN')
            LIMIT 1
        """, (pid,))
        if not cursor.fetchone():
            runnable.append(pid)

    if close_conn:
        conn.close()
    return runnable
