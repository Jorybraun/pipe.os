import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WebSocket from 'ws';

const execFileAsync = promisify(execFile);

const APP_BASE = (process.env.APP_BASE || 'https://app-dev.hire-pipe.com').replace(/\/$/, '');
const ROOM_BASE = (process.env.ROOM_BASE || 'https://room-dev.hire-pipe.com').replace(/\/$/, '');
const APP_BASIC_USER = process.env.PIPE_APP_DEV_BASIC_AUTH_USER
  || process.env.APP_DEV_BASIC_AUTH_USER
  || process.env.PIPE_DEV_BASIC_AUTH_USER
  || process.env.DEV_BASIC_AUTH_USER
  || '';
const APP_BASIC_PASSWORD = process.env.PIPE_APP_DEV_BASIC_AUTH_PASSWORD
  || process.env.APP_DEV_BASIC_AUTH_PASSWORD
  || process.env.PIPE_DEV_BASIC_AUTH_PASSWORD
  || process.env.DEV_BASIC_AUTH_PASSWORD
  || '';
const ROOM_BASIC_USER = process.env.PIPE_ROOM_DEV_BASIC_AUTH_USER
  || process.env.ROOM_DEV_BASIC_AUTH_USER
  || process.env.VIDEO_ROOM_DEV_AUTH_USER
  || '';
const ROOM_BASIC_PASSWORD = process.env.PIPE_ROOM_DEV_BASIC_AUTH_PASSWORD
  || process.env.ROOM_DEV_BASIC_AUTH_PASSWORD
  || process.env.VIDEO_ROOM_DEV_AUTH_PASSWORD
  || '';
const REPO_URL = process.env.WORKSPACE_SMOKE_REPO_URL || 'https://github.com/octocat/Hello-World';
const INTERVIEW_TYPE = process.env.WORKSPACE_SMOKE_INTERVIEW_TYPE || 'DEV_CONTAINER_CHALLENGE';
const RAW_PR_NUMBER = process.env.WORKSPACE_SMOKE_PR_NUMBER || (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX' ? '' : '1');
const PR_NUMBER = RAW_PR_NUMBER ? Number(RAW_PR_NUMBER) : null;
const RAW_MATCHED_REPO_ID = process.env.WORKSPACE_SMOKE_MATCHED_REPO_ID || '';
const MATCHED_REPO_ID = RAW_MATCHED_REPO_ID ? Number(RAW_MATCHED_REPO_ID) : null;
const BASE_COMMIT_SHA = process.env.WORKSPACE_SMOKE_BASE_COMMIT_SHA || '';
const CHANGE_MODE = process.env.WORKSPACE_SMOKE_CHANGE_MODE || 'placeholder';
const EXPECTED_BRIDGE_REVISION = process.env.WORKSPACE_SMOKE_EXPECTED_BRIDGE_REVISION
  || '2026-06-30-finalizer-terminal-v1';
const REMOTE = !APP_BASE.includes('localhost') && !APP_BASE.includes('127.0.0.1');

function assertEnv() {
  if (MATCHED_REPO_ID !== null && (!Number.isInteger(MATCHED_REPO_ID) || MATCHED_REPO_ID <= 0)) {
    throw new Error('WORKSPACE_SMOKE_MATCHED_REPO_ID must be a positive integer when provided.');
  }
  if (MATCHED_REPO_ID !== null && INTERVIEW_TYPE !== 'OPEN_SOURCE_BUG_FIX') {
    throw new Error('WORKSPACE_SMOKE_MATCHED_REPO_ID is only supported for OPEN_SOURCE_BUG_FIX smoke runs.');
  }
  if (!['placeholder', 'mui-popover-fix'].includes(CHANGE_MODE)) {
    throw new Error('WORKSPACE_SMOKE_CHANGE_MODE must be placeholder or mui-popover-fix.');
  }
  if (!REMOTE) return;
  if (!APP_BASIC_USER || !APP_BASIC_PASSWORD) {
    throw new Error(
      'Set PIPE_APP_DEV_BASIC_AUTH_USER/PASSWORD or PIPE_DEV_BASIC_AUTH_USER/PASSWORD to smoke deployed app-dev.',
    );
  }
  if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX' && MATCHED_REPO_ID === null && !/^[a-f0-9]{40}$/i.test(BASE_COMMIT_SHA)) {
    throw new Error(
      'Set WORKSPACE_SMOKE_BASE_COMMIT_SHA to the real 40-character base commit SHA, or set WORKSPACE_SMOKE_MATCHED_REPO_ID for matched OPEN_SOURCE_BUG_FIX smoke runs.',
    );
  }
}

