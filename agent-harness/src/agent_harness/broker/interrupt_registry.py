"""LangGraph interrupt registry: maps plan_id ↔ thread for human-in-the-loop resume."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any

from agent_harness.broker.db import get_conn, row_to_dict


def register_interrupt(
    plan_id: str,
    thread_id: str,
    reason: str,
    lane_id: str | None = None,
    checkpoint_id: str | None = None,
    plan_path: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Register an active interrupt for a plan lane.

    Returns the interrupt record.
    """
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    interrupt_id = f"int_{uuid.uuid4().hex[:16]}"
    now = time.time()

    conn.execute(
        """
        INSERT INTO interrupts (interrupt_id, plan_id, lane_id, thread_id, checkpoint_id, reason, status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (interrupt_id, plan_id, lane_id, thread_id, checkpoint_id, reason, "active", now),
    )
    conn.commit()

    if close_conn:
        conn.close()

    return {
        "interrupt_id": interrupt_id,
        "plan_id": plan_id,
        "lane_id": lane_id,
        "thread_id": thread_id,
        "checkpoint_id": checkpoint_id,
        "reason": reason,
        "status": "active",
        "created_at": now,
    }


def resume_interrupt(
    plan_id: str,
    payload: dict[str, Any] | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Resume the most recent active interrupt for a plan.

    Returns the updated interrupt record, or None if no active interrupt exists.
    """
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cursor = conn.execute(
        """
        SELECT * FROM interrupts
        WHERE plan_id = ? AND status = 'active'
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (plan_id,),
    )
    row = cursor.fetchone()
    if not row:
        if close_conn:
            conn.close()
        return None

    now = time.time()
    conn.execute(
        """
        UPDATE interrupts
        SET status = 'resumed', resumed_at = ?, payload = ?
        WHERE interrupt_id = ?
        """,
        (now, json.dumps(payload) if payload else None, row["interrupt_id"]),
    )
    conn.commit()

    if close_conn:
        conn.close()

    return {
        "interrupt_id": row["interrupt_id"],
        "plan_id": row["plan_id"],
        "lane_id": row["lane_id"],
        "thread_id": row["thread_id"],
        "checkpoint_id": row["checkpoint_id"],
        "status": "resumed",
        "resumed_at": now,
        "payload": payload,
    }


def get_interrupt(
    plan_id: str,
    status: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any] | None:
    """Get the most recent interrupt for a plan, optionally filtered by status."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    if status:
        cursor = conn.execute(
            """
            SELECT * FROM interrupts
            WHERE plan_id = ? AND status = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (plan_id, status),
        )
    else:
        cursor = conn.execute(
            """
            SELECT * FROM interrupts
            WHERE plan_id = ?
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (plan_id,),
        )
    row = cursor.fetchone()

    if close_conn:
        conn.close()

    return row_to_dict(row) if row else None


def list_interrupts(
    status: str | None = None,
    plan_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """List interrupts with optional filters."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    conditions: list[str] = []
    params: list[Any] = []

    if status:
        conditions.append("status = ?")
        params.append(status)
    if plan_id:
        conditions.append("plan_id = ?")
        params.append(plan_id)

    where_clause = " AND ".join(conditions) if conditions else "1=1"
    cursor = conn.execute(
        f"""
        SELECT * FROM interrupts
        WHERE {where_clause}
        ORDER BY created_at DESC
        """,
        params,
    )
    rows = [row_to_dict(r) for r in cursor.fetchall()]

    if close_conn:
        conn.close()
    return rows
