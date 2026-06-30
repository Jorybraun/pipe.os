const ROOM_BASE = (process.env.ROOM_BASE || 'https://room-dev.hire-pipe.com').replace(/\/$/, '');
const APP_BASE = (process.env.APP_BASE || ROOM_BASE).replace(/\/$/, '');
const BASIC_USER = process.env.PIPE_DEV_BASIC_AUTH_USER || process.env.DEV_BASIC_AUTH_USER || '';
const BASIC_PASSWORD = process.env.PIPE_DEV_BASIC_AUTH_PASSWORD || process.env.DEV_BASIC_AUTH_PASSWORD || '';
const REPO_URL = process.env.AGENT_SMOKE_REPO_URL || 'https://github.com/octocat/Hello-World';
const PR_NUMBER = Number(process.env.AGENT_SMOKE_PR_NUMBER || '1');
const EXPECTED_RESPONSE = process.env.AGENT_SMOKE_EXPECTED_RESPONSE || 'PIPE_AGENT_SMOKE_OK';
const PROMPT_TEXT =
  process.env.AGENT_SMOKE_PROMPT
  || `Say exactly ${EXPECTED_RESPONSE} and no other words.`;
const REMOTE = !ROOM_BASE.includes('localhost') && !ROOM_BASE.includes('127.0.0.1');

function assertEnv() {
  if (typeof WebSocket !== 'function') {
    throw new Error('This smoke requires a Node runtime with global WebSocket support.');
  }
  if (!REMOTE) return;
  if (!BASIC_USER || !BASIC_PASSWORD) {
    throw new Error(
      'Set PIPE_DEV_BASIC_AUTH_USER and PIPE_DEV_BASIC_AUTH_PASSWORD to smoke deployed room-dev.',
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

function connectAgent(wsUrl) {
  return new Promise((resolve, reject) => {
    const messages = [];
    const headers = authHeaders();
    const ws = new WebSocket(wsUrl, Object.keys(headers).length > 0 ? { headers } : undefined);
    let ready = false;
    const timer = setTimeout(() => {
      ws.close();
      resolve(messages);
    }, 90_000);

    ws.addEventListener('message', (event) => {
      const parsed = parseMessage(event.data);
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
    ws.addEventListener('error', () => {
      clearTimeout(timer);
      reject(new Error('Agent WebSocket failed.'));
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

  const launched = await requestJson(ROOM_BASE, `/api/v1/meeting-rooms/${hostToken}/workspace/launch`, {
    method: 'POST',
  });
  if (!launched?.workspace?.session?.sessionId) {
    throw new Error(`Launch response missing session: ${JSON.stringify(launched)}`);
  }

  const readySession = await pollWorkspaceReady(hostToken);
  const wsUrl = `${ROOM_BASE.replace(/^http/, 'ws')}/api/v1/meeting-rooms/${hostToken}/agent/${readySession.sessionId}/ws`;
  const messages = await connectAgent(wsUrl);
  const chatResponse = messages.find((message) => message.type === 'CHAT_RESPONSE');
  const persistedDiagnostics = messages.filter((message) =>
    message.type === 'AGENT_DIAGNOSTIC' && message.persisted === true
  );

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
    diagnosticPersistedCount: persistedDiagnostics.length,
    responseText: chatResponse.text,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
