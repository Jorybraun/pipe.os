import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { createServer } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';

const bridgeProcesses = new Set();

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to allocate a free port.')));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, output) {
  const url = `http://127.0.0.1:${port}/health`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Keep polling until the bridge has bound its port.
    }
    await delay(50);
  }
  throw new Error(`Bridge did not become healthy. stdout=${output.stdout} stderr=${output.stderr}`);
}

async function writeFakeDevin(scriptBody) {
  const root = mkdtempSync(path.join(tmpdir(), 'pipe-fake-devin-'));
  const binDir = path.join(root, 'bin');
  mkdirSync(binDir);
  const devinPath = path.join(binDir, 'devin');
  writeFileSync(devinPath, `#!/usr/bin/env node\n${scriptBody}\n`);
  await chmod(devinPath, 0o755);
  return { root, binDir };
}

async function startBridge(scriptBody, extraEnv = {}) {
  const port = await freePort();
  const codeServerPort = await freePort();
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'pipe-bridge-workspace-'));
  const { binDir } = await writeFakeDevin(scriptBody);
  const bridgeRoot = mkdtempSync(path.join(tmpdir(), 'pipe-agent-bridge-'));
  const bridgePath = path.join(bridgeRoot, 'agent-bridge.cjs');
  const diagnosticsPath = path.join(bridgeRoot, 'agent-diagnostics.cjs');
  writeFileSync(
    diagnosticsPath,
    readFileSync(path.join(process.cwd(), 'infra/containers/code-server/agent-diagnostics.js'), 'utf8'),
  );
  writeFileSync(
    bridgePath,
    readFileSync(path.join(process.cwd(), 'infra/containers/code-server/agent-bridge.js'), 'utf8')
      .replace("require('./agent-diagnostics.js')", "require('./agent-diagnostics.cjs')"),
  );
  const output = { stdout: '', stderr: '' };
  const child = spawn(
    process.execPath,
    [bridgePath],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH ?? ''}`,
        DEVIN_API_KEY: 'test-devin-key',
        AGENT_TYPE: 'devin',
        AGENT_BRIDGE_PORT: String(port),
        CODE_SERVER_PORT: String(codeServerPort),
        WORKSPACE_DIR: workspaceDir,
        WORKSPACE_SCAN_INTERVAL_MS: '60000',
        AGENT_START_READY_TIMEOUT_MS: '300',
        ...extraEnv,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (chunk) => {
    output.stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output.stderr += chunk.toString();
  });
  bridgeProcesses.add(child);
  child.on('exit', () => bridgeProcesses.delete(child));
  await waitForHealth(port, output);
  return { child, port, workspaceDir };
}

async function startSessionEventCaptureServer() {
  const events = [];
  const port = await freePort();
  const server = createServer((req, res) => {
    if (req.method !== 'POST' || !req.url?.includes('/session-events')) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      events.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ captured: true }));
    });
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    events,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function connectAgent(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  const messages = [];
  ws.addEventListener('message', (event) => {
    messages.push(JSON.parse(String(event.data)));
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return { ws, messages };
}

async function waitForMessage(messages, predicate, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const message = messages.find(predicate);
    if (message) return message;
    await delay(25);
  }
  throw new Error(`Timed out waiting for bridge message. Saw: ${JSON.stringify(messages)}`);
}

afterEach(async () => {
  for (const child of [...bridgeProcesses]) {
    child.kill('SIGTERM');
  }
  await delay(50);
});

describe('agent bridge readiness', () => {
  it('does not fabricate a Devin bridge when AGENT_TYPE is missing', async () => {
    const { port } = await startBridge(`
process.stdin.setEncoding('utf8');
process.stdin.once('data', () => process.stdout.write('This fake Devin process should not start.\\n'));
setInterval(() => {}, 1000);
`, {
      AGENT_TYPE: '',
    });

    const { ws, messages } = await connectAgent(port);
    await delay(150);
    expect(messages.some((message) => message.agent === 'devin')).toBe(false);
    expect(messages.some((message) => message.type === 'AGENT_READY')).toBe(false);

    ws.send(JSON.stringify({ type: 'CHAT', text: 'hello?' }));
    const error = await waitForMessage(messages, (message) => message.type === 'ERROR');
    expect(error).toEqual({
      type: 'ERROR',
      message: 'No real agent is configured in this container. Set AGENT_TYPE to a supported bridge agent before enabling Clippy chat.',
    });
    expect(messages.some((message) => message.agent === 'devin')).toBe(false);
    ws.close();
  });

  it('reports AGENT_READY after the real Devin process accepts the source-backed room primer', async () => {
    const { port } = await startBridge(`
