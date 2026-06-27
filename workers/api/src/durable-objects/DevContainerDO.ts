/**
 * DevContainerDO — Durable Object backing a single dev-container session.
 *
 * Phase 3b (ADR-037). One instance per `sessionId`. The DO owns:
 *   - session config persisted to ctx.storage
 *   - D1 status transitions (LAUNCHING → READY → STOPPED/EXPIRED)
 *   - the `code-server` container lifecycle via @cloudflare/containers
 *   - TTL warn-then-expire bisection via this.schedule() (Steps 10–11)
 *   - (Step 9) proxy passthrough to the container's :8080 for the code-server iframe
 *
 * The DO is addressed by `sessionId` (idFromName). All internal routes use
 * the `/__*` prefix so they cannot collide with the proxy passthrough path
 * the candidate's iframe hits.
 */

import { Container, switchPort } from '@cloudflare/containers';
import type { Env } from '../types';
import { markError, markExpired, markStatus, markWarned } from '../lib/devContainerSessions';

const DEFAULT_WARN_BEFORE_SECONDS = 60;

/**
 * Minimal agent bridge script embedded as a string.
 * Written to /tmp/agent-bridge.js inside the container and run with node.
 * Uses only Node.js built-ins (http, child_process, fs, path, net, crypto)
 * — no npm dependencies needed.
 *
 * The `ws` package is not available in the base image, so we implement
 * a minimal WebSocket server using raw `http` + `crypto` for the handshake
 * and frame encoding/decoding.
 */
