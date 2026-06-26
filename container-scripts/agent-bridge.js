#!/usr/bin/env node
/**
 * Agent Bridge — runs inside the dev container alongside code-server.
 *
 * Responsibilities:
 *   - WebSocket server on port 8081 for Clippy UI to connect to
 *   - Manages agent process lifecycle (Claude Code, Aider, etc.)
 *   - Relays chat messages between Clippy UI and the agent
 *   - Watches workspace filesystem for changes
 *   - Handles agent authentication (OAuth callback server on port 8082)
 *   - Reports agent status (idle/thinking/working/auth-needed)
 *
 * Message protocol (Clippy ↔ Agent Bridge):
 *   Clippy → Bridge:
 *     { type: 'CHAT', text: '...' }
 *     { type: 'AUTH_START', agent: 'claude-code' }
 *     { type: 'AUTH_CALLBACK', code: '...', state: '...' }
 *     { type: 'AGENT_STOP' }
 *     { type: 'GET_STATUS' }
 *
 *   Bridge → Clippy:
 *     { type: 'CHAT_RESPONSE', text: '...' }
 *     { type: 'AGENT_STATUS', status: 'idle'|'thinking'|'working'|'auth_needed' }
 *     { type: 'AUTH_NEEDED', authUrl: '...', agent: '...' }
 *     { type: 'FILE_CHANGED', path: '...', action: 'modified'|'created'|'deleted' }
 *     { type: 'AGENT_READY', agent: '...', capabilities: [...] }
 *     { type: 'ERROR', message: '...' }
 */

const { WebSocketServer } = require('ws');
const http = require('http');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BRIDGE_PORT = parseInt(process.env.AGENT_BRIDGE_PORT || '8081', 10);
const AUTH_PORT = parseInt(process.env.AGENT_AUTH_PORT || '8082', 10);
const WORKSPACE = process.env.WORKSPACE_DIR || '/home/coder/workspace';
const AGENT_TYPE = process.env.AGENT_TYPE || 'claude-code';
const AGENT_API_KEY = process.env.AGENT_API_KEY || process.env.ANTHROPIC_API_KEY || '';

let agentProcess = null;
let agentStatus = 'idle';
let pendingAuthResolver = null;
const clients = new Set();

// ─── Agent definitions ─────────────────────────────────────────────────────

