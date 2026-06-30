const http = require('http');
const crypto = require('crypto');
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const {
  agentChatSessionEvent,
  agentDiagnosticMessage,
  agentDiagnosticSessionEvent,
  agentRoomActionSessionEvent,
  agentPromptHandoffDiagnosticMessage,
  isAgentAuthFailureText,
  redactDiagnosticText,
} = require('./agent-diagnostics.js');

const BRIDGE_PORT = Number(process.env.AGENT_BRIDGE_PORT || 8081);
const CODE_SERVER_PORT = Number(process.env.CODE_SERVER_PORT || 8080);
const WORKSPACE = process.env.WORKSPACE_DIR || '/workspace';
const BRIDGE_REVISION = process.env.PIPE_BRIDGE_REVISION || 'local-dev';
const REQUESTED_AGENT_NAME = String(process.env.AGENT_TYPE || '').trim();
const SUPPORTED_AGENT_TYPES = new Set(['devin']);
const AGENT_NAME = SUPPORTED_AGENT_TYPES.has(REQUESTED_AGENT_NAME) ? REQUESTED_AGENT_NAME : '';
const AGENT_UNCONFIGURED_MESSAGE = REQUESTED_AGENT_NAME
  ? `Agent type "${REQUESTED_AGENT_NAME}" is not supported by this bridge. Configure a real bridge for that agent before enabling Clippy chat.`
  : 'No real agent is configured in this container. Set AGENT_TYPE to a supported bridge agent before enabling Clippy chat.';
const PIPE_API_URL = process.env.PIPE_API_URL || '';
const ROOM_TOKEN = process.env.ROOM_TOKEN || '';
const AGENT_CONTEXT_MAX_LENGTH = Number(process.env.AGENT_CONTEXT_MAX_LENGTH || 6000);
const WORKSPACE_SCAN_INTERVAL_MS = positiveIntEnv('WORKSPACE_SCAN_INTERVAL_MS', 2000, 1000);
const WORKSPACE_MAX_SCAN_FILES = positiveIntEnv('WORKSPACE_MAX_SCAN_FILES', 1500, 100);
const WORKSPACE_MAX_HASH_BYTES = positiveIntEnv('WORKSPACE_MAX_HASH_BYTES', 1024 * 1024, 1024);
const WORKSPACE_PREVIEW_BYTES = positiveIntEnv('WORKSPACE_PREVIEW_BYTES', 2048, 0);
const AGENT_START_READY_TIMEOUT_MS = positiveIntEnv('AGENT_START_READY_TIMEOUT_MS', 15000, 1000);
const AGENT_READY_AFTER_PRIMER_MS = positiveIntEnv('AGENT_READY_AFTER_PRIMER_MS', 3000, 25);
const DEVIN_API_BASE_URL = String(process.env.DEVIN_API_BASE_URL || 'https://api.devin.ai/v3').replace(/\/+$/, '');
const DEVIN_API_KEY = String(process.env.DEVIN_API_KEY || '').trim();
const DEVIN_ORG_ID = String(process.env.DEVIN_ORG_ID || '').trim();
const DEVIN_API_RESPONSE_TIMEOUT_MS = positiveIntEnv('DEVIN_API_RESPONSE_TIMEOUT_MS', 45000, 1000);
const DEVIN_API_POLL_INTERVAL_MS = positiveIntEnv('DEVIN_API_POLL_INTERVAL_MS', 2500, 250);
const DEVIN_AUTH_MESSAGE = 'Devin CLI is not logged in inside this container. Authenticate the real Devin CLI before using Clippy chat.';
const ASSESSMENT_FINALIZE_TIMEOUT_MS = positiveIntEnv('ASSESSMENT_FINALIZE_TIMEOUT_MS', 120000, 1000);

let agentAuthed = false;
let agentProcess = null;
let agentRuntime = 'none';
let agentReady = false;
let agentStatus = AGENT_NAME ? 'disconnected' : 'disconnected';
const clients = new Set();
let agentStartReadyTimer = null;
let agentPrimerReadyTimer = null;
let lastAuthMessage = DEVIN_AUTH_MESSAGE;
let lastAuthDiagnosticSource = 'auth_required';
let workspaceBaselineReady = false;
let workspaceScanInFlight = false;
let workspaceWatcherTimer = null;
let workspaceSnapshot = new Map();
const pendingAgentChatPromptRefs = [];
let devinApiSession = null;
const devinApiSeenMessageIds = new Set();

const WORKSPACE_IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.cache',
  '.pnpm-store',
]);

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

function positiveIntEnv(name, fallback, minimum = 1) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value)) return fallback;
  return Math.max(Math.floor(value), minimum);
}

function normalizeRoomAction(value) {
  const normalized = roomActionName(value);
  if (ROOM_ACTIONS[normalized]) return normalized;
  for (const [id, config] of Object.entries(ROOM_ACTIONS)) {
    if (config.aliases.some((alias) => roomActionName(alias) === normalized)) return id;
  }
  return null;
}

function extractTaggedRoomActions(text, source = 'agent_stdout') {
  const actions = [];
  const cleanText = String(text || '').replace(
    /\[\[room_action:([a-zA-Z0-9_-]+)(?:\|([^\]]+))?\]\]/g,
    (_match, rawAction, rawLabel) => {
      const action = normalizeRoomAction(rawAction);
      if (action) {
        actions.push({
          action,
          agent: AGENT_NAME,
          label: rawLabel || ROOM_ACTIONS[action].label,
          text: rawLabel ? String(rawLabel) : ROOM_ACTIONS[action].label,
          source,
          protocol: 'clippy_room_action_tag',
        });
      }
      return '';
    },
  ).trim();
  return { text: cleanText, actions };
}

function send(ws, msg) {
  if (!msg) return;
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
  if (!msg) return;
  for (const ws of clients) send(ws, msg);
}

function roomSessionEventsUrl(pipeApiUrl = PIPE_API_URL, roomToken = ROOM_TOKEN) {
  const base = String(pipeApiUrl || '').trim();
  const token = String(roomToken || '').trim();
  if (!base || !token) return null;

  try {
    return new URL(
      `/api/v1/meeting-rooms/${encodeURIComponent(token)}/session-events`,
      base,
    ).toString();
  } catch {
    return null;
  }
}

function roomCommitSubmissionUrl(pipeApiUrl = PIPE_API_URL, roomToken = ROOM_TOKEN) {
  const base = String(pipeApiUrl || '').trim();
  const token = String(roomToken || '').trim();
  if (!base || !token) return null;

  try {
    return new URL(
      `/api/v1/meeting-rooms/${encodeURIComponent(token)}/assessment/commit-submission`,
      base,
    ).toString();
  } catch {
    return null;
  }
}

function sha256ContentHash(text) {
  return `sha256:${crypto.createHash('sha256').update(String(text)).digest('hex')}`;
}