process.stdin.setEncoding('utf8');
process.stdin.once('data', () => {});
setInterval(() => {}, 1000);
`, {
      AGENT_READY_AFTER_PRIMER_MS: '35',
      AGENT_START_READY_TIMEOUT_MS: '2000',
    });

    const { ws, messages } = await connectAgent(port);
    const startingStatus = await waitForMessage(messages, (message) => message.type === 'AGENT_STATUS' && message.status === 'starting');
    expect(startingStatus).toMatchObject({ agent: 'devin' });

    const ready = await waitForMessage(messages, (message) => message.type === 'AGENT_READY');
    expect(ready).toMatchObject({
      agent: 'devin',
      capabilities: ['read', 'write', 'run', 'browse'],
    });
    ws.close();
  });

  it('turns Devin auth output into auth_needed instead of ready', async () => {
    const { port } = await startBridge(`
process.stdin.setEncoding('utf8');
process.stdin.once('data', () => {
  setTimeout(() => process.stderr.write('Please run devin auth login before continuing.\\n'), 50);
});
setInterval(() => {}, 1000);
`, { AGENT_READY_AFTER_PRIMER_MS: '1000' });

    const { ws, messages } = await connectAgent(port);
    const authStatus = await waitForMessage(messages, (message) => message.type === 'AGENT_STATUS' && message.status === 'auth_needed');
    expect(authStatus).toMatchObject({ agent: 'devin' });

    expect(messages.some((message) => message.type === 'AGENT_READY')).toBe(false);
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'AUTH_NEEDED',
      agent: 'devin',
    }));
    ws.close();
  });

  it('allows chat after a quiet real Devin process accepts the room primer', async () => {
    const { port } = await startBridge(`
process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  if (buffer.includes('Current Clippy chat message:')) {
    process.stdout.write('Real Devin received the candidate request.\\n');
  }
});
setInterval(() => {}, 1000);
`, {
      AGENT_READY_AFTER_PRIMER_MS: '35',
      AGENT_START_READY_TIMEOUT_MS: '2000',
    });

    const { ws, messages } = await connectAgent(port);
    await waitForMessage(messages, (message) => message.type === 'AGENT_READY');
    ws.send(JSON.stringify({
      type: 'CHAT',
      text: 'Please inspect the task.',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
    }));
    const diagnostic = await waitForMessage(messages, (message) => (
      message.type === 'AGENT_DIAGNOSTIC'
      && message.diagnosticSource === 'agent_prompt_sent'
    ));
    expect(diagnostic).toMatchObject({
      agent: 'devin',
      promptType: 'chat_prompt',
      deliveredToAgent: true,
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
    });
    const response = await waitForMessage(messages, (message) => (
      message.type === 'CHAT_RESPONSE'
      && message.text.includes('Real Devin received the candidate request.')
    ));

    expect(response).toMatchObject({
      agent: 'devin',
      source: 'agent_stdout',
      browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      browserPromptFingerprint: 'clippy_0123abcd',
      browserPromptTimestamp: 1782603900000,
      browserPromptLength: 24,
    });
    ws.close();
  });

  it('persists code-server workspace creates as code editor save evidence before broadcasting', async () => {
    const captureServer = await startSessionEventCaptureServer();
    try {
      const { port, workspaceDir } = await startBridge(`
process.stdin.setEncoding('utf8');
process.stdin.once('data', () => process.stdout.write('Primer accepted by real Devin\\n'));
setInterval(() => {}, 1000);
`, {
        PIPE_API_URL: captureServer.url,
        ROOM_TOKEN: 'room-token',
        WORKSPACE_SCAN_INTERVAL_MS: '1000',
      });

      const { ws, messages } = await connectAgent(port);
      await delay(1200);
      writeFileSync(path.join(workspaceDir, 'src-example.ts'), 'export const value = 42;\n');

      const fileMessage = await waitForMessage(messages, (message) => (
        message.type === 'FILE_CHANGED'
        && message.path === 'src-example.ts'
        && message.persisted === true
      ), 3000);

      expect(fileMessage).toMatchObject({
        type: 'FILE_CHANGED',
        source: 'code_server_workspace',
        action: 'created',
        path: 'src-example.ts',
        sizeBytes: 25,
        contentPreview: 'export const value = 42;\n',
      });
      expect(fileMessage.contentHash).toMatch(/^[a-f0-9]{64}$/);

      const saveEvent = captureServer.events.find((event) => event.type === 'code_editor_save');
      expect(saveEvent).toMatchObject({
        type: 'code_editor_save',
        text: 'src-example.ts',
        actor: 'system',
        properties: {
          source: 'code_server_workspace',
          observedBy: 'agent_bridge',
          bridgeEventType: 'FILE_CHANGED',
          editorSurface: 'code-server',
          path: 'src-example.ts',
          action: 'created',
          contentPreview: 'export const value = 42;\n',
          sizeBytes: 25,
          workspaceRoot: workspaceDir,
          bridgePersisted: true,
        },
      });
      expect(saveEvent.properties.contentHash).toMatch(/^[a-f0-9]{64}$/);
      ws.close();
    } finally {
      await captureServer.close();
    }
  });
});
