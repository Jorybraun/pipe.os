import { execFileSync, spawn } from 'node:child_process';
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
  writeFileSync(devinPath, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
function fakeAuthStatus() {
  if (process.env.FAKE_DEVIN_AUTH_STATUS_FILE) {
    try {
      return fs.readFileSync(process.env.FAKE_DEVIN_AUTH_STATUS_FILE, 'utf8').trim();
    } catch {
      return '';
    }
  }
  return process.env.FAKE_DEVIN_AUTH_STATUS || '';
}
if (args[0] === 'auth' && args[1] === 'status') {
  if (fakeAuthStatus() === 'not_logged_in') {
    process.stdout.write('Not logged in.\\n  Credentials path: /tmp/devin-test/credentials.toml\\nRun \`devin auth login\` to authenticate.\\n');
    process.exit(0);
  }
  process.stdout.write('Logged in as test-devin-user.\\n');
  process.exit(0);
}
${scriptBody}
`);
  await chmod(devinPath, 0o755);
  return { root, binDir };
}

async function startBridge(scriptBody, extraEnv = {}, options = {}) {
  const installFakeDevin = options.installFakeDevin !== false;
  const port = await freePort();
  const codeServerPort = await freePort();
  const workspaceDir = options.workspaceDir || mkdtempSync(path.join(tmpdir(), 'pipe-bridge-workspace-'));
  const fakeDevin = installFakeDevin ? await writeFakeDevin(scriptBody) : null;
  const emptyBinDir = mkdtempSync(path.join(tmpdir(), 'pipe-empty-bin-'));
  const bridgePathEnv = fakeDevin
    ? `${fakeDevin.binDir}:${process.env.PATH ?? ''}`
    : emptyBinDir;
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
        PATH: bridgePathEnv,
        DEVIN_API_KEY: '',
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

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'PIPE Test',
      GIT_AUTHOR_EMAIL: 'pipe-test@example.com',
      GIT_COMMITTER_NAME: 'PIPE Test',
      GIT_COMMITTER_EMAIL: 'pipe-test@example.com',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trimEnd();
}

function createCommittedWorkspace(branchName = 'pipe-assessment') {
  const workspaceDir = mkdtempSync(path.join(tmpdir(), 'pipe-bridge-git-workspace-'));
  git(['init'], workspaceDir);
  git(['config', 'user.name', 'PIPE Test'], workspaceDir);
  git(['config', 'user.email', 'pipe-test@example.com'], workspaceDir);
  writeFileSync(path.join(workspaceDir, 'README.md'), '# Assessment repo\n\nOriginal behavior.\n');
  git(['add', 'README.md'], workspaceDir);
  git(['commit', '-m', 'base'], workspaceDir);
  const baseCommitSha = git(['rev-parse', 'HEAD'], workspaceDir);
  git(['checkout', '-B', branchName], workspaceDir);
  writeFileSync(path.join(workspaceDir, 'README.md'), '# Assessment repo\n\nFixed behavior with evidence.\n');
  git(['add', 'README.md'], workspaceDir);
  git(['commit', '-m', 'candidate fix'], workspaceDir);
  const commitSha = git(['rev-parse', 'HEAD'], workspaceDir);
  return { workspaceDir, baseCommitSha, commitSha };
}

async function startFakeDevinApiServer() {
  const requests = [];
  const messages = [];
  const port = await freePort();
  let sessionCreated = false;
  let messageCounter = 0;
  const server = createServer((req, res) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const jsonBody = body ? JSON.parse(body) : null;
      requests.push({ method: req.method, url: req.url, body: jsonBody });

      if (req.method === 'GET' && req.url === '/v3/self') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ org_id: 'org_123' }));
        return;
      }

      if (req.method === 'POST' && req.url === '/v3/organizations/org_123/sessions') {
        sessionCreated = true;
        messages.push({
          event_id: 'primer-user',
          role: 'user',
          message: jsonBody?.prompt ?? '',
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ session_id: 'devin-session-1' }));
        return;
      }

      if (req.method === 'POST' && req.url === '/v3/organizations/org_123/sessions/devin-session-1/messages') {
        messageCounter += 1;
        messages.push({
          event_id: `user-${messageCounter}`,
          role: 'user',
          message: jsonBody?.message ?? '',
        });
        messages.push({
          event_id: `devin-${messageCounter}`,
          role: 'assistant',
          message: 'I can help from the real Devin API session. [[room_action:open-workspace|Open VS Code]]',
        });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ accepted: true }));
        return;
      }

      if (req.method === 'GET' && req.url?.startsWith('/v3/organizations/org_123/sessions/devin-session-1/messages')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ messages }));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found', sessionCreated }));
    });
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    requests,
    url: `http://127.0.0.1:${port}/v3`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
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

async function startCommitSubmissionCaptureServer() {
  const submissions = [];
  const port = await freePort();
  const server = createServer((req, res) => {
    if (
      req.method !== 'POST'
      || req.url !== '/api/v1/meeting-rooms/room-token/assessment/commit-submission'
    ) {
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
      const jsonBody = JSON.parse(body);
      submissions.push(jsonBody);
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        submission: {
          accepted: true,
          repositoryUrl: jsonBody.repositoryUrl,
          branchName: jsonBody.branchName,
          commitSha: jsonBody.commitSha,
          commitUrl: jsonBody.commitUrl ?? null,
        },
        progress: {
          stage: 'READY_FOR_EVALUATION',
          nextAction: 'START_EVALUATION',
          hasCommitSubmission: true,
        },
      }));
    });
  });

  await new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

  return {
    submissions,
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

async function websocketDataText(data) {
  if (typeof data === 'string') return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  if (data && typeof data.arrayBuffer === 'function') {
    return Buffer.from(await data.arrayBuffer()).toString('utf8');
  }
  return String(data);
}

async function connectTerminal(port) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/terminal`);
  ws.binaryType = 'arraybuffer';
  const chunks = [];
  ws.addEventListener('message', (event) => {
    void websocketDataText(event.data).then((text) => chunks.push(text));
  });
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', reject, { once: true });
  });
  return { ws, chunks };
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

async function waitForTerminalOutput(chunks, text, timeoutMs = 2000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const output = chunks.join('');
    if (output.includes(text)) return output;
    await delay(25);
  }
  throw new Error(`Timed out waiting for terminal output "${text}". Saw: ${chunks.join('')}`);
}

afterEach(async () => {
  for (const child of [...bridgeProcesses]) {
    child.kill('SIGTERM');
  }
  await delay(50);
});

describe('agent bridge readiness', () => {
  it('decodes browser terminal control messages before writing to bash', async () => {
    const { port } = await startBridge('', {
      AGENT_TYPE: '',
      PATH: process.env.PATH ?? '',
    }, {
      installFakeDevin: false,
    });

    const { ws, chunks } = await connectTerminal(port);
    ws.send(JSON.stringify({ type: 'TERMINAL_INPUT', data: 'printf "__PIPE_TERMINAL_OK__\\n"\r' }));
    const output = await waitForTerminalOutput(chunks, '__PIPE_TERMINAL_OK__');

    expect(output).toContain('__PIPE_TERMINAL_OK__');
    expect(output).not.toContain('TERMINAL_INPUT');
    ws.close();
  });

  it('finalizes a real workspace commit into source-backed assessment evidence without a configured agent', async () => {
    const captureServer = await startCommitSubmissionCaptureServer();
    const { workspaceDir, baseCommitSha, commitSha } = createCommittedWorkspace();
    try {
      const { port } = await startBridge('', {
        AGENT_TYPE: '',
        PATH: process.env.PATH ?? '',
        PIPE_API_URL: captureServer.url,
        ROOM_TOKEN: 'room-token',
        REPO_GIT_URL: 'https://github.com/example/repo',
        CHALLENGE_BASE_COMMIT_SHA: baseCommitSha,
        PIPE_TEST_COMMAND: 'node -e "console.log(42)"',
      }, {
        installFakeDevin: false,
        workspaceDir,
      });

      const response = await fetch(`http://127.0.0.1:${port}/assessment/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ narrative: 'Candidate fixed the assessment repo behavior.' }),
      });

      expect(response.status).toBe(201);
      const body = await response.json();
      expect(body).toMatchObject({
        ok: true,
        submitted: true,
        commit: {
          repositoryUrl: 'https://github.com/example/repo',
          branchName: 'pipe-assessment',
          baseCommitSha,
          commitSha,
          sourceRefTypes: ['git_commit', 'code_diff', 'terminal_command', 'test_run'],
        },
      });

      expect(captureServer.submissions).toHaveLength(1);
      const submission = captureServer.submissions[0];
      expect(submission).toMatchObject({
        narrative: 'Candidate fixed the assessment repo behavior.',
        repositoryUrl: 'https://github.com/example/repo',
        forkRepositoryUrl: null,
        branchName: 'pipe-assessment',
        baseCommitSha,
        commitSha,
        upstreamPrConsent: false,
        changedFiles: [{ path: 'README.md', status: 'modified' }],
      });
      expect(submission.sourceRefs.map((ref) => ref.sourceRefType)).toEqual([
        'git_commit',
        'code_diff',
        'terminal_command',
        'test_run',
      ]);
      expect(submission.sourceRefs.every((ref) => /^sha256:[a-f0-9]{64}$/.test(ref.contentHash))).toBe(true);
      expect(submission.sourceRefs[0]).toMatchObject({
        sourceRefType: 'git_commit',
        sourceRefId: commitSha,
        evidenceRole: 'submitted_commit',
        metadata: { source: 'agent_bridge_workspace_finalize' },
      });
      expect(submission.sourceRefs[0].exactText).toContain(commitSha);
      expect(submission.sourceRefs[1]).toMatchObject({
        sourceRefType: 'code_diff',
        sourceRefId: `${baseCommitSha}..${commitSha}`,
      });
      expect(submission.sourceRefs[1].exactText).toContain('diff --git');
      expect(submission.sourceRefs[1].exactText).toContain('README.md');
      expect(submission.sourceRefs[2]).toMatchObject({
        sourceRefType: 'terminal_command',
        sourceRefId: `${commitSha}:workspace-finalizer-commands`,
        evidenceRole: 'workspace_finalizer_command_transcript',
        metadata: {
          source: 'agent_bridge_workspace_finalize',
          scope: 'finalizer_commands_only',
        },
      });
      expect(submission.sourceRefs[2].exactText).toContain('Workspace finalizer command transcript');
      expect(submission.sourceRefs[2].exactText).toContain(`$ git diff --no-ext-diff --find-renames ${baseCommitSha}..${commitSha}`);
      expect(submission.sourceRefs[2].exactText).toContain('$ bash -lc node -e "console.log(42)"');
      expect(submission.sourceRefs[3]).toMatchObject({
        sourceRefType: 'test_run',
        sourceRefId: `${commitSha}:test-run`,
        evidenceRole: 'verification_test_output',
        locator: {
          command: 'node -e "console.log(42)"',
          exitCode: 0,
        },
      });
      expect(submission.sourceRefs[3].exactText).toContain('$ node -e "console.log(42)"');
      expect(submission.sourceRefs[3].exactText).toContain('exitCode: 0');
      expect(submission.sourceRefs[3].exactText).toContain('42');
    } finally {
      await captureServer.close();
    }
  });

  it('records a verification gap instead of inventing test output when no test command is configured', async () => {
    const captureServer = await startCommitSubmissionCaptureServer();
    const { workspaceDir, baseCommitSha, commitSha } = createCommittedWorkspace();
    try {
      const { port } = await startBridge('', {
        AGENT_TYPE: '',
        PATH: process.env.PATH ?? '',
        PIPE_API_URL: captureServer.url,
        ROOM_TOKEN: 'room-token',
        REPO_GIT_URL: 'https://github.com/example/repo',
        CHALLENGE_BASE_COMMIT_SHA: baseCommitSha,
      }, {
        installFakeDevin: false,
        workspaceDir,
      });

      const response = await fetch(`http://127.0.0.1:${port}/assessment/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      expect(response.status).toBe(201);
      const submission = captureServer.submissions[0];
      const verificationGap = submission.sourceRefs.find((ref) => ref.sourceRefType === 'verification_gap');
      expect(verificationGap).toMatchObject({
        sourceRefId: `${commitSha}:test-evidence-missing`,
        evidenceRole: 'missing_test_evidence_note',
        metadata: {
          source: 'agent_bridge_workspace_finalize',
          missingEvidence: 'test_run',
        },
      });
      expect(verificationGap.exactText).toContain('No test command was provided');
    } finally {
      await captureServer.close();
    }
  });

  it('blocks finalization when the workspace commit is not on the assessment branch namespace', async () => {
    const captureServer = await startCommitSubmissionCaptureServer();
    const { workspaceDir, baseCommitSha } = createCommittedWorkspace('main');
    try {
      const { port } = await startBridge('', {
        AGENT_TYPE: '',
        PATH: process.env.PATH ?? '',
        PIPE_API_URL: captureServer.url,
        ROOM_TOKEN: 'room-token',
        REPO_GIT_URL: 'https://github.com/example/repo',
        CHALLENGE_BASE_COMMIT_SHA: baseCommitSha,
      }, {
        installFakeDevin: false,
        workspaceDir,
      });

      const response = await fetch(`http://127.0.0.1:${port}/assessment/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      expect(response.status).toBe(409);
      const body = await response.json();
      expect(body).toMatchObject({
        ok: false,
        error: {
          code: 'ASSESSMENT_FINALIZE_BLOCKED',
        },
      });
      expect(body.error.message).toContain('HEAD must be pipe-assessment or a pipe-assessment/* branch');
      expect(captureServer.submissions).toHaveLength(0);
    } finally {
      await captureServer.close();
    }
  });

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

  it('reports AGENT_READY after creating a real Devin API session with the service token', async () => {
    const apiServer = await startFakeDevinApiServer();
    const captureServer = await startSessionEventCaptureServer();
    try {
      const { port } = await startBridge('', {
        DEVIN_API_KEY: 'test-devin-service-token',
        DEVIN_API_BASE_URL: apiServer.url,
        PIPE_API_URL: captureServer.url,
        ROOM_TOKEN: 'room-token',
        DEVIN_API_RESPONSE_TIMEOUT_MS: '1000',
        DEVIN_API_POLL_INTERVAL_MS: '25',
      }, { installFakeDevin: false });

      const { ws, messages } = await connectAgent(port);
      const ready = await waitForMessage(messages, (message) => message.type === 'AGENT_READY');
      expect(ready).toMatchObject({
        agent: 'devin',
        capabilities: ['read', 'write', 'run', 'browse'],
      });
      expect(apiServer.requests.some((request) => request.method === 'GET' && request.url === '/v3/self')).toBe(true);
      expect(apiServer.requests.some((request) => (
        request.method === 'POST'
        && request.url === '/v3/organizations/org_123/sessions'
      ))).toBe(true);

      ws.send(JSON.stringify({
        type: 'CHAT',
        text: 'Please inspect the repo.',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
      }));

      const response = await waitForMessage(messages, (message) => (
        message.type === 'CHAT_RESPONSE'
        && message.source === 'agent_api_response'
      ));
      expect(response).toMatchObject({
        agent: 'devin',
        text: 'I can help from the real Devin API session.',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 24,
      });

      const roomAction = await waitForMessage(messages, (message) => (
        message.type === 'ROOM_ACTION'
        && message.source === 'agent_api_response'
      ));
      expect(roomAction).toMatchObject({
        agent: 'devin',
        action: 'open-workspace',
        protocol: 'clippy_room_action_tag',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
      });

      const chatEvent = captureServer.events.find((event) => event.type === 'ai_chat_agent');
      expect(chatEvent).toMatchObject({
        type: 'ai_chat_agent',
        text: 'I can help from the real Devin API session.',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          bridgeEventType: 'CHAT_RESPONSE',
          bridgeMessageSource: 'agent_api_response',
          bridgePersisted: true,
        },
      });
      const actionEvent = captureServer.events.find((event) => event.type === 'clippy_action');
      expect(actionEvent).toMatchObject({
        type: 'clippy_action',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          actionSource: 'agent_api_response',
          actionProtocol: 'clippy_room_action_tag',
          bridgeEventType: 'ROOM_ACTION',
        },
      });
      ws.close();
    } finally {
      await apiServer.close();
      await captureServer.close();
    }
  });

  it('does not treat DEVIN_API_KEY as Devin CLI login', async () => {
    const { port } = await startBridge(`
process.stdin.setEncoding('utf8');
process.stdin.on('data', () => process.stdout.write('This should not start without CLI auth.\\n'));
setInterval(() => {}, 1000);
`, {
      DEVIN_API_KEY: 'test-devin-service-token',
      DEVIN_API_BASE_URL: 'http://127.0.0.1:9/v3',
      FAKE_DEVIN_AUTH_STATUS: 'not_logged_in',
    });

    const { ws, messages } = await connectAgent(port);
    const authNeeded = await waitForMessage(messages, (message) => message.type === 'AUTH_NEEDED');

    expect(authNeeded).toMatchObject({
      agent: 'devin',
      message: expect.stringContaining('Not logged in.'),
    });
    expect(messages.some((message) => message.type === 'AGENT_READY')).toBe(false);
    const authStatusDiagnostic = await waitForMessage(
      messages,
      (message) => (
        message.type === 'AGENT_DIAGNOSTIC'
        && message.diagnosticSource === 'devin_auth_status_not_logged_in'
      ),
    );
    expect(authStatusDiagnostic).toMatchObject({
      agent: 'devin',
      status: 'auth_needed',
      message: expect.stringContaining('devin auth login --force-manual-token-flow'),
    });

    ws.send(JSON.stringify({ type: 'CHAT', text: 'hello?' }));
    const repeatedAuth = await waitForMessage(
      messages,
      (message) => (
        message.type === 'AGENT_DIAGNOSTIC'
        && message.diagnosticSource === 'devin_auth_status_not_logged_in'
      ),
    );
    expect(repeatedAuth).toBeTruthy();
    expect(messages.some((message) => (
      message.type === 'CHAT_RESPONSE'
      && String(message.text || '').includes('This should not start')
    ))).toBe(false);
    ws.close();
  });

  it('rechecks real Devin CLI auth and starts the agent after terminal login completes', async () => {
    const statusDir = mkdtempSync(path.join(tmpdir(), 'pipe-devin-auth-status-'));
    const statusFile = path.join(statusDir, 'status');
    writeFileSync(statusFile, 'not_logged_in');
    const { port } = await startBridge(`
process.stdin.setEncoding('utf8');
process.stdin.once('data', () => {});
setInterval(() => {}, 1000);
`, {
      FAKE_DEVIN_AUTH_STATUS_FILE: statusFile,
      AGENT_READY_AFTER_PRIMER_MS: '35',
      AGENT_START_READY_TIMEOUT_MS: '2000',
    });

    const { ws, messages } = await connectAgent(port);
    const authNeeded = await waitForMessage(messages, (message) => message.type === 'AUTH_NEEDED');
    expect(authNeeded).toMatchObject({
      agent: 'devin',
      message: expect.stringContaining('Not logged in.'),
    });
    expect(messages.some((message) => message.type === 'AGENT_READY')).toBe(false);

    writeFileSync(statusFile, 'logged_in');
    ws.send(JSON.stringify({ type: 'AUTH_START', agent: 'devin' }));

    const starting = await waitForMessage(
      messages,
      (message) => message.type === 'AGENT_STATUS' && message.status === 'starting',
    );
    expect(starting).toMatchObject({ agent: 'devin' });
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

  it('does not treat the Devin login banner as ready when auth is canceled', async () => {
    const { port } = await startBridge(`
process.stdin.setEncoding('utf8');
process.stdin.once('data', () => {
  process.stdout.write('Welcome to Devin CLI!\\n');
  setTimeout(() => process.stderr.write('Error: Login canceled\\n'), 50);
});
setInterval(() => {}, 1000);
`, { AGENT_READY_AFTER_PRIMER_MS: '1000' });

    const { ws, messages } = await connectAgent(port);
    const authNeeded = await waitForMessage(messages, (message) => message.type === 'AUTH_NEEDED');
    expect(authNeeded).toMatchObject({ agent: 'devin' });
    expect(messages.some((message) => message.type === 'AGENT_READY')).toBe(false);
    const authDiagnostic = await waitForMessage(
      messages,
      (message) => (
        message.type === 'AGENT_DIAGNOSTIC'
        && message.diagnosticSource === 'agent_stderr_auth_required'
      ),
    );
    expect(authDiagnostic).toMatchObject({
      agent: 'devin',
      status: 'auth_needed',
    });
    ws.close();
  });

  it('does not report ready when the real Devin CLI executable is missing', async () => {
    const { port } = await startBridge('', {}, { installFakeDevin: false });

    const { ws, messages } = await connectAgent(port);
    await delay(500);

    expect(messages.some((message) => message.type === 'AGENT_READY')).toBe(false);
    expect(messages).toContainEqual(expect.objectContaining({
      type: 'AGENT_DIAGNOSTIC',
      agent: 'devin',
      status: 'disconnected',
      diagnosticSource: 'agent_cli_missing',
    }));

    ws.send(JSON.stringify({ type: 'CHAT', text: 'hello?' }));
    const error = await waitForMessage(messages, (message) => message.type === 'ERROR');
    expect(error).toEqual({
      type: 'ERROR',
      message: 'devin is not available. Check bridge diagnostics before sending chat.',
    });
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

  it('redacts real Devin stdout before bridge broadcast and direct session-event persistence', async () => {
    const captureServer = await startSessionEventCaptureServer();
    const rawToken = 'cog_fakeServiceUserToken0123456789abcdef';
    try {
      const { port } = await startBridge(`
process.stdin.setEncoding('utf8');
let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  if (buffer.includes('Current Clippy chat message:')) {
    process.stdout.write('Auth check used DEVIN_API_KEY=${rawToken}.\\n');
  }
});
setInterval(() => {}, 1000);
`, {
        AGENT_READY_AFTER_PRIMER_MS: '35',
        AGENT_START_READY_TIMEOUT_MS: '2000',
        PIPE_API_URL: captureServer.url,
        ROOM_TOKEN: 'room-token',
      });

      const { ws, messages } = await connectAgent(port);
      await waitForMessage(messages, (message) => message.type === 'AGENT_READY');
      ws.send(JSON.stringify({
        type: 'CHAT',
        text: 'Please inspect auth.',
        browserPromptId: 'workspace-123:guest:prompt:1782603900000:clippy_0123abcd',
        browserPromptFingerprint: 'clippy_0123abcd',
        browserPromptTimestamp: 1782603900000,
        browserPromptLength: 20,
      }));

      const response = await waitForMessage(messages, (message) => (
        message.type === 'CHAT_RESPONSE'
        && String(message.text || '').includes('Auth check used DEVIN_API_KEY=')
      ));
      expect(response.text).toBe('Auth check used DEVIN_API_KEY=[REDACTED_SECRET]');
      expect(JSON.stringify(response)).not.toContain(rawToken);

      const chatEvent = captureServer.events.find((event) => event.type === 'ai_chat_agent');
      expect(chatEvent).toMatchObject({
        type: 'ai_chat_agent',
        text: 'Auth check used DEVIN_API_KEY=[REDACTED_SECRET]',
        actor: 'agent',
        properties: {
          source: 'clippy_agent_bridge',
          bridgeEventType: 'CHAT_RESPONSE',
          bridgeMessageSource: 'agent_stdout',
          responseLength: 'Auth check used DEVIN_API_KEY=[REDACTED_SECRET]'.length,
          bridgePersisted: true,
        },
      });
      expect(JSON.stringify(chatEvent)).not.toContain(rawToken);
      expect(chatEvent.properties.agentChatResponseId).toContain(chatEvent.properties.responseFingerprint);
      ws.close();
    } finally {
      await captureServer.close();
    }
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
