"""Walk docs/plans/strategy-v2/**/*.md, parse frontmatter + sections, populate SQLite."""
from __future__ import annotations

import hashlib
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
    """Parse ## Dependencies block.

    Supports formats:
        - Depends on: `filename.md` (description)
        - Depends on: filename.md (description)
        - Depends on: None
        - Depends on: [title](path/to/file.md)
    """
    deps: list[dict[str, str]] = []
    section = _extract_section(text, "Dependencies")
    if not section:
        return deps
    for line in section.splitlines():
        line = line.strip()
        if line.startswith("- Depends on:") or line.startswith("- Blocks:"):
            relation = "depends_on" if "Depends on" in line else "blocks"
            rest = line.split(":", 1)[1].strip()
            rest = rest.rstrip(".")
            if not rest or rest.lower() in ("none", "nothing"):
                continue
            # Try markdown link [title](path)
            m = re.search(r"\[([^\]]+)\]\(([^)]+)\)", rest)
            if m:
                dep_id = m.group(2)  # use the path, not the title
                deps.append({"depends_on": dep_id, "relation": relation})
                continue
            # Try backtick-wrapped filename: `filename.md`
            m = re.search(r"`([^`]+\.md)`", rest)
            if m:
                deps.append({"depends_on": m.group(1), "relation": relation})
                continue
            # Try bare filename at start of string: filename.md ...
            m = re.search(r"^([\w\-]+\.md)", rest)
            if m:
                deps.append({"depends_on": m.group(1), "relation": relation})
                continue
            # Fallback: store the first "word" if it looks like a reference
            first_word = rest.split()[0] if rest else ""
            if first_word and ".md" in first_word:
                deps.append({"depends_on": first_word, "relation": relation})
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


def _plan_hash(p: dict[str, Any]) -> str:
    """Compute a content hash for a parsed plan (excludes swarm-managed status)."""
    content = {
        "plan_path": p.get("plan_path"),
        "title": p.get("title"),
        "source": p.get("source"),
        "phase": p.get("phase"),
        "estimate": p.get("estimate"),
        "why": p.get("why"),
        "acceptance": p.get("acceptance"),
        "subtasks": p.get("subtasks", []),
        "files": p.get("files", []),
        "dependencies": p.get("dependencies", []),
    }
    return hashlib.sha256(json.dumps(content, sort_keys=True, default=str).encode()).hexdigest()[:16]


def sync_plans_to_db(plans: list[dict[str, Any]] | None = None, conn: sqlite3.Connection | None = None) -> dict[str, int]:
    """Diff-sync parsed plans into the broker database. Preserves swarm state.

    Returns {"inserted": N, "updated": N, "unchanged": N}
    """
    if plans is None:
        plans = walk_plans()

    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    now = time.time()
    inserted = 0
    updated = 0
    unchanged = 0

    # Ensure content_hash column exists (idempotent)
    cursor = conn.execute("PRAGMA table_info(plans)")
    cols = {r["name"] for r in cursor.fetchall()}
    if "content_hash" not in cols:
        conn.execute("ALTER TABLE plans ADD COLUMN content_hash TEXT")

    valid_plan_ids = {p["plan_id"] for p in plans}
    filename_to_plan_id: dict[str, str] = {}
    for p in plans:
        pid = p["plan_id"]
        filename_to_plan_id[pid] = pid
        filename_to_plan_id[Path(pid).name] = pid

    def _resolve_dep(dep_id: str) -> str | None:
        if dep_id in valid_plan_ids:
            return dep_id
        if dep_id in filename_to_plan_id:
            return filename_to_plan_id[dep_id]
        clean = dep_id.lstrip("./")
        if clean in filename_to_plan_id:
            return filename_to_plan_id[clean]
        for pid in valid_plan_ids:
            if Path(pid).name == Path(dep_id).name:
                return pid
        return None

    # Load existing plans and subtasks from DB
    cursor = conn.cursor()
    cursor.execute("SELECT plan_id, status, content_hash FROM plans")
    existing_plans: dict[str, dict[str, Any]] = {
        r["plan_id"]: {"status": r["status"], "hash": r["content_hash"]}
        for r in cursor.fetchall()
    }

    cursor.execute("SELECT plan_id, subtask_id, status FROM plan_subtasks")
    existing_subtasks: dict[tuple[str, str], str] = {
        (r["plan_id"], r["subtask_id"]): r["status"]
        for r in cursor.fetchall()
    }

    with conn:
        for p in plans:
            pid = p["plan_id"]
            new_hash = _plan_hash(p)
            existing = existing_plans.get(pid)

            if existing is None:
                # New plan — insert everything
                conn.execute(
                    """
                    INSERT INTO plans (plan_id, plan_path, title, source, phase, status, estimate, why, acceptance, parsed_at, content_hash)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        pid, p["plan_path"], p["title"], p.get("source"),
                        p.get("phase"), p["status"], p.get("estimate"),
                        p.get("why"), p.get("acceptance"), now, new_hash,
                    ),
                )
                _insert_plan_children(conn, p)
                inserted += 1

            elif existing.get("hash") == new_hash:
                # Plan unchanged — skip entirely
                unchanged += 1

            else:
                # Plan changed — update content but preserve swarm status
                db_status = existing["status"]
                new_status = p["status"]
                # If swarm has moved the plan from PENDING, don't revert it
                if db_status not in (None, "", "PENDING"):
                    new_status = db_status

                conn.execute(
                    """
                    UPDATE plans
                    SET plan_path = ?, title = ?, source = ?, phase = ?,
                        status = ?, estimate = ?, why = ?, acceptance = ?,
                        parsed_at = ?, content_hash = ?
                    WHERE plan_id = ?
                    """,
                    (
                        p["plan_path"], p["title"], p.get("source"),
                        p.get("phase"), new_status, p.get("estimate"),
                        p.get("why"), p.get("acceptance"), now, new_hash,
                        pid,
                    ),
                )

                # Sync subtasks: delete old, insert new, preserve non-PENDING statuses
                conn.execute("DELETE FROM plan_subtasks WHERE plan_id = ?", (pid,))
                for st in p.get("subtasks", []):
                    st_id = st["subtask_id"]
                    db_st_status = existing_subtasks.get((pid, st_id))
                    st_status = st["status"]
                    if db_st_status not in (None, "", "PENDING"):
                        st_status = db_st_status
                    conn.execute(
                        """
                        INSERT INTO plan_subtasks (plan_id, subtask_id, title, spec, files, migrations, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            pid, st_id, st["title"], st["spec"],
                            json.dumps(st["files"]), json.dumps(st["migrations"]),
                            st_status,
                        ),
                    )

                # Sync files
                conn.execute("DELETE FROM plan_files WHERE plan_id = ?", (pid,))
                for f in p.get("files", []):
                    conn.execute(
                        "INSERT OR IGNORE INTO plan_files (plan_id, file_path) VALUES (?, ?)",
                        (pid, f),
                    )

                updated += 1

        # Dependencies: clear and rebuild (dependency resolution needs full graph)
        conn.execute("DELETE FROM plan_dependencies")
        for p in plans:
            for dep in p.get("dependencies", []):
                resolved = _resolve_dep(dep["depends_on"])
                if resolved:
                    conn.execute(
                        """
                        INSERT OR IGNORE INTO plan_dependencies (plan_id, depends_on, relation)
                        VALUES (?, ?, ?)
                        """,
                        (p["plan_id"], resolved, dep["relation"]),
                    )

    if close_conn:
        conn.close()
    return {"inserted": inserted, "updated": updated, "unchanged": unchanged}