const AGENTS = {
  'claude-code': {
    name: 'Claude Code',
    install: 'npm install -g @anthropic-ai/claude-code 2>/dev/null',
    start: (workspace) => {
      const env = { ...process.env, ANTHROPIC_API_KEY: AGENT_API_KEY };
      return spawn('claude', ['--workspace', workspace, '--json'], {
        cwd: workspace,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    },
    needsAuth: !AGENT_API_KEY,
    capabilities: ['read', 'write', 'run'],
  },
  'aider': {
    name: 'Aider',
    install: 'pip install aider-chat 2>/dev/null',
    start: (workspace) => {
      const env = { ...process.env };
      return spawn('aider', ['--no-auto-commits', '--json'], {
        cwd: workspace,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    },
    needsAuth: !process.env.OPENAI_API_KEY && !AGENT_API_KEY,
    capabilities: ['read', 'write'],
  },
};

// ─── WebSocket server (port 8081) ──────────────────────────────────────────

const wss = new WebSocketServer({ port: BRIDGE_PORT, host: '0.0.0.0' });

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`[agent-bridge] Client connected (${clients.size} total)`);

  // Send current status
  send(ws, { type: 'AGENT_STATUS', status: agentStatus });
  send(ws, { type: 'AGENT_READY', agent: AGENT_TYPE, capabilities: AGENTS[AGENT_TYPE]?.capabilities || [] });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      send(ws, { type: 'ERROR', message: 'Invalid JSON' });
      return;
    }

    switch (msg.type) {
      case 'CHAT':
        handleChat(ws, msg.text);
        break;
      case 'AUTH_START':
        handleAuthStart(ws, msg.agent || AGENT_TYPE);
        break;
      case 'AUTH_CALLBACK':
        handleAuthCallback(ws, msg.code, msg.state);
        break;
      case 'AGENT_STOP':
        stopAgent();
        break;
      case 'GET_STATUS':
        send(ws, { type: 'AGENT_STATUS', status: agentStatus });
        break;
      default:
        send(ws, { type: 'ERROR', message: `Unknown message type: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log(`[agent-bridge] Client disconnected (${clients.size} total)`);
  });
});

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(msg) {
  for (const ws of clients) {
    send(ws, msg);
  }
}

// ─── Agent process management ───────────────────────────────────────────────

function startAgent() {
  const agentDef = AGENTS[AGENT_TYPE];
  if (!agentDef) {
    broadcast({ type: 'ERROR', message: `Unknown agent type: ${AGENT_TYPE}` });
    return;
  }

  if (agentDef.needsAuth) {
    agentStatus = 'auth_needed';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    broadcast({ type: 'AUTH_NEEDED', authUrl: `http://localhost:${AUTH_PORT}/start?agent=${AGENT_TYPE}`, agent: AGENT_TYPE });
    return;
  }

  try {
    agentProcess = agentDef.start(WORKSPACE);
    agentStatus = 'idle';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    broadcast({ type: 'AGENT_READY', agent: AGENT_TYPE, capabilities: agentDef.capabilities });
    console.log(`[agent-bridge] Started ${AGENT_TYPE} agent (pid: ${agentProcess.pid})`);

    agentProcess.stdout.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        agentStatus = 'working';
        broadcast({ type: 'AGENT_STATUS', status: agentStatus });
        broadcast({ type: 'CHAT_RESPONSE', text });
        agentStatus = 'idle';
        broadcast({ type: 'AGENT_STATUS', status: agentStatus });
      }
    });

    agentProcess.stderr.on('data', (data) => {
      const text = data.toString().trim();
      if (text) {
        console.error(`[agent-bridge] Agent stderr: ${text}`);
      }
    });

    agentProcess.on('exit', (code) => {
      console.log(`[agent-bridge] Agent exited with code ${code}`);
      agentProcess = null;
      agentStatus = 'idle';
      broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    });

    agentProcess.on('error', (err) => {
      console.error(`[agent-bridge] Agent process error:`, err);
      broadcast({ type: 'ERROR', message: `Agent failed to start: ${err.message}` });
      agentProcess = null;
      agentStatus = 'idle';
      broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    });
  } catch (err) {
    broadcast({ type: 'ERROR', message: `Failed to start agent: ${err.message}` });
    agentStatus = 'idle';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
  }
}

function stopAgent() {
  if (agentProcess) {
    try {
      agentProcess.kill('SIGTERM');
    } catch {
      // ignore
    }
    agentProcess = null;
  }
  agentStatus = 'idle';
  broadcast({ type: 'AGENT_STATUS', status: agentStatus });
}

function handleChat(ws, text) {
  if (!text || !text.trim()) return;

  if (!agentProcess && agentStatus !== 'auth_needed') {
    startAgent();
  }

  if (agentStatus === 'auth_needed') {
    send(ws, { type: 'CHAT_RESPONSE', text: 'I need to authenticate first! Click the login button to connect.' });
    return;
  }

  if (!agentProcess) {
    send(ws, { type: 'CHAT_RESPONSE', text: 'Agent is not running. Please try again.' });
    return;
  }

  agentStatus = 'thinking';
  broadcast({ type: 'AGENT_STATUS', status: agentStatus });

  try {
    agentProcess.stdin.write(text + '\n');
  } catch (err) {
    broadcast({ type: 'ERROR', message: `Failed to send to agent: ${err.message}` });
    agentStatus = 'idle';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
  }
}

function handleAuthStart(ws, agentName) {
  const agentDef = AGENTS[agentName];
  if (!agentDef) {
    send(ws, { type: 'ERROR', message: `Unknown agent: ${agentName}` });
    return;
  }
  agentStatus = 'auth_needed';
  broadcast({ type: 'AGENT_STATUS', status: agentStatus });
  broadcast({ type: 'AUTH_NEEDED', authUrl: `http://localhost:${AUTH_PORT}/start?agent=${agentName}`, agent: agentName });
}

