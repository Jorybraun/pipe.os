import { isDevProxyRecruiterAuthBypassEnabled } from '../auth/devProxyAuth';

declare global {
  interface Window {
    __PIPE_DEV_PROXY_API_PREFETCHES__?: Map<string, Promise<unknown>>;
  }
}

function normalizePrefetchPath(path: string): string | null {
  if (typeof window === 'undefined') return null;

  const url = new URL(path, window.location.origin);
  if (url.origin !== window.location.origin) return null;
  if (!url.pathname.startsWith('/api/')) return null;
  return `${url.pathname}${url.search}`;
}

function getPrefetches(): Map<string, Promise<unknown>> {
  window.__PIPE_DEV_PROXY_API_PREFETCHES__ ??= new Map<string, Promise<unknown>>();
  return window.__PIPE_DEV_PROXY_API_PREFETCHES__;
}

export function prefetchDevProxyApiJson(path: string): void {
  if (!isDevProxyRecruiterAuthBypassEnabled() || typeof window === 'undefined') return;

  const key = normalizePrefetchPath(path);
  if (!key) return;

  const prefetches = getPrefetches();
  if (prefetches.has(key)) return;

  const prefetch = fetch(key, {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json',
    },
  }).then(async (response): Promise<unknown> => {
    if (!response.ok) throw new Error(`Prefetch failed: HTTP ${response.status}`);
    if (response.status === 204) return undefined;
    return await response.json() as unknown;
  });

  prefetches.set(key, prefetch);
  prefetch.catch(() => {
    if (prefetches.get(key) === prefetch) prefetches.delete(key);
  });
}

export function takeDevProxyApiJsonPrefetch<T>(path: string): Promise<T> | null {
  if (!isDevProxyRecruiterAuthBypassEnabled() || typeof window === 'undefined') return null;

  const key = normalizePrefetchPath(path);
  if (!key) return null;

  const prefetches = window.__PIPE_DEV_PROXY_API_PREFETCHES__;
  if (!prefetches) return null;

  const prefetch = prefetches.get(key);
  if (!prefetch) return null;

  prefetches.delete(key);
  return prefetch as Promise<T>;
}
