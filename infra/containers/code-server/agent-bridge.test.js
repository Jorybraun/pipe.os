import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { chmod } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
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
  return { child, port };
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
  it('does not report AGENT_READY until real Devin stdout is observed', async () => {
    const { port } = await startBridge(`
process.stdin.setEncoding('utf8');
process.stdin.once('data', () => {
  setTimeout(() => process.stdout.write('Primer accepted by real Devin\\n'), 500);
});
setInterval(() => {}, 1000);
`, { AGENT_START_READY_TIMEOUT_MS: '2000' });

    const { ws, messages } = await connectAgent(port);
    await waitForMessage(messages, (message) => message.type === 'AGENT_STATUS' && message.status === 'starting');
    await delay(150);
    expect(messages.some((message) => message.type === 'AGENT_READY')).toBe(false);

    await waitForMessage(messages, (message) => message.type === 'AGENT_READY');
    ws.close();
  });

  it('turns Devin auth output into auth_needed instead of ready', async () => {
    const { port } = await startBridge(`
process.stdin.setEncoding('utf8');
process.stdin.once('data', () => {
  setTimeout(() => process.stderr.write('Please run devin auth login before continuing.\\n'), 50);
});
setInterval(() => {}, 1000);
`);

    const { ws, messages } = await connectAgent(port);
    await waitForMessage(messages, (message) => message.type === 'AGENT_STATUS' && message.status === 'auth_needed');

    expect(messages.some((message) => message.type === 'AGENT_READY')).toBe(false);
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'AUTH_NEEDED',
      agent: 'devin',
    }));
    ws.close();
  });

  it('records a diagnostic when Devin never proves readiness', async () => {
    const { port } = await startBridge(`
process.stdin.resume();
setInterval(() => {}, 1000);
`, { AGENT_START_READY_TIMEOUT_MS: '120' });

    const { ws, messages } = await connectAgent(port);
    await waitForMessage(messages, (message) => (
      message.type === 'AGENT_DIAGNOSTIC'
      && message.diagnosticSource === 'agent_start_timeout'
    ));

    expect(messages.some((message) => message.type === 'AGENT_READY')).toBe(false);
    ws.close();
  });
});