function jsonResponse(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

function readJsonRequestBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > maxBytes) {
        reject(new Error('Request body is too large.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Request body must be valid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function runCommand(command, args, {
  cwd = WORKSPACE,
  timeoutMs = 30000,
  env = process.env,
} = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
    timeout: timeoutMs,
  });
  const stdout = result.stdout || '';
  const stderr = result.stderr || '';
  if (result.error) {
    throw new Error(`${command} ${args.join(' ')} failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = `${stdout}\n${stderr}`.trim().slice(0, 2000);
    throw new Error(`${command} ${args.join(' ')} exited ${result.status}${detail ? `: ${detail}` : ''}`);
  }
  return stdout.trimEnd();
}

function runGit(args, options = {}) {
  return runCommand('git', args, options);
}

function parseChangedFiles(nameStatusText) {
  return String(nameStatusText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t');
      const rawStatus = parts[0] || '';
      const code = rawStatus.charAt(0).toUpperCase();
      if ((code === 'R' || code === 'C') && parts.length >= 3) {
        return {
          path: parts[2],
          status: code === 'R' ? 'renamed' : 'copied',
          previousPath: parts[1],
        };
      }
      const pathValue = parts.slice(1).join('\t').trim();
      if (!pathValue) return null;
      if (code === 'A') return { path: pathValue, status: 'added' };
      if (code === 'D') return { path: pathValue, status: 'deleted' };
      return { path: pathValue, status: 'modified' };
    })
    .filter(Boolean);
}

function normalizeOptionalString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function defaultCommitNarrative(commitSha, changedFiles) {
  const fileSummary = changedFiles.length === 1
    ? changedFiles[0].path
    : `${changedFiles.length} files`;
  return `Candidate submitted commit ${commitSha} with changes to ${fileSummary}.`;
}

function buildTestEvidenceText(command, result) {
  return [
    `$ ${command}`,
    `exitCode: ${result.status === null ? 'null' : result.status}`,
    result.signal ? `signal: ${result.signal}` : null,
    '--- stdout ---',
    result.stdout || '',
    '--- stderr ---',
    result.stderr || '',
  ].filter((part) => part !== null).join('\n');
}

function buildFinalizerCommandEvidenceText({ baseCommitSha, commitSha, testCommand }) {
  const commands = [
    'git rev-parse --is-inside-work-tree',
    `git cat-file -e ${baseCommitSha}^{commit}`,
    'git rev-parse HEAD',
    'git rev-parse --abbrev-ref HEAD',
    'git config --get remote.origin.url',
    `git show --no-patch --format=fuller ${commitSha}`,
    `git diff --no-ext-diff --find-renames ${baseCommitSha}..${commitSha}`,
    `git diff --name-status --find-renames ${baseCommitSha}..${commitSha}`,
    testCommand ? `bash -lc ${testCommand}` : null,
  ].filter(Boolean);

  return [
    'Workspace finalizer command transcript',
    ...commands.map((command) => `$ ${redactDiagnosticText(command)}`),
  ].join('\n');
}

async function buildWorkspaceCommitSubmission(body = {}) {
  runGit(['rev-parse', '--is-inside-work-tree']);
  const baseCommitSha = normalizeOptionalString(body.baseCommitSha)
    || normalizeOptionalString(process.env.CHALLENGE_BASE_COMMIT_SHA);
  if (!baseCommitSha || !/^[a-f0-9]{40}$/i.test(baseCommitSha)) {
    throw new Error('CHALLENGE_BASE_COMMIT_SHA must be configured with the exact 40-character base commit before finalizing.');
  }

  runGit(['cat-file', '-e', `${baseCommitSha}^{commit}`]);
  const commitSha = runGit(['rev-parse', 'HEAD']).trim().toLowerCase();
  if (!/^[a-f0-9]{40}$/i.test(commitSha)) {
    throw new Error('Unable to resolve a full HEAD commit SHA.');
  }
  if (commitSha === baseCommitSha.toLowerCase()) {
    throw new Error('Cannot finalize assessment: HEAD is still the challenge base commit.');
  }

  const branchName = runGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
  const repositoryUrl = normalizeOptionalString(body.repositoryUrl)
    || normalizeOptionalString(process.env.REPO_GIT_URL)
    || normalizeOptionalString(runGit(['config', '--get', 'remote.origin.url']));
  if (!repositoryUrl) {
    throw new Error('Repository URL is required before finalizing assessment evidence.');
  }

  const commitEvidenceText = runGit(['show', '--no-patch', '--format=fuller', commitSha]);
  const diffText = runGit(['diff', '--no-ext-diff', '--find-renames', `${baseCommitSha}..${commitSha}`]);
  const changedFiles = parseChangedFiles(
    runGit(['diff', '--name-status', '--find-renames', `${baseCommitSha}..${commitSha}`]),
  );
  if (changedFiles.length === 0 || !diffText.trim()) {
    throw new Error('Cannot finalize assessment: submitted commit has no source-backed diff from the challenge base.');
  }

  const occurredAt = new Date().toISOString();
  const sourceRepositoryUrl = normalizeOptionalString(body.forkRepositoryUrl) || repositoryUrl;
  const testCommand = normalizeOptionalString(body.testCommand)
    || normalizeOptionalString(process.env.PIPE_TEST_COMMAND);
  const finalizerCommandEvidenceText = buildFinalizerCommandEvidenceText({
    baseCommitSha: baseCommitSha.toLowerCase(),
    commitSha,
    testCommand,
  });
  let verificationSourceRef;
  if (testCommand) {
    const testResult = spawnSync('bash', ['-lc', testCommand], {
      cwd: WORKSPACE,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      timeout: ASSESSMENT_FINALIZE_TIMEOUT_MS,
    });
    const testEvidenceText = buildTestEvidenceText(testCommand, testResult);
    verificationSourceRef = {
      sourceRefType: 'test_run',
      sourceRefId: `${commitSha}:test-run`,
      evidenceRole: 'verification_test_output',
      locator: {
        repositoryUrl: sourceRepositoryUrl,
        commitSha,
        command: testCommand,
        exitCode: testResult.status,
      },
      exactText: testEvidenceText,
      contentHash: sha256ContentHash(testEvidenceText),
      metadata: {
        source: 'agent_bridge_workspace_finalize',
        timedOut: Boolean(testResult.error && testResult.error.code === 'ETIMEDOUT'),
      },
    };
  } else {
    const gapText = 'No test command was provided to the workspace finalizer, so PIPE captured this as a verification gap instead of inventing test evidence.';
    verificationSourceRef = {
      sourceRefType: 'verification_gap',
      sourceRefId: `${commitSha}:test-evidence-missing`,
      evidenceRole: 'missing_test_evidence_note',
      locator: {
        repositoryUrl: sourceRepositoryUrl,
        commitSha,
        expectedSourceRefType: 'test_run',
      },
      exactText: gapText,
      contentHash: sha256ContentHash(gapText),
      metadata: {
        source: 'agent_bridge_workspace_finalize',
        missingEvidence: 'test_run',
      },
    };
  }

  return {
    narrative: normalizeOptionalString(body.narrative) || defaultCommitNarrative(commitSha, changedFiles),
    repositoryUrl,
    forkRepositoryUrl: normalizeOptionalString(body.forkRepositoryUrl),
    branchName,
    baseCommitSha: baseCommitSha.toLowerCase(),
    commitSha,
    commitUrl: normalizeOptionalString(body.commitUrl),
    upstreamPullRequestUrl: normalizeOptionalString(body.upstreamPullRequestUrl),
    upstreamPrConsent: body.upstreamPrConsent === true,
    changedFiles,
    occurredAt,
    sourceRefs: [
      {
        sourceRefType: 'git_commit',
        sourceRefId: commitSha,
        evidenceRole: 'submitted_commit',
        locator: {
          repositoryUrl: sourceRepositoryUrl,
          commitSha,
        },
        exactText: commitEvidenceText,
        contentHash: sha256ContentHash(commitEvidenceText),
        metadata: {
          source: 'agent_bridge_workspace_finalize',
        },
      },
      {
        sourceRefType: 'code_diff',
        sourceRefId: `${baseCommitSha.toLowerCase()}..${commitSha}`,
        evidenceRole: 'submitted_diff',
        locator: {
          repositoryUrl: sourceRepositoryUrl,
          baseCommitSha: baseCommitSha.toLowerCase(),
          commitSha,
        },
        exactText: diffText,
        contentHash: sha256ContentHash(diffText),
        metadata: {
          source: 'agent_bridge_workspace_finalize',
        },
      },
      {
        sourceRefType: 'terminal_command',
        sourceRefId: `${commitSha}:workspace-finalizer-commands`,
        evidenceRole: 'workspace_finalizer_command_transcript',
        locator: {
          repositoryUrl: sourceRepositoryUrl,
          baseCommitSha: baseCommitSha.toLowerCase(),
          commitSha,
          commandSource: 'agent_bridge_workspace_finalize',
        },
        exactText: finalizerCommandEvidenceText,
        contentHash: sha256ContentHash(finalizerCommandEvidenceText),
        metadata: {
          source: 'agent_bridge_workspace_finalize',
          scope: 'finalizer_commands_only',
        },
      },
      verificationSourceRef,
    ],
  };
}

async function submitWorkspaceCommitSubmission(payload) {
  const endpoint = roomCommitSubmissionUrl();
  if (!endpoint) {
    throw new Error('PIPE_API_URL and ROOM_TOKEN must be configured before submitting assessment evidence.');
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  if (!response.ok) {
    const detail = typeof body === 'string' ? body : JSON.stringify(body);
    throw new Error(`PIPE commit submission failed (${response.status}): ${detail}`);
  }
  return body;
}

async function captureWorkspaceFileChangeEvidence(change) {
  const endpoint = roomSessionEventsUrl();
  if (!endpoint) return false;
  const eventType = change.action === 'deleted' ? 'file_change' : 'code_editor_save';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: eventType,
        text: change.path,
        actor: 'system',
        properties: {
          source: 'code_server_workspace',
          observedBy: 'agent_bridge',
          bridgeEventType: 'FILE_CHANGED',
          editorSurface: 'code-server',
          workspaceRoot: WORKSPACE,
          path: change.path,
          action: change.action,
          observedAt: change.observedAt,
          contentHash: change.contentHash ?? null,
          sizeBytes: change.sizeBytes ?? null,
          contentPreview: change.contentPreview ?? null,
          bridgePersisted: true,
        },
      }),
    });
    return response.ok;
  } catch (error) {
    console.error('[agent-bridge] workspace file evidence capture failed:', error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function postSessionEventEvidence(event, logLabel) {
  const endpoint = roomSessionEventsUrl();
  if (!event) return false;
  if (!endpoint) return false;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
    });
    if (!response.ok) {
      console.error(`[agent-bridge] ${logLabel} evidence capture failed: ${response.status} ${response.statusText}`);
    }
    return response.ok;
  } catch (error) {
    console.error(`[agent-bridge] ${logLabel} evidence capture failed:`, error instanceof Error ? error.message : String(error));
    return false;
  }
}

async function captureAgentDiagnosticEvidence(message) {
  return postSessionEventEvidence(agentDiagnosticSessionEvent(message), 'agent diagnostic');
}

async function captureAgentChatEvidence(message) {
  return postSessionEventEvidence(agentChatSessionEvent(message), 'agent chat');
}

async function captureAgentRoomActionEvidence(action, observedAt) {
  return postSessionEventEvidence(
    agentRoomActionSessionEvent({ agent: AGENT_NAME, action, observedAt }),
    'agent room action',
  );
}

function broadcastAgentDiagnostic(message) {
  if (!message) return;
  void captureAgentDiagnosticEvidence(message)
    .then((persisted) => {
      broadcast({ ...message, persisted });
    });
}

function sendAgentDiagnostic(ws, message) {
  if (!message) return;
  void captureAgentDiagnosticEvidence(message)
    .then((persisted) => {
      send(ws, { ...message, persisted });
    });
}

function broadcastAgentChat(message, bridgeMessageSource = 'agent_stdout') {
  if (!message) return;
  const safeMessage = {
    ...message,
    text: redactDiagnosticText(message.text),
    bridgeMessageSource,
  };
  void captureAgentChatEvidence(safeMessage)
    .then((persisted) => {
      broadcast({ type: 'CHAT_RESPONSE', source: bridgeMessageSource, ...safeMessage, persisted });
    });
}

function promptRefFromMessage(message) {
  if (!message || typeof message !== 'object') return {};
  return {
    browserPromptId: message.browserPromptId,
    browserPromptFingerprint: message.browserPromptFingerprint,
    browserPromptTimestamp: message.browserPromptTimestamp,
    browserPromptLength: message.browserPromptLength,
  };
}

function hasPromptRef(promptRef) {
  return Boolean(promptRef)
    && (
      typeof promptRef.browserPromptId === 'string'
      || typeof promptRef.browserPromptFingerprint === 'string'
      || Number.isFinite(promptRef.browserPromptTimestamp)
      || Number.isFinite(promptRef.browserPromptLength)
    );
}

function enqueuePromptRefForNextAgentResponse(promptRef) {
  if (!hasPromptRef(promptRef)) return;
  pendingAgentChatPromptRefs.push(promptRef);
}

function takePromptRefForAgentResponse() {
  return pendingAgentChatPromptRefs.shift() || {};
}

function clearPendingPromptRefs() {
  pendingAgentChatPromptRefs.splice(0, pendingAgentChatPromptRefs.length);
}

function broadcastAgentRoomAction(action, observedAt) {
  if (!action) return;
  const safeAction = {
    ...action,
    ...(typeof action.label === 'string' ? { label: redactDiagnosticText(action.label) } : {}),
    ...(typeof action.text === 'string' ? { text: redactDiagnosticText(action.text) } : {}),
    ...(typeof action.url === 'string' ? { url: redactDiagnosticText(action.url) } : {}),
    ...(typeof action.href === 'string' ? { href: redactDiagnosticText(action.href) } : {}),
  };
  void captureAgentRoomActionEvidence(safeAction, observedAt)
    .then((persisted) => {
      broadcast({ type: 'ROOM_ACTION', ...safeAction, observedAt, persisted });
    });
}

function workspaceEventPayload(action, fact, observedAt, persisted) {
  return {
    type: 'FILE_CHANGED',
    source: 'code_server_workspace',
    path: fact.path,
    action,
    observedAt,
    sizeBytes: fact.sizeBytes,
    contentHash: fact.contentHash || undefined,
    contentPreview: fact.contentPreview || undefined,
    persisted,
  };
}

function normalizeWorkspacePath(value) {
  return String(value || '').split(path.sep).join('/');
}

function relativeWorkspacePath(absolutePath) {
  const relativePath = path.relative(WORKSPACE, absolutePath);
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  return normalizeWorkspacePath(relativePath);
}

function shouldIgnoreWorkspacePath(relativePath) {
  return normalizeWorkspacePath(relativePath)
    .split('/')
    .some((segment) => WORKSPACE_IGNORED_DIRS.has(segment));
}

async function walkWorkspaceFiles(directory, files) {
  if (files.length >= WORKSPACE_MAX_SCAN_FILES) return;
  let dir;
  try {
    dir = await fs.promises.opendir(directory);
  } catch {
    return;
  }

  const entries = [];
  for await (const entry of dir) entries.push(entry);
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    if (files.length >= WORKSPACE_MAX_SCAN_FILES) return;
    const absolutePath = path.join(directory, entry.name);
    const relativePath = relativeWorkspacePath(absolutePath);
    if (!relativePath || shouldIgnoreWorkspacePath(relativePath)) continue;
    if (entry.isDirectory()) {
      await walkWorkspaceFiles(absolutePath, files);
    } else if (entry.isFile()) {
      files.push({ absolutePath, relativePath });
    }
  }
}

function looksLikeText(buffer) {
  if (buffer.length === 0) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, WORKSPACE_PREVIEW_BYTES || 512));
  if (sample.includes(0)) return false;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte < 7 || (byte > 14 && byte < 32)) suspicious += 1;
  }
  return suspicious / sample.length < 0.05;
}

function boundedTextPreview(buffer) {
  if (WORKSPACE_PREVIEW_BYTES <= 0 || !looksLikeText(buffer)) return null;
  return buffer.subarray(0, WORKSPACE_PREVIEW_BYTES).toString('utf8');
}

function hashWorkspaceFile(absolutePath) {
  return new Promise((resolve) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(absolutePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', () => resolve(null));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function readWorkspaceFileFact(file) {
  const stat = await fs.promises.stat(file.absolutePath).catch(() => null);
  if (!stat || !stat.isFile()) return null;

  let contentHash = null;
  let contentPreview = null;
  if (stat.size <= WORKSPACE_MAX_HASH_BYTES) {
    const buffer = await fs.promises.readFile(file.absolutePath).catch(() => null);
    if (buffer) {
      contentHash = crypto.createHash('sha256').update(buffer).digest('hex');
      contentPreview = boundedTextPreview(buffer);
    }
  } else {
    contentHash = await hashWorkspaceFile(file.absolutePath);
  }

  return {
    path: file.relativePath,
    sizeBytes: stat.size,
    mtimeMs: Math.floor(stat.mtimeMs),
    contentHash,
    contentPreview,
    fingerprint: contentHash || `${stat.size}:${Math.floor(stat.mtimeMs)}`,
  };
}

async function scanWorkspaceSnapshot() {
  const files = [];
  await walkWorkspaceFiles(WORKSPACE, files);

  const snapshot = new Map();
  for (const file of files) {
    const fact = await readWorkspaceFileFact(file);
    if (fact) snapshot.set(fact.path, fact);
  }
  return snapshot;
}

function workspaceFileChanged(previous, next) {
  return previous.fingerprint !== next.fingerprint
    || previous.sizeBytes !== next.sizeBytes
    || previous.contentHash !== next.contentHash;
}

async function emitWorkspaceFileChange(action, fact) {
  const observedAt = new Date().toISOString();
  const change = {
    action,
    path: fact.path,
    observedAt,
    sizeBytes: fact.sizeBytes,
    contentHash: fact.contentHash,
    contentPreview: fact.contentPreview,
  };
  const persisted = await captureWorkspaceFileChangeEvidence(change);
  broadcast(workspaceEventPayload(action, fact, observedAt, persisted));
}

async function pollWorkspaceChanges() {
  if (workspaceScanInFlight) return;
  workspaceScanInFlight = true;
  try {
    const nextSnapshot = await scanWorkspaceSnapshot();
    if (workspaceBaselineReady) {
      for (const [filePath, fact] of nextSnapshot.entries()) {
        const previous = workspaceSnapshot.get(filePath);
        if (!previous) {
          await emitWorkspaceFileChange('created', fact);
        } else if (workspaceFileChanged(previous, fact)) {
          await emitWorkspaceFileChange('modified', fact);
        }
      }
      for (const [filePath, previous] of workspaceSnapshot.entries()) {
        if (!nextSnapshot.has(filePath)) {
          await emitWorkspaceFileChange('deleted', previous);
        }
      }
    }
    workspaceSnapshot = nextSnapshot;
    workspaceBaselineReady = true;
  } catch (error) {
    console.error('[agent-bridge] workspace scan failed:', error instanceof Error ? error.message : String(error));
  } finally {
    workspaceScanInFlight = false;
  }
}

function startWorkspaceWatcher() {
  if (workspaceWatcherTimer) return;
  void pollWorkspaceChanges();
  workspaceWatcherTimer = setInterval(() => {
    void pollWorkspaceChanges();
  }, WORKSPACE_SCAN_INTERVAL_MS);
}

function devinAuthNeededMessage(message = lastAuthMessage) {
  if (!AGENT_NAME) return null;
  return {
    type: 'AUTH_NEEDED',
    authUrl: null,
    agent: AGENT_NAME,
    message: message || DEVIN_AUTH_MESSAGE,
  };
}

function devinAuthDiagnosticMessage() {
  return agentDiagnosticMessage({
    agent: AGENT_NAME,
    status: 'auth_needed',
    message: lastAuthMessage || DEVIN_AUTH_MESSAGE,
    diagnosticSource: lastAuthDiagnosticSource || 'auth_required',
  });
}

function clearAgentStartReadyTimer() {
  if (!agentStartReadyTimer) return;
  clearTimeout(agentStartReadyTimer);
  agentStartReadyTimer = null;
}

function clearAgentPrimerReadyTimer() {
  if (!agentPrimerReadyTimer) return;
  clearTimeout(agentPrimerReadyTimer);
  agentPrimerReadyTimer = null;
}

function clearAgentStartupTimers() {
  clearAgentStartReadyTimer();
  clearAgentPrimerReadyTimer();
}

function broadcastAgentReady() {
  if (!AGENT_NAME) return;
  broadcast({ type: 'AGENT_READY', agent: AGENT_NAME, capabilities: ['read', 'write', 'run', 'browse'] });
}

function agentStatusMessage() {
  if (!AGENT_NAME) return null;
  return { type: 'AGENT_STATUS', agent: AGENT_NAME, status: agentStatus };
}

function broadcastAgentStatus() {
  broadcast(agentStatusMessage());
}

function sendAgentStatus(ws) {
  send(ws, agentStatusMessage());
}

function markAgentReady() {
  if (agentReady) return;
  clearAgentStartupTimers();
  agentReady = true;
  agentStatus = 'idle';
  broadcastAgentStatus();
  broadcastAgentReady();
}

function markAgentDisconnected(message, diagnosticSource, processToStop = agentProcess) {
  clearAgentStartupTimers();
  clearPendingPromptRefs();
  if (agentRuntime === 'api') clearDevinApiSession();
  agentRuntime = 'none';
  agentReady = false;
  agentStatus = 'disconnected';
  broadcastAgentStatus();
  broadcastAgentDiagnostic(agentDiagnosticMessage({
    agent: AGENT_NAME,
    status: 'disconnected',
    message,
    diagnosticSource,
  }));
  if (processToStop && agentProcess === processToStop) {
    agentProcess = null;
    processToStop.kill('SIGTERM');
  }
}

function scheduleAgentStartReadyTimeout(targetProcess) {
  clearAgentStartReadyTimer();
  agentStartReadyTimer = setTimeout(() => {
    if (agentProcess !== targetProcess || agentReady || agentStatus !== 'starting') return;
    markAgentDisconnected(
      'Devin process did not produce a readiness response after context-primer handoff.',
      'agent_start_timeout',
      targetProcess,
    );
  }, AGENT_START_READY_TIMEOUT_MS);
}

function scheduleAgentPrimerReady(targetProcess) {
  clearAgentPrimerReadyTimer();
  agentPrimerReadyTimer = setTimeout(() => {
    agentPrimerReadyTimer = null;
    if (agentProcess !== targetProcess || agentReady || agentStatus !== 'starting') return;
    markAgentReady();
  }, AGENT_READY_AFTER_PRIMER_MS);
}

function markAgentAuthNeeded(message, diagnosticSource = 'auth_required') {
  clearAgentStartupTimers();
  if (agentRuntime === 'api') clearDevinApiSession();
  agentRuntime = 'none';
  lastAuthMessage = message || DEVIN_AUTH_MESSAGE;
  lastAuthDiagnosticSource = diagnosticSource;
  agentReady = false;
  agentStatus = 'auth_needed';
  broadcastAgentStatus();
  broadcast(devinAuthNeededMessage(lastAuthMessage));
  broadcastAgentDiagnostic(agentDiagnosticMessage({
    agent: AGENT_NAME,
    status: 'auth_needed',
    message: lastAuthMessage,
    diagnosticSource,
  }));
  if (agentProcess) {
    const processToStop = agentProcess;
    agentProcess = null;
    clearPendingPromptRefs();
    processToStop.kill('SIGTERM');
  }
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

function compactAgentContext(value, maxLength = AGENT_CONTEXT_MAX_LENGTH) {
  const text = String(value || '').trim();
  if (!text) return 'No PIPE room context has been captured yet.';
  if (!Number.isFinite(maxLength) || maxLength <= 0 || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}\n[PIPE room context truncated]`;
}

function roomActionProtocolGuide() {
  return Object.entries(ROOM_ACTIONS)
    .map(([id, config]) => `- ${id}: ${config.label}`)
    .join('\n');
}

function buildAgentContextPrompt(roomContext, userMessage = '') {
  const parts = [
    'PIPE room context',
    'You are Devin running as Clippy inside a PIPE-OS "95 Until Infinity" technical interview dev container.',
    'Use the source-backed room context below to help the candidate without inventing facts.',
    'When you want the shared interview desktop to do something, include one allow-listed tag in your response.',
    'Example: [[room_action:open-workspace|Open VS Code]]',
    'Allowed shared desktop actions:',
    roomActionProtocolGuide(),
    'Current source-backed room context:',
    compactAgentContext(roomContext),
  ];
  const message = String(userMessage || '').trim();
  if (message) {
    parts.push('Current Clippy chat message:', message);
  }
  return `${parts.join('\n')}\n`;
}

function clearDevinApiSession() {
  devinApiSession = null;
  devinApiSeenMessageIds.clear();
}

function devinApiHeaders() {
  return {
    Authorization: `Bearer ${DEVIN_API_KEY}`,
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
}

function devinApiUrl(pathname, params = {}) {
  const url = new URL(`${DEVIN_API_BASE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === '') continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

async function devinApiRequest(pathname, {
  method = 'GET',
  body = undefined,
  params = {},
  timeoutMs = 15000,
} = {}) {
  if (!DEVIN_API_KEY) {
    throw new Error('DEVIN_API_KEY is not configured.');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(devinApiUrl(pathname, params), {
      method,
      headers: devinApiHeaders(),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    const parsed = text ? JSON.parse(text) : null;
    if (!response.ok) {
      const detail = parsed && typeof parsed === 'object'
        ? JSON.stringify(parsed).slice(0, 500)
        : text.slice(0, 500);
      throw new Error(`Devin API ${method} ${pathname} failed with ${response.status}: ${redactDiagnosticText(detail)}`);
    }
    return parsed;
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new Error(`Devin API ${method} ${pathname} timed out after ${timeoutMs}ms.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function stringField(value, names) {
  if (!value || typeof value !== 'object') return null;
  for (const name of names) {
    const candidate = value[name];
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return null;
}

async function resolveDevinOrgId() {
  if (DEVIN_ORG_ID) return DEVIN_ORG_ID;
  const self = await devinApiRequest('/self', { timeoutMs: 10000 });
  const orgId = stringField(self, ['org_id', 'organization_id', 'orgId', 'organizationId']);
  if (!orgId) {
    throw new Error('Devin API /self did not return an organization id for this service token.');
  }
  return orgId;
}

function devinApiSessionId(value) {
  return stringField(value, ['session_id', 'id', 'devin_id', 'devinId']);
}

function devinApiAgentRunReference(session = devinApiSession) {
  if (!session || !session.orgId || !session.sessionId) return {};
  const sessionHash = crypto
    .createHash('sha256')
    .update(`${session.orgId}:${session.sessionId}`)
    .digest('hex');
  return {
    agentRuntime: 'api',
    agentRunProvider: 'devin_api',
    agentRunId: `devin-api:${sessionHash.slice(0, 32)}`,
    agentRunExternalSessionHash: `sha256:${sessionHash}`,
  };
}

function devinApiMessagesFromResponse(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['messages', 'items', 'data', 'results']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function devinApiMessageId(value) {
  return stringField(value, ['event_id', 'id', 'message_id', 'messageId'])
    || `message:${crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
}

function devinApiMessageText(value) {
  if (typeof value === 'string') return value.trim();
  if (!value || typeof value !== 'object') return null;
  const direct = stringField(value, ['message', 'text', 'content']);
  if (direct) return direct;
  const nested = value.message || value.content;
  if (nested && typeof nested === 'object') {
    return stringField(nested, ['text', 'content', 'message']);
  }
  return null;
}

function devinApiMessageAuthor(value) {
  if (!value || typeof value !== 'object') return null;
  return stringField(value, ['role', 'source', 'sender', 'author', 'from', 'speaker']);
}

function isUserAuthoredDevinApiMessage(value) {
  const author = devinApiMessageAuthor(value);
  if (!author) return false;
  return ['user', 'human', 'client', 'customer', 'requester'].includes(author.toLowerCase());
}

function isAgentAuthoredDevinApiMessage(value) {
  const author = devinApiMessageAuthor(value);
  if (!author) return false;
  return ['devin', 'assistant', 'agent', 'ai', 'system'].includes(author.toLowerCase());
}

async function listDevinApiMessages() {
  if (!devinApiSession) return [];
  const response = await devinApiRequest(
    `/organizations/${encodeURIComponent(devinApiSession.orgId)}/sessions/${encodeURIComponent(devinApiSession.sessionId)}/messages`,
    {
      params: { limit: 100 },
      timeoutMs: 15000,
    },
  );
  return devinApiMessagesFromResponse(response);
}

async function seedDevinApiSeenMessages() {
  const messages = await listDevinApiMessages().catch((error) => {
    const agentRunRef = devinApiAgentRunReference();
    broadcastAgentDiagnostic(agentDiagnosticMessage({
      agent: AGENT_NAME,
      status: agentStatus,
      message: `Devin API session message seed failed: ${error instanceof Error ? error.message : String(error)}`,
      diagnosticSource: 'devin_api_messages_seed_failed',
      ...agentRunRef,
    }));
    return [];
  });
  for (const message of messages) {
    devinApiSeenMessageIds.add(devinApiMessageId(message));
  }
}

function shouldAcceptDevinApiMessage(message, sentPrompt) {
  const text = devinApiMessageText(message);
  if (!text) return false;
  const trimmedPrompt = String(sentPrompt || '').trim();
  if (trimmedPrompt && text.trim() === trimmedPrompt) return false;
  if (text.includes('PIPE room context') || text.includes('Current Clippy chat message:')) return false;
  if (isUserAuthoredDevinApiMessage(message)) return false;
  return isAgentAuthoredDevinApiMessage(message) || !devinApiMessageAuthor(message);
}

async function pollDevinApiForResponse(sentPrompt, browserPromptRef) {
  if (!devinApiSession) return false;
  const deadline = Date.now() + DEVIN_API_RESPONSE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const messages = await listDevinApiMessages();
    const accepted = [];
    for (const message of messages) {
      const id = devinApiMessageId(message);
      if (devinApiSeenMessageIds.has(id)) continue;
      devinApiSeenMessageIds.add(id);
      if (shouldAcceptDevinApiMessage(message, sentPrompt)) accepted.push(message);
    }
    if (accepted.length > 0) {
      for (const message of accepted) {
        const rawText = devinApiMessageText(message);
        if (!rawText) continue;
        const parsed = extractTaggedRoomActions(rawText, 'agent_api_response');
        const observedAt = new Date().toISOString();
        const agentRunRef = devinApiAgentRunReference();
        const responsePromptRef = parsed.text || parsed.actions.length > 0
          ? takePromptRefForAgentResponse()
          : {};
        if (parsed.text) {
          broadcastAgentChat({
            agent: AGENT_NAME,
            text: parsed.text,
            observedAt,
            actionCount: parsed.actions.length,
            ...agentRunRef,
            ...responsePromptRef,
          }, 'agent_api_response');
        }
        for (const action of parsed.actions) {
          broadcastAgentRoomAction({ ...action, ...agentRunRef, ...responsePromptRef }, observedAt);
        }
      }
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, DEVIN_API_POLL_INTERVAL_MS));
  }
  broadcastAgentDiagnostic(agentDiagnosticMessage({
    agent: AGENT_NAME,
    status: 'idle',
    message: `Devin API accepted the Clippy message but did not return a new assistant message within ${DEVIN_API_RESPONSE_TIMEOUT_MS}ms.`,
    diagnosticSource: 'devin_api_response_timeout',
    ...devinApiAgentRunReference(),
  }));
  return false;
}

async function startDevinApiAgent() {
  if (!DEVIN_API_KEY) return false;

  agentRuntime = 'api';
  agentReady = false;
  agentStatus = 'starting';
  broadcastAgentStatus();

  try {
    const orgId = await resolveDevinOrgId();
    const context = await fetchRoomContextSummary();
    const prompt = `${buildAgentContextPrompt(context.text)}Do not begin work yet. Wait for explicit Clippy chat messages before taking action.\n`;
    const response = await devinApiRequest(
      `/organizations/${encodeURIComponent(orgId)}/sessions`,
      {
        method: 'POST',
        body: {
          prompt,
          tags: ['pipe-os', '95-until-infinity', 'clippy'],
        },
        timeoutMs: 30000,
      },
    );
    const sessionId = devinApiSessionId(response);
    if (!sessionId) {
      throw new Error('Devin API session create response did not include a session id.');
    }
    devinApiSession = { orgId, sessionId };
    const agentRunRef = devinApiAgentRunReference();
    await seedDevinApiSeenMessages();
    agentAuthed = true;
    broadcastAgentDiagnostic(agentPromptHandoffDiagnosticMessage({
      agent: AGENT_NAME,
      status: agentStatus,
      promptType: 'context_primer',
      deliveryTarget: 'devin_api_session',
      deliveredToAgent: true,
      roomContextStatus: context.status,
      roomContextText: compactAgentContext(context.text),
      promptText: prompt,
      ...agentRunRef,
    }));
    broadcastAgentDiagnostic(agentDiagnosticMessage({
      agent: AGENT_NAME,
      status: 'idle',
      message: 'Devin API session created and ready for Clippy chat.',
      diagnosticSource: 'devin_api_session_ready',
      ...agentRunRef,
    }));
    markAgentReady();
    return true;
  } catch (error) {
    clearDevinApiSession();
    agentRuntime = 'none';
    agentAuthed = false;
    agentReady = false;
    agentStatus = 'disconnected';
    broadcastAgentStatus();
    broadcastAgentDiagnostic(agentDiagnosticMessage({
      agent: AGENT_NAME,
      status: 'disconnected',
      message: `Devin API bridge could not start: ${error instanceof Error ? error.message : String(error)}`,
      diagnosticSource: 'devin_api_start_failed',
    }));
    return false;
  }
}

function writeToCurrentAgentProcess(targetProcess, prompt) {
  if (!agentProcess || targetProcess !== agentProcess) return false;
  if (!agentProcess.stdin || agentProcess.stdin.destroyed || agentProcess.stdin.writableEnded) return false;
  agentProcess.stdin.write(`${prompt}\n`);
  return true;
}

async function primeAgentWithRoomContext(targetProcess = agentProcess) {
  if (!targetProcess) return false;
  const context = await fetchRoomContextSummary();
  const roomContextText = compactAgentContext(context.text);
  const prompt = buildAgentContextPrompt(context.text);
  const deliveredToAgent = writeToCurrentAgentProcess(targetProcess, prompt);
  broadcastAgentDiagnostic(agentPromptHandoffDiagnosticMessage({
    agent: AGENT_NAME,
    status: agentStatus,
    promptType: 'context_primer',
    deliveredToAgent,
    roomContextStatus: context.status,
    roomContextText,
    promptText: prompt,
  }));
  return deliveredToAgent;
}

async function writeAgentChatPrompt(text, browserPromptRef = {}) {
  if (agentRuntime === 'api' && devinApiSession) {
    const context = await fetchRoomContextSummary();
    const roomContextText = compactAgentContext(context.text);
    const prompt = buildAgentContextPrompt(context.text, text);
    const agentRunRef = devinApiAgentRunReference();
    agentStatus = 'thinking';
    broadcastAgentStatus();
    try {
      await devinApiRequest(
        `/organizations/${encodeURIComponent(devinApiSession.orgId)}/sessions/${encodeURIComponent(devinApiSession.sessionId)}/messages`,
        {
          method: 'POST',
          body: { message: prompt },
          timeoutMs: 15000,
        },
      );
      enqueuePromptRefForNextAgentResponse(browserPromptRef);
      broadcastAgentDiagnostic(agentPromptHandoffDiagnosticMessage({
        agent: AGENT_NAME,
        status: agentStatus,
        promptType: 'chat_prompt',
        deliveryTarget: 'devin_api_session',
        deliveredToAgent: true,
        roomContextStatus: context.status,
        roomContextText,
        promptText: prompt,
        userMessage: text,
        browserPromptId: browserPromptRef.browserPromptId,
        browserPromptFingerprint: browserPromptRef.browserPromptFingerprint,
        browserPromptTimestamp: browserPromptRef.browserPromptTimestamp,
        browserPromptLength: browserPromptRef.browserPromptLength,
        ...agentRunRef,
      }));
      agentStatus = 'working';
      broadcastAgentStatus();
      const responded = await pollDevinApiForResponse(prompt, browserPromptRef);
      agentStatus = 'idle';
      broadcastAgentStatus();
      return responded;
    } catch (error) {
      agentStatus = 'idle';
      broadcastAgentStatus();
      broadcastAgentDiagnostic(agentDiagnosticMessage({
        agent: AGENT_NAME,
        status: 'idle',
        message: `Devin API chat delivery failed: ${error instanceof Error ? error.message : String(error)}`,
        diagnosticSource: 'devin_api_chat_failed',
        ...agentRunRef,
      }));
      return false;
    }
  }

  const targetProcess = agentProcess;
  if (!targetProcess) return false;
  const context = await fetchRoomContextSummary();
  const roomContextText = compactAgentContext(context.text);
  const prompt = buildAgentContextPrompt(context.text, text);
  const deliveredToAgent = writeToCurrentAgentProcess(targetProcess, prompt);
  if (deliveredToAgent) enqueuePromptRefForNextAgentResponse(browserPromptRef);
  broadcastAgentDiagnostic(agentPromptHandoffDiagnosticMessage({
    agent: AGENT_NAME,
    status: agentStatus,
    promptType: 'chat_prompt',
    deliveredToAgent,
    roomContextStatus: context.status,
    roomContextText,
    promptText: prompt,
    userMessage: text,
    browserPromptId: browserPromptRef.browserPromptId,
    browserPromptFingerprint: browserPromptRef.browserPromptFingerprint,
    browserPromptTimestamp: browserPromptRef.browserPromptTimestamp,
    browserPromptLength: browserPromptRef.browserPromptLength,
  }));
  return deliveredToAgent;
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

function isExecutable(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function executableFromPath(command) {
  const pathValue = process.env.PATH || '';
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) continue;
    const candidate = path.join(directory, command);
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function devinCommand() {
  const candidates = [
    '/root/.local/bin/devin',
    '/usr/local/bin/devin',
    '/usr/bin/devin',
  ];
  return candidates.find(isExecutable) || executableFromPath('devin');
}

function summarizeDevinAuthStatusOutput(value) {
  const text = String(value || '').trim();
  if (!text) return DEVIN_AUTH_MESSAGE;
  return text.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 3).join(' ');
}

function checkDevinCliAuth(command) {
  if (!command) {
    return {
      ok: false,
      message: 'Devin CLI executable was not found in the container image. Install the real Devin CLI before enabling Clippy chat.',
      diagnosticSource: 'agent_cli_missing',
    };
  }
  const result = spawnSync(command, ['auth', 'status'], {
    cwd: WORKSPACE,
    env: process.env,
    encoding: 'utf8',
    timeout: 5000,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();
  if (result.error) {
    return {
      ok: false,
      message: `Devin auth status check failed: ${result.error.message}`,
      diagnosticSource: 'devin_auth_status_error',
    };
  }
  const normalized = output.toLowerCase();
  if (normalized.includes('not logged in') || normalized.includes('run `devin auth login`')) {
    return {
      ok: false,
      message: `${summarizeDevinAuthStatusOutput(output)} Use the container terminal to run \`devin auth login --force-manual-token-flow\`, or bake verified Devin CLI credentials into the container.`,
      diagnosticSource: 'devin_auth_status_not_logged_in',
    };
  }
  if (normalized.includes('logged in')) {
    return {
      ok: true,
      message: 'Devin CLI auth status confirmed a stored login.',
      diagnosticSource: 'devin_auth_status_logged_in',
    };
  }
  return {
    ok: false,
    message: `Devin auth status was inconclusive: ${summarizeDevinAuthStatusOutput(output)}`,
    diagnosticSource: 'devin_auth_status_unknown',
  };
}

async function startAgent() {
  if (agentProcess || devinApiSession || agentReady) return;
  if (!AGENT_NAME) {
    agentReady = false;
    agentStatus = 'disconnected';
    broadcastAgentStatus();
    return;
  }

  try {
    if (DEVIN_API_KEY) {
      const startedApiAgent = await startDevinApiAgent();
      if (startedApiAgent) return;
    }

    const command = devinCommand();
    const authStatus = checkDevinCliAuth(command);
    agentAuthed = authStatus.ok;
    if (!authStatus.ok) {
      if (authStatus.diagnosticSource === 'agent_cli_missing') {
        markAgentDisconnected(authStatus.message, authStatus.diagnosticSource, null);
        return;
      }
      markAgentAuthNeeded(authStatus.message, authStatus.diagnosticSource);
      return;
    }
    if (!command) {
      markAgentDisconnected(
        'Devin CLI executable was not found in the container image. Install the real Devin CLI before enabling Clippy chat.',
        'agent_cli_missing',
        null,
      );
      return;
    }
    const env = { ...process.env };
    agentRuntime = 'cli';
    agentReady = false;
    agentStatus = 'starting';
    broadcastAgentStatus();
    agentProcess = spawn(command, [], { cwd: WORKSPACE, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const startedProcess = agentProcess;
    scheduleAgentStartReadyTimeout(startedProcess);
    void primeAgentWithRoomContext(startedProcess)
      .then((delivered) => {
        if (agentProcess !== startedProcess) return;
        if (!delivered) {
          markAgentDisconnected(
            'Devin process started but did not accept the room-context primer.',
            'context_primer_not_delivered',
            startedProcess,
          );
          return;
        }
        scheduleAgentPrimerReady(startedProcess);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error('[agent-bridge] room context primer failed:', message);
        if (agentProcess !== startedProcess) return;
        markAgentDisconnected(
          `Room context primer failed: ${message}`,
          'context_primer_error',
          startedProcess,
        );
      });
    agentProcess.stdout.on('data', (chunk) => {
      const rawText = chunk.toString();
      if (isAgentAuthFailureText(rawText)) {
        markAgentAuthNeeded(rawText, 'agent_stdout_auth_required');
        return;
      }
      if (!agentReady) {
        if (rawText.trim()) {
          broadcastAgentDiagnostic(agentDiagnosticMessage({
            agent: AGENT_NAME,
            status: agentStatus,
            message: rawText,
            diagnosticSource: 'agent_stdout_startup',
          }));
        }
        return;
      }
      const parsed = extractTaggedRoomActions(rawText);
      agentStatus = 'working';
      broadcastAgentStatus();
      const observedAt = new Date().toISOString();
      const responsePromptRef = parsed.text || parsed.actions.length > 0
        ? takePromptRefForAgentResponse()
        : {};
      if (parsed.text) {
        broadcastAgentChat({
          agent: AGENT_NAME,
          text: parsed.text,
          observedAt,
          actionCount: parsed.actions.length,
          ...responsePromptRef,
        });
      }
      for (const action of parsed.actions) {
        broadcastAgentRoomAction({ ...action, ...responsePromptRef }, observedAt);
      }
      agentStatus = 'idle';
      broadcastAgentStatus();
    });
    agentProcess.stderr.on('data', (chunk) => {
      const message = chunk.toString().trim();
      if (!message) return;
      console.error('[agent-bridge] devin stderr:', message);
      if (isAgentAuthFailureText(message)) {
        markAgentAuthNeeded(message, 'agent_stderr_auth_required');
        return;
      }
      broadcastAgentDiagnostic(agentDiagnosticMessage({
        agent: AGENT_NAME,
        status: agentStatus,
        message,
        diagnosticSource: 'agent_stderr',
      }));
    });
    agentProcess.on('exit', (code, signal) => {
      if (agentProcess !== startedProcess && agentProcess !== null) return;
      clearAgentStartupTimers();
      const wasAuthNeeded = agentStatus === 'auth_needed';
      agentProcess = null;
      agentRuntime = 'none';
      clearPendingPromptRefs();
      agentReady = false;
      agentStatus = wasAuthNeeded ? 'auth_needed' : 'disconnected';
      broadcastAgentDiagnostic(agentDiagnosticMessage({
        agent: AGENT_NAME,
        status: wasAuthNeeded ? 'auth_needed' : 'disconnected',
        message: `Devin process exited with code ${code === null ? 'null' : code}${signal ? ` and signal ${signal}` : ''}.`,
        diagnosticSource: 'agent_exit',
        exitCode: code,
        signal,
      }));
      broadcastAgentStatus();
    });
    agentProcess.on('error', (error) => {
      if (agentProcess !== startedProcess && agentProcess !== null) return;
      clearAgentStartupTimers();
      agentProcess = null;
      agentRuntime = 'none';
      clearPendingPromptRefs();
      agentReady = false;
      agentStatus = 'disconnected';
      broadcastAgentDiagnostic(agentDiagnosticMessage({
        agent: AGENT_NAME,
        status: 'disconnected',
        message: `Devin CLI failed to start inside the container: ${error instanceof Error ? error.message : String(error)}`,
        diagnosticSource: 'agent_process_error',
      }));
      broadcastAgentStatus();
    });
  } catch (error) {
    clearAgentStartupTimers();
    agentRuntime = 'none';
    agentReady = false;
    agentStatus = 'disconnected';
    broadcastAgentStatus();
    broadcastAgentDiagnostic(agentDiagnosticMessage({
      agent: AGENT_NAME,
      status: 'disconnected',
      message: error instanceof Error ? error.message : String(error),
      diagnosticSource: 'agent_start_exception',
    }));
  }
}

async function handleAgentMessage(ws, msg) {
  if (msg.type === 'CHAT') {
    const text = String(msg.text || '').trim();
    if (!text) return;
    if (!AGENT_NAME) {
      send(ws, { type: 'ERROR', message: AGENT_UNCONFIGURED_MESSAGE });
      return;
    }
    if (!agentProcess && !devinApiSession && !agentReady && agentStatus !== 'auth_needed') await startAgent();
    if (!agentProcess && !devinApiSession && !agentReady && agentStatus === 'disconnected') {
      send(ws, { type: 'ERROR', message: `${AGENT_NAME} is not available. Check bridge diagnostics before sending chat.` });
      return;
    }
    if (agentStatus === 'auth_needed') {
      send(ws, devinAuthNeededMessage());
      sendAgentDiagnostic(ws, devinAuthDiagnosticMessage());
      return;
    }
    if (!agentReady) {
      send(ws, { type: 'ERROR', message: `${AGENT_NAME} is still starting. Wait for the bridge to report ready before sending chat.` });
      return;
    }
    if (!agentProcess && !devinApiSession) {
      send(ws, { type: 'ERROR', message: 'Agent is not running.' });
      return;
    }
    agentStatus = 'thinking';
    broadcastAgentStatus();
    const sent = await writeAgentChatPrompt(text, promptRefFromMessage(msg));
    if (!sent) {
      send(ws, { type: 'ERROR', message: 'Agent is not ready to receive messages.' });
      agentStatus = 'idle';
      broadcastAgentStatus();
    }
  } else if (msg.type === 'AUTH_START') {
    if (!AGENT_NAME) {
      send(ws, { type: 'ERROR', message: AGENT_UNCONFIGURED_MESSAGE });
      return;
    }
    if (agentAuthed) {
      await startAgent();
      return;
    }
    await startAgent();
  } else if (msg.type === 'AGENT_STOP' && (agentProcess || devinApiSession)) {
    clearPendingPromptRefs();
    if (agentProcess) {
      agentProcess.kill('SIGTERM');
      return;
    }
    clearDevinApiSession();
    agentRuntime = 'none';
    agentReady = false;
    agentStatus = 'disconnected';
    broadcastAgentStatus();
  } else if (msg.type === 'GET_STATUS') {
    sendAgentStatus(ws);
  }
}

function acceptAgent(req, socket) {
  const ws = acceptWebSocket(req, socket, (client, opcode, payload) => {
    if (opcode !== 1) return;
    try {
      void handleAgentMessage(client, JSON.parse(payload.toString())).catch((error) => {
        send(client, { type: 'ERROR', message: error instanceof Error ? error.message : 'Agent bridge message failed.' });
      });
    } catch {
      send(client, { type: 'ERROR', message: 'Invalid agent bridge message.' });
    }
  });
  if (!ws) return;
  clients.add(ws);
  sendAgentStatus(ws);
  if (agentReady) {
    send(ws, { type: 'AGENT_READY', agent: AGENT_NAME, capabilities: ['read', 'write', 'run', 'browse'] });
  }
  if (agentStatus === 'auth_needed') {
    send(ws, devinAuthNeededMessage());
    sendAgentDiagnostic(ws, devinAuthDiagnosticMessage());
  }
  if (AGENT_NAME && !agentProcess && !devinApiSession && !agentReady && agentStatus !== 'auth_needed') {
    void startAgent();
  }
}

function terminalInputPayload(opcode, payload) {
  if (opcode === 2) return payload;
  if (opcode !== 1) return null;

  const text = payload.toString('utf8');
  try {
    const message = JSON.parse(text);
    if (!message || typeof message !== 'object') return text;
    if (message.type === 'TERMINAL_INPUT' && typeof message.data === 'string') {
      return message.data.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    }
    if (message.type === 'TERMINAL_RESIZE') return null;
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  } catch {
    return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  }
}

function acceptTerminal(req, socket) {
  const shell = spawn('bash', ['-l'], { cwd: WORKSPACE, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
  const ws = acceptWebSocket(req, socket, (_client, opcode, payload) => {
    const input = terminalInputPayload(opcode, payload);
    if (input !== null) shell.stdin.write(input);
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
    res.end(JSON.stringify({ ok: true, agent: AGENT_NAME, status: agentStatus, ready: agentReady, bridgeRevision: BRIDGE_REVISION }));
    return;
  }
  if (url.pathname === '/start') {
    res.writeHead(501, { 'Content-Type': 'text/html' });
    res.end(html(`<h2>Devin auth is not configured</h2><p>${DEVIN_AUTH_MESSAGE}</p>`));
    return;
  }
  if (url.pathname === '/callback') {
    res.writeHead(404, { 'Content-Type': 'text/html' });
    res.end(html('<h2>Devin auth callback is not available</h2>'));
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
  if (url.pathname === '/assessment/finalize') {
    if (req.method !== 'POST') {
      jsonResponse(res, 405, { ok: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Use POST to finalize assessment evidence.' } });
      return;
    }
    try {
      const body = await readJsonRequestBody(req);
      const payload = await buildWorkspaceCommitSubmission(body);
      const submitted = await submitWorkspaceCommitSubmission(payload);
      jsonResponse(res, 201, {
        ok: true,
        submitted: true,
        commit: {
          repositoryUrl: payload.repositoryUrl,
          branchName: payload.branchName,
          baseCommitSha: payload.baseCommitSha,
          commitSha: payload.commitSha,
          changedFiles: payload.changedFiles,
          sourceRefTypes: payload.sourceRefs.map((ref) => ref.sourceRefType),
        },
        submission: submitted?.submission ?? null,
        progress: submitted?.progress ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Assessment finalize failed.';
      const status = message.includes('PIPE commit submission failed') ? 502 : 409;
      jsonResponse(res, status, {
        ok: false,
        error: {
          code: status === 502 ? 'COMMIT_SUBMISSION_FAILED' : 'ASSESSMENT_FINALIZE_BLOCKED',
          message,
        },
      });
    }
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
  startWorkspaceWatcher();
  console.log(`[agent-bridge] ${AGENT_NAME} bridge listening on ${BRIDGE_PORT}, code-server on ${CODE_SERVER_PORT}`);
});

process.on('SIGTERM', () => {
  if (workspaceWatcherTimer) clearInterval(workspaceWatcherTimer);
  clearPendingPromptRefs();
  if (agentProcess) agentProcess.kill('SIGTERM');
  server.close(() => process.exit(0));
});