function handleAuthCallback(ws, code, state) {
  // Auth callback received — restart agent with auth complete
  agentStatus = 'idle';
  broadcast({ type: 'AGENT_STATUS', status: agentStatus });
  broadcast({ type: 'AGENT_READY', agent: AGENT_TYPE, capabilities: AGENTS[AGENT_TYPE]?.capabilities || [] });
  startAgent();
}

// ─── Auth server (port 8082) ───────────────────────────────────────────────

const authServer = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${AUTH_PORT}`);

  if (url.pathname === '/start') {
    const agent = url.searchParams.get('agent') || AGENT_TYPE;
    // In a real implementation, this would redirect to the agent's OAuth page.
    // For API-key based agents, we simulate success.
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html><body style="font-family: sans-serif; padding: 40px; text-align: center;">
<h2>Agent Authentication</h2>
<p>Authenticating ${agent}...</p>
<script>
  fetch('/callback?simulated=1').then(() => {
    document.body.innerHTML = '<h2>&#10003; Authentication successful!</h2><p>You can close this window.</p>';
  });
</script>
</body></html>`);
    return;
  }

  if (url.pathname === '/callback') {
    const code = url.searchParams.get('code') || url.searchParams.get('simulated') || '';
    const state = url.searchParams.get('state') || '';

    // Notify bridge that auth completed
    if (pendingAuthResolver) {
      pendingAuthResolver({ code, state });
      pendingAuthResolver = null;
    }

    // For simulated auth, restart agent
    if (url.searchParams.get('simulated')) {
      agentStatus = 'idle';
      broadcast({ type: 'AGENT_STATUS', status: agentStatus });
      broadcast({ type: 'AGENT_READY', agent: AGENT_TYPE, capabilities: AGENTS[AGENT_TYPE]?.capabilities || [] });
      startAgent();
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 40px; text-align: center;"><h2>&#10003; Authentication successful!</h2><p>You can close this window.</p></body></html>');
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

authServer.listen(AUTH_PORT, '0.0.0.0', () => {
  console.log(`[agent-bridge] Auth server listening on port ${AUTH_PORT}`);
});

// ─── File watcher ──────────────────────────────────────────────────────────

let watchDebounce = null;
try {
  fs.watch(WORKSPACE, { recursive: true }, (eventType, filename) => {
    if (!filename || filename.startsWith('.git/')) return;
    if (watchDebounce) clearTimeout(watchDebounce);
    watchDebounce = setTimeout(() => {
      const filePath = path.join(WORKSPACE, filename);
      let action = 'modified';
      try {
        if (!fs.existsSync(filePath)) action = 'deleted';
        else if (eventType === 'rename') action = 'created';
      } catch {
        // ignore
      }
      broadcast({ type: 'FILE_CHANGED', path: filename, action });
    }, 300);
  });
  console.log(`[agent-bridge] Watching workspace: ${WORKSPACE}`);
} catch (err) {
  console.error(`[agent-bridge] File watch failed:`, err.message);
}

// ─── Startup ────────────────────────────────────────────────────────────────

console.log(`[agent-bridge] WebSocket server listening on port ${BRIDGE_PORT}`);
console.log(`[agent-bridge] Agent type: ${AGENT_TYPE}`);
console.log(`[agent-bridge] Workspace: ${WORKSPACE}`);

// Auto-start agent if API key is available
if (AGENT_API_KEY || !AGENTS[AGENT_TYPE]?.needsAuth) {
  console.log(`[agent-bridge] API key available, auto-starting agent`);
  setTimeout(() => startAgent(), 1000);
} else {
  console.log(`[agent-bridge] No API key, will request auth on first message`);
  agentStatus = 'auth_needed';
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('[agent-bridge] SIGTERM received, shutting down');
  stopAgent();
  wss.close();
  authServer.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  stopAgent();
  wss.close();
  authServer.close();
  process.exit(0);
});
