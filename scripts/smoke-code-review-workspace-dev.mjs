import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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
const BASE_COMMIT_SHA = process.env.WORKSPACE_SMOKE_BASE_COMMIT_SHA || '';
const REMOTE = !APP_BASE.includes('localhost') && !APP_BASE.includes('127.0.0.1');

function assertEnv() {
  if (!REMOTE) return;
  if (!APP_BASIC_USER || !APP_BASIC_PASSWORD) {
    throw new Error(
      'Set PIPE_APP_DEV_BASIC_AUTH_USER/PASSWORD or PIPE_DEV_BASIC_AUTH_USER/PASSWORD to smoke deployed app-dev.',
    );
  }
  if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX' && !/^[a-f0-9]{40}$/i.test(BASE_COMMIT_SHA)) {
    throw new Error(
      'Set WORKSPACE_SMOKE_BASE_COMMIT_SHA to the real 40-character base commit SHA for OPEN_SOURCE_BUG_FIX smoke runs.',
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

async function assertReachableBaseCommit() {
  if (INTERVIEW_TYPE !== 'OPEN_SOURCE_BUG_FIX') return;
  const dir = await mkdtemp(join(tmpdir(), 'pipe-workspace-smoke-'));
  try {
    await git(['init', '--quiet'], dir);
    await git(['remote', 'add', 'origin', REPO_URL], dir);
    await git(['fetch', '--quiet', '--depth=1', 'origin', BASE_COMMIT_SHA], dir);
    await git(['cat-file', '-e', `${BASE_COMMIT_SHA}^{commit}`], dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Base commit ${BASE_COMMIT_SHA} is not reachable from ${REPO_URL}; use a real source-backed commit before launching deployed workspace smoke. ${message}`,
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
  await assertReachableBaseCommit();

  const unique = Date.now();
  const recipientEmail = `workspace-smoke-${unique}@pipe-test.dev`;
  const openSourceTaskFields = INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX'
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
  const created = await requestJson(APP_BASE, '/api/v1/scheduling/interviews', {
    method: 'POST',
    body: JSON.stringify({
      recipientName: 'Workspace Smoke',
      recipientEmail,
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: INTERVIEW_TYPE,
      githubRepoUrl: REPO_URL,
      ...(PR_NUMBER ? { githubPrNumber: PR_NUMBER } : {}),
      ...openSourceTaskFields,
    }),
  });
  const interviewId = created?.interview?.id;
  if (!interviewId) throw new Error(`Create response missing interview id: ${JSON.stringify(created)}`);
  if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX') {
    const setup = created?.interview?.assessmentSetup;
    if (setup?.kind !== 'manual_open_source_task' || setup?.status !== 'reviewable_task_assigned') {
      throw new Error(`Open-source task setup was not ready: ${JSON.stringify(setup)}`);
    }
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
  if (workspace.repoUrl !== REPO_URL) {
    throw new Error(`Workspace repo mismatch: ${JSON.stringify(workspace)}`);
  }
  if (INTERVIEW_TYPE === 'OPEN_SOURCE_BUG_FIX') {
    const challenge = workspace.challenge;
    if (challenge?.status !== 'repo_task_assigned' || challenge?.source !== 'scheduled_interview.challenge_packet') {
      throw new Error(`Workspace challenge did not expose the repo task packet: ${JSON.stringify(challenge)}`);
    }
    if (challenge?.packet?.locator?.baseCommitSha !== BASE_COMMIT_SHA) {
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
  const finalizeResponse = await fetch(`${ROOM_BASE}${proxyBasePath}/assessment/finalize`, {
    method: 'POST',
    headers: {
      ...authHeadersFor(ROOM_BASE),
      ...roomAuthHeaders,
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

  console.log(JSON.stringify({
    ok: true,
    interviewId,
    hostUrl: cleanRoomUrl(invited.room.hostUrl),
    guestUrl: cleanRoomUrl(invited.room.guestUrl),
    repoUrl: workspace.repoUrl,
    githubPrNumber: PR_NUMBER,
    interviewType: INTERVIEW_TYPE,
    challengeStatus: workspace.challenge?.status ?? null,
    challengeSource: workspace.challenge?.source ?? null,
    workspaceStatus: readySession.status,
    proxyPathReady: Boolean(readySession.proxyPath),
    bridgeHealthReady: true,
    bridgeAgent: bridgeHealth.agent || null,
    finalizerEndpointBlocked: true,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
