/**
 * GitHub Enrichment Client — fetches candidate GitHub metadata for graph enrichment.
 *
 * Methods:
 *   - getOwnedRepos(handle)
 *   - getContributedRepos(handle)
 *   - getRepoLanguages(owner, repo)
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
}

export interface GitHubContribution {
  repo_id: number;
  repo_name: string;
  repo_full_name: string;
  event_count: number;
}

export interface GitHubUserProfile {
  login: string;
  followers: number;
  public_repos: number;
  html_url: string;
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

  /**
   * Fetch repos the user has contributed to via public events.
   * Aggregates PushEvent / PullRequestEvent / IssuesEvent by repo.
   * Returns repos with >= 5 events.
   */
  async getContributedRepos(handle: string): Promise<GitHubContribution[]> {
    const url = `https://api.github.com/users/${encodeURIComponent(handle)}/events/public?per_page=100`;
    const res = await this.fetch(url);
    const events = (await res.json()) as Array<{
      repo?: { id: number; name: string; url: string };
      type: string;
    }>;

    const counts = new Map<
      number,
      { repo_name: string; repo_full_name: string; count: number }
    >();

    for (const ev of events) {
      if (!ev.repo) continue;
      const repoId = ev.repo.id;
      const existing = counts.get(repoId);
      if (existing) {
        existing.count += 1;
      } else {
        counts.set(repoId, {
          repo_name: ev.repo.name.split('/')[1] ?? ev.repo.name,
          repo_full_name: ev.repo.name,
          count: 1,
        });
      }
    }

    return Array.from(counts.entries())
      .filter(([, v]) => v.count >= 5)
      .map(([repo_id, v]) => ({
        repo_id,
        repo_name: v.repo_name,
        repo_full_name: v.repo_full_name,
        event_count: v.count,
      }));
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