async function git(args, cwd) {
  return execFileAsync('git', args, {
    cwd,
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
}

async function assertReachableBaseCommit(repoUrl, baseCommitSha) {
  if (INTERVIEW_TYPE !== 'OPEN_SOURCE_BUG_FIX') return;
  if (!/^[a-f0-9]{40}$/i.test(baseCommitSha)) {
    throw new Error(`Open-source workspace smoke requires a real 40-character base commit SHA; got ${baseCommitSha || 'empty'}.`);
  }
  const dir = await mkdtemp(join(tmpdir(), 'pipe-workspace-smoke-'));
  try {
    await git(['init', '--quiet'], dir);
    await git(['remote', 'add', 'origin', repoUrl], dir);
    await git(['fetch', '--quiet', '--depth=1', 'origin', baseCommitSha], dir);
    await git(['cat-file', '-e', `${baseCommitSha}^{commit}`], dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Base commit ${baseCommitSha} is not reachable from ${repoUrl}; use a real source-backed commit before launching deployed workspace smoke. ${message}`,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function basicAuthHeaders(user, password) {
  if (!user && !password) return {};
  const value = Buffer.from(`${user}:${password}`).toString('base64');
  return { Authorization: `Basic ${value}` };
}

function authHeadersFor(base) {
  return base === ROOM_BASE
    ? basicAuthHeaders(ROOM_BASIC_USER, ROOM_BASIC_PASSWORD)
    : basicAuthHeaders(APP_BASIC_USER, APP_BASIC_PASSWORD);
}

function authHeadersFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  if (!url.username && !url.password) return {};
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  return basicAuthHeaders(user, password);
}

function mergedRoomAuthHeaders(roomHeaders = {}) {
  return {
    ...authHeadersFor(ROOM_BASE),
    ...roomHeaders,
  };
}

function websocketUrl(base, path) {
  const url = new URL(`${base}${path}`);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

function websocketChunkText(data) {
  if (typeof data === 'string') return data;
  if (Buffer.isBuffer(data)) return data.toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8');
  }
  return String(data);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function waitForWorkspaceTerminalOutput(proxyBasePath, headers, command, expectedText) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(websocketUrl(ROOM_BASE, `${proxyBasePath}/terminal`), {
      headers: mergedRoomAuthHeaders(headers),
    });
    let output = '';
    let opened = false;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error(`Timed out waiting for terminal output "${expectedText}" after opened=${opened}. Saw:\n${output}`));
    }, 120_000);

    ws.on('open', () => {
      opened = true;
      ws.send(JSON.stringify({ type: 'TERMINAL_INPUT', data: `${command}\r` }));
    });
    ws.on('message', (data) => {
      output += websocketChunkText(data);
      if (!output.includes(expectedText)) return;
      clearTimeout(timeout);
      ws.close();
      resolve(output);
    });
    ws.on('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    ws.on('unexpected-response', (_request, response) => {
      clearTimeout(timeout);
      reject(new Error(`Terminal WebSocket upgrade failed with HTTP ${response.statusCode}.`));
    });
    ws.on('close', () => {
      clearTimeout(timeout);
    });
  });
}

async function commitWorkspaceSmokeChange(proxyBasePath, headers, unique) {
  const sentinel = `__PIPE_COMMIT_OK_${unique}__`;
  const common = [
    'set -e',
    'git config user.name "PIPE Workspace Smoke"',
    'git config user.email "workspace-smoke@pipe-test.dev"',
  ];
  const modeSpecific = CHANGE_MODE === 'mui-popover-fix'
    ? [
        'git fetch --quiet origin pull/973/head:pipe-smoke-pr-973',
        'git checkout pipe-smoke-pr-973 -- packages/react/src/popover/root/usePopoverRoot.ts packages/react/src/popover/trigger/PopoverTrigger.test.tsx packages/react/src/popover/utils/constants.ts',
        'git diff --check',
        'git add packages/react/src/popover/root/usePopoverRoot.ts packages/react/src/popover/trigger/PopoverTrigger.test.tsx packages/react/src/popover/utils/constants.ts',
        `git commit -m ${shellQuote('fix popover impatient click handling')}`,
      ]
    : [
        `printf ${shellQuote(`\nPIPE workspace smoke ${unique}\n`)} >> PIPE_WORKSPACE_SMOKE.md`,
        'git add PIPE_WORKSPACE_SMOKE.md',
        `git commit -m ${shellQuote(`pipe workspace smoke ${unique}`)}`,
      ];
  const command = [
    ...common,
    ...modeSpecific,
    `printf ${shellQuote(`${sentinel}%s${sentinel}\\n`)} "$(git rev-parse HEAD)"`,
  ].join(' && ');
  const output = await waitForWorkspaceTerminalOutput(proxyBasePath, headers, command, sentinel);
  const match = output.match(new RegExp(`${sentinel}([a-f0-9]{40})${sentinel}`));
  if (!match) {
    throw new Error(`Terminal command completed without a parseable commit SHA. Saw:\n${output}`);
  }
  return {
    commitSha: match[1],
    mode: CHANGE_MODE,
    narrative: CHANGE_MODE === 'mui-popover-fix'
      ? 'Implemented the source-backed popover impatient-click fix, including the 500ms guard and regression tests for fast versus patient clicks.'
      : `Workspace smoke submitted real commit ${match[1]}.`,
    testCommand: CHANGE_MODE === 'mui-popover-fix'
      ? 'git diff --check HEAD~1 HEAD && git diff --name-only HEAD~1 HEAD'
      : 'git status --short',
    output,
  };
}

async function requestJson(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...authHeadersFor(base),
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
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
    throw new Error(`${init.method ?? 'GET'} ${base}${path} failed (${response.status}): ${text}`);
  }
  return body;
}

function tokenFromRoomUrl(rawUrl) {
  const url = new URL(rawUrl);
  const match = url.pathname.match(/\/room\/([^/]+)/);
  if (!match) throw new Error(`Room URL did not contain a token: ${rawUrl}`);
  return match[1];
}

function cleanRoomUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  return url.toString().replace(/\/room\/.+$/, '/room/<token>');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollWorkspaceReady(token, headers = {}) {
  const deadline = Date.now() + 240_000;
  let last = null;
  while (Date.now() < deadline) {
    const body = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${token}/workspace`, {
      headers,
    });
    last = body.workspace?.session ?? null;
    if (last?.status === 'READY' || last?.status === 'SLEEPING') return last;
    if (last?.status === 'ERROR') break;
    await sleep(5_000);
  }
  throw new Error(`Workspace did not become ready. Last state: ${JSON.stringify(last)}`);
}

async function main() {
  assertEnv();

  const unique = Date.now();
  const recipientEmail = `workspace-smoke-${unique}@pipe-test.dev`;
  const useMatchedRepo = MATCHED_REPO_ID !== null;
  const openSourceTaskFields = INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX' && !useMatchedRepo
    ? {
        challengeBaseCommitSha: BASE_COMMIT_SHA,
        challengeTitle: 'Fix deterministic smoke ordering',
        challengeInstructions: 'Make the smallest production-ready change that preserves source-backed evidence and deterministic execution.',
        challengeSuccessCriteria: [
          'Reproduce the ordering failure before changing code.',
          'Keep the fix scoped to the affected behavior.',
          'Leave a clear verification trail for the reviewer.',
        ],
        challengeExpectedEvidence: [
          'Changed files and commit SHA',
          'Test or command output',
          'Candidate explanation of trade-offs',
        ],
      }
    : {};
  const challengeAssignmentFields = useMatchedRepo
    ? { matchedRepoId: MATCHED_REPO_ID }
    : {
        githubRepoUrl: REPO_URL,
        ...(PR_NUMBER ? { githubPrNumber: PR_NUMBER } : {}),
      };
  const created = await requestJson(APP_BASE, '/api/v1/scheduling/interviews', {
    method: 'POST',
    body: JSON.stringify({
      recipientName: 'Workspace Smoke',
      recipientEmail,
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: INTERVIEW_TYPE,
      ...challengeAssignmentFields,
      ...openSourceTaskFields,
    }),
  });
  const interviewId = created?.interview?.id;
  if (!interviewId) throw new Error(`Create response missing interview id: ${JSON.stringify(created)}`);
  const expectedRepoUrl = useMatchedRepo
    ? created?.interview?.githubRepoUrl
    : REPO_URL;
  const expectedGithubPrNumber = useMatchedRepo
    ? created?.interview?.githubPrNumber ?? null
    : PR_NUMBER;
  const expectedBaseCommitSha = useMatchedRepo
    ? created?.interview?.assessmentProgress?.challenge?.locator?.baseCommitSha ?? ''
    : BASE_COMMIT_SHA;
  if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX') {
    const setup = created?.interview?.assessmentSetup;
    const expectedSetupKind = useMatchedRepo ? 'auto_match' : 'manual_open_source_task';
    if (setup?.kind !== expectedSetupKind || setup?.status !== 'reviewable_task_assigned') {
      throw new Error(`Open-source task setup was not ready: ${JSON.stringify(setup)}`);
    }
    if (!expectedRepoUrl) {
      throw new Error(`Open-source task did not expose a repository URL: ${JSON.stringify(created?.interview)}`);
    }
    if (created?.interview?.assessmentProgress?.challenge?.sourceRefType !== (useMatchedRepo ? 'review_challenge_packet' : 'open_source_challenge_packet')) {
      throw new Error(`Open-source task did not expose the expected challenge source ref: ${JSON.stringify(created?.interview?.assessmentProgress)}`);
    }
    await assertReachableBaseCommit(expectedRepoUrl, expectedBaseCommitSha);
  }

  const invited = await requestJson(APP_BASE, `/api/v1/scheduling/interviews/${interviewId}/invite`, {
    method: 'POST',
    body: JSON.stringify({
      email: recipientEmail,
      message: 'Automated dev smoke for the PIPE live code-review workspace.',
    }),
  });
  const hostToken = tokenFromRoomUrl(invited?.room?.hostUrl ?? '');
  const roomAuthHeaders = authHeadersFromUrl(invited?.room?.hostUrl ?? '');
  const room = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${hostToken}`, {
    headers: roomAuthHeaders,
  });
  const workspace = room?.room?.workspace;
  if (!workspace?.enabled) throw new Error(`Workspace was not enabled: ${JSON.stringify(workspace)}`);
  if (workspace.repoUrl !== expectedRepoUrl) {
    throw new Error(`Workspace repo mismatch: ${JSON.stringify(workspace)}`);
  }
  if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX') {
    const challenge = workspace.challenge;
    if (challenge?.status !== 'repo_task_assigned' || challenge?.source !== 'scheduled_interview.challenge_packet') {
      throw new Error(`Workspace challenge did not expose the repo task packet: ${JSON.stringify(challenge)}`);
    }
    if (challenge?.packet?.locator?.baseCommitSha !== expectedBaseCommitSha) {
      throw new Error(`Workspace packet base commit mismatch: ${JSON.stringify(challenge?.packet)}`);
    }
  }

  const launched = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${hostToken}/workspace/launch`, {
    method: 'POST',
    headers: roomAuthHeaders,
  });
  if (!launched?.workspace?.session?.sessionId) {
    throw new Error(`Launch response missing session: ${JSON.stringify(launched)}`);
  }

  const readySession = await pollWorkspaceReady(hostToken, roomAuthHeaders);
  if (!readySession.proxyPath) {
    throw new Error(`Ready workspace did not expose a proxy path: ${JSON.stringify(readySession)}`);
  }
  const proxyBasePath = readySession.proxyPath.replace(/\/$/, '');
  const bridgeHealth = await requestJson(ROOM_BASE, `${proxyBasePath}/health`, {
    headers: roomAuthHeaders,
  });
  if (bridgeHealth?.ok !== true) {
    throw new Error(`Workspace bridge health check failed: ${JSON.stringify(bridgeHealth)}`);
  }
  if (REMOTE && bridgeHealth.bridgeRevision !== EXPECTED_BRIDGE_REVISION) {
    throw new Error(
      `Workspace bridge image revision mismatch: expected ${EXPECTED_BRIDGE_REVISION}, got ${JSON.stringify(bridgeHealth)}`,
    );
  }
  const finalizeResponse = await fetch(`${ROOM_BASE}${proxyBasePath}/assessment/finalize`, {
    method: 'POST',
    headers: {
      ...mergedRoomAuthHeaders(roomAuthHeaders),
      'Content-Type': 'application/json',
    },
    body: '{}',
  });
  const finalizeText = await finalizeResponse.text();
  let finalizeBody = null;
  if (finalizeText) {
    try {
      finalizeBody = JSON.parse(finalizeText);
    } catch {
      finalizeBody = finalizeText;
    }
  }
  if (
    finalizeResponse.status !== 409
    || finalizeBody?.error?.code !== 'ASSESSMENT_FINALIZE_BLOCKED'
  ) {
    throw new Error(`Workspace finalizer did not honestly block unchanged work: ${JSON.stringify(finalizeBody)}`);
  }

  const workspaceCommit = await commitWorkspaceSmokeChange(proxyBasePath, roomAuthHeaders, unique);
  const submittedResponse = await fetch(`${ROOM_BASE}${proxyBasePath}/assessment/finalize`, {
    method: 'POST',
    headers: {
      ...mergedRoomAuthHeaders(roomAuthHeaders),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      narrative: workspaceCommit.narrative,
      testCommand: workspaceCommit.testCommand,
    }),
  });
  const submittedText = await submittedResponse.text();
  let submittedBody = null;
  if (submittedText) {
    try {
      submittedBody = JSON.parse(submittedText);
    } catch {
      submittedBody = submittedText;
    }
  }
  if (!submittedResponse.ok || submittedBody?.submitted !== true) {
    throw new Error(`Workspace finalizer did not accept committed work: ${JSON.stringify(submittedBody)}`);
  }
  if (submittedBody?.commit?.commitSha !== workspaceCommit.commitSha) {
    throw new Error(`Workspace finalizer submitted the wrong commit: ${JSON.stringify(submittedBody?.commit)}`);
  }
  const sourceRefTypes = submittedBody?.commit?.sourceRefTypes ?? [];
  for (const requiredSourceRefType of ['git_commit', 'code_diff', 'terminal_command', 'test_run']) {
    if (!sourceRefTypes.includes(requiredSourceRefType)) {
      throw new Error(`Workspace finalizer missed ${requiredSourceRefType} evidence: ${JSON.stringify(sourceRefTypes)}`);
    }
  }
  if (submittedBody?.progress?.hasCommitSubmission !== true) {
    throw new Error(`Workspace progress did not reflect the committed submission: ${JSON.stringify(submittedBody?.progress)}`);
  }
  const evaluationBody = await requestJson(APP_BASE, `/api/v1/scheduling/interviews/${interviewId}/assessment/start-evaluation`, {
    method: 'POST',
  });
  const evaluationProgress = evaluationBody?.progress ?? null;
  if (evaluationProgress?.stage !== 'EVALUATED' || evaluationProgress?.nextAction !== 'REVIEW_EVALUATION') {
    throw new Error(`Workspace assessment evaluation did not produce a reviewable report: ${JSON.stringify(evaluationBody)}`);
  }
  if (evaluationBody?.report?.status !== 'EVALUATED' || evaluationBody?.diagnostic !== null) {
    throw new Error(`Workspace assessment evaluation was not a clean source-backed report: ${JSON.stringify(evaluationBody)}`);
  }
  if (evaluationProgress?.evaluation?.status !== 'EVALUATED') {
    throw new Error(`Workspace assessment progress did not expose evaluated status: ${JSON.stringify(evaluationProgress?.evaluation)}`);
  }
  const recommendation = evaluationProgress?.evaluation?.recommendation
    ?? evaluationBody?.report?.output?.recommendation
    ?? null;
  if (CHANGE_MODE === 'mui-popover-fix') {
    const acceptedRecommendations = new Set(['strong_evidence_to_advance', 'mixed_evidence_human_review']);
    const summary = `${evaluationProgress?.evaluation?.summary ?? ''} ${evaluationBody?.report?.summary ?? ''}`.toLowerCase();
    if (!acceptedRecommendations.has(recommendation)) {
      throw new Error(`Task-aligned workspace smoke did not receive a useful evaluator recommendation: ${JSON.stringify(evaluationBody?.report?.output)}`);
    }
    if (!summary.includes('popover') && !summary.includes('click')) {
      throw new Error(`Task-aligned workspace smoke evaluation summary did not mention the challenged behavior: ${summary}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    interviewId,
    hostUrl: cleanRoomUrl(invited.room.hostUrl),
    guestUrl: cleanRoomUrl(invited.room.guestUrl),
    repoUrl: workspace.repoUrl,
    githubPrNumber: expectedGithubPrNumber,
    matchedRepoId: MATCHED_REPO_ID,
    interviewType: INTERVIEW_TYPE,
    challengeStatus: workspace.challenge?.status ?? null,
    challengeSource: workspace.challenge?.source ?? null,
    workspaceStatus: readySession.status,
    proxyPathReady: Boolean(readySession.proxyPath),
    bridgeHealthReady: true,
    bridgeAgent: bridgeHealth.agent || null,
    bridgeRevision: bridgeHealth.bridgeRevision || null,
    finalizerEndpointBlocked: true,
    terminalCommitCreated: true,
    workspaceCommitSha: workspaceCommit.commitSha,
    workspaceChangeMode: workspaceCommit.mode,
    finalizerSubmitted: true,
    finalizerProgressStage: submittedBody.progress?.stage ?? null,
    finalizerNextAction: submittedBody.progress?.nextAction ?? null,
    evaluationStarted: true,
    evaluationStage: evaluationProgress.stage,
    evaluationNextAction: evaluationProgress.nextAction,
    evaluationStatus: evaluationProgress.evaluation?.status ?? null,
    evaluationRecommendation: recommendation,
    evaluationSummary: evaluationProgress.evaluation?.summary ?? null,
    evaluationReportId: evaluationBody.report?.id ?? null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
