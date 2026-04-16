/**
 * GitHub REST + GraphQL client with rate-limit-aware retry.
 *
 * Rate limiting strategy:
 * - Before each request, check remaining quota.
 * - If X-RateLimit-Remaining < 10, sleep until X-RateLimit-Reset.
 * - Retry on 429 / 403 (secondary rate limit) with exponential back-off.
 */

import { logger } from './logger.js';
import type { GitHubRepoBasic, GitHubPR, GitHubPRFile } from './types.js';

const BASE = 'https://api.github.com';
const GRAPHQL = 'https://api.github.com/graphql';
const MAX_RETRIES = 3;

export class GitHubClient {
  private readonly token: string;
  private remaining = 5000;
  private resetAt = 0;

  constructor(token: string) {
    this.token = token;
  }

  // ─── Core fetch ──────────────────────────────────────────────────────────

  private baseHeaders(): Record<string, string> {
    return {
      'Authorization': `Bearer ${this.token}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'pipe-repo-crawler/1.0',
    };
  }

  private updateRateLimit(headers: Headers): void {
    const rem = headers.get('X-RateLimit-Remaining');
    const reset = headers.get('X-RateLimit-Reset');
    if (rem !== null) this.remaining = parseInt(rem, 10);
    if (reset !== null) this.resetAt = parseInt(reset, 10) * 1000;
  }

  private async waitIfThrottled(): Promise<void> {
    if (this.remaining < 10 && this.resetAt > Date.now()) {
      const waitMs = this.resetAt - Date.now() + 2000;
      logger.warn('[github] Rate limit low, sleeping', { remaining: this.remaining, waitMs });
      await sleep(waitMs);
    }
  }

  async get<T>(path: string): Promise<T> {
    const url = path.startsWith('http') ? path : `${BASE}${path}`;
    return this.fetch<T>(url, { method: 'GET', headers: this.baseHeaders() });
  }

  async fetch<T>(url: string, init: RequestInit): Promise<T> {
    await this.waitIfThrottled();

    let lastError: Error | undefined;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const res = await globalThis.fetch(url, init);
      this.updateRateLimit(res.headers);

      if (res.status === 404) {
        throw new NotFoundError(url);
      }

      if (res.status === 429 || res.status === 403) {
        const retryAfter = res.headers.get('Retry-After');
        const waitMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : backoff(attempt);
        logger.warn('[github] Rate limited, retrying', { status: res.status, waitMs, attempt });
        await sleep(waitMs);
        lastError = new Error(`GitHub ${res.status}`);
        continue;
      }

      if (!res.ok) {
        throw new Error(`GitHub ${res.status}: ${url}`);
      }

      return res.json() as Promise<T>;
    }

    throw lastError ?? new Error('GitHub request failed after retries');
  }

  // ─── REST helpers ─────────────────────────────────────────────────────────

  async getRepo(owner: string, repo: string): Promise<GitHubRepoBasic> {
    return this.get<GitHubRepoBasic>(`/repos/${owner}/${repo}`);
  }

  async searchRepos(query: string, page = 1): Promise<{ total_count: number; items: GitHubRepoBasic[] }> {
    const q = encodeURIComponent(query);
    return this.get(`/search/repositories?q=${q}&per_page=100&page=${page}`);
  }

  /**
   * Returns open PR + open enhancement-labelled issue counts for a single repo.
   * Used by Pass 1 to drive the "challenge-ready" hard filter in matchRepos.
   * Two API calls per repo (search/issues with is:pr and is:issue+label:enhancement).
   */
  async getOpenWorkCounts(owner: string, repo: string): Promise<{
    open_pr_count: number;
    open_feature_issue_count: number;
  }> {
    const repoQ = encodeURIComponent(`repo:${owner}/${repo} is:open`);
    const prResp = await this.get<{ total_count: number }>(
      `/search/issues?q=${repoQ}+is:pr&per_page=1`,
    );
    const issueResp = await this.get<{ total_count: number }>(
      `/search/issues?q=${repoQ}+is:issue+label:enhancement&per_page=1`,
    );
    return {
      open_pr_count: prResp.total_count,
      open_feature_issue_count: issueResp.total_count,
    };
  }

  async getMergedPRs(owner: string, repo: string, page = 1): Promise<GitHubPR[]> {
    return this.get<GitHubPR[]>(
      `/repos/${owner}/${repo}/pulls?state=closed&sort=updated&direction=desc&per_page=100&page=${page}`,
    );
  }

  async getPRDetail(owner: string, repo: string, prNumber: number): Promise<GitHubPR> {
    return this.get<GitHubPR>(`/repos/${owner}/${repo}/pulls/${prNumber}`);
  }

  async getPRFiles(owner: string, repo: string, prNumber: number): Promise<GitHubPRFile[]> {
    return this.get<GitHubPRFile[]>(`/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`);
  }

  // ─── GraphQL — dependency manifests ──────────────────────────────────────

  async getDependencyManifests(owner: string, repo: string): Promise<DependencyManifest[]> {
    const query = `
      query($owner: String!, $repo: String!) {
        repository(owner: $owner, name: $repo) {
          dependencyGraphManifests(first: 10) {
            nodes {
              filename
              dependencies(first: 100) {
                nodes {
                  packageName
                  packageManager
                  requirements
                }
              }
            }
          }
        }
      }
    `;

    await this.waitIfThrottled();

    const res = await globalThis.fetch(GRAPHQL, {
      method: 'POST',
      headers: { ...this.baseHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { owner, repo } }),
    });

    this.updateRateLimit(res.headers);

    if (!res.ok) {
      logger.warn('[github] GraphQL request failed', { status: res.status, owner, repo });
      return [];
    }

    const data = (await res.json()) as {
      data?: {
        repository?: {
          dependencyGraphManifests?: {
            nodes: Array<{
              filename: string;
              dependencies: {
                nodes: Array<{ packageName: string; packageManager: string }>;
              };
            }>;
          };
        };
      };
      errors?: Array<{ message: string }>;
    };

    if (data.errors?.length) {
      // GraphQL errors are non-fatal — dependency graph may not be enabled
      logger.debug('[github] GraphQL errors (non-fatal)', { errors: data.errors.map((e) => e.message) });
      return [];
    }

    return (data.data?.repository?.dependencyGraphManifests?.nodes ?? []).map((node) => ({
      filename: node.filename,
      packages: node.dependencies.nodes.map((d) => ({
        name: d.packageName,
        manager: d.packageManager.toLowerCase(),
      })),
    }));
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DependencyManifest {
  filename: string;
  packages: Array<{ name: string; manager: string }>;
}

export class NotFoundError extends Error {
  constructor(url: string) {
    super(`GitHub 404: ${url}`);
    this.name = 'NotFoundError';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): number {
  return Math.min(1000 * 2 ** attempt, 30_000);
}
