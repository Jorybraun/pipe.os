#!/usr/bin/env python3
"""Lazy MCP wrapper — responds to Kimi immediately, execs real server on demand.

Kimi spawns this on session start. It acts as a minimal MCP server with one tool:
`harness_start_server`. When called, it sends the response, then execs the real
agent-harness server preserving stdin/stdout.
"""

import json
import os
import sys

PROJECT_ROOT = "/Users/hans/Code/PIPE/PIPE-OS/agent-harness"
PYTHON = f"{PROJECT_ROOT}/.venv/bin/python"
SERVER_ARGS = [PYTHON, "-m", "agent_harness.server", "--data-dir", ".swarm"]


def _send(msg: dict) -> None:
    data = json.dumps(msg).encode()
    header = f"Content-Length: {len(data)}\r\n\r\n".encode()
    sys.stdout.buffer.write(header + data)
    sys.stdout.buffer.flush()


def _recv() -> dict | None:
    header = b""
    while b"\r\n\r\n" not in header:
        chunk = sys.stdin.buffer.read(1)
        if not chunk:
            return None
        header += chunk
    try:
        length = int(header.split(b"Content-Length: ")[1].split(b"\r\n")[0])
    except (IndexError, ValueError):
        line = header.decode().strip()
        if not line:
            line = sys.stdin.readline().strip()
        return json.loads(line) if line else None
    body = sys.stdin.buffer.read(length)
    return json.loads(body)


def _handle(req: dict) -> dict:
    method = req.get("method")
    if method == "initialize":
        return {
            "protocolVersion": "2024-11-05",
            "capabilities": {
                "experimental": {},
                "prompts": {"listChanged": False},
                "resources": {"subscribe": False, "listChanged": False},
                "tools": {"listChanged": False},
            },
            "serverInfo": {"name": "agent-harness-lazy", "version": "0.1"},
            "instructions": "Agent Harness is idle. Call harness_start_server to start.",
        }
    if method == "tools/list":
        return {
            "tools": [
                {
                    "name": "harness_start_server",
                    "description": "Start the agent-harness MCP server. Preserves connection.",
                    "inputSchema": {"type": "object", "properties": {}},
                }
            ]
        }
    if method == "tools/call":
        tool = req.get("params", {}).get("name")
        if tool == "harness_start_server":
            return {
                "_exec_after_send": True,
                "content": [{"type": "text", "text": "Agent Harness server starting..."}],
                "isError": False,
            }
        return {"content": [{"type": "text", "text": f"Unknown tool: {tool}"}], "isError": True}
    return {"error": {"code": -32601, "message": f"Method not found: {method}"}}


def main():
    while True:
        req = _recv()
        if req is None:
            break
        resp = _handle(req)
        resp["jsonrpc"] = "2.0"
        resp["id"] = req.get("id")

        should_exec = resp.pop("_exec_after_send", False)
        _send(resp)

        if should_exec:
            os.chdir(PROJECT_ROOT)
            os.execv(PYTHON, SERVER_ARGS)


if __name__ == "__main__":
    main()
