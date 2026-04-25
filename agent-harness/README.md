# Agent Harness

An MCP server that orchestrates multi-agent development workflows with queue-based telemetry and persistent state.

## Features

- **6-phase workflow**: PM → Design → Architecture → Implementation → QA → Approval
- **Queue-based telemetry**: Real-time event streaming across sessions
- **Persistent state**: Workflow state survives server restarts
- **Quality gates**: TypeScript compilation, `any` type detection, named export checks, changelog verification
- **Approval gates**: Structured approve/reject/revise workflow
- **Parallel agent support**: Backend and Frontend agents run concurrently

## Installation

```bash
pip install agent-harness
```

Or from source:

```bash
git clone <repo>
cd agent-harness
pip install -e .
```

## Quick Start

### 1. Register with Kimi Code CLI

```bash
kimi mcp add --transport stdio agent-harness -- agent-harness
```

Or with a custom venv:

```bash
kimi mcp add --transport stdio agent-harness -- \
  /path/to/venv/bin/python -m agent_harness.server
```

### 2. Or use with Claude Desktop / other MCP clients

Add to your MCP config:

```json
{
  "mcpServers": {
    "agent-harness": {
      "command": "agent-harness"
    }
  }
}
```

### 3. Run standalone

```bash
# stdio transport (for MCP clients)
agent-harness

# SSE transport (for HTTP clients)
agent-harness --transport sse --port 8765
```

## Workflow

1. **Start**: `harness_start_workflow(task, repo_path)`
2. **Plan**: Spawn PM agent, submit output
3. **Design**: Spawn Designer agent (if needed)
4. **Architect**: Spawn Architect agent (if needed)
5. **Implement**: Spawn Backend/Frontend agents in parallel
6. **QA**: Run `harness_run_qa(workflow_id)`
7. **Approve**: Request final approval, mark complete

## Telemetry

Poll for live events:

```
harness_poll_events(workflow_id, timeout=5.0)
```

Get historical events:

```
harness_get_telemetry(workflow_id, since=0.0)
```

Events are persisted to `.swarm/telemetry.jsonl`.

## State

Workflow state is saved to `.swarm/mcp_state.json` after every mutation.
