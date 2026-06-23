import { chromium, expect } from '@playwright/test';

const ROOM_BASE = (process.env.ROOM_BASE || 'https://room-dev.hire-pipe.com').replace(/\/$/, '');
const BASIC_USER = process.env.PIPE_DEV_BASIC_AUTH_USER || process.env.DEV_BASIC_AUTH_USER || '';
const BASIC_PASSWORD = process.env.PIPE_DEV_BASIC_AUTH_PASSWORD || process.env.DEV_BASIC_AUTH_PASSWORD || '';
const HEADLESS = process.env.HEADED === '1' ? false : true;
const REMOTE = !ROOM_BASE.includes('localhost') && !ROOM_BASE.includes('127.0.0.1');

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

function withBasicAuth(rawUrl) {
  if (!BASIC_USER && !BASIC_PASSWORD) return rawUrl;
  const url = new URL(rawUrl);
  if (url.username || url.password) return rawUrl;
  url.username = BASIC_USER;
  url.password = BASIC_PASSWORD;
  return url.toString();
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
    hostUrl: withBasicAuth(prepared.room.hostUrl),
    guestUrl: withBasicAuth(prepared.room.guestUrl),
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

async function waitForMeetingRecording(meetingId) {
  const deadline = Date.now() + 20_000;
  let last = null;
  while (Date.now() < deadline) {
    const body = await getJson(`/api/v1/meetings/${meetingId}`);
    last = body.meeting;
    if (
      last?.recordingR2Key
      && ['PROCESSING', 'READY', 'FAILED'].includes(last.transcriptStatus)
    ) {
      return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 750));
  }
  throw new Error(
    `Meeting recording status did not update. Last state: ${JSON.stringify(last)}`,
  );
}

async function main() {
  assertEnv();

  const { meetingId, hostUrl, guestUrl } = await createRoom();
  const roomOrigin = new URL(ROOM_BASE).origin;
  const browser = await chromium.launch({
    headless: HEADLESS,
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  });

  const hostContext = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 720 },
  });
  const guestContext = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 720 },
  });
  await hostContext.grantPermissions(['camera', 'microphone'], { origin: roomOrigin });
  await guestContext.grantPermissions(['camera', 'microphone'], { origin: roomOrigin });

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
    await expect(host.getByTestId('remote-video')).toBeVisible();
    await expect(guest.getByTestId('remote-video')).toBeVisible();
    await expect(host.getByTestId('network-provider')).toContainText('Cloudflare', {
      timeout: 10_000,
    });
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
      cloudflareTurn: true,
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
