import { describe, expect, it } from 'vitest';

import worker from './public/_worker.js';

const env = (assetHandler) => ({
  ROOM_AUTH_MODE: 'public',
  ASSETS: {
    fetch: assetHandler,
  },
});

function request(path, init = {}) {
  return new Request(`https://room-dev.hire-pipe.com${path}`, init);
}

describe('video room worker static assets', () => {
  it('does not serve the SPA shell as a stale JavaScript asset', async () => {
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

  it('keeps room navigation as the SPA shell with explicit dev cache reset headers', async () => {
    const response = await worker.fetch(
      request('/room/room-token', {
        headers: { Accept: 'text/html' },
      }),
      env(() => new Response('<!doctype html><html><head></head><body><div id="root"></div></body></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      })),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Clear-Site-Data')).toBe('"cache"');
    expect(response.headers.get('Pragma')).toBe('no-cache');
    expect(response.headers.get('Expires')).toBe('0');
    expect(await response.text()).toContain('<base href="https://room-dev.hire-pipe.com/">');
  });
});
