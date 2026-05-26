#!/usr/bin/env python3
"""Stdio-to-SSE proxy for Docker-based agent-harness MCP server.

Kimi CLI spawns this via stdio. It ensures the Docker container is running,
then proxies JSON-RPC messages to the container's SSE endpoint.
"""

import json
import os
import subprocess
import sys
import time
import urllib.request

SSE_URL = "http://localhost:8765/sse"
MESSAGE_URL = "http://localhost:8765/messages/?session_id={session_id}"
PROJECT_ROOT = "/Users/hans/Code/PIPE/PIPE-OS/agent-harness"


def _ensure_docker_running():
    """Start the Docker container if not already running."""
    try:
        result = subprocess.run(
            ["docker", "ps", "-q", "-f", "name=agent-harness-server"],
            capture_output=True, text=True, check=True
        )
        if result.stdout.strip():
            return  # Already running
    except Exception:
        pass

    # Start it
    subprocess.run(
        ["docker", "compose", "up", "agent-harness-server", "-d"],
        cwd=PROJECT_ROOT, check=True
    )
    # Wait for health
    for _ in range(30):
        try:
            urllib.request.urlopen(SSE_URL, timeout=2)
            return
        except Exception:
            time.sleep(1)
    raise RuntimeError("Docker container failed to start")


def _send(msg: dict):
    data = json.dumps(msg).encode()
    sys.stdout.buffer.write(data + b"\n")
    sys.stdout.buffer.flush()


def _recv() -> dict | None:
    line = sys.stdin.buffer.readline()
    if not line:
        return None
    return json.loads(line.decode("utf-8"))


def main():
    _ensure_docker_running()

    # Open SSE connection to get session endpoint
    import urllib.request
    req = urllib.request.Request(SSE_URL, method="GET")
    resp = urllib.request.urlopen(req, timeout=10)

    # Read the endpoint event
    session_id = None
    for _ in range(10):
        line = resp.readline().decode("utf-8").strip()
        if line.startswith("event: endpoint"):
            next_line = resp.readline().decode("utf-8").strip()
            if next_line.startswith("data: "):
                endpoint = next_line[6:]
                # Extract session_id from endpoint URL
                if "session_id=" in endpoint:
                    session_id = endpoint.split("session_id=")[1]
                break

    if not session_id:
        # Fallback: use default message URL pattern
        session_id = "default"

    message_url = MESSAGE_URL.format(session_id=session_id)

    # Handle MCP initialize
    req_obj = _recv()
    if req_obj is None:
        return

    method = req_obj.get("method")
    if method == "initialize":
        _send({
            "jsonrpc": "2.0",
            "id": req_obj.get("id"),
            "result": {
                "protocolVersion": "2024-11-05",
                "capabilities": {
                    "experimental": {},
                    "prompts": {"listChanged": False},
                    "resources": {"subscribe": False, "listChanged": False},
                    "tools": {"listChanged": True},
                },
                "serverInfo": {"name": "agent-harness-docker", "version": "0.1"},
            }
        })
    elif method == "tools/list":
        # Forward to Docker server
        post_req = urllib.request.Request(
            message_url,
            data=json.dumps(req_obj).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        post_resp = urllib.request.urlopen(post_req, timeout=30)
        result = json.loads(post_resp.read().decode())
        _send(result)
    elif method == "tools/call":
        post_req = urllib.request.Request(
            message_url,
            data=json.dumps(req_obj).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        post_resp = urllib.request.urlopen(post_req, timeout=120)
        result = json.loads(post_resp.read().decode())
        _send(result)
    else:
        _send({"jsonrpc": "2.0", "id": req_obj.get("id"), "error": {"code": -32601, "message": f"Method not found: {method}"}})

    # Main proxy loop
    while True:
        req_obj = _recv()
        if req_obj is None:
            break

        post_req = urllib.request.Request(
            message_url,
            data=json.dumps(req_obj).encode(),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        try:
            post_resp = urllib.request.urlopen(post_req, timeout=120)
            result = json.loads(post_resp.read().decode())
            _send(result)
        except Exception as e:
            _send({
                "jsonrpc": "2.0",
                "id": req_obj.get("id"),
                "error": {"code": -32603, "message": str(e)}
            })


if __name__ == "__main__":
    main()
