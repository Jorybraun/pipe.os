# Handoff — MCP Server Stdio Fix

## Problem

The agent-harness MCP server was failing to start in stdio transport mode with:

```
Failed to parse JSONRPC message from server
...
Invalid JSON: expected value at line 1 column 2
input_value='[harness ws] Agent WebSo... on ws://127.0.0.1:8766'
```

Two separate bugs caused this:

1. **Stdout pollution**: `AgentWebSocketServer.start()` printed its startup banner to **stdout**, corrupting the JSON-RPC message stream.
2. **Event loop crash**: `_run_stdio()` called `mcp.run(transport="stdio")` inside an existing `asyncio.run()` loop. `mcp.run()` internally uses `anyio.run()`, which raises `RuntimeError: Already running asyncio in this thread`.

## Fixes applied

### 1. Redirect WebSocket startup log to stderr
**File:** `agent-harness/src/agent_harness/websocket_server.py`

- Added `import sys`
- Changed `print(f"[harness ws] ...")` → `print(f"[harness ws] ...", file=sys.stderr)`

### 2. Redirect shutdown log to stderr (cleanup)
**File:** `agent-harness/src/agent_harness/server.py`

- Changed `print("\n[harness] Shutting down...")` → `print("\n[harness] Shutting down...", file=sys.stderr)`

### 3. Use async stdio entrypoint
**File:** `agent-harness/src/agent_harness/server.py`

- Changed `mcp.run(transport="stdio")` → `await mcp.run_stdio_async()`

This allows the WebSocket server and MCP stdio transport to share the same event loop instead of trying to nest them.

## Files touched

```
agent-harness/src/agent_harness/websocket_server.py
agent-harness/src/agent_harness/server.py
```

## Verification

Ran a 2-second smoke test:

```bash
cd agent-harness
python -m agent_harness.server
```

- **Stdout:** empty ✅
- **Stderr:** correctly shows `[broker] Database initialised` and `[harness ws] Agent WebSocket server started` ✅
- **No crash:** process stays alive instead of throwing `RuntimeError` ✅

## Impact

- MCP clients (Kimi Code CLI, Claude Desktop, etc.) can now connect to the harness server via stdio without JSON-RPC parse errors.
- The server is usable both as a stdio MCP server and as an SSE server (existing `--transport sse` path unchanged).
