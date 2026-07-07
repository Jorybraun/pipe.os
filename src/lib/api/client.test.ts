import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApiClient } from './client';
import { prefetchDevProxyApiJson } from './devProxyPrefetch';

describe('createApiClient', () => {
  afterEach(() => {
    vi.useRealTimers();
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
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/demo', expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
    }));
    expect(getToken).not.toHaveBeenCalled();
  });

  it('falls back to a normal fetch when a dev proxy prefetch stalls', async () => {
    vi.useFakeTimers();
    window.history.pushState({}, '', '/interviews?devProxyAuth=1');
    const stalledPrefetch = new Promise<Response>(() => undefined);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockReturnValueOnce(stalledPrefetch)
      .mockResolvedValueOnce(new Response(JSON.stringify({ source: 'fallback' }), { status: 200 }));
    const getToken = vi.fn(() => null);
    vi.stubGlobal('fetch', fetchMock);

    prefetchDevProxyApiJson('/api/v1/demo');
    const client = createApiClient({ getToken });
    const resultPromise = client.get<{ source: string }>('/api/v1/demo');
    await vi.advanceTimersByTimeAsync(1500);
    const result = await resultPromise;

    expect(result).toEqual({ source: 'fallback' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]).toEqual(expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
    }));
    expect(fetchMock.mock.calls[1]?.[1]).toEqual(expect.objectContaining({
      method: 'GET',
      cache: 'no-store',
    }));
    expect(getToken).toHaveBeenCalledTimes(1);
  });
});
