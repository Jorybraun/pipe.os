#!/usr/bin/env python3
"""Lazy MCP wrapper — responds to Kimi immediately, execs real server on demand.

Kimi spawns this on session start. It acts as a minimal MCP server with one tool:
`harness_start_server`. When called, it sends the response, then execs the real
agent-harness server preserving stdin/stdout.

Supports both Content-Length (Claude Desktop) and line-delimited JSON (Kimi CLI).
"""

import json
import os
import sys

PROJECT_ROOT = "/Users/hans/Code/PIPE/PIPE-OS/agent-harness"
PYTHON = f"{PROJECT_ROOT}/.venv/bin/python"
SERVER_ARGS = [PYTHON, "-m", "agent_harness.server", "--data-dir", ".swarm"]

# Detected protocol format from client: True = Content-Length (Claude), False = line-delimited (Kimi)
_use_content_length: bool | None = None


def _send(msg: dict) -> None:
    data = json.dumps(msg).encode()
    global _use_content_length
    if _use_content_length:
        header = f"Content-Length: {len(data)}\r\n\r\n".encode()
        sys.stdout.buffer.write(header + data)
    else:
        sys.stdout.buffer.write(data + b"\n")
    sys.stdout.buffer.flush()


def _read_line() -> bytes:
    line = b""
    while b"\n" not in line:
        chunk = sys.stdin.buffer.read(1)
        if not chunk:
            return b""
        line += chunk
    return line


def _recv() -> dict | None:
    first_line = _read_line()
    if not first_line:
        return None

    stripped = first_line.strip()

    # Content-Length protocol (Claude Desktop / TypeScript SDK)
    global _use_content_length
    if stripped.lower().startswith(b"content-length:"):
        _use_content_length = True
        try:
            length = int(stripped.split(b":", 1)[1].strip())
        except (IndexError, ValueError):
            return None

        # Consume separator empty line (\r\n or just \n)
        if first_line.endswith(b"\r\n"):
            sep = b""
            while b"\n" not in sep:
                chunk = sys.stdin.buffer.read(1)
                if not chunk:
                    return None
                sep += chunk

        body = sys.stdin.buffer.read(length)
        return json.loads(body)

    # Line-delimited JSON protocol (Kimi CLI / Python SDK)
    _use_content_length = False
    return json.loads(stripped.decode("utf-8"))


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
        body = _handle(req)
        should_exec = body.pop("_exec_after_send", False)

        # Notifications (no id) must not receive a response per JSON-RPC 2.0
        if req.get("id") is None:
            if should_exec:
                os.chdir(PROJECT_ROOT)
                os.execv(PYTHON, SERVER_ARGS)
            continue

        if "error" in body:
            resp = {"jsonrpc": "2.0", "id": req["id"], "error": body["error"]}
        else:
            resp = {"jsonrpc": "2.0", "id": req["id"], "result": body}
        _send(resp)

        if should_exec:
            os.chdir(PROJECT_ROOT)
            os.execv(PYTHON, SERVER_ARGS)


if __name__ == "__main__":
    main()