const AGENT_BRIDGE_SCRIPT = String.raw`
const http = require('http');
const net = require('net');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const BRIDGE_PORT = Number(process.env.AGENT_BRIDGE_PORT || 8081);
const CODE_SERVER_PORT = Number(process.env.CODE_SERVER_PORT || 8080);
const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';
const DEVIN_API_KEY = process.env.DEVIN_API_KEY || '';
let agentAuthed = false;

let agentProcess = null;
let agentStatus = 'idle';
const clients = new Set();

// --- Minimal WebSocket implementation ---
function acceptWebSocket(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const ws = { socket, alive: true };
  clients.add(ws);
  send(ws, { type: 'AGENT_STATUS', status: agentStatus });
  send(ws, { type: 'AGENT_READY', agent: 'devin', capabilities: ['read','write','run','browse'] });

  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80;
      const opcode = buf[0] & 0x0f;
      let payloadLen = buf[1] & 0x7f;
      let offset = 2;
      if (payloadLen === 126) { if (buf.length < 4) break; payloadLen = buf.readUInt16BE(2); offset = 4; }
      else if (payloadLen === 127) { if (buf.length < 10) break; payloadLen = Number(buf.readBigUInt64BE(2)); offset = 10; }
      if (buf.length < offset + payloadLen) break;
      const payload = buf.subarray(offset, offset + payloadLen);
      buf = buf.subarray(offset + payloadLen);
      if (opcode === 8) { clients.delete(ws); ws.alive = false; socket.destroy(); return; }
      if (opcode === 1) {
        try { const msg = JSON.parse(payload.toString()); handleMessage(ws, msg); } catch {}
      }
    }
  });
  socket.on('close', () => { clients.delete(ws); ws.alive = false; });
  socket.on('error', () => { clients.delete(ws); ws.alive = false; });
}

function send(ws, msg) {
  if (!ws.alive) return;
  const data = JSON.stringify(msg);
  const payload = Buffer.from(data);
  const mask = 0x80; // server-to-client: no mask
  let header;
  if (payload.length < 126) {
    header = Buffer.alloc(2); header[0] = 0x81; header[1] = payload.length;
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4); header[0] = 0x81; header[1] = 126; header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10); header[0] = 0x81; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  try { ws.socket.write(Buffer.concat([header, payload])); } catch {}
}

function broadcast(msg) { for (const ws of clients) send(ws, msg); }

const ROOM_ACTIONS = {
  'open-browser': { label: 'Open Browser', aliases: ['open browser', 'browser', 'open edge', 'edge'] },
  'open-terminal': { label: 'Open Terminal', aliases: ['open terminal', 'terminal', 'shell'] },
  'open-workspace': { label: 'Open Workspace', aliases: ['open workspace', 'workspace', 'editor', 'code server', 'code-server'] },
  'launch-workspace': { label: 'Launch Workspace', aliases: ['launch workspace', 'start workspace', 'launch container'] },
  'open-files': { label: 'Open Files', aliases: ['open files', 'files', 'file manager', 'explorer'] },
  'open-notepad': { label: 'Open Notepad', aliases: ['open notepad', 'notepad', 'notes'] },
  'open-paint': { label: 'Open Paint', aliases: ['open paint', 'paint', 'ms paint', 'mspaint'] },
  'start-recording': { label: 'Start Recording', aliases: ['start recording', 'record interview', 'begin recording'] },
};

function roomActionName(value) {
  return String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function normalizeRoomAction(value) {
  const normalized = roomActionName(value);
  if (ROOM_ACTIONS[normalized]) return normalized;
  for (const [id, config] of Object.entries(ROOM_ACTIONS)) {
    if (config.aliases.some((alias) => roomActionName(alias) === normalized)) return id;
  }
  return null;
}

function roomActionFromText(text) {
  const raw = String(text || '').trim();
  const lower = raw.toLowerCase();
  const matches = [];
  for (const [id, config] of Object.entries(ROOM_ACTIONS)) {
    for (const alias of config.aliases) {
      if (lower.includes(alias)) matches.push({ id, config, aliasLength: alias.length });
    }
  }
  matches.sort((a, b) => b.aliasLength - a.aliasLength);
  const match = matches[0];
  const actionText = match?.id === 'start-recording'
    ? 'I can help by starting the recording.'
    : match?.id === 'launch-workspace'
      ? 'I can help by launching the workspace.'
      : match
        ? 'I can help by opening ' + match.config.label.replace(/^Open\s+/i, '') + '.'
        : '';
  return match ? {
    action: match.id,
    label: match.config.label,
    text: actionText,
    autoExecute: true,
  } : null;
}

function emitRoomAction(action) {
  if (!action || !ROOM_ACTIONS[action.action]) return;
  broadcast({ type: 'ROOM_ACTION', ...action });
}

function extractTaggedRoomActions(text) {
  const actions = [];
  let cleanText = String(text || '');
  cleanText = cleanText.replace(/\[\[room_action:([a-zA-Z0-9_-]+)(?:\|([^\]]+))?\]\]/g, (_match, rawAction, rawLabel) => {
    const action = normalizeRoomAction(rawAction);
    if (action) {
      actions.push({
        action,
        label: rawLabel || ROOM_ACTIONS[action].label,
        text: rawLabel ? String(rawLabel) : ROOM_ACTIONS[action].label,
      });
    }
    return '';
  }).trim();
  return { text: cleanText, actions };
}

// --- Terminal over WebSocket (PuTTY-style) ---
function acceptTerminal(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');

  const { spawn: spawnPty } = (() => {
    try { return { spawnPty: require('node-pty').spawn }; } catch { return { spawnPty: null }; }
  })();

  let shell;
  if (spawnPty) {
    shell = spawnPty('bash', [], { name: 'xterm-color', cwd: WORKSPACE, env: process.env });
  } else {
    // Fallback: plain bash with pipe stdio (no true PTY but works for basic commands)
    shell = spawn('bash', ['-l'], { cwd: WORKSPACE, env: process.env, stdio: ['pipe','pipe','pipe'] });
  }

  let buf = Buffer.alloc(0);
  const ws = { socket, alive: true };

  function writeWs(data) {
    if (!ws.alive) return;
    const payload = Buffer.from(data);
    let header;
    if (payload.length < 126) {
      header = Buffer.alloc(2); header[0] = 0x82; header[1] = payload.length; // binary frame
    } else if (payload.length < 65536) {
      header = Buffer.alloc(4); header[0] = 0x82; header[1] = 126; header.writeUInt16BE(payload.length, 2);
    } else {
      header = Buffer.alloc(10); header[0] = 0x82; header[1] = 127; header.writeBigUInt64BE(BigInt(payload.length), 2);
    }
    try { ws.socket.write(Buffer.concat([header, payload])); } catch {}
  }

  // Shell output → WebSocket
  const onData = (d) => writeWs(d);
  if (shell.stdout) shell.stdout.on('data', onData);
  if (shell.stderr) shell.stderr.on('data', onData);
  if (shell.on) shell.on('data', onData); // node-pty emits 'data' directly

  shell.on('exit', () => {
    writeWs('\r\n[session ended]\r\n');
    ws.alive = false;
    try { socket.destroy(); } catch {}
  });

  // WebSocket → shell input
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const fin = buf[0] & 0x80;
      const opcode = buf[0] & 0x0f;
      let payloadLen = buf[1] & 0x7f;
      let offset = 2;
      if (payloadLen === 126) { if (buf.length < 4) break; payloadLen = buf.readUInt16BE(2); offset = 4; }
      else if (payloadLen === 127) { if (buf.length < 10) break; payloadLen = Number(buf.readBigUInt64BE(2)); offset = 10; }
      // Skip mask (client always masks)
      if (buf[1] & 0x80) { offset += 4; }
      if (buf.length < offset + payloadLen) break;
      let payload = buf.subarray(offset, offset + payloadLen);
      // Unmask if needed
      if (buf[1] & 0x80) {
        const mask = buf.subarray(offset - 4, offset);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      buf = buf.subarray(offset + payloadLen);
      if (opcode === 8) { ws.alive = false; try { shell.kill('SIGTERM'); } catch {} socket.destroy(); return; }
      if (opcode === 1 || opcode === 2) {
        try {
          if (shell.stdin) shell.stdin.write(payload);
          else if (shell.write) shell.write(payload); // node-pty
        } catch {}
      }
    }
  });

  socket.on('close', () => { ws.alive = false; try { shell.kill('SIGTERM'); } catch {} });
  socket.on('error', () => { ws.alive = false; try { shell.kill('SIGTERM'); } catch {} });
}

// --- Devin agent management ---
function startAgent() {
  if (agentProcess) return;
  // Devin uses OAuth — if not authed yet, request auth
  if (!agentAuthed && !DEVIN_API_KEY) {
    agentStatus = 'auth_needed';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    broadcast({ type: 'AUTH_NEEDED', authUrl: '/start?agent=devin', agent: 'devin' });
    return;
  }
  try {
    const env = { ...process.env };
    if (DEVIN_API_KEY) env.DEVIN_API_KEY = DEVIN_API_KEY;
    const devinBin = path.join(process.env.HOME || '/home/coder', '.local', 'bin', 'devin');
    const devinCmd = fs.existsSync(devinBin) ? devinBin : 'devin';
    agentProcess = spawn(devinCmd, [], { cwd: WORKSPACE, env, stdio: ['pipe','pipe','pipe'] });
    agentStatus = 'idle';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    broadcast({ type: 'AGENT_READY', agent: 'devin', capabilities: ['read','write','run','browse'] });
    agentProcess.stdout.on('data', (d) => {
      const text = d.toString().trim();
      if (text) {
        const parsed = extractTaggedRoomActions(text);
        agentStatus = 'working';
        broadcast({ type: 'AGENT_STATUS', status: agentStatus });
        if (parsed.text) broadcast({ type: 'CHAT_RESPONSE', text: parsed.text });
        for (const action of parsed.actions) emitRoomAction(action);
        agentStatus = 'idle';
        broadcast({ type: 'AGENT_STATUS', status: agentStatus });
      }
    });
    agentProcess.stderr.on('data', (d) => { console.error('[agent-bridge] stderr:', d.toString().trim()); });
    agentProcess.on('exit', () => { agentProcess = null; agentStatus = 'idle'; broadcast({ type: 'AGENT_STATUS', status: agentStatus }); });
    agentProcess.on('error', () => { agentProcess = null; agentStatus = 'idle'; broadcast({ type: 'AGENT_STATUS', status: agentStatus }); broadcast({ type: 'ERROR', message: 'Devin CLI failed to start — is it installed?' }); });
  } catch (e) { broadcast({ type: 'ERROR', message: 'Failed: ' + e.message }); }
}

function stopAgent() { if (agentProcess) { try { agentProcess.kill('SIGTERM'); } catch {} agentProcess = null; } agentStatus = 'idle'; broadcast({ type: 'AGENT_STATUS', status: agentStatus }); }

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'CHAT':
      if (!msg.text || !msg.text.trim()) return;
      const roomAction = roomActionFromText(msg.text);
      if (roomAction) {
        send(ws, { type: 'CHAT_RESPONSE', text: roomAction.text });
        emitRoomAction(roomAction);
        return;
      }
      if (!agentProcess && agentStatus !== 'auth_needed') startAgent();
      if (agentStatus === 'auth_needed') { send(ws, { type: 'CHAT_RESPONSE', text: 'I need to authenticate first! Click the login button.' }); return; }
      if (!agentProcess) { send(ws, { type: 'CHAT_RESPONSE', text: 'Agent not running. Try again.' }); return; }
      agentStatus = 'thinking'; broadcast({ type: 'AGENT_STATUS', status: agentStatus });
      try { agentProcess.stdin.write(msg.text + '\n'); } catch {}
      break;
    case 'AUTH_START':
      agentStatus = 'auth_needed'; broadcast({ type: 'AGENT_STATUS', status: agentStatus });
      broadcast({ type: 'AUTH_NEEDED', authUrl: '/start?agent=devin', agent: 'devin' });
      break;
    case 'AUTH_CALLBACK':
      agentAuthed = true; agentStatus = 'idle'; broadcast({ type: 'AGENT_STATUS', status: agentStatus }); startAgent();
      break;
    case 'AGENT_STOP': stopAgent(); break;
    case 'GET_STATUS': send(ws, { type: 'AGENT_STATUS', status: agentStatus }); break;
  }
}

// --- HTTP server: routes /ws and /start, /callback to itself, proxies everything else to code-server ---
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');

  // Auth routes handled by bridge
  if (url.pathname === '/start') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Authenticating...</h2><script>fetch("/callback?simulated=1").then(()=>{document.body.innerHTML="<h2>OK! Close this window.</h2>"})</script></body></html>');
    return;
  }
  if (url.pathname === '/callback') {
    if (url.searchParams.get('simulated')) { agentStatus = 'idle'; broadcast({ type: 'AGENT_STATUS', status: agentStatus }); startAgent(); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<html><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>Auth OK! Close this window.</h2></body></html>');
    return;
  }

  // Context brain — returns candidate's session context summary for the agent
  if (url.pathname === '/context') {
    const apiUrl = process.env.PIPE_API_URL || '';
    const roomToken = process.env.ROOM_TOKEN || '';
    if (!apiUrl || !roomToken) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('No context available — API URL or room token not set.');
      return;
    }
    const ctxReq = http.get(apiUrl + '/api/v1/meeting-rooms/' + roomToken + '/context-summary', (ctxRes) => {
      let body = '';
      ctxRes.on('data', (d) => body += d);
      ctxRes.on('end', () => {
        try { const parsed = JSON.parse(body); res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(parsed.summary || 'No context yet.'); }
        catch { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(body); }
      });
    });
    ctxReq.on('error', () => { res.writeHead(502); res.end('Failed to fetch context.'); });
    return;
  }

  // Event capture — agent can POST events to the candidate's graph
  if (url.pathname === '/events' && req.method === 'POST') {
    let body = '';
    req.on('data', (d) => body += d);
    req.on('end', () => {
      const apiUrl = process.env.PIPE_API_URL || '';
      const roomToken = process.env.ROOM_TOKEN || '';
      if (!apiUrl || !roomToken) { res.writeHead(502); res.end('No API configured.'); return; }
      const eventReq = http.request(apiUrl + '/api/v1/meeting-rooms/' + roomToken + '/session-events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }, (eventRes) => {
        let respBody = '';
        eventRes.on('data', (d) => respBody += d);
        eventRes.on('end', () => { res.writeHead(eventRes.statusCode || 200, { 'Content-Type': 'application/json' }); res.end(respBody); });
      });
      eventReq.on('error', () => { res.writeHead(502); res.end('Failed to capture event.'); });
      eventReq.write(body);
      eventReq.end();
    });
    return;
  }

  // Everything else: proxy to code-server on 8083
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: CODE_SERVER_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => { res.writeHead(502); res.end('Bad Gateway'); });
  req.pipe(proxyReq);
});

// WebSocket upgrade: /ws goes to agent bridge, /terminal goes to PTY, everything else goes to code-server
server.on('upgrade', (req, socket) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/ws') {
    acceptWebSocket(req, socket);
  } else if (url.pathname === '/terminal') {
    acceptTerminal(req, socket);
  } else {
    // Proxy WebSocket upgrade to code-server on 8083
    const proxyReq = http.request({
      hostname: '127.0.0.1',
      port: CODE_SERVER_PORT,
      path: req.url,
      method: 'GET',
      headers: req.headers,
    });
    proxyReq.on('upgrade', (proxyRes, proxySocket) => {
      socket.write('HTTP/1.1 101 Switching Protocols\r\n' +
        Object.entries(proxyRes.headers).map(([k,v]) => k + ': ' + v).join('\r\n') + '\r\n\r\n');
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });
    proxyReq.on('error', () => socket.destroy());
    proxyReq.end();
  }
});

server.listen(BRIDGE_PORT, '0.0.0.0', () => console.log('[agent-bridge] Router listening on ' + BRIDGE_PORT + ', code-server on ' + CODE_SERVER_PORT));

// --- File watcher ---
try {
  fs.watch(WORKSPACE, { recursive: true }, (eventType, filename) => {
    if (!filename || filename.startsWith('.git/')) return;
    broadcast({ type: 'FILE_CHANGED', path: filename, action: eventType === 'rename' ? 'created' : 'modified' });
  });
} catch (e) { console.error('[agent-bridge] Watch failed:', e.message); }

// --- Startup ---
if (DEVIN_API_KEY) { agentAuthed = true; setTimeout(() => startAgent(), 1000); } else { agentStatus = 'auth_needed'; }
process.on('SIGTERM', () => { stopAgent(); server.close(); process.exit(0); });
process.on('SIGINT', () => { stopAgent(); server.close(); process.exit(0); });
`;

