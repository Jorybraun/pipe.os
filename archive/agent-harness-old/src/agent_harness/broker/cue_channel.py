"""Operator → swarm steering cues with dedupe by content hash."""
from __future__ import annotations

import hashlib
import sqlite3
import time
import uuid
from typing import Any

from agent_harness.broker.db import get_conn, row_to_dict


def _hash(content: str) -> str:
    return hashlib.sha256(content.encode()).hexdigest()[:32]


def post_cue(
    content: str,
    plan_id: str | None = None,
    lane_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Post a steering cue. Returns cue_id or existing cue_id if duplicate."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    content_hash = _hash(content)
    now = time.time()

    # Check for recent duplicate (same hash, unacked, within last hour)
    cursor = conn.execute(
        """
        SELECT cue_id FROM cues
        WHERE content_hash = ? AND acked_at IS NULL AND posted_at > ?
        LIMIT 1
        """,
        (content_hash, now - 3600),
    )
    row = cursor.fetchone()
    if row:
        if close_conn:
            conn.close()
        return {"cue_id": row["cue_id"], "status": "deduped"}

    cue_id = f"cue_{uuid.uuid4().hex[:16]}"
    conn.execute(
        """
        INSERT INTO cues (cue_id, plan_id, lane_id, content, content_hash, posted_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (cue_id, plan_id, lane_id, content, content_hash, now),
    )
    conn.commit()

    if close_conn:
        conn.close()
    return {"cue_id": cue_id, "status": "posted"}


def read_cues(
    plan_id: str | None = None,
    lane_id: str | None = None,
    since: float = 0.0,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """Read pending (unacked) cues for a plan/lane."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    conditions = ["posted_at >= ?", "acked_at IS NULL"]
    params: list[Any] = [since]

    if plan_id:
        conditions.append("plan_id = ?")
        params.append(plan_id)
    if lane_id:
        conditions.append("lane_id = ?")
        params.append(lane_id)

    where_clause = " AND ".join(conditions)
    cursor = conn.execute(
        f"""
        SELECT * FROM cues
        WHERE {where_clause}
        ORDER BY posted_at ASC
        """,
        params,
    )
    rows = [row_to_dict(r) for r in cursor.fetchall()]

    if close_conn:
        conn.close()
    return rows


def ack_cue(cue_id: str, conn: sqlite3.Connection | None = None) -> bool:
    """Acknowledge a cue."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cursor = conn.execute(
        "UPDATE cues SET acked_at = ? WHERE cue_id = ?",
        (time.time(), cue_id),
    )
    conn.commit()

    if close_conn:
        conn.close()
    return cursor.rowcount > 0
