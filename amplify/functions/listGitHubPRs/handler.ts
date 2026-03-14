/**
 * listGitHubPRs Lambda Handler
 *
 * Lists pull requests from a GitHub repository.
 * Returns lightweight PR summaries (no diffs) for display in the challenge picker.
 *
 * Input:
 *   - repoUrl: string (e.g. "https://github.com/owner/repo")
 *   - state?: 'open' | 'closed' | 'all' (default: 'open')
 *
 * Output:
 *   - success: boolean
 *   - data: { prs: PRSummary[], repo: RepoInfo, totalCount: number }
 *   - error: { code, message, retryable } (if !success)
 */

import { Octokit } from '@octokit/rest';
import {
  ListGitHubPRsInput,
  ListGitHubPRsResponse,
  PRSummary,
} from './types';

const GITHUB_URL_REGEX = /^https:\/\/github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/?$/;

// ============================================================
// Helpers
// ============================================================

/**
 * Minimal shape of a GitHub API (Octokit) error with HTTP context
 * Mirrors the helper in fetchGitHubPR/handler.ts
 */
interface OctokitErrorShape {
  status?: number;
  response?: { headers?: Record<string, string | undefined> };
  message?: string;
}

function asOctokitError(err: unknown): OctokitErrorShape {
  if (typeof err === 'object' && err !== null) {
    return err as OctokitErrorShape;
  }
  return {};
}

function getGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error('GITHUB_AUTH_ERROR: GitHub token not configured. Set via: npx ampx sandbox secret set GITHUB_TOKEN');
  }
  return token;
}

function parseGitHubUrl(repoUrl: string): { owner: string; repo: string } {
  const match = repoUrl.trim().match(GITHUB_URL_REGEX);
  if (!match || !match[1] || !match[2]) {
    throw new Error(`INVALID_INPUT: Invalid GitHub repository URL format: ${repoUrl}`);
  }
  return { owner: match[1], repo: match[2] };
}

// ============================================================
// Handler
// ============================================================

export async function handler(rawEvent: unknown): Promise<ListGitHubPRsResponse> {
  // Amplify Gen 2 custom mutations pass arguments nested under `arguments` key
  // e.g. { arguments: { repoUrl, state }, identity: {...}, ... }
  const ev = rawEvent as Record<string, unknown>;
  const args = (ev['arguments'] as Record<string, unknown> | undefined) ?? ev;
  const event: ListGitHubPRsInput = {
    repoUrl: args['repoUrl'] as string,
    state: args['state'] as ListGitHubPRsInput['state'] | undefined,
  };

  console.log('[listGitHubPRs] Request received', {
    repoUrl: event.repoUrl,
    state: event.state,
    timestamp: new Date().toISOString(),
  });

  try {
    // Validate input
    if (!event.repoUrl) {
      return {
        success: false,
        error: { code: 'INVALID_INPUT', message: 'repoUrl is required', retryable: false },
      };
    }

    let owner: string;
    let repo: string;
    try {
      ({ owner, repo } = parseGitHubUrl(event.repoUrl));
    } catch (err) {
      return {
        success: false,
        error: {
          code: 'INVALID_INPUT',
          message: err instanceof Error ? err.message : 'Invalid repository URL',
          retryable: false,
        },
      };
    }

    const token = getGitHubToken();
    const octokit = new Octokit({
      auth: token,
      userAgent: 'pipe-platform/1.0',
    });

    const state = event.state ?? 'open';

    // Fetch PR list from GitHub
    const { data: rawPRs } = await octokit.pulls.list({
      owner,
      repo,
      state,
      per_page: 50,
      sort: 'updated',
      direction: 'desc',
    });

    const prs: PRSummary[] = rawPRs.map(pr => ({
      number: pr.number,
      title: pr.title,
      description: pr.body ?? '',
      author: pr.user?.login ?? 'unknown',
      avatar: pr.user?.avatar_url ?? '',
      state: pr.merged_at ? 'merged' : (pr.state as 'open' | 'closed'),
      draft: pr.draft ?? false,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      htmlUrl: pr.html_url,
      labels: pr.labels.map(l => (typeof l === 'string' ? l : (l.name ?? ''))).filter(Boolean),
      baseBranch: pr.base.ref,
      featureBranch: pr.head.ref,
    }));

    console.log('[listGitHubPRs] Success', {
      owner,
      repo,
      count: prs.length,
      state,
    });

    return {
      success: true,
      data: {
        prs,
        repo: { owner, name: repo, fullName: `${owner}/${repo}` },
        totalCount: prs.length,
      },
    };

  } catch (rawErr: unknown) {
    // Extract Octokit HTTP error details when available
    const err = asOctokitError(rawErr);
    const status = err.status;
    const headers = err.response?.headers ?? {};
    const message = rawErr instanceof Error ? rawErr.message : String(rawErr);

    console.error('[listGitHubPRs] Error', { status, message });

    if (status === 404 || message.includes('Not Found') || message.includes('404')) {
      return {
        success: false,
        error: {
          code: 'INVALID_REPOSITORY',
          message: 'Repository not found or not accessible. Check the URL and your GitHub token permissions.',
          retryable: false,
        },
      };
    }

    if (status === 401 || message.includes('Unauthorized') || message.includes('401') || message.includes('GITHUB_AUTH_ERROR')) {
      return {
        success: false,
        error: {
          code: 'GITHUB_AUTH_ERROR',
          message: 'GitHub authentication failed. Check GITHUB_TOKEN configuration.',
          retryable: false,
        },
      };
    }

    if (status === 403) {
      const rateLimitRemaining = parseInt(headers['x-ratelimit-remaining'] ?? '-1', 10);
      if (rateLimitRemaining === 0) {
        const resetAt = parseInt(headers['x-ratelimit-reset'] ?? '0', 10);
        const resetDate = resetAt ? new Date(resetAt * 1000).toISOString() : 'soon';
        return {
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: `GitHub API rate limit exceeded. Resets at ${resetDate}.`,
            retryable: true,
          },
        };
      }
      // 403 with remaining quota: permission/scope/SSO/org-policy issue
      return {
        success: false,
        error: {
          code: 'GITHUB_AUTH_ERROR',
          message: 'GitHub API access denied (403). Check token scopes, SSO authorization, or org policy.',
          retryable: false,
        },
      };
    }

    return {
      success: false,
      error: {
        code: 'UNKNOWN_ERROR',
        message: `Unexpected error: ${message}`,
        retryable: true,
      },
    };
  }
}
