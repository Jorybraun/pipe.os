#!/usr/bin/env python3
"""WebSocket server for agent push notifications.

.. deprecated::
    WebSocket push is being replaced by the planned SSE subscribe endpoint
    (broker_get_events_tool with streaming). Use broker events + cues for
    real-time agent communication instead.

Agents connect and subscribe to channels:
    {"subscribe": "workflow:hw-xxx:pm"}

Messages are pushed as JSON:
    {"type": "message", "payload": {...}}

Also supports:
    {"subscribe": "workflow:hw-xxx:broadcast"}
    {"poll": {"workflow_id": "hw-xxx", "roles": ["pm", "architect"]}}
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from typing import Any

import websockets
from websockets.protocol import State

from agent_harness.messaging import AgentMessage, SQLiteMessageQueue, get_message_queue


def _channel_for(workflow_id: str, role: str) -> str:
    return f"workflow:{workflow_id}:{role}"


class AgentWebSocketServer:
    """Push-notification server for harness agents."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 8766,
        queue: SQLiteMessageQueue | None = None,
        poll_interval: float = 0.5,
    ):
        self.host = host
        self.port = port
        self.queue = queue or get_message_queue()
        self.poll_interval = poll_interval
        self._connections: dict[Any, dict[str, Any]] = {}  # websocket -> metadata
        self._server: Any | None = None
        self._poller_task: asyncio.Task | None = None
        self._server_task: asyncio.Task | None = None
        self._shutdown_event = asyncio.Event()

    async def start(self) -> None:
        import websockets

        self._server = await websockets.serve(
            self._handle_connection,
            self.host,
            self.port,
        )
        self._poller_task = asyncio.create_task(self._poll_loop())
        # websockets 14+ requires serve_forever() to process connections
        if hasattr(self._server, "serve_forever"):
            self._server_task = asyncio.create_task(self._server.serve_forever())
        print(f"[harness ws] Agent WebSocket server started on ws://{self.host}:{self.port}", file=sys.stderr)

    async def stop(self) -> None:
        self._shutdown_event.set()
        if self._server_task:
            self._server_task.cancel()
            try:
                await self._server_task
            except asyncio.CancelledError:
                pass
        if self._poller_task:
            self._poller_task.cancel()
            try:
                await self._poller_task
            except asyncio.CancelledError:
                pass
        if self._server:
            self._server.close()
            await self._server.wait_closed()

    async def _poll_loop(self) -> None:
        """Background loop: poll message queue and push to connected clients."""
        while not self._shutdown_event.is_set():
            try:
                await asyncio.wait_for(
                    self._shutdown_event.wait(),
                    timeout=self.poll_interval,
                )
            except asyncio.TimeoutError:
                pass

            # Collect all channels that have active subscribers
            channel_to_clients: dict[str, list[Any]] = {}
            for ws, meta in list(self._connections.items()):
                if ws.state != State.OPEN:
                    continue
                wf_id = meta.get("workflow_id")
                if not wf_id:
                    continue
                roles = meta.get("subscribed_roles", set())
                for role in roles:
                    ch = _channel_for(wf_id, role)
                    channel_to_clients.setdefault(ch, []).append(ws)
                # Always include broadcast
                bc = _channel_for(wf_id, "broadcast")
                channel_to_clients.setdefault(bc, []).append(ws)

            # Poll undelivered messages for each workflow+channel combo
            # Group by workflow_id to minimize DB queries
            wf_channels: dict[str, set[str]] = {}
            for ch, clients in channel_to_clients.items():
                parts = ch.split(":")
                if len(parts) >= 3:
                    wf_id = parts[1]
                    wf_channels.setdefault(wf_id, set()).add(ch)

            for wf_id, channels in wf_channels.items():
                try:
                    messages = await self.queue.poll_undelivered(wf_id, list(channels))
                    for msg in messages:
                        clients = channel_to_clients.get(msg.channel, [])
                        for ws in clients:
                            await self._send_msg(ws, msg)
                except Exception:
                    pass

    async def _handle_connection(self, websocket) -> None:
        self._connections[websocket] = {
            "subscribed_roles": set(),
            "workflow_id": None,
            "role": None,
        }
        try:
            async for raw in websocket:
                try:
                    msg = json.loads(raw)
                except json.JSONDecodeError:
                    await websocket.send(json.dumps({"type": "error", "message": "Invalid JSON"}))
                    continue

                if "subscribe" in msg:
                    channel = msg["subscribe"]
                    parts = channel.split(":")
                    if len(parts) >= 3:
                        self._connections[websocket]["workflow_id"] = parts[1]
                        self._connections[websocket]["subscribed_roles"].add(parts[2])
                    await websocket.send(json.dumps({"type": "subscribed", "channel": channel}))

                elif "poll" in msg:
                    poll_req = msg["poll"]
                    wf_id = poll_req.get("workflow_id")
                    roles = poll_req.get("roles", [])
                    channels = [_channel_for(wf_id, r) for r in roles]
                    channels.append(_channel_for(wf_id, "broadcast"))
                    messages = await self.queue.poll_undelivered(wf_id, channels)
                    await websocket.send(json.dumps({
                        "type": "poll_result",
                        "messages": [self._msg_to_dict(m) for m in messages],
                    }))

                elif "identify" in msg:
                    ident = msg["identify"]
                    self._connections[websocket]["workflow_id"] = ident.get("workflow_id")
                    self._connections[websocket]["role"] = ident.get("role")
                    await websocket.send(json.dumps({"type": "identified", "ok": True}))

                else:
                    await websocket.send(json.dumps({"type": "error", "message": "Unknown command"}))

        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self._connections.pop(websocket, None)

    async def _send_msg(self, websocket, message: AgentMessage) -> None:
        if websocket.state != State.OPEN:
            return
        try:
            await websocket.send(json.dumps({
                "type": "message",
                "payload": self._msg_to_dict(message),
            }))
        except websockets.exceptions.ConnectionClosed:
            pass

    def _msg_to_dict(self, msg: AgentMessage) -> dict[str, Any]:
        return {
            "id": msg.id,
            "workflow_id": msg.workflow_id,
            "channel": msg.channel,
            "sender": msg.sender,
            "recipient_role": msg.recipient_role,
            "content": msg.content,
            "timestamp": msg.timestamp,
            "msg_type": msg.msg_type,
            "data": msg.data,
        }
