#!/usr/bin/env python3
"""Lazy MCP wrapper — starts Docker container on demand, then execs into it.

Kimi spawns this on session start. It acts as a minimal MCP server with one tool:
`harness_start_server`. When called, it ensures the Docker container is running,
then execs `docker exec -i` so stdio is preserved into the container.

Supports both Content-Length (Claude Desktop) and line-delimited JSON (Kimi CLI).
"""

import json
import os
import subprocess
import sys
import time

PROJECT_ROOT = "/Users/hans/Code/PIPE/PIPE-OS/agent-harness"
CONTAINER_NAME = "agent-harness-server"

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


def _container_is_running() -> bool:
    try:
        result = subprocess.run(
            ["docker", "inspect", "-f", "{{.State.Running}}", CONTAINER_NAME],
            capture_output=True,
            text=True,
            timeout=5,
        )
        return result.returncode == 0 and result.stdout.strip() == "true"
    except Exception:
        return False


def _ensure_container() -> None:
    """Start the Docker container if it's not already running."""
    if _container_is_running():
        return

    # Try to start it
    subprocess.run(
        ["docker", "compose", "up", "-d", "agent-harness-server"],
        cwd=PROJECT_ROOT,
        check=False,
    )

    # Wait up to 15s for the container to be ready
    for _ in range(15):
        if _container_is_running():
            return
        time.sleep(1)

    raise RuntimeError(f"Container {CONTAINER_NAME} did not start in time")


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
            try:
                _ensure_container()
                return {
                    "_exec_after_send": True,
                    "content": [{"type": "text", "text": "Agent Harness server starting in Docker..."}],
                    "isError": False,
                }
            except Exception as e:
                return {
                    "content": [{"type": "text", "text": f"Failed to start container: {e}"}],
                    "isError": True,
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
                _ensure_container()
                os.execv(
                    "/usr/bin/docker",
                    [
                        "docker",
                        "exec",
                        "-i",
                        CONTAINER_NAME,
                        "python",
                        "-m",
                        "agent_harness.server",
                        "--data-dir",
                        "/app/agent-harness/.swarm",
                    ],
                )
            continue

        if "error" in body:
            resp = {"jsonrpc": "2.0", "id": req["id"], "error": body["error"]}
        else:
            resp = {"jsonrpc": "2.0", "id": req["id"], "result": body}
        _send(resp)

        if should_exec:
            _ensure_container()
            os.execv(
                "/usr/bin/docker",
                [
                    "docker",
                    "exec",
                    "-i",
                    CONTAINER_NAME,
                    "python",
                    "-m",
                    "agent_harness.server",
                    "--data-dir",
                    "/app/agent-harness/.swarm",
                ],
            )


if __name__ == "__main__":
    main()
