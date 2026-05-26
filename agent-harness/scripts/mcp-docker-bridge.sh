#!/bin/bash
# MCP Docker bridge — starts container if needed, then execs into it.
# Kimi Code CLI spawns this directly; stdio is preserved into the container.

set -e

PROJECT_ROOT="/Users/hans/Code/PIPE/PIPE-OS/agent-harness"
CONTAINER_NAME="agent-harness-server"

cd "$PROJECT_ROOT"

# Start container if not running
if ! docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true; then
    docker compose up -d agent-harness-server >/dev/null 2>&1
    # Wait for container to be ready
    for i in {1..15}; do
        if docker inspect -f '{{.State.Running}}' "$CONTAINER_NAME" 2>/dev/null | grep -q true; then
            break
        fi
        sleep 1
    done
fi

# Exec into container, preserving stdio for MCP protocol
exec docker exec -i "$CONTAINER_NAME" \
    python -m agent_harness.server \
    --data-dir /app/agent-harness/.swarm
