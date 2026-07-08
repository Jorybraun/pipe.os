import { chromium, expect } from '@playwright/test';

const ROOM_BASE = (process.env.ROOM_BASE || 'https://room-dev.hire-pipe.com').replace(/\/$/, '');
const BASIC_USER = process.env.PIPE_DEV_BASIC_AUTH_USER || process.env.DEV_BASIC_AUTH_USER || '';
const BASIC_PASSWORD = process.env.PIPE_DEV_BASIC_AUTH_PASSWORD || process.env.DEV_BASIC_AUTH_PASSWORD || '';
const HEADLESS = process.env.HEADED === '1' ? false : true;
const REMOTE = !ROOM_BASE.includes('localhost') && !ROOM_BASE.includes('127.0.0.1');
const LOCAL_E2E_TRANSCRIPT_OVERRIDE = !REMOTE && process.env.VIDEO_ROOM_SMOKE_E2E_TRANSCRIPT !== '0';
const TRANSCRIPT_READY_TIMEOUT_MS = Number.parseInt(
  process.env.VIDEO_ROOM_SMOKE_TRANSCRIPT_READY_TIMEOUT_MS || '60000',
  10,
);

function assertEnv() {
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

function cleanUrl(rawUrl) {
  const url = new URL(rawUrl);
  url.username = '';
  url.password = '';
  return url.toString();
}

async function postJson(path, body = {}) {
  const response = await fetch(`${ROOM_BASE}${path}`, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${path} failed (${response.status}): ${text}`);
  }
  return JSON.parse(text);
}

async function getJson(path) {
  const response = await fetch(`${ROOM_BASE}${path}`, {
    headers: authHeaders(),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${path} failed (${response.status}): ${text}`);
  }
  return JSON.parse(text);
}

async function createRoom() {
  const unique = Date.now();
  const created = await postJson('/api/v1/meetings', {
    recipientName: 'Codex Video Smoke Guest',
    recipientEmail: `codex-video-smoke-${unique}@pipe-test.dev`,
    title: `Codex video room smoke ${unique}`,
    meetingType: 'INTERVIEW',
  });
  const prepared = await postJson(`/api/v1/meetings/${created.meeting.id}/room`);
  return {
    meetingId: created.meeting.id,
    hostUrl: cleanUrl(prepared.room.hostUrl),
    guestUrl: cleanUrl(prepared.room.guestUrl),
  };
}

function observeWebSocketFrames(page) {
  const frames = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/api/v1/meeting-rooms/')) return;
    frames.push(`open:${ws.url()}`);
    ws.on('framesent', (event) => frames.push(`sent:${event.payload.toString()}`));
    ws.on('framereceived', (event) => frames.push(`received:${event.payload.toString()}`));
  });
  return frames;
}

function sawFrame(frames, type) {
  return frames.some((frame) => frame.includes(`"type":"${type}"`));
}

function roomTokenFromUrl(roomUrl) {
  const token = new URL(roomUrl).pathname.match(/^\/room\/([^/]+)$/)?.[1];
  if (!token) throw new Error(`Could not parse room token from ${cleanUrl(roomUrl)}`);
  return token;
}

function iceServersHaveTurn(iceServers) {
  if (!Array.isArray(iceServers)) return false;
  return iceServers.some((server) => {
    const urls = Array.isArray(server.urls) ? server.urls : [server.urls];
    return urls.some((url) => typeof url === 'string' && (url.startsWith('turn:') || url.startsWith('turns:')));
  });
}

async function getIceConfig(token) {
  const body = await getJson(`/api/v1/meeting-rooms/${token}/turn-credentials`);
  return {
    provider: body.provider,
    serverCount: Array.isArray(body.iceServers) ? body.iceServers.length : 0,
    hasTurn: iceServersHaveTurn(body.iceServers),
  };
}

function e2eDeepgramResponse() {
  return JSON.stringify({
    metadata: { channels: 2 },
    results: {
      utterances: [
        {
          id: 'smoke-host-1',
          transcript: 'What production system did you improve?',
          start: 0.5,
          end: 2,
          channel: 0,
          speaker: 0,
          confidence: 0.98,
        },
        {
          id: 'smoke-guest-1',
          transcript: 'I implemented lattice replay buffers for ecommerce order recovery and validated the fix with Vitest coverage.',
          start: 2.2,
          end: 7.8,
          channel: 1,
          speaker: 1,
          confidence: 0.96,
        },
      ],
    },
  });
}

async function installLocalTranscriptOverride(context) {
  if (!LOCAL_E2E_TRANSCRIPT_OVERRIDE) return;
  await context.route('**/api/v1/meeting-rooms/**/recording', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }
    await route.continue({
      headers: {
        ...request.headers(),
        'x-pipe-e2e-deepgram-response': e2eDeepgramResponse(),
      },
    });
  });
}