def _insert_plan_children(conn: sqlite3.Connection, p: dict[str, Any]) -> None:
    """Insert subtasks and files for a new plan."""
    for st in p.get("subtasks", []):
        conn.execute(
            """
            INSERT INTO plan_subtasks (plan_id, subtask_id, title, spec, files, migrations, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (
                p["plan_id"], st["subtask_id"], st["title"], st["spec"],
                json.dumps(st["files"]), json.dumps(st["migrations"]),
                st["status"],
            ),
        )
    for f in p.get("files", []):
        conn.execute(
            "INSERT OR IGNORE INTO plan_files (plan_id, file_path) VALUES (?, ?)",
            (p["plan_id"], f),
        )


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


def mark_plan_complete(plan_id: str, conn: sqlite3.Connection | None = None) -> bool:
    """Mark a plan as COMPLETE in the registry."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()
    cursor = conn.cursor()
    cursor.execute("UPDATE plans SET status = 'COMPLETE' WHERE plan_id = ?", (plan_id,))


def claim_plan(plan_id: str, lane_id: str = "", conn: sqlite3.Connection | None = None) -> bool:
    """Atomically claim a plan for a lane.

    Returns True if the plan was in 'PENDING' and is now 'CLAIMED'.
    Returns False if the plan was already claimed, complete, or missing.
    """
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    conn.execute("BEGIN IMMEDIATE")
    try:
        cursor = conn.execute(
            "UPDATE plans SET status = 'CLAIMED' WHERE plan_id = ? AND status = 'PENDING'",
            (plan_id,),
        )
        conn.commit()
        ok = cursor.rowcount > 0
    except Exception:
        conn.rollback()
        raise
    finally:
        if close_conn:
            conn.close()
    return ok


def heartbeat(lane_id: str, agent_id: str = "", conn: sqlite3.Connection | None = None) -> None:
    """Update the last_heartbeat timestamp for a lane."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()
    conn.execute(
        "UPDATE lanes SET last_heartbeat = ? WHERE lane_id = ?",
        (__import__("time").time(), lane_id),
    )
    conn.commit()
    if close_conn:
        conn.close()


def runnable_set(
    conn: sqlite3.Connection | None = None,
    part_prefix: str | None = None,
    max_phase: int | None = None,
) -> list[str]:
    """Return plan_ids that are PENDING, not NEEDS-REFINEMENT, and have no unmet deps.

    Args:
        part_prefix: If set, only include plans whose plan_id starts with this (e.g. 'part1-')
        max_phase: If set, only include plans with phase <= this.
    """
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cursor = conn.cursor()

    conditions = ["status NOT IN ('NEEDS-REFINEMENT', 'DONE', 'COMPLETE', 'PR_OPEN', 'CLAIMED')"]
    params: list[Any] = []
    if part_prefix:
        conditions.append("plan_id LIKE ?")
        params.append(f"{part_prefix}%")
    if max_phase is not None:
        conditions.append("phase <= ?")
        params.append(max_phase)

    where_clause = " AND ".join(conditions)
    cursor.execute(f"""
        SELECT plan_id FROM plans
        WHERE {where_clause}
        ORDER BY phase, plan_id
    """, params)
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
