#!/usr/bin/env python3
"""Persistent message queue for inter-agent communication.

.. deprecated::
    This module duplicates the broker's event_bus + cue_channel.
    Messages are being consolidated into broker.db (see schema.sql messages table).
    Use broker_post_cue_tool, broker_read_cues_tool, and broker_get_events_tool instead.
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

from agent_harness import config


@dataclass
class AgentMessage:
    """A message exchanged between agents or operator and agents."""

    id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    workflow_id: str = ""
    channel: str = ""
    sender: str = ""  # who sent it: "operator", "pm", "architect", "system"
    recipient_role: str = ""  # target role, or "" for broadcast
    content: str = ""
    timestamp: float = field(default_factory=time.time)
    msg_type: str = "steering"  # steering | output | approval | system | qa
    data: dict[str, Any] = field(default_factory=dict)
    delivered: bool = False


class SQLiteMessageQueue:
    """Persistent message queue using SQLite.

    Supports publish, poll, and channel-based subscription.
    """

    def __init__(self, db_path: str | Path | None = None):
        self._db_path = Path(db_path) if db_path is not None else config.data_path("broker.db")
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._listeners: dict[str, list[Callable[[AgentMessage], None]]] = {}
        self._lock = asyncio.Lock()
        self._init_db()

    def _init_db(self) -> None:
        with sqlite3.connect(str(self._db_path)) as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    workflow_id TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    sender TEXT,
                    recipient_role TEXT,
                    content TEXT,
                    timestamp REAL,
                    msg_type TEXT,
                    data TEXT,
                    delivered INTEGER DEFAULT 0
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_channel_ts ON messages(channel, timestamp)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_wf_delivered ON messages(workflow_id, delivered)"
            )
            conn.commit()

    def _conn(self) -> sqlite3.Connection:
        return sqlite3.connect(str(self._db_path))

    async def publish(self, msg: AgentMessage) -> AgentMessage:
        """Persist a message and notify any in-process listeners."""
        async with self._lock:
            with self._conn() as conn:
                conn.execute(
                    """
                    INSERT INTO messages
                    (id, workflow_id, channel, sender, recipient_role, content, timestamp, msg_type, data, delivered)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        msg.id,
                        msg.workflow_id,
                        msg.channel,
                        msg.sender,
                        msg.recipient_role,
                        msg.content,
                        msg.timestamp,
                        msg.msg_type,
                        json.dumps(msg.data),
                        1 if msg.delivered else 0,
                    ),
                )
                conn.commit()

        # Notify in-process listeners (e.g. websocket server)
        for pattern, callbacks in list(self._listeners.items()):
            if self._channel_matches(pattern, msg.channel):
                for cb in callbacks:
                    try:
                        cb(msg)
                    except Exception:
                        pass
        return msg

    async def poll(
        self,
        channel: str,
        since: float = 0.0,
        limit: int = 100,
        mark_delivered: bool = False,
    ) -> list[AgentMessage]:
        """Poll messages on a channel. Optionally mark them delivered."""
        async with self._lock:
            with self._conn() as conn:
                cursor = conn.execute(
                    """
                    SELECT id, workflow_id, channel, sender, recipient_role,
                           content, timestamp, msg_type, data, delivered
                    FROM messages
                    WHERE channel = ? AND timestamp >= ?
                    ORDER BY timestamp ASC
                    LIMIT ?
                    """,
                    (channel, since, limit),
                )
                rows = cursor.fetchall()
                ids = [r[0] for r in rows]
                if mark_delivered and ids:
                    placeholders = ",".join("?" * len(ids))
                    conn.execute(
                        f"UPDATE messages SET delivered = 1 WHERE id IN ({placeholders})",
                        ids,
                    )
                    conn.commit()

        return [self._row_to_msg(r) for r in rows]

    async def poll_undelivered(
        self,
        workflow_id: str,
        channel_patterns: list[str],
        limit: int = 100,
    ) -> list[AgentMessage]:
        """Poll undelivered messages matching any channel pattern for a workflow."""
        if not channel_patterns:
            return []
        placeholders = ",".join("?" * len(channel_patterns))
        async with self._lock:
            with self._conn() as conn:
                cursor = conn.execute(
                    f"""
                    SELECT id, workflow_id, channel, sender, recipient_role,
                           content, timestamp, msg_type, data, delivered
                    FROM messages
                    WHERE workflow_id = ? AND delivered = 0 AND channel IN ({placeholders})
                    ORDER BY timestamp ASC
                    LIMIT ?
                    """,
                    (workflow_id, *channel_patterns, limit),
                )
                rows = cursor.fetchall()
                ids = [r[0] for r in rows]
                if ids:
                    ph = ",".join("?" * len(ids))
                    conn.execute(
                        f"UPDATE messages SET delivered = 1 WHERE id IN ({ph})",
                        ids,
                    )
                    conn.commit()
        return [self._row_to_msg(r) for r in rows]

    def subscribe(self, channel_pattern: str, callback: Callable[[AgentMessage], None]) -> None:
        """Subscribe to a channel pattern for in-process delivery (e.g. websocket bridge)."""
        self._listeners.setdefault(channel_pattern, []).append(callback)

    def unsubscribe(self, channel_pattern: str, callback: Callable[[AgentMessage], None]) -> None:
        """Remove a subscription."""
        if channel_pattern in self._listeners:
            self._listeners[channel_pattern] = [
                cb for cb in self._listeners[channel_pattern] if cb is not callback
            ]

    def _channel_matches(self, pattern: str, channel: str) -> bool:
        """Simple wildcard: 'workflow:*:pm' matches 'workflow:abc:pm'."""
        if pattern == channel:
            return True
        if pattern.endswith("*"):
            return channel.startswith(pattern[:-1])
        return False

    def _row_to_msg(self, row: tuple) -> AgentMessage:
        return AgentMessage(
            id=row[0],
            workflow_id=row[1],
            channel=row[2],
            sender=row[3],
            recipient_role=row[4],
            content=row[5],
            timestamp=row[6],
            msg_type=row[7],
            data=json.loads(row[8]) if row[8] else {},
            delivered=bool(row[9]),
        )

    def _prune_sync(
        self,
        max_age_days: float = 30.0,
        max_rows: int = 10000,
    ) -> int:
        """Synchronous prune helper (used from sync startup code)."""
        cutoff = time.time() - (max_age_days * 24 * 3600)
        with sqlite3.connect(str(self._db_path)) as conn:
            cur = conn.execute(
                "DELETE FROM messages WHERE timestamp < ?",
                (cutoff,),
            )
            deleted = cur.rowcount

            cursor = conn.execute("SELECT COUNT(*) as cnt FROM messages")
            row = cursor.fetchone()
            total = row[0] if row else 0

            if total > max_rows:
                excess = total - max_rows
                cur = conn.execute(
                    """
                    DELETE FROM messages
                    WHERE id IN (
                        SELECT id FROM messages
                        ORDER BY timestamp ASC
                        LIMIT ?
                    )
                    """,
                    (excess,),
                )
                deleted += cur.rowcount

            conn.commit()
        return deleted

    async def prune(
        self,
        max_age_days: float = 30.0,
        max_rows: int = 10000,
    ) -> int:
        """Delete old messages to prevent unbounded growth.

        Returns number of rows deleted.
        """
        cutoff = time.time() - (max_age_days * 24 * 3600)
        async with self._lock:
            with self._conn() as conn:
                cur = conn.execute(
                    "DELETE FROM messages WHERE timestamp < ?",
                    (cutoff,),
                )
                deleted = cur.rowcount

                cursor = conn.execute("SELECT COUNT(*) as cnt FROM messages")
                row = cursor.fetchone()
                total = row[0] if row else 0

                if total > max_rows:
                    excess = total - max_rows
                    cur = conn.execute(
                        """
                        DELETE FROM messages
                        WHERE id IN (
                            SELECT id FROM messages
                            ORDER BY timestamp ASC
                            LIMIT ?
                        )
                        """,
                        (excess,),
                    )
                    deleted += cur.rowcount

                conn.commit()
        return deleted

    async def channel_history(
        self, channel: str, limit: int = 200
    ) -> list[AgentMessage]:
        """Get full history for a channel."""
        async with self._lock:
            with self._conn() as conn:
                cursor = conn.execute(
                    """
                    SELECT id, workflow_id, channel, sender, recipient_role,
                           content, timestamp, msg_type, data, delivered
                    FROM messages
                    WHERE channel = ?
                    ORDER BY timestamp DESC
                    LIMIT ?
                    """,
                    (channel, limit),
                )
                rows = cursor.fetchall()
        return [self._row_to_msg(r) for r in reversed(rows)]


# Singleton instance (orchestrator + websocket server share it)
_default_queue: SQLiteMessageQueue | None = None


def get_message_queue(db_path: str | Path | None = None) -> SQLiteMessageQueue:
    global _default_queue
    if _default_queue is None:
        _default_queue = SQLiteMessageQueue(db_path if db_path is not None else config.data_path("broker.db"))
    return _default_queue
