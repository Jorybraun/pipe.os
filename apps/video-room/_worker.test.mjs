import { describe, expect, it } from 'vitest';

import worker from './public/_worker.js';

const env = (assetHandler, overrides = {}) => ({
  ROOM_AUTH_MODE: 'public',
  ASSETS: {
    fetch: assetHandler,
  },
  ...overrides,
});

function request(path, init = {}) {
  return new Request(`https://room-dev.hire-pipe.com${path}`, init);
}

describe('video room worker static assets', () => {
  it('recovers stale JavaScript asset requests from the current bundle', async () => {
    const response = await worker.fetch(
      request('/assets/index-old.js', {
        headers: { Accept: '*/*' },
      }),
      env((assetRequest) => {
        const { pathname } = new URL(assetRequest.url);
        if (pathname === '/index.html') {
          return new Response(
            '<!doctype html><html><head><script type="module" src="/assets/index-new.js"></script></head></html>',
            { status: 200, headers: { 'Content-Type': 'text/html' } },
          );
        }
        if (pathname === '/assets/index-new.js') {
          return new Response('console.log("current room bundle");', {
            status: 200,
            headers: { 'Content-Type': 'text/javascript' },
          });
        }
        return new Response('<!doctype html><div id="root"></div>', {
          status: 200,
          headers: { 'Content-Type': 'text/html' },
        });
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toContain('text/javascript');
    expect(response.headers.get('X-Pipe-Stale-Asset-Recovered')).toBe('1');
    expect(await response.text()).toContain('current room bundle');
  });

  it('does not serve the SPA shell when stale asset recovery is unavailable', async () => {
    const response = await worker.fetch(
      request('/assets/index-old.js', {
        headers: { Accept: '*/*' },
      }),
      env(() => new Response('<!doctype html><div id="root"></div>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Content-Type')).toContain('text/plain');
    expect(await response.text()).toContain('Refresh the room');
  });

  it('keeps room navigation as the SPA shell without clearing hashed asset cache', async () => {
    const response = await worker.fetch(
      request('/room/room-token', {
        headers: { Accept: 'text/html' },
      }),
      env(() => new Response('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
        status: 200,
        headers: {
          'Content-Type': 'text/html',
          'Clear-Site-Data': '"cache"',
          'Pragma': 'no-cache',
          'Expires': '0',
        },
      })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Clear-Site-Data')).toBeNull();
    expect(response.headers.get('Pragma')).toBeNull();
    expect(response.headers.get('Expires')).toBeNull();
    expect(await response.text()).toContain('<base href="https://room-dev.hire-pipe.com/">');
  });

  it('clears browser cache only on the basic-auth handoff page', async () => {
    const response = await worker.fetch(
      request('/room/room-token', {
        headers: {
          Accept: 'text/html',
          Authorization: `Basic ${btoa('room-user:pipe-room-2026')}`,
        },
      }),
      env(() => new Response('unused'), {
        ROOM_AUTH_MODE: 'dev',
        VIDEO_ROOM_DEV_AUTH_USER: 'room-user',
        VIDEO_ROOM_DEV_AUTH_PASSWORD: 'pipe-room-2026',
        DEV_PROXY_SECRET: 'dev-secret',
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Clear-Site-Data')).toBe('"cache"');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('Expires')).toBe('0');
    expect(response.headers.get('Set-Cookie')).toContain('pipe_room_dev_auth=');
    expect(await response.text()).toContain('Opening PIPE Room');
  });
});