interface InitPayload {
  sessionId: string;
  expiresAt: string;
  ttlSeconds: number;
  repoGitUrl: string | null;
  challengeBranch: string | null;
  agentType?: string | null;
  agentApiKey?: string | null;
  pipeApiUrl?: string | null;
  roomToken?: string | null;
}

function buildEnvVars(payload: InitPayload): Record<string, string> {
  const env: Record<string, string> = {
    SESSION_ID: payload.sessionId,
    PASSWORD: 'pipe',
    WORKSPACE_DIR: '/workspace',
    AGENT_TYPE: payload.agentType || 'devin',
    AGENT_BRIDGE_PORT: '8081',
    CODE_SERVER_PORT: '8080',
  };
  if (payload.repoGitUrl) env.REPO_GIT_URL = payload.repoGitUrl;
  if (payload.challengeBranch) env.CHALLENGE_BRANCH = payload.challengeBranch;
  if (payload.agentApiKey) env.DEVIN_API_KEY = payload.agentApiKey;
  if (payload.pipeApiUrl) env.PIPE_API_URL = payload.pipeApiUrl;
  if (payload.roomToken) env.ROOM_TOKEN = payload.roomToken;
  return env;
}

function isAgentBridgePath(pathname: string): boolean {
  return pathname === '/ws'
    || pathname === '/terminal'
    || pathname === '/start'
    || pathname === '/callback'
    || pathname === '/context'
    || pathname === '/events';
}

