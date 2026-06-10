"""Conflict detection: file-path and migration-number overlap between plans."""
from __future__ import annotations

import json
import sqlite3
from typing import Any

from agent_harness.broker.db import get_conn, row_to_dict


def conflicts_for(plan_id: str, conn: sqlite3.Connection | None = None) -> dict[str, Any]:
    """Return all conflicts for a given plan vs other active/runnable plans.

    Checks:
    1. File-path overlap with other plans
    2. Migration-number overlap with other plans
    3. Currently active lanes touching the same files/migrations
    """
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cursor = conn.cursor()

    # --- File overlaps ---
    cursor.execute(
        """
        SELECT DISTINCT p.plan_id, p.title, p.status, f.file_path
        FROM plan_files f
        JOIN plan_files o ON o.file_path = f.file_path AND o.plan_id != f.plan_id
        JOIN plans p ON p.plan_id = o.plan_id
        WHERE f.plan_id = ?
        ORDER BY f.file_path, p.plan_id
        """,
        (plan_id,),
    )
    file_overlaps: list[dict[str, Any]] = []
    for row in cursor.fetchall():
        file_overlaps.append({
            "plan_id": row["plan_id"],
            "title": row["title"],
            "status": row["status"],
            "file_path": row["file_path"],
        })

    # --- Migration overlaps ---
    cursor.execute(
        """
        SELECT DISTINCT p.plan_id, p.title, p.status, s.migrations
        FROM plan_subtasks s
        JOIN plan_subtasks o ON o.plan_id != s.plan_id
        JOIN plans p ON p.plan_id = o.plan_id
        WHERE s.plan_id = ?
          AND (
              EXISTS (
                  SELECT 1 FROM json_each(s.migrations) AS sm
                  JOIN json_each(o.migrations) AS om ON sm.value = om.value
              )
          )
        ORDER BY p.plan_id
        """,
        (plan_id,),
    )
    migration_overlaps: list[dict[str, Any]] = []
    for row in cursor.fetchall():
        migration_overlaps.append({
            "plan_id": row["plan_id"],
            "title": row["title"],
            "status": row["status"],
        })

    # --- Active lane conflicts ---
    cursor.execute(
        """
        SELECT l.lane_id, l.plan_id AS lane_plan_id, l.status
        FROM lanes l
        WHERE l.status = 'running'
          AND l.plan_id != ?
          AND EXISTS (
              SELECT 1 FROM plan_files f
              JOIN plan_files o ON o.file_path = f.file_path
              WHERE f.plan_id = ? AND o.plan_id = l.plan_id
          )
        """,
        (plan_id, plan_id),
    )
    active_lane_conflicts = [row_to_dict(r) for r in cursor.fetchall()]

    # --- Summary ---
    has_conflict = bool(file_overlaps or migration_overlaps or active_lane_conflicts)

    if close_conn:
        conn.close()

    return {
        "plan_id": plan_id,
        "has_conflict": has_conflict,
        "file_overlaps": file_overlaps,
        "migration_overlaps": migration_overlaps,
        "active_lane_conflicts": active_lane_conflicts,
    }


def active_conflicts(conn: sqlite3.Connection | None = None) -> list[dict[str, Any]]:
    """Return all pairwise conflicts among runnable plans."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cursor = conn.cursor()
    cursor.execute("SELECT plan_id FROM plans WHERE status NOT IN ('NEEDS-REFINEMENT', 'DONE', 'COMPLETE', 'PR_OPEN')")
    plan_ids = [r["plan_id"] for r in cursor.fetchall()]

    results: list[dict[str, Any]] = []
    seen = set()
    for pid in plan_ids:
        c = conflicts_for(pid, conn=conn)
        if c["has_conflict"]:
            key = tuple(sorted([pid] + [o["plan_id"] for o in c["file_overlaps"]]))
            if key not in seen:
                seen.add(key)
                results.append(c)

    if close_conn:
        conn.close()
    return results
