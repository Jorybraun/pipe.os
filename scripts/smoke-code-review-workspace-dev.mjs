const APP_BASE = (process.env.APP_BASE || 'https://app-dev.hire-pipe.com').replace(/\/$/, '');
const ROOM_BASE = (process.env.ROOM_BASE || 'https://room-dev.hire-pipe.com').replace(/\/$/, '');
const BASIC_USER = process.env.PIPE_DEV_BASIC_AUTH_USER || process.env.DEV_BASIC_AUTH_USER || '';
const BASIC_PASSWORD = process.env.PIPE_DEV_BASIC_AUTH_PASSWORD || process.env.DEV_BASIC_AUTH_PASSWORD || '';
const REPO_URL = process.env.WORKSPACE_SMOKE_REPO_URL || 'https://github.com/octocat/Hello-World';
const REMOTE = !APP_BASE.includes('localhost') && !APP_BASE.includes('127.0.0.1');

function assertEnv() {
  if (!REMOTE) return;
  if (!BASIC_USER || !BASIC_PASSWORD) {
    throw new Error(
      'Set PIPE_DEV_BASIC_AUTH_USER and PIPE_DEV_BASIC_AUTH_PASSWORD to smoke deployed app-dev/room-dev.',
    );
  }
}

function authHeaders() {
  if (!BASIC_USER && !BASIC_PASSWORD) return {};
  const value = Buffer.from(`${BASIC_USER}:${BASIC_PASSWORD}`).toString('base64');
  return { Authorization: `Basic ${value}` };
}

async function requestJson(base, path, init = {}) {
  const response = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...authHeaders(),
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

async function pollWorkspaceReady(token) {
  const deadline = Date.now() + 120_000;
  let last = null;
  while (Date.now() < deadline) {
    const body = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${token}/workspace`);
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
  const created = await requestJson(APP_BASE, '/api/v1/scheduling/interviews', {
    method: 'POST',
    body: JSON.stringify({
      recipientName: 'Workspace Smoke',
      recipientEmail,
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: 'CODE_REVIEW',
      githubRepoUrl: REPO_URL,
    }),
  });
  const interviewId = created?.interview?.id;
  if (!interviewId) throw new Error(`Create response missing interview id: ${JSON.stringify(created)}`);

  const invited = await requestJson(APP_BASE, `/api/v1/scheduling/interviews/${interviewId}/invite`, {
    method: 'POST',
    body: JSON.stringify({
      email: recipientEmail,
      message: 'Automated dev smoke for the PIPE live code-review workspace.',
    }),
  });
  const hostToken = tokenFromRoomUrl(invited?.room?.hostUrl ?? '');
  const room = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${hostToken}`);
  const workspace = room?.room?.workspace;
  if (!workspace?.enabled) throw new Error(`Workspace was not enabled: ${JSON.stringify(workspace)}`);
  if (workspace.repoUrl !== REPO_URL) {
    throw new Error(`Workspace repo mismatch: ${JSON.stringify(workspace)}`);
  }

  const launched = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${hostToken}/workspace/launch`, {
    method: 'POST',
  });
  if (!launched?.workspace?.session?.sessionId) {
    throw new Error(`Launch response missing session: ${JSON.stringify(launched)}`);
  }

  const readySession = await pollWorkspaceReady(hostToken);
  if (!readySession.proxyPath) {
    throw new Error(`Ready workspace did not expose a proxy path: ${JSON.stringify(readySession)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    interviewId,
    hostUrl: cleanRoomUrl(invited.room.hostUrl),
    guestUrl: cleanRoomUrl(invited.room.guestUrl),
    repoUrl: workspace.repoUrl,
    workspaceStatus: readySession.status,
    proxyPathReady: Boolean(readySession.proxyPath),
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