export class DevContainerDO extends Container<Env> {
  // Bind the default route to code-server. The agent bridge runs as a sidecar
  // on 8081 and is reached only for Clippy/terminal/auth endpoints.
  defaultPort = 8080;
  requiredPorts = [8080];

  // Sleep the DO after 10 minutes of inactivity so we don't pay for idle.
  sleepAfter = '10m';

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/__init' && request.method === 'POST') {
      return this.handleInit(request);
    }
    if (url.pathname === '/__destroy' && request.method === 'POST') {
      return this.handleDestroy();
    }
    // After DO hibernation `this.envVars` is lost (instance property), so
    // rehydrate from storage before `super.fetch()` kicks off startContainer.
    await this.rehydrateEnvVarsIfMissing();
    if (isAgentBridgePath(url.pathname)) {
      return super.fetch(switchPort(request, 8081));
    }
    return super.fetch(request);
  }

  private async rehydrateEnvVarsIfMissing(): Promise<void> {
    if (this.envVars && Object.keys(this.envVars).length > 0) return;
    const config = (await this.ctx.storage.get<InitPayload>('config')) ?? null;
    if (!config) return;
    this.envVars = buildEnvVars(config);
  }

  private async handleInit(request: Request): Promise<Response> {
    let payload: InitPayload;
    try {
      payload = (await request.json()) as InitPayload;
    } catch {
      return new Response(
        JSON.stringify({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON body.' } }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Persist config so future DO invocations (destroy, proxy, alarms) can
    // read it without re-querying D1.
    await this.ctx.storage.put('config', payload);

    // Populate env vars for the container entrypoint. The proxy path
    // re-hydrates this from storage after hibernation.
    this.envVars = buildEnvVars(payload);

    try {
      // Use the Docker image entrypoint for repo cloning and code-server startup.
      // Passing the full bridge script through Container.start() exceeded the
      // runtime value limit and caused the VM to exit before port 8080 opened.
      await this.startAndWaitForPorts({
        ports: this.requiredPorts,
        startOptions: {
          envVars: this.envVars,
        },
        cancellationOptions: {
          instanceGetTimeoutMS: 15_000,
          portReadyTimeoutMS: 45_000,
          waitInterval: 500,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[DevContainerDO.handleInit] start failed:', err);
      await markError(this.env.DB, payload.sessionId, message);
      return new Response(
        JSON.stringify({ error: { code: 'CONTAINER_START_FAILED', message } }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      );
    }

    // Only mark the session READY after the code-server port is actually
    // listening. The iframe proxy depends on this being an honest state.
    const startedAt = new Date().toISOString();
    await markStatus(this.env.DB, payload.sessionId, 'READY', {
      startedAt,
    });

    // Step 11: schedule the warn-then-expire bisection. The base class
    // multiplexes schedules on top of a single alarm. We first fire
    // `onWarn` at `expiresAt − WARN_BEFORE_SECONDS` so the candidate can
    // see a countdown; `onWarn` then reschedules `onExpire` at the real
    // `expiresAt`. If the configured TTL is already shorter than the warn
    // window, we skip the warning and go straight to destroy.
    const expireAt = new Date(payload.expiresAt);
    if (!Number.isNaN(expireAt.getTime())) {
      const warnBeforeSeconds = parseWarnSeconds(this.env.DEV_CONTAINER_WARN_BEFORE_SECONDS);
      const warnAt = new Date(expireAt.getTime() - warnBeforeSeconds * 1000);
      try {
        if (warnAt.getTime() > Date.now()) {
          await this.schedule(warnAt, 'onWarn');
        } else {
          await this.schedule(expireAt, 'onExpire');
        }
      } catch (err) {
        console.error('[DevContainerDO.handleInit] schedule failed:', err);
      }
    }

    return new Response(
      JSON.stringify({ ok: true, sessionId: payload.sessionId }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * Manual destroy handler. Called when the candidate clicks "END SESSION".
   * Stops the container and clears storage. D1 status is already marked
   * STOPPED by the route handler before calling this.
   */
  private async handleDestroy(): Promise<Response> {
    const config = (await this.ctx.storage.get<InitPayload>('config')) ?? null;

    // Stop the container if it's running. Safe to call when already stopped.
    try {
      await this.destroy();
    } catch (err) {
      console.error('[DevContainerDO.handleDestroy] destroy() failed:', err);
      // Continue — the container may already be stopped
    }

    // Wipe storage so the DO can be garbage-collected and alarms won't refire.
    try {
      await this.ctx.storage.deleteAll();
    } catch (err) {
      console.error('[DevContainerDO.handleDestroy] deleteAll failed:', err);
    }

    return new Response(
      JSON.stringify({ ok: true, sessionId: config?.sessionId ?? null }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    );
  }

  /**
   * TTL warning callback. Fires at `expiresAt − WARN_BEFORE_SECONDS`.
   * Writes `warned_at` to D1 (the cockpit + the frontend hook read this
   * to surface the countdown toast) and reschedules `onExpire` at the
   * real `expiresAt`. Public because the scheduler dispatches callbacks
   * reflectively via `this[row.callback](...)`.
   */
  async onWarn(): Promise<void> {
    const config = (await this.ctx.storage.get<InitPayload>('config')) ?? null;
    if (!config) {
      console.error('[DevContainerDO.onWarn] missing config in storage — skipping');
      return;
    }

    const warnedAt = new Date().toISOString();
    try {
      await markWarned(this.env.DB, config.sessionId, warnedAt);
    } catch (err) {
      console.error('[DevContainerDO.onWarn] markWarned failed:', err);
    }

    const expireAt = new Date(config.expiresAt);
    if (!Number.isNaN(expireAt.getTime())) {
      try {
        await this.schedule(expireAt, 'onExpire');
      } catch (err) {
        console.error('[DevContainerDO.onWarn] schedule(onExpire) failed:', err);
      }
    }
  }

  /**
   * TTL expiry callback. Invoked by the Container scheduler when
   * `expiresAt` is reached. Stops the container and marks the D1 row
   * as EXPIRED so the cockpit can distinguish manual destroy from
   * timed-out sessions.
   *
   * Named `onExpire` so the scheduler's reflective dispatch
   * (`this[row.callback](...)`) can find it.
   */
  async onExpire(): Promise<void> {
    const config = (await this.ctx.storage.get<InitPayload>('config')) ?? null;
    if (!config) {
      console.error('[DevContainerDO.onExpire] missing config in storage — skipping');
      return;
    }

    // Kill the container if it's still running. Safe to call when stopped.
    try {
      await this.destroy();
    } catch (err) {
      console.error('[DevContainerDO.onExpire] destroy() failed:', err);
    }

    const stoppedAt = new Date().toISOString();
    try {
      await markExpired(this.env.DB, config.sessionId, stoppedAt);
    } catch (err) {
      console.error('[DevContainerDO.onExpire] markExpired failed:', err);
    }

    // Wipe storage so a future DO restart doesn't re-fire the callback.
    try {
      await this.ctx.storage.deleteAll();
    } catch (err) {
      console.error('[DevContainerDO.onExpire] deleteAll failed:', err);
    }
  }
}

function parseWarnSeconds(raw: string | undefined): number {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return DEFAULT_WARN_BEFORE_SECONDS;
  }
  return parsed;
}