async function waitForMeetingRecording(meetingId) {
  const deadline = Date.now() + TRANSCRIPT_READY_TIMEOUT_MS;
  let last = null;
  while (Date.now() < deadline) {
    const body = await getJson(`/api/v1/meetings/${meetingId}`);
    last = body.meeting;
    if (last?.recordingR2Key && last.transcriptStatus === 'READY') {
      return last;
    }
    if (last?.transcriptStatus === 'FAILED') {
      throw new Error(
        `Meeting transcript processing failed: ${JSON.stringify(last)}`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(
    `Meeting transcript did not become ready. Last state: ${JSON.stringify(last)}`,
  );
}

async function main() {
  assertEnv();

  const { meetingId, hostUrl, guestUrl } = await createRoom();
  const iceConfig = await getIceConfig(roomTokenFromUrl(hostUrl));
  if (REMOTE && !iceConfig.hasTurn) {
    throw new Error(`Remote room did not return TURN credentials: ${JSON.stringify(iceConfig)}`);
  }
  const roomOrigin = new URL(ROOM_BASE).origin;
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });

  const hostContext = await browser.newContext({
    ...(BASIC_USER || BASIC_PASSWORD
      ? { httpCredentials: { username: BASIC_USER, password: BASIC_PASSWORD } }
      : {}),
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 720 },
  });
  const guestContext = await browser.newContext({
    ...(BASIC_USER || BASIC_PASSWORD
      ? { httpCredentials: { username: BASIC_USER, password: BASIC_PASSWORD } }
      : {}),
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 720 },
  });
  await hostContext.grantPermissions(['camera', 'microphone'], { origin: roomOrigin });
  await guestContext.grantPermissions(['camera', 'microphone'], { origin: roomOrigin });
  await installLocalTranscriptOverride(hostContext);

  try {
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const hostFrames = observeWebSocketFrames(host);
    const guestFrames = observeWebSocketFrames(guest);

    await Promise.all([
      host.goto(hostUrl),
      guest.goto(guestUrl),
    ]);
    await Promise.all([
      expect(host.getByTestId('device-check')).toBeVisible(),
      expect(guest.getByTestId('device-check')).toBeVisible(),
    ]);
    await Promise.all([
      host.getByTestId('join-room').click(),
      guest.getByTestId('join-room').click(),
    ]);

    await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', {
      timeout: 30_000,
    });
    await expect(guest.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', {
      timeout: 30_000,
    });
    await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-layout', 'standard');
    await expect(guest.getByTestId('call-stage')).toHaveAttribute('data-room-layout', 'standard');
    await expect(host.getByTestId('standard-layout')).toBeVisible();
    await expect(guest.getByTestId('standard-layout')).toBeVisible();
    await expect(host.getByTestId('remote-video')).toBeVisible();
    await expect(guest.getByTestId('remote-video')).toBeVisible();

    await expect(host.getByTestId('remote-video')).toBeVisible();
    await expect(guest.getByTestId('remote-video')).toBeVisible();
    await expect(host.getByTestId('start-recording')).toBeEnabled({
      timeout: 10_000,
    });
    await host.getByTestId('start-recording').click();
    await expect(host.getByTestId('recording-state')).toContainText('Recording', {
      timeout: 10_000,
    });

    for (const signalType of ['OFFER', 'ANSWER', 'ICE_CANDIDATE']) {
      if (!sawFrame(hostFrames, signalType) || !sawFrame(guestFrames, signalType)) {
        throw new Error(`Missing ${signalType} signaling frame on host or guest`);
      }
    }

    const recordingResponse = host.waitForResponse((response) => (
      response.url().includes('/api/v1/meeting-rooms/')
      && response.url().endsWith('/recording')
      && response.request().method() === 'POST'
    ), { timeout: 45_000 });
    await host.getByTestId('end-call').click();
    const response = await recordingResponse;
    if (response.status() !== 202) {
      throw new Error(`Recording upload failed (${response.status()}): ${await response.text()}`);
    }

    const meeting = await waitForMeetingRecording(meetingId);
    console.log(JSON.stringify({
      ok: true,
      meetingId,
      room: cleanUrl(hostUrl).replace(/\/room\/.+$/, '/room/<host-token>'),
      transcriptStatus: meeting.transcriptStatus,
      recordingR2Key: meeting.recordingR2Key,
      iceProvider: iceConfig.provider,
      hasTurn: iceConfig.hasTurn,
      iceServerCount: iceConfig.serverCount,
      e2eTranscriptOverride: LOCAL_E2E_TRANSCRIPT_OVERRIDE,
    }, null, 2));
  } finally {
    await hostContext.close();
    await guestContext.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
