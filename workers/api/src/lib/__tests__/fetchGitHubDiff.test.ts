import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGitHubDiff } from '../fetchGitHubDiff';

describe('fetchGitHubDiff', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('uses bounded fetch requests when reading pull request metadata and files', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const url = String(input);
      if (url.endsWith('/pulls/123')) {
        return new Response(JSON.stringify({
          title: 'Fix popover behavior',
          body: 'Better handle impatient clicks.',
          state: 'closed',
          changed_files: 0,
          user: { login: 'contributor' },
          created_at: '2026-06-01T00:00:00Z',
          merged_at: '2026-06-02T00:00:00Z',
          base: { ref: 'main', sha: 'base-sha' },
          head: { ref: 'branch', sha: 'head-sha' },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/pulls/123/files?per_page=100&page=1')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGitHubDiff('mui/base-ui', 123, 'token');

    expect(result?.metadata).toMatchObject({
      title: 'Fix popover behavior',
      author: 'contributor',
      base_sha: 'base-sha',
      head_sha: 'head-sha',
    });
    expect(result?.diff.files).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when a GitHub request fails or times out', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('fetch timeout');
    }));

    await expect(fetchGitHubDiff('mui/base-ui', 123, 'token')).resolves.toBeNull();
  });

  it('paginates changed files instead of truncating at the first 100', async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      filename: `removed-${index}.ts`,
      status: 'removed',
      additions: 0,
      deletions: 1,
      patch: '@@ -1 +0,0 @@\n-export const removed = true;',
    }));
    const secondPage = [{
      filename: 'removed-100.ts',
      status: 'removed',
      additions: 0,
      deletions: 1,
      patch: '@@ -1 +0,0 @@\n-export const removed = true;',
    }];
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const url = String(input);
      if (url.endsWith('/pulls/123')) {
        return new Response(JSON.stringify({
          title: 'Large cleanup',
          body: null,
          state: 'closed',
          changed_files: 101,
          user: { login: 'contributor' },
          created_at: '2026-06-01T00:00:00Z',
          merged_at: '2026-06-02T00:00:00Z',
          base: { ref: 'main', sha: 'base-sha' },
          head: { ref: 'branch', sha: 'head-sha' },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/pulls/123/files?per_page=100&page=1')) {
        return new Response(JSON.stringify(firstPage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/pulls/123/files?per_page=100&page=2')) {
        return new Response(JSON.stringify(secondPage), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchGitHubDiff('mui/base-ui', 123, 'token');

    expect(result?.diff.files).toHaveLength(101);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('returns null when GitHub metadata and fetched file count disagree', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith('/pulls/123')) {
        return new Response(JSON.stringify({
          title: 'Large cleanup',
          body: null,
          state: 'closed',
          changed_files: 101,
          user: { login: 'contributor' },
          created_at: '2026-06-01T00:00:00Z',
          merged_at: '2026-06-02T00:00:00Z',
          base: { ref: 'main', sha: 'base-sha' },
          head: { ref: 'branch', sha: 'head-sha' },
        }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/pulls/123/files?per_page=100&page=1')) {
        return new Response(JSON.stringify(Array.from({ length: 100 }, (_, index) => ({
          filename: `removed-${index}.ts`,
          status: 'removed',
          additions: 0,
          deletions: 1,
        }))), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.endsWith('/pulls/123/files?per_page=100&page=2')) {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchGitHubDiff('mui/base-ui', 123, 'token')).resolves.toBeNull();
  });
});
