#!/usr/bin/env python3
"""Queue-based telemetry system for the Agent Harness MCP server.

.. deprecated::
    This in-memory event bus duplicates broker/event_bus.py.
    Use broker_emit_event_tool and broker_get_events_tool instead.
    The telemetry.jsonl log is being replaced by the broker events table.
"""

from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field
from typing import Any


@dataclass
class HarnessEvent:
    """A single telemetry event."""

    event_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    timestamp: float = field(default_factory=time.time)
    workflow_id: str = ""
    event_type: str = ""  # phase_start, phase_complete, agent_progress, approval_needed, qa_result, error
    agent_role: str | None = None
    phase: str | None = None
    data: dict[str, Any] = field(default_factory=dict)
    message: str = ""


class WorkflowQueue:
    """Per-workflow event queue with async consumers."""

    def __init__(self, workflow_id: str, max_size: int = 1000):
        self.workflow_id = workflow_id
        self._queue: asyncio.Queue[HarnessEvent] = asyncio.Queue(maxsize=max_size)
        self._history: list[HarnessEvent] = []
        self._closed = False

    async def put(self, event: HarnessEvent) -> None:
        if self._closed:
            return
        event.workflow_id = self.workflow_id
        self._history.append(event)
        await self._queue.put(event)

    async def get(self) -> HarnessEvent:
        return await self._queue.get()

    def get_nowait(self) -> HarnessEvent | None:
        try:
            return self._queue.get_nowait()
        except asyncio.QueueEmpty:
            return None

    def drain(self, max_events: int = 100) -> list[HarnessEvent]:
        """Drain available events without blocking."""
        events = []
        for _ in range(max_events):
            evt = self.get_nowait()
            if evt is None:
                break
            events.append(evt)
        return events

    def get_history(self, since: float = 0.0) -> list[HarnessEvent]:
        return [e for e in self._history if e.timestamp >= since]

    def close(self) -> None:
        self._closed = True


class EventBus:
    """Global event bus managing all workflow queues."""

    def __init__(self):
        self._queues: dict[str, WorkflowQueue] = {}
        self._lock = asyncio.Lock()

    async def create_workflow(self, workflow_id: str) -> WorkflowQueue:
        async with self._lock:
            if workflow_id not in self._queues:
                self._queues[workflow_id] = WorkflowQueue(workflow_id)
            return self._queues[workflow_id]

    async def get_queue(self, workflow_id: str, auto_create: bool = True) -> WorkflowQueue | None:
        async with self._lock:
            if workflow_id not in self._queues and auto_create:
                self._queues[workflow_id] = WorkflowQueue(workflow_id)
            return self._queues.get(workflow_id)

    async def emit(self, workflow_id: str, event: HarnessEvent) -> None:
        queue = await self.get_queue(workflow_id)
        if queue:
            await queue.put(event)

    async def close_workflow(self, workflow_id: str) -> None:
        async with self._lock:
            if workflow_id in self._queues:
                self._queues[workflow_id].close()
                del self._queues[workflow_id]

    async def list_workflows(self) -> list[str]:
        async with self._lock:
            return list(self._queues.keys())
