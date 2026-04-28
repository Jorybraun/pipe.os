/**
 * GitHub enrichment client tests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubClient, GitHubRateLimitError } from '../githubClient';

describe('GitHubClient', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(response: {
    ok?: boolean;
    status?: number;
    headers?: Record<string, string>;
    json?: unknown;
  }) {
    const fetchMock = fetch as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      headers: {
        get: (key: string) => response.headers?.[key] ?? null,
      },
      json: async () => response.json,
    });
  }

  it('fetches user profile', async () => {
    const client = new GitHubClient();
    mockFetch({
      json: { login: 'alice', followers: 42, public_repos: 12, html_url: 'https://github.com/alice' },
    });

    const profile = await client.getUserProfile('alice');
    expect(profile.login).toBe('alice');
    expect(profile.followers).toBe(42);
  });

  it('fetches owned repos', async () => {
    const client = new GitHubClient();
    mockFetch({
      json: [
        {
          id: 1,
          name: 'repo-a',
          full_name: 'alice/repo-a',
          description: 'A test repo',
          html_url: 'https://github.com/alice/repo-a',
          stargazers_count: 10,
          watchers_count: 5,
          forks_count: 2,
          language: 'TypeScript',
          languages_url: 'https://api.github.com/repos/alice/repo-a/languages',
          created_at: '2023-01-01T00:00:00Z',
          updated_at: '2024-01-01T00:00:00Z',
          pushed_at: '2024-01-01T00:00:00Z',
        },
      ],
    });

    const repos = await client.getOwnedRepos('alice');
    expect(repos).toHaveLength(1);
    expect(repos[0]!.name).toBe('repo-a');
    expect(repos[0]!.stargazers_count).toBe(10);
  });

  it('fetches contributed repos from events', async () => {
    const client = new GitHubClient();
    mockFetch({
      json: [
        { type: 'PushEvent', repo: { id: 101, name: 'org/repo-x', url: 'https://api.github.com/repos/org/repo-x' } },
        { type: 'PushEvent', repo: { id: 101, name: 'org/repo-x', url: 'https://api.github.com/repos/org/repo-x' } },
        { type: 'PushEvent', repo: { id: 101, name: 'org/repo-x', url: 'https://api.github.com/repos/org/repo-x' } },
        { type: 'PushEvent', repo: { id: 101, name: 'org/repo-x', url: 'https://api.github.com/repos/org/repo-x' } },
        { type: 'PushEvent', repo: { id: 101, name: 'org/repo-x', url: 'https://api.github.com/repos/org/repo-x' } },
        { type: 'PushEvent', repo: { id: 102, name: 'org/repo-y', url: 'https://api.github.com/repos/org/repo-y' } },
      ],
    });

    const contribs = await client.getContributedRepos('alice');
    expect(contribs).toHaveLength(1);
    expect(contribs[0]!.repo_name).toBe('repo-x');
    expect(contribs[0]!.event_count).toBe(5);
  });

  it('fetches repo languages', async () => {
    const client = new GitHubClient();
    mockFetch({ json: { TypeScript: 5000, JavaScript: 2000 } });

    const langs = await client.getRepoLanguages('alice', 'repo-a');
    expect(langs.TypeScript).toBe(5000);
    expect(langs.JavaScript).toBe(2000);
  });

  it('throws GitHubRateLimitError when remaining < 10', async () => {
    const client = new GitHubClient();
    mockFetch({
      json: {},
      headers: { 'x-ratelimit-remaining': '5' },
    });

    await expect(client.getUserProfile('alice')).rejects.toThrow(GitHubRateLimitError);
  });

  it('throws on 404', async () => {
    const client = new GitHubClient();
    mockFetch({ ok: false, status: 404, json: {} });

    await expect(client.getUserProfile('ghost')).rejects.toThrow(/Not found/);
  });

  it('throws on 403 rate limit', async () => {
    const client = new GitHubClient();
    mockFetch({ ok: false, status: 403, json: {} });

    await expect(client.getUserProfile('alice')).rejects.toThrow(GitHubRateLimitError);
  });
});
