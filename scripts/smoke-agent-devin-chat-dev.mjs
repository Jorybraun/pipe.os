import dotenv from 'dotenv';
import WebSocket from 'ws';

dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const ROOM_BASE = (process.env.ROOM_BASE || 'https://room-dev.hire-pipe.com').replace(/\/$/, '');
const APP_BASE = (process.env.APP_BASE || 'https://app-dev.hire-pipe.com').replace(/\/$/, '');
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
  || process.env.PIPE_DEV_BASIC_AUTH_USER
  || process.env.DEV_BASIC_AUTH_USER
  || '';
const ROOM_BASIC_PASSWORD = process.env.PIPE_ROOM_DEV_BASIC_AUTH_PASSWORD
  || process.env.ROOM_DEV_BASIC_AUTH_PASSWORD
  || process.env.VIDEO_ROOM_DEV_AUTH_PASSWORD
  || process.env.PIPE_DEV_BASIC_AUTH_PASSWORD
  || process.env.DEV_BASIC_AUTH_PASSWORD
  || '';
const REPO_URL = process.env.AGENT_SMOKE_REPO_URL || 'https://github.com/octocat/Hello-World';
const PR_NUMBER = Number(process.env.AGENT_SMOKE_PR_NUMBER || '1');
const EXPECTED_RESPONSE = process.env.AGENT_SMOKE_EXPECTED_RESPONSE || 'PIPE_AGENT_SMOKE_OK';
const EXPECT_AUTH_NEEDED = process.env.AGENT_SMOKE_EXPECT_AUTH_NEEDED === '1';
const PROMPT_TEXT =
  process.env.AGENT_SMOKE_PROMPT
  || `Say exactly ${EXPECTED_RESPONSE} and no other words.`;
const REMOTE = !ROOM_BASE.includes('localhost') && !ROOM_BASE.includes('127.0.0.1');

function assertEnv() {
  if (!REMOTE) return;
  if (!APP_BASIC_USER || !APP_BASIC_PASSWORD) {
    throw new Error(
      'Set PIPE_APP_DEV_BASIC_AUTH_USER/PASSWORD or PIPE_DEV_BASIC_AUTH_USER/PASSWORD to smoke deployed app-dev.',
    );
  }
  if (!ROOM_BASIC_USER || !ROOM_BASIC_PASSWORD) {
    throw new Error(
      'Set PIPE_ROOM_DEV_BASIC_AUTH_USER/PASSWORD or VIDEO_ROOM_DEV_AUTH_USER/PASSWORD to smoke deployed room-dev.',
    );
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
  const deadline = Date.now() + 120_000;
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

function parseMessage(raw) {
  try {
    return JSON.parse(String(raw));
  } catch {
    return { type: 'UNPARSEABLE', raw: String(raw).slice(0, 240) };
  }
}

function boundedMessage(message) {
  const next = { ...message };
  if (typeof next.text === 'string') next.text = next.text.slice(0, 500);
  if (typeof next.message === 'string') next.message = next.message.slice(0, 500);
  if (typeof next.authUrl === 'string') next.authUrl = '<redacted>';
  return next;
}

function sourceRefCount(rows, kind) {
  return Array.isArray(rows)
    ? rows.find((row) => row?.kind === kind)?.count ?? 0
    : 0;
}

function connectAgent(wsUrl, headers) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const ws = new WebSocket(wsUrl, Object.keys(headers).length > 0 ? { headers } : undefined);
    let ready = false;
    const timer = setTimeout(() => {
      ws.close();
      resolve(messages);
    }, 90_000);

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'GET_STATUS' }));
    });

    ws.on('message', (data) => {
      const parsed = parseMessage(data);
      messages.push(parsed);
      if (parsed.type === 'AGENT_READY' && !ready) {
        ready = true;
        const promptTimestamp = Date.now();
        ws.send(JSON.stringify({
          type: 'CHAT',
          text: PROMPT_TEXT,
          browserPromptId: `smoke-workspace:host:prompt:${promptTimestamp}:agent_1234abcd`,
          browserPromptFingerprint: 'agent_1234abcd',
          browserPromptTimestamp: promptTimestamp,
          browserPromptLength: PROMPT_TEXT.length,
        }));
      }
      if (parsed.type === 'CHAT_RESPONSE' || parsed.type === 'ERROR' || parsed.type === 'AUTH_NEEDED') {
        setTimeout(() => {
          clearTimeout(timer);
          ws.close();
          resolve(messages);
        }, 1_000);
      }
    });
    ws.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    ws.on('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      reject(new Error(`Agent WebSocket upgrade failed (${response.statusCode}).`));
    });
  });
}

