import { afterEach, describe, expect, it, vi } from 'vitest';
import { prefetchDevProxyApiJson, takeDevProxyApiJsonPrefetch } from './devProxyPrefetch';

describe('dev proxy API prefetch', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    window.__PIPE_DEV_PROXY_API_PREFETCHES__?.clear();
    window.history.pushState({}, '', '/');
  });

  it('starts and consumes same-origin API prefetches on the dev proxy auth path', async () => {
    window.history.pushState({}, '', '/interviews?devProxyAuth=1');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    prefetchDevProxyApiJson('/api/v1/scheduling/interviews/interview-1');
    const prefetched = takeDevProxyApiJsonPrefetch<{ ok: boolean }>('/api/v1/scheduling/interviews/interview-1');

    await expect(prefetched).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(window.__PIPE_DEV_PROXY_API_PREFETCHES__?.size ?? 0).toBe(0);
  });

  it('ignores non-api paths', () => {
    window.history.pushState({}, '', '/interviews?devProxyAuth=1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    prefetchDevProxyApiJson('/assets/index.js');

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
