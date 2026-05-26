"""Handoff store — developer exit artifacts persisted in SQLite."""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from agent_harness.broker.db import get_conn


def _make_handoff_id(plan_id: str, subtask_id: str, sequence: int) -> str:
    return f"{plan_id}:{subtask_id}:{sequence}"


def submit_handoff(
    plan_id: str,
    subtask_id: str,
    status: str,
    handoff_to: str,
    sequence: int | None = None,
    done: list[dict] | None = None,
    next_actions: list[str] | None = None,
    state_notes: list[str] | None = None,
    files_touched: list[str] | None = None,
    migrations_reserved: list[int] | None = None,
    context_used: int | None = None,
    dod_checklist: list[dict] | None = None,
) -> dict[str, Any]:
    """Store a developer handoff. Returns the stored record."""
    conn = get_conn()
    try:
        if sequence is None:
            row = conn.execute(
                """
                SELECT MAX(sequence) as max_seq FROM handoffs
                WHERE plan_id = ? AND subtask_id = ?
                """,
                (plan_id, subtask_id),
            ).fetchone()
            sequence = (row["max_seq"] or 0) + 1

        handoff_id = _make_handoff_id(plan_id, subtask_id, sequence)
        created_at = time.time()

        conn.execute(
            """
            INSERT INTO handoffs (
                handoff_id, plan_id, subtask_id, sequence, status,
                done, next_actions, state_notes, files_touched,
                migrations_reserved, context_used, handoff_to, dod_checklist, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                handoff_id,
                plan_id,
                subtask_id,
                sequence,
                status,
                json.dumps(done or []),
                json.dumps(next_actions or []),
                json.dumps(state_notes or []),
                json.dumps(files_touched or []),
                json.dumps(migrations_reserved or []),
                context_used,
                handoff_to,
                json.dumps(dod_checklist or []),
                created_at,
            ),
        )
        conn.commit()
        return {
            "handoff_id": handoff_id,
            "plan_id": plan_id,
            "subtask_id": subtask_id,
            "sequence": sequence,
            "status": status,
            "handoff_to": handoff_to,
            "created_at": created_at,
        }
    finally:
        conn.close()


def get_handoff(plan_id: str, subtask_id: str, sequence: int | None = None) -> dict[str, Any] | None:
    """Retrieve a specific handoff, or the latest for a (plan_id, subtask_id)."""
    conn = get_conn()
    try:
        if sequence is not None:
            handoff_id = _make_handoff_id(plan_id, subtask_id, sequence)
            row = conn.execute(
                "SELECT * FROM handoffs WHERE handoff_id = ?",
                (handoff_id,),
            ).fetchone()
        else:
            row = conn.execute(
                """
                SELECT * FROM handoffs
                WHERE plan_id = ? AND subtask_id = ?
                ORDER BY sequence DESC LIMIT 1
                """,
                (plan_id, subtask_id),
            ).fetchone()

        if row is None:
            return None
        return _deserialize_row(row)
    finally:
        conn.close()


def get_handoff_chain(plan_id: str) -> list[dict[str, Any]]:
    """Return all handoffs for a plan, ordered by subtask and sequence."""
    conn = get_conn()
    try:
        rows = conn.execute(
            """
            SELECT * FROM handoffs WHERE plan_id = ?
            ORDER BY subtask_id, sequence
            """,
            (plan_id,),
        ).fetchall()
        return [_deserialize_row(r) for r in rows]
    finally:
        conn.close()


def _deserialize_row(row: Any) -> dict[str, Any]:
    return {
        "handoff_id": row["handoff_id"],
        "plan_id": row["plan_id"],
        "subtask_id": row["subtask_id"],
        "sequence": row["sequence"],
        "status": row["status"],
        "done": json.loads(row["done"] or "[]"),
        "next_actions": json.loads(row["next_actions"] or "[]"),
        "state_notes": json.loads(row["state_notes"] or "[]"),
        "files_touched": json.loads(row["files_touched"] or "[]"),
        "migrations_reserved": json.loads(row["migrations_reserved"] or "[]"),
        "context_used": row["context_used"],
        "handoff_to": row["handoff_to"],
        "dod_checklist": json.loads(row["dod_checklist"] or "[]"),
        "created_at": row["created_at"],
    }