async function main() {
  assertEnv();

  const unique = Date.now();
  const recipientEmail = `agent-devin-smoke-${unique}@pipe-test.dev`;
  const created = await requestJson(APP_BASE, '/api/v1/scheduling/interviews', {
    method: 'POST',
    body: JSON.stringify({
      recipientName: 'Agent Devin Smoke',
      recipientEmail,
      meetingType: 'DIRECT_VIDEO_CALL',
      interviewType: 'DEV_CONTAINER_CHALLENGE',
      githubRepoUrl: REPO_URL,
      githubPrNumber: PR_NUMBER,
    }),
  });
  const interviewId = created?.interview?.id;
  if (!interviewId) throw new Error(`Create response missing interview id: ${JSON.stringify(created)}`);

  const invited = await requestJson(APP_BASE, `/api/v1/scheduling/interviews/${interviewId}/invite`, {
    method: 'POST',
    body: JSON.stringify({
      email: recipientEmail,
      message: 'Automated dev smoke for real Devin agent chat.',
    }),
  });
  const hostToken = tokenFromRoomUrl(invited?.room?.hostUrl ?? '');
  const roomAuthHeaders = authHeadersFromUrl(invited?.room?.hostUrl ?? '');

  const launched = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${hostToken}/workspace/launch`, {
    method: 'POST',
    body: JSON.stringify({ agentType: 'devin' }),
    headers: roomAuthHeaders,
  });
  if (!launched?.workspace?.session?.sessionId) {
    throw new Error(`Launch response missing session: ${JSON.stringify(launched)}`);
  }

  const readySession = await pollWorkspaceReady(hostToken, roomAuthHeaders);
  const wsUrl = `${ROOM_BASE.replace(/^http/, 'ws')}/api/v1/meeting-rooms/${hostToken}/agent/${readySession.sessionId}/ws`;
  const messages = await connectAgent(wsUrl, {
    ...authHeadersFor(ROOM_BASE),
    ...roomAuthHeaders,
  });
  const chatResponse = messages.find((message) => message.type === 'CHAT_RESPONSE');
  const authNeeded = messages.find((message) => message.type === 'AUTH_NEEDED');
  const statusMessages = messages.filter((message) => message.type === 'AGENT_STATUS');
  const persistedDiagnostics = messages.filter((message) =>
    message.type === 'AGENT_DIAGNOSTIC' && message.persisted === true
  );

  if (EXPECT_AUTH_NEEDED) {
    if (!authNeeded) {
      throw new Error(`Expected Devin auth-needed state, got: ${JSON.stringify(messages.map(boundedMessage))}`);
    }
    if (chatResponse) {
      throw new Error(`Expected no Devin chat response while auth is needed, got: ${JSON.stringify(boundedMessage(chatResponse))}`);
    }
    if (!statusMessages.some((message) => message.status === 'auth_needed')) {
      throw new Error(`Expected auth_needed status, got: ${JSON.stringify(messages.map(boundedMessage))}`);
    }
    console.log(JSON.stringify({
      ok: true,
      expectedAuthNeeded: true,
      interviewId,
      hostUrl: cleanRoomUrl(invited.room.hostUrl),
      guestUrl: cleanRoomUrl(invited.room.guestUrl),
      repoUrl: REPO_URL,
      githubPrNumber: PR_NUMBER,
      workspaceStatus: readySession.status,
      agentReady: false,
      authNeeded: true,
      statuses: statusMessages.map((message) => message.status),
      authMessage: authNeeded.message,
    }, null, 2));
    return;
  }

  if (!messages.some((message) => message.type === 'AGENT_READY')) {
    throw new Error(`Devin agent bridge never became ready: ${JSON.stringify(messages.map(boundedMessage))}`);
  }
  if (!chatResponse) {
    throw new Error(`Devin agent chat did not return a response: ${JSON.stringify(messages.map(boundedMessage))}`);
  }
  if (chatResponse.source !== 'agent_api_response') {
    throw new Error(`Expected real Devin API response, got ${chatResponse.source ?? 'unknown source'}.`);
  }
  if (chatResponse.persisted !== true) {
    throw new Error(`Devin agent chat response was not persisted as source-backed evidence.`);
  }
  if (!String(chatResponse.text || '').includes(EXPECTED_RESPONSE)) {
    throw new Error(`Unexpected Devin agent response: ${String(chatResponse.text || '').slice(0, 500)}`);
  }
  if (persistedDiagnostics.length === 0) {
    throw new Error('No persisted Devin agent bridge diagnostics were observed.');
  }
  const detail = await requestJson(APP_BASE, `/api/v1/scheduling/interviews/${interviewId}`);
  const progress = detail?.interview?.assessmentProgress ?? null;
  const sourceRefCounts = progress?.sourceRefCounts ?? [];
  if (progress?.hasAiInteraction !== true) {
    throw new Error(`Devin agent response did not mark assessment AI interaction: ${JSON.stringify(progress)}`);
  }
  if (sourceRefCount(sourceRefCounts, 'ai_agent_response') < 1) {
    throw new Error(`Devin agent response was not counted as ai_agent_response assessment evidence: ${JSON.stringify(sourceRefCounts)}`);
  }

  console.log(JSON.stringify({
    ok: true,
    interviewId,
    hostUrl: cleanRoomUrl(invited.room.hostUrl),
    guestUrl: cleanRoomUrl(invited.room.guestUrl),
    repoUrl: REPO_URL,
    githubPrNumber: PR_NUMBER,
    workspaceStatus: readySession.status,
    agentReady: true,
    chatSource: chatResponse.source,
    chatPersisted: chatResponse.persisted,
    assessmentAiInteraction: progress.hasAiInteraction,
    assessmentAgentResponseCount: sourceRefCount(sourceRefCounts, 'ai_agent_response'),
    diagnosticPersistedCount: persistedDiagnostics.length,
    responseText: chatResponse.text,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
