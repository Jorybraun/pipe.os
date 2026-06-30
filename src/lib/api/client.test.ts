import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { prefetchDevProxyApiJson } from './devProxyPrefetch';

describe('createApiClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.__PIPE_DEV_PROXY_API_PREFETCHES__?.clear();
    window.history.pushState({}, '', '/');
  });

  it('uses a dev proxy prefetch before resolving auth or fetching again', async () => {
    window.history.pushState({}, '', '/interviews?devProxyAuth=1');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ source: 'prefetch' }), { status: 200 }));
    const getToken = vi.fn(() => {
      throw new Error('Token should not be needed for a dev proxy prefetch.');
    });
    vi.stubGlobal('fetch', fetchMock);

    prefetchDevProxyApiJson('/api/v1/demo');
    const client = createApiClient({ getToken });
    const result = await client.get<{ source: string }>('/api/v1/demo');

    expect(result).toEqual({ source: 'prefetch' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(getToken).not.toHaveBeenCalled();
  });
});
