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

  it('fetches all owned repos with pagination', async () => {
    const client = new GitHubClient();
    // Page 1: 2 repos
    mockFetch({
      json: [
        { id: 1, name: 'repo-a', full_name: 'alice/repo-a', html_url: '', stargazers_count: 0, watchers_count: 0, forks_count: 0, language: null, languages_url: '', created_at: '', updated_at: '', pushed_at: '', fork: false },
        { id: 2, name: 'repo-b', full_name: 'alice/repo-b', html_url: '', stargazers_count: 0, watchers_count: 0, forks_count: 0, language: null, languages_url: '', created_at: '', updated_at: '', pushed_at: '', fork: false },
      ],
    });
    // Page 2: empty
    mockFetch({ json: [] });

    const repos = await client.getOwnedReposAll('alice', 10);
    expect(repos).toHaveLength(2);
    expect(repos[0]!.name).toBe('repo-a');
    expect(repos[1]!.name).toBe('repo-b');
  });

  it('fetches merged pull requests', async () => {
    const client = new GitHubClient();
    mockFetch({
      json: {
        total_count: 2,
        items: [
          { id: 1, title: 'Fix bug', repository_url: 'https://api.github.com/repos/org/repo-x', html_url: 'https://github.com/org/repo-x/pull/1', created_at: '2024-01-01T00:00:00Z' },
          { id: 2, title: 'Add feature', repository_url: 'https://api.github.com/repos/org/repo-y', html_url: 'https://github.com/org/repo-y/pull/2', created_at: '2024-02-01T00:00:00Z' },
        ],
      },
    });

    const prs = await client.getMergedPullRequests('alice');
    expect(prs).toHaveLength(2);
    expect(prs[0]!.title).toBe('Fix bug');
  });

  it('fetches user orgs', async () => {
    const client = new GitHubClient();
    mockFetch({
      json: [
        { login: 'org-a', id: 1, avatar_url: 'https://avatars.githubusercontent.com/u/1' },
        { login: 'org-b', id: 2, avatar_url: 'https://avatars.githubusercontent.com/u/2' },
      ],
    });

    const orgs = await client.getUserOrgs('alice');
    expect(orgs).toHaveLength(2);
    expect(orgs[0]!.login).toBe('org-a');
  });

  it('fetches contribution calendar via GraphQL', async () => {
    const client = new GitHubClient({ token: 'test-token' });
    mockFetch({
      json: {
        data: {
          user: {
            contributionsCollection: {
              contributionCalendar: {
                totalContributions: 1247,
                weeks: [
                  {
                    contributionDays: [
                      { contributionCount: 5, date: '2025-04-01' },
                      { contributionCount: 0, date: '2025-04-02' },
                    ],
                  },
                ],
              },
            },
          },
        },
      },
    });

    const calendar = await client.getContributionCalendar('alice');
    expect(calendar.totalContributions).toBe(1247);
    expect(calendar.weeks).toHaveLength(1);
    expect(calendar.weeks[0]!.contributionDays).toHaveLength(2);
    expect(calendar.weeks[0]!.contributionDays[0]!.date).toBe('2025-04-01');
    expect(calendar.weeks[0]!.contributionDays[0]!.count).toBe(5);
  });

  it('throws on GraphQL errors', async () => {
    const client = new GitHubClient({ token: 'test-token' });
    mockFetch({
      json: {
        errors: [{ message: 'Could not resolve to a User with the login of alice.' }],
      },
    });

    await expect(client.getContributionCalendar('alice')).rejects.toThrow(/Could not resolve/);
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
