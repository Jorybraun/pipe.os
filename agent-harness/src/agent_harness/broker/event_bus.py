"""Append-only event log backed by SQLite."""
from __future__ import annotations

import json
import sqlite3
import time
import uuid
from typing import Any

from agent_harness.broker.db import get_conn, row_to_dict


def emit(
    event_type: str,
    payload: dict[str, Any] | None = None,
    plan_id: str | None = None,
    lane_id: str | None = None,
    agent_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> str:
    """Append a single event. Returns the event_id."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    event_id = f"evt_{uuid.uuid4().hex[:16]}"
    conn.execute(
        """
        INSERT INTO events (event_id, event_type, plan_id, lane_id, agent_id, payload, emitted_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            event_type,
            plan_id,
            lane_id,
            agent_id,
            json.dumps(payload) if payload else None,
            time.time(),
        ),
    )
    conn.commit()

    if close_conn:
        conn.close()
    return event_id


def get_events(
    event_type: str | None = None,
    plan_id: str | None = None,
    lane_id: str | None = None,
    since: float = 0.0,
    limit: int = 1000,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Query events with optional filters."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    conditions = ["emitted_at >= ?"]
    params: list[Any] = [since]

    if event_type:
        conditions.append("event_type = ?")
        params.append(event_type)
    if plan_id:
        conditions.append("plan_id = ?")
        params.append(plan_id)
    if lane_id:
        conditions.append("lane_id = ?")
        params.append(lane_id)

    where_clause = " AND ".join(conditions)
    cursor = conn.execute(
        f"""
        SELECT * FROM events
        WHERE {where_clause}
        ORDER BY emitted_at ASC
        LIMIT ?
        """,
        params + [limit],
    )
    rows = [row_to_dict(r) for r in cursor.fetchall()]

    if close_conn:
        conn.close()
    return rows


def prune_events(
    max_age_days: float = 30.0,
    max_rows: int = 50000,
    conn: sqlite3.Connection | None = None,
) -> int:
    """Delete old events to prevent unbounded growth.

    Keeps the most recent max_rows events and events newer than max_age_days.
    Returns number of rows deleted.
    """
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cutoff = time.time() - (max_age_days * 24 * 3600)

    # First, delete events older than max_age_days
    cur = conn.execute(
        "DELETE FROM events WHERE emitted_at < ?",
        (cutoff,),
    )
    deleted = cur.rowcount

    # Then, if still over max_rows, delete oldest excess
    cursor = conn.execute("SELECT COUNT(*) as cnt FROM events")
    row = cursor.fetchone()
    total = row["cnt"] if row else 0

    if total > max_rows:
        excess = total - max_rows
        cur = conn.execute(
            """
            DELETE FROM events
            WHERE event_id IN (
                SELECT event_id FROM events
                ORDER BY emitted_at ASC
                LIMIT ?
            )
            """,
            (excess,),
        )
        deleted += cur.rowcount

    conn.commit()
    if close_conn:
        conn.close()
    return deleted
