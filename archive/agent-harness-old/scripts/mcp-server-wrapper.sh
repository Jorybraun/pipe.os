#!/bin/bash
# MCP server wrapper for Claude Desktop
# Ensures environment variables (KIMI_API_KEY) are loaded from shell profile

# Source common shell profiles to pick up env vars
[ -f "$HOME/.bash_profile" ] && source "$HOME/.bash_profile"
[ -f "$HOME/.zshrc" ] && source "$HOME/.zshrc"
[ -f "$HOME/.profile" ] && source "$HOME/.profile"

# Change to agent-harness directory
cd "$(dirname "$0")/.."

# Run the server with stdio transport
exec .venv/bin/python -m agent_harness.server --data-dir .swarm
