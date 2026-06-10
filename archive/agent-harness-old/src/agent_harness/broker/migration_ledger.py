"""Atomic per-environment migration number allocator."""
from __future__ import annotations

import sqlite3
import time
from typing import Any

from agent_harness.broker.db import get_conn


def reserve_migration(
    env: str,
    plan_id: str | None = None,
    lane_id: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> int:
    """Atomically reserve the next migration number for an environment.

    Returns the reserved number. Raises RuntimeError on failure.
    """
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    # Use immediate transaction to hold the lock early
    conn.execute("BEGIN IMMEDIATE")
    try:
        cursor = conn.execute(
            """
            SELECT MAX(number) as max_num FROM migration_ledger
            WHERE env = ? AND released_at IS NULL
            """,
            (env,),
        )
        row = cursor.fetchone()
        next_num = (row["max_num"] or 0) + 1

        conn.execute(
            """
            INSERT INTO migration_ledger (number, env, plan_id, lane_id, reserved_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (next_num, env, plan_id, lane_id, time.time()),
        )
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        if close_conn:
            conn.close()

    return next_num


def release_migration(
    number: int,
    env: str,
    conn: sqlite3.Connection | None = None,
) -> bool:
    """Soft-release a migration number (tombstone, do not reuse).

    Returns True if the row was updated.
    """
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cursor = conn.execute(
        """
        UPDATE migration_ledger
        SET released_at = ?
        WHERE number = ? AND env = ? AND released_at IS NULL
        """,
        (time.time(), number, env),
    )
    conn.commit()

    if close_conn:
        conn.close()
    return cursor.rowcount > 0


def list_reserved(
    env: str | None = None,
    conn: sqlite3.Connection | None = None,
) -> list[dict[str, Any]]:
    """List all reserved (not released) migration numbers."""
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    if env:
        cursor = conn.execute(
            """
            SELECT * FROM migration_ledger
            WHERE env = ? AND released_at IS NULL
            ORDER BY number ASC
            """,
            (env,),
        )
    else:
        cursor = conn.execute(
            """
            SELECT * FROM migration_ledger
            WHERE released_at IS NULL
            ORDER BY env, number ASC
            """
        )

    rows = [
        {
            "number": r["number"],
            "env": r["env"],
            "plan_id": r["plan_id"],
            "lane_id": r["lane_id"],
            "reserved_at": r["reserved_at"],
        }
        for r in cursor.fetchall()
    ]

    if close_conn:
        conn.close()
    return rows


def prune_released(
    max_age_days: float = 30.0,
    conn: sqlite3.Connection | None = None,
) -> int:
    """Delete old released migration ledger entries to prevent unbounded growth.

    Returns number of rows deleted.
    """
    close_conn = conn is None
    if conn is None:
        conn = get_conn()

    cutoff = time.time() - (max_age_days * 24 * 3600)
    cur = conn.execute(
        "DELETE FROM migration_ledger WHERE released_at IS NOT NULL AND released_at < ?",
        (cutoff,),
    )
    conn.commit()

    if close_conn:
        conn.close()
    return cur.rowcount
