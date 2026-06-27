const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');

const BRIDGE_PORT = Number(process.env.AGENT_BRIDGE_PORT || 8081);
const CODE_SERVER_PORT = Number(process.env.CODE_SERVER_PORT || 8080);
const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';
const DEVIN_API_KEY = process.env.DEVIN_API_KEY || '';
const AGENT_NAME = process.env.AGENT_TYPE || 'devin';
const PIPE_API_URL = process.env.PIPE_API_URL || '';
const ROOM_TOKEN = process.env.ROOM_TOKEN || '';

let agentAuthed = Boolean(DEVIN_API_KEY);
let agentProcess = null;
let agentStatus = agentAuthed ? 'idle' : 'auth_needed';
const clients = new Set();

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
  const lower = String(text || '').trim().toLowerCase();
  const matches = [];
  for (const [id, config] of Object.entries(ROOM_ACTIONS)) {
    for (const alias of config.aliases) {
      if (lower.includes(alias)) matches.push({ id, config, aliasLength: alias.length });
    }
  }
  matches.sort((a, b) => b.aliasLength - a.aliasLength);
  const match = matches[0];
  if (!match) return null;
  return {
    action: match.id,
    label: match.config.label,
    text: match.id === 'start-recording'
      ? 'I can help by starting the recording.'
      : `I can help by opening ${match.config.label.replace(/^Open\s+/i, '')}.`,
    autoExecute: true,
  };
}

function extractTaggedRoomActions(text) {
  const actions = [];
  const cleanText = String(text || '').replace(
    /\[\[room_action:([a-zA-Z0-9_-]+)(?:\|([^\]]+))?\]\]/g,
    (_match, rawAction, rawLabel) => {
      const action = normalizeRoomAction(rawAction);
      if (action) {
        actions.push({
          action,
          label: rawLabel || ROOM_ACTIONS[action].label,
          text: rawLabel ? String(rawLabel) : ROOM_ACTIONS[action].label,
        });
      }
      return '';
    },
  ).trim();
  return { text: cleanText, actions };
}

function send(ws, msg) {
  if (!ws.alive) return;
  const payload = Buffer.from(JSON.stringify(msg));
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x81, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  try {
    ws.socket.write(Buffer.concat([header, payload]));
  } catch {
    ws.alive = false;
  }
}

function sendBinary(ws, chunk) {
  if (!ws.alive) return;
  const payload = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x82, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x82;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  try {
    ws.socket.write(Buffer.concat([header, payload]));
  } catch {
    ws.alive = false;
  }
}

function broadcast(msg) {
  for (const ws of clients) send(ws, msg);
}

function roomContextSummaryUrl(pipeApiUrl = PIPE_API_URL, roomToken = ROOM_TOKEN) {
  const base = String(pipeApiUrl || '').trim();
  const token = String(roomToken || '').trim();
  if (!base || !token) return null;

  try {
    return new URL(
      `/api/v1/meeting-rooms/${encodeURIComponent(token)}/context-summary`,
      base,
    ).toString();
  } catch {
    return null;
  }
}

