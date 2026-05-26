/**
 * GitHub Enrichment Client — fetches candidate GitHub metadata for graph enrichment.
 *
 * Methods:
 *   - getUserProfile(handle)
 *   - getOwnedRepos(handle) — single page, 30 repos
 *   - getOwnedReposAll(handle, maxRepos) — paginated, up to maxRepos
 *   - getMergedPullRequests(handle, maxResults) — search API for merged PRs
 *   - getUserOrgs(handle) — organization memberships
 *   - getRepoLanguages(owner, repo)
 *   - getContributionCalendar(handle) — GraphQL contribution calendar
 *
 * Rate limit guard: throws GitHubRateLimitError when x-ratelimit-remaining < 10.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description: string | null;
  html_url: string;
  stargazers_count: number;
  watchers_count: number;
  forks_count: number;
  language: string | null;
  languages_url: string;
  created_at: string;
  updated_at: string;
  pushed_at: string;
  fork: boolean;
}

export interface GitHubUserProfile {
  login: string;
  name: string | null;
  followers: number;
  following: number;
  public_repos: number;
  public_gists: number;
  html_url: string;
  blog: string | null;
  location: string | null;
  company: string | null;
  created_at: string;
  bio: string | null;
  type: string;
}

export interface GitHubOrg {
  login: string;
  id: number;
  avatar_url: string;
}

export interface MergedPR {
  id: number;
  title: string;
  repository_url: string;
  html_url: string;
  created_at: string;
}

export interface ContributionDay {
  date: string; // "2025-04-15"
  count: number; // 0–N
}

export interface ContributionCalendar {
  totalContributions: number;
  weeks: Array<{
    contributionDays: ContributionDay[];
  }>;
}

export class GitHubRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitHubRateLimitError';
  }
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class GitHubClient {
  private token?: string;

  constructor(opts: { token?: string } = {}) {
    this.token = opts.token;
  }

  /** Fetch the user's public profile. */
  async getUserProfile(handle: string): Promise<GitHubUserProfile> {
    const res = await this.fetch(`https://api.github.com/users/${encodeURIComponent(handle)}`);
    return (await res.json()) as GitHubUserProfile;
  }

  /** Fetch repos the user owns (max 30, sorted by most recently pushed). */
  async getOwnedRepos(handle: string): Promise<GitHubRepo[]> {
    const url = `https://api.github.com/users/${encodeURIComponent(handle)}/repos?type=owner&sort=pushed&per_page=30`;
    const res = await this.fetch(url);
    return (await res.json()) as GitHubRepo[];
  }

  /** Fetch repos the user owns with pagination (up to maxRepos). */
  async getOwnedReposAll(handle: string, maxRepos = 300): Promise<GitHubRepo[]> {
    const all: GitHubRepo[] = [];
    let page = 1;

    while (all.length < maxRepos) {
      const perPage = Math.min(100, maxRepos - all.length);
      const url =
        `https://api.github.com/users/${encodeURIComponent(handle)}/repos?` +
        `type=owner&sort=pushed&per_page=${perPage}&page=${page}`;

      const res = await this.fetch(url);
      const repos = (await res.json()) as GitHubRepo[];
      if (!Array.isArray(repos) || repos.length === 0) break;

      all.push(...repos);
      page++;

      if (repos.length < perPage) break;
    }

    return all;
  }

  /**
   * Fetch merged pull requests by the user via the search API.
   * This finds contributions to repos they do NOT own, with full history.
   */
  async getMergedPullRequests(handle: string, maxResults = 100): Promise<MergedPR[]> {
    const url =
      `https://api.github.com/search/issues?q=` +
      encodeURIComponent(`type:pr is:merged author:${handle}`) +
      `&per_page=${maxResults}&sort=updated&order=desc`;
    const res = await this.fetch(url);
    const data = (await res.json()) as { total_count: number; items: MergedPR[] };
    return data.items ?? [];
  }

  /** Fetch organization memberships for the user. */
  async getUserOrgs(handle: string): Promise<GitHubOrg[]> {
    const res = await this.fetch(`https://api.github.com/users/${encodeURIComponent(handle)}/orgs`);
    return (await res.json()) as GitHubOrg[];
  }

  /**
   * Fetch contribution calendar via GitHub GraphQL API.
   * Returns 52+ weeks of daily commit counts.
   */
  async getContributionCalendar(handle: string): Promise<ContributionCalendar> {
    const query = `
      query($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
              weeks {
                contributionDays {
                  contributionCount
                  date
                }
              }
            }
          }
        }
      }
    `;

    const res = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.token ?? ''}`,
        'User-Agent': 'pipe-api/1.0',
      },
      body: JSON.stringify({ query, variables: { login: handle } }),
    });

    if (!res.ok) {
      if (res.status === 403) {
        throw new GitHubRateLimitError(`[githubClient] GraphQL rate limited`);
      }
      throw new Error(`[githubClient] GraphQL error ${res.status}`);
    }

    const data = (await res.json()) as {
      data?: {
        user?: {
          contributionsCollection?: {
            contributionCalendar?: {
              totalContributions: number;
              weeks: Array<{
                contributionDays: Array<{
                  contributionCount: number;
                  date: string;
                }>;
              }>;
            };
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors && data.errors.length > 0) {
      throw new Error(`[githubClient] GraphQL error: ${data.errors[0]!.message}`);
    }

    const calendar = data.data?.user?.contributionsCollection?.contributionCalendar;
    if (!calendar) {
      throw new Error(`[githubClient] No contribution calendar found for ${handle}`);
    }

    return {
      totalContributions: calendar.totalContributions,
      weeks: calendar.weeks.map((w) => ({
        contributionDays: w.contributionDays.map((d) => ({
          date: d.date,
          count: d.contributionCount,
        })),
      })),
    };
  }

  /** Fetch language breakdown for a repo. */
  async getRepoLanguages(owner: string, repo: string): Promise<Record<string, number>> {
    const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/languages`;
    const res = await this.fetch(url);
    return (await res.json()) as Record<string, number>;
  }

  // ─── Internal ───────────────────────────────────────────────────────────────

  private async fetch(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'pipe-api/1.0',
    };
    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const res = await fetch(url, { headers });

    if (!res.ok) {
      if (res.status === 403) {
        throw new GitHubRateLimitError(`[githubClient] Rate limited: ${url}`);
      }
      if (res.status === 404) {
        throw new Error(`[githubClient] Not found: ${url}`);
      }
      throw new Error(`[githubClient] GitHub API error ${res.status}: ${url}`);
    }

    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining && Number(remaining) < 10) {
      throw new GitHubRateLimitError(
        `[githubClient] Rate limit nearly exhausted (${remaining} remaining): ${url}`,
      );
    }

    return res;
  }
}
