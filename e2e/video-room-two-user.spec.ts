import { expect, test, type APIRequestContext, type BrowserContext, type Page } from '@playwright/test';
import { API_BASE, VIDEO_ROOM_BASE } from './env';

test.use({
  launchOptions: {
    args: [
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
    ],
  },
});

async function getAuthToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const sessionCookie = cookies.find((cookie) => cookie.name === '__session');
  if (!sessionCookie) {
    throw new Error('[video-room-two-user] No __session cookie. Run auth setup first.');
  }
  return sessionCookie.value;
}

function jsonAuthHeaders(token: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  };
}

function observeRoomFrames(page: Page): string[] {
  const frames: string[] = [];
  page.on('websocket', (ws) => {
    if (!ws.url().includes('/api/v1/meeting-rooms/')) return;
    frames.push(`open:${ws.url()}`);
    ws.on('framesent', (event) => {
      frames.push(`sent:${event.payload.toString()}`);
    });
    ws.on('framereceived', (event) => {
      frames.push(`received:${event.payload.toString()}`);
    });
  });
  return frames;
}

function sawFrame(frames: string[], type: string): boolean {
  return frames.some((frame) => frame.includes(`"type":"${type}"`));
}

function countFrames(frames: string[], type: string): number {
  return frames.filter((frame) => frame.includes(`"type":"${type}"`)).length;
}

async function createMeetingRoom(
  request: APIRequestContext,
  token: string,
): Promise<{ hostUrl: string; guestUrl: string }> {
  const unique = Date.now();
  const createRes = await request.post(`${API_BASE}/api/v1/meetings`, {
    headers: jsonAuthHeaders(token),
    data: {
      recipientName: 'E2E Video Guest',
      recipientEmail: `video-room-${unique}@pipe-test.dev`,
      title: `E2E Video Room ${unique}`,
      meetingType: 'INTERVIEW',
    },
  });
  if (!createRes.ok()) {
    throw new Error(`meeting create failed: ${await createRes.text()}`);
  }
  const created = await createRes.json() as { meeting: { id: string } };

  const roomRes = await request.post(`${API_BASE}/api/v1/meetings/${created.meeting.id}/room`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!roomRes.ok()) {
    throw new Error(`room prepare failed: ${await roomRes.text()}`);
  }
  const prepared = await roomRes.json() as {
    room: { hostUrl: string; guestUrl: string };
  };

  expect(prepared.room.hostUrl).toMatch(new RegExp(`^${VIDEO_ROOM_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/room/.+`));
  expect(prepared.room.guestUrl).toMatch(new RegExp(`^${VIDEO_ROOM_BASE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/room/.+`));
  expect(prepared.room.hostUrl).not.toBe(prepared.room.guestUrl);

  return prepared.room;
}

async function newRoomContext(context: BrowserContext): Promise<Page> {
  await context.grantPermissions(['camera', 'microphone'], { origin: VIDEO_ROOM_BASE });
  return context.newPage();
}

test.describe('two-user video room', () => {
  test('connects a host and guest through the scheduled interview room links', async ({
    browser,
    page,
    request,
  }) => {
    const token = await getAuthToken(page);
    const { hostUrl, guestUrl } = await createMeetingRoom(request, token);

    const hostContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });
    const guestContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });

    try {
      const host = await newRoomContext(hostContext);
      const guest = await newRoomContext(guestContext);
      const hostFrames = observeRoomFrames(host);
      const guestFrames = observeRoomFrames(guest);

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

      await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(guest.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(host.getByTestId('remote-video')).toBeVisible();
      await expect(guest.getByTestId('remote-video')).toBeVisible();
      await expect(host.getByTestId('local-video')).toBeVisible();
      await expect(guest.getByTestId('local-video')).toBeVisible();

      expect(sawFrame(hostFrames, 'OFFER')).toBeTruthy();
      expect(sawFrame(guestFrames, 'OFFER')).toBeTruthy();
      expect(sawFrame(hostFrames, 'ANSWER')).toBeTruthy();
      expect(sawFrame(guestFrames, 'ANSWER')).toBeTruthy();
      expect(sawFrame(hostFrames, 'ICE_CANDIDATE')).toBeTruthy();
      expect(sawFrame(guestFrames, 'ICE_CANDIDATE')).toBeTruthy();
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });

  test('renegotiates when the guest rejoins the same room link', async ({
    browser,
    page,
    request,
  }) => {
    const token = await getAuthToken(page);
    const { hostUrl, guestUrl } = await createMeetingRoom(request, token);

    const hostContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });
    const guestContext = await browser.newContext({
      permissions: ['camera', 'microphone'],
      viewport: { width: 1280, height: 720 },
    });

    try {
      const host = await newRoomContext(hostContext);
      const firstGuest = await newRoomContext(guestContext);
      const hostFrames = observeRoomFrames(host);

      await Promise.all([
        host.goto(hostUrl),
        firstGuest.goto(guestUrl),
      ]);
      await Promise.all([
        expect(host.getByTestId('device-check')).toBeVisible(),
        expect(firstGuest.getByTestId('device-check')).toBeVisible(),
      ]);
      await Promise.all([
        host.getByTestId('join-room').click(),
        firstGuest.getByTestId('join-room').click(),
      ]);

      await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(firstGuest.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });

      await firstGuest.close();

      const rejoinedGuest = await newRoomContext(guestContext);
      await rejoinedGuest.goto(guestUrl);
      await expect(rejoinedGuest.getByTestId('device-check')).toBeVisible();
      await rejoinedGuest.getByTestId('join-room').click();

      await expect(host.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(rejoinedGuest.getByTestId('call-stage')).toHaveAttribute('data-room-phase', 'connected', { timeout: 30_000 });
      await expect(host.getByTestId('remote-video')).toBeVisible();
      await expect(rejoinedGuest.getByTestId('remote-video')).toBeVisible();
      expect(countFrames(hostFrames, 'OFFER')).toBeGreaterThanOrEqual(2);
    } finally {
      await hostContext.close();
      await guestContext.close();
    }
  });
});