async function fetchRoomContextSummary(fetchImpl = fetch) {
  const contextUrl = roomContextSummaryUrl();
  if (!contextUrl) {
    return {
      status: 503,
      text: 'PIPE room context is not configured for this workspace.',
    };
  }

  try {
    const response = await fetchImpl(contextUrl, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) {
      return {
        status: response.status,
        text: `PIPE room context fetch failed (${response.status}).`,
      };
    }

    const body = await response.json().catch(() => null);
    const summary = body && typeof body.summary === 'string' ? body.summary.trim() : '';
    return {
      status: 200,
      text: summary || 'No PIPE room context has been captured yet.',
    };
  } catch (error) {
    return {
      status: 502,
      text: `PIPE room context fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function decodeFrames(buffer, onFrame) {
  let remaining = buffer;
  while (remaining.length >= 2) {
    const opcode = remaining[0] & 0x0f;
    let payloadLength = remaining[1] & 0x7f;
    let offset = 2;
    if (payloadLength === 126) {
      if (remaining.length < 4) break;
      payloadLength = remaining.readUInt16BE(2);
      offset = 4;
    } else if (payloadLength === 127) {
      if (remaining.length < 10) break;
      payloadLength = Number(remaining.readBigUInt64BE(2));
      offset = 10;
    }
    const masked = Boolean(remaining[1] & 0x80);
    const maskOffset = offset;
    if (masked) offset += 4;
    if (remaining.length < offset + payloadLength) break;
    const payload = Buffer.from(remaining.subarray(offset, offset + payloadLength));
    if (masked) {
      const mask = remaining.subarray(maskOffset, maskOffset + 4);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    remaining = remaining.subarray(offset + payloadLength);
    onFrame(opcode, payload);
  }
  return remaining;
}

function acceptWebSocket(req, socket, onMessage) {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return null;
  }
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n'
    + 'Upgrade: websocket\r\n'
    + 'Connection: Upgrade\r\n'
    + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  const ws = { socket, alive: true };
  let buffer = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buffer = decodeFrames(Buffer.concat([buffer, chunk]), (opcode, payload) => {
      if (opcode === 8) {
        ws.alive = false;
        socket.destroy();
        return;
      }
      onMessage(ws, opcode, payload);
    });
  });
  socket.on('close', () => { ws.alive = false; clients.delete(ws); });
  socket.on('error', () => { ws.alive = false; clients.delete(ws); });
  return ws;
}

function devinCommand() {
  const candidates = [
    '/root/.local/bin/devin',
    '/usr/local/bin/devin',
    '/usr/bin/devin',
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || 'devin';
}

function startAgent() {
  if (agentProcess) return;
  if (!agentAuthed && !DEVIN_API_KEY) {
    agentStatus = 'auth_needed';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    broadcast({ type: 'AUTH_NEEDED', authUrl: '/start?agent=devin', agent: AGENT_NAME });
    return;
  }

  try {
    const env = { ...process.env };
    if (DEVIN_API_KEY) env.DEVIN_API_KEY = DEVIN_API_KEY;
    agentProcess = spawn(devinCommand(), [], { cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'] });
    agentStatus = 'idle';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    broadcast({ type: 'AGENT_READY', agent: AGENT_NAME, capabilities: ['read', 'write', 'run', 'browse'] });
    agentProcess.stdout.on('data', (chunk) => {
      const parsed = extractTaggedRoomActions(chunk.toString());
      agentStatus = 'working';
      broadcast({ type: 'AGENT_STATUS', status: agentStatus });
      if (parsed.text) broadcast({ type: 'CHAT_RESPONSE', text: parsed.text });
      for (const action of parsed.actions) broadcast({ type: 'ROOM_ACTION', ...action });
      agentStatus = 'idle';
      broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    });
    agentProcess.stderr.on('data', (chunk) => {
      console.error('[agent-bridge] devin stderr:', chunk.toString().trim());
    });
    agentProcess.on('exit', () => {
      agentProcess = null;
      agentStatus = 'idle';
      broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    });
    agentProcess.on('error', () => {
      agentProcess = null;
      agentStatus = 'idle';
      broadcast({ type: 'ERROR', message: 'Devin CLI failed to start inside the container.' });
      broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    });
  } catch (error) {
    broadcast({ type: 'ERROR', message: error instanceof Error ? error.message : String(error) });
  }
}

function handleAgentMessage(ws, msg) {
  if (msg.type === 'CHAT') {
    const text = String(msg.text || '').trim();
    if (!text) return;
    const roomAction = roomActionFromText(text);
    if (roomAction) {
      send(ws, { type: 'CHAT_RESPONSE', text: roomAction.text });
      broadcast({ type: 'ROOM_ACTION', ...roomAction });
      return;
    }
    if (!agentProcess && agentStatus !== 'auth_needed') startAgent();
    if (agentStatus === 'auth_needed') {
      send(ws, { type: 'CHAT_RESPONSE', text: 'I need Devin authentication first.' });
      return;
    }
    if (!agentProcess) {
      send(ws, { type: 'ERROR', message: 'Agent is not running.' });
      return;
    }
    agentStatus = 'thinking';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    agentProcess.stdin.write(`${text}\n`);
  } else if (msg.type === 'AUTH_START') {
    agentStatus = 'auth_needed';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    broadcast({ type: 'AUTH_NEEDED', authUrl: '/start?agent=devin', agent: AGENT_NAME });
  } else if (msg.type === 'AUTH_CALLBACK') {
    agentAuthed = true;
    agentStatus = 'idle';
    broadcast({ type: 'AGENT_STATUS', status: agentStatus });
    startAgent();
  } else if (msg.type === 'AGENT_STOP' && agentProcess) {
    agentProcess.kill('SIGTERM');
  } else if (msg.type === 'GET_STATUS') {
    send(ws, { type: 'AGENT_STATUS', status: agentStatus });
  }
}

function acceptAgent(req, socket) {
  const ws = acceptWebSocket(req, socket, (client, opcode, payload) => {
    if (opcode !== 1) return;
    try {
      handleAgentMessage(client, JSON.parse(payload.toString()));
    } catch {
      send(client, { type: 'ERROR', message: 'Invalid agent bridge message.' });
    }
  });
  if (!ws) return;
  clients.add(ws);
  send(ws, { type: 'AGENT_STATUS', status: agentStatus });
  send(ws, { type: 'AGENT_READY', agent: AGENT_NAME, capabilities: ['read', 'write', 'run', 'browse'] });
  if (agentStatus === 'auth_needed') {
    send(ws, { type: 'AUTH_NEEDED', authUrl: '/start?agent=devin', agent: AGENT_NAME });
  }
}

function acceptTerminal(req, socket) {
  const shell = spawn('bash', ['-l'], { cwd: WORKSPACE, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const ws = acceptWebSocket(req, socket, (_client, opcode, payload) => {
    if (opcode === 1 || opcode === 2) shell.stdin.write(payload);
  });
  if (!ws) {
    shell.kill('SIGTERM');
    return;
  }
  shell.stdout.on('data', (chunk) => sendBinary(ws, chunk));
  shell.stderr.on('data', (chunk) => sendBinary(ws, chunk));
  shell.on('exit', () => {
    sendBinary(ws, '\r\n[session ended]\r\n');
    ws.alive = false;
    socket.destroy();
  });
  socket.on('close', () => shell.kill('SIGTERM'));
}

function html(body) {
  return `<!doctype html><html><body style="font-family:sans-serif;padding:40px;text-align:center">${body}</body></html>`;
}

function proxyToCodeServer(req, res) {
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: CODE_SERVER_PORT,
    path: req.url,
    method: req.method,
    headers: req.headers,
  }, (proxyRes) => {
    res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
    proxyRes.pipe(res);
  });
  proxyReq.on('error', () => {
    res.writeHead(502, { 'Content-Type': 'text/plain' });
    res.end('Code-server is not ready.');
  });
  req.pipe(proxyReq);
}

function writeUpgradeResponse(socket, proxyRes) {
  const statusCode = proxyRes.statusCode || 101;
  const statusMessage = proxyRes.statusMessage || 'Switching Protocols';
  socket.write(`HTTP/1.1 ${statusCode} ${statusMessage}\r\n`);
  for (const [key, rawValue] of Object.entries(proxyRes.headers)) {
    if (Array.isArray(rawValue)) {
      for (const value of rawValue) socket.write(`${key}: ${value}\r\n`);
    } else if (rawValue !== undefined) {
      socket.write(`${key}: ${rawValue}\r\n`);
    }
  }
  socket.write('\r\n');
}

function proxyUpgradeToCodeServer(req, socket, head) {
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: CODE_SERVER_PORT,
    path: req.url,
    method: 'GET',
    headers: req.headers,
  });
  proxyReq.on('upgrade', (proxyRes, proxySocket) => {
    writeUpgradeResponse(socket, proxyRes);
    if (head && head.length > 0) proxySocket.write(head);
    proxySocket.pipe(socket);
    socket.pipe(proxySocket);
  });
  proxyReq.on('error', () => socket.destroy());
  proxyReq.end();
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agent: AGENT_NAME, status: agentStatus }));
    return;
  }
  if (url.pathname === '/start') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html('<h2>Authenticating Devin...</h2><script>fetch("/callback?simulated=1").then(()=>{document.body.innerHTML="<h2>OK. Close this window.</h2>"})</script>'));
    return;
  }
  if (url.pathname === '/callback') {
    if (url.searchParams.get('simulated')) {
      agentAuthed = true;
      agentStatus = 'idle';
      broadcast({ type: 'AGENT_STATUS', status: agentStatus });
      startAgent();
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(html('<h2>Auth OK. Close this window.</h2>'));
    return;
  }
  if (url.pathname === '/context') {
    const context = await fetchRoomContextSummary();
    res.writeHead(context.status, {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(context.text);
    return;
  }
  proxyToCodeServer(req, res);
});

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/ws') {
    acceptAgent(req, socket);
  } else if (url.pathname === '/terminal') {
    acceptTerminal(req, socket);
  } else {
    proxyUpgradeToCodeServer(req, socket, head);
  }
});

server.listen(BRIDGE_PORT, '0.0.0.0', () => {
  console.log(`[agent-bridge] ${AGENT_NAME} bridge listening on ${BRIDGE_PORT}, code-server on ${CODE_SERVER_PORT}`);
});

process.on('SIGTERM', () => {
  if (agentProcess) agentProcess.kill('SIGTERM');
  server.close(() => process.exit(0));
});
