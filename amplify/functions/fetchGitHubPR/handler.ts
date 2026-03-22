/**
 * GitHub PR Fetcher Lambda Handler
 *
 * STREAM 2: GitHub PR Integration for Code Review Challenges
 * Phase 1: GitHub API Integration
 *
 * Fetches PR metadata and diff from GitHub API, parses into structured format,
 * and returns for admin UI to cache with Challenge.
 *
 * Input:
 *   - repoUrl: string (e.g., "https://github.com/owner/repo")
 *   - prNumber: number (e.g., 42)
 *
 * Output:
 *   - success: boolean
 *   - data: Parsed PR metadata + diff (if success)
 *   - error: Error details (if !success)
 */

import { Octokit } from '@octokit/rest';
import {
  FetchGitHubPRInput,
  FetchGitHubPRResponse,
  GitHubAPIError,
  ParsedGitHubRepo,
  DiffJson,
  Metadata,
  DiffHunk,
  DiffLine,
} from './types';

// ============================================================
// Local API shape types
// ============================================================

/** Shape of a PR file item returned by GitHub's paginate endpoint */
interface GitHubPRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch?: string;
}

/** Shape of a PR label as returned by Octokit */
interface GitHubPRLabel {
  name?: string;
}

/** Shape of a PR reviewer as returned by Octokit */
interface GitHubPRReviewer {
  login?: string;
}

// ============================================================
// Constants
// ============================================================

const MAX_DIFF_SIZE = 10_485_760; // 10 MB
const GITHUB_API_TIMEOUT = 30_000; // 30 seconds

// ============================================================
// GitHub Token Management
// ============================================================

/**
 * Retrieve GitHub token from environment variable
 * NEVER log or expose token
 * 
 * Token is injected by Amplify via secret() function in resource.ts
 * Set locally via: npx ampx sandbox secret set GITHUB_TOKEN
 */
function getGitHubToken(): string {
  const token = process.env.GITHUB_TOKEN;
  
  if (!token) {
    throw new GitHubAPIError(
      'GITHUB_AUTH_ERROR',
      'GitHub token not configured. Set via: npx ampx sandbox secret set GITHUB_TOKEN',
      false
    );
  }
  
  return token;
}

// ============================================================
// URL Parsing & Validation
// ============================================================

/**
 * Parse GitHub repository URL into owner and repo
 * Validates format: https://github.com/owner/repo
 */
function parseGitHubUrl(url: string): ParsedGitHubRepo {
  const urlPattern = /^https:\/\/github\.com\/([a-zA-Z0-9._-]+)\/([a-zA-Z0-9._-]+)\/?$/;
  const match = url.trim().match(urlPattern);

  if (!match) {
    throw new GitHubAPIError(
      'INVALID_REPOSITORY',
      `Invalid GitHub URL format. Expected: https://github.com/owner/repo. Got: ${url}`,
      false
    );
  }

  return {
    owner: match[1],
    repo: match[2],
  };
}

// ============================================================
// Input Validation
// ============================================================

/**
 * Validate fetchGitHubPR input parameters
 */
function validateInput(input: unknown): asserts input is FetchGitHubPRInput {
  if (typeof input !== 'object' || !input) {
    throw new GitHubAPIError('INVALID_INPUT', 'Input must be an object', false);
  }

  const { repoUrl, prNumber } = input as Record<string, unknown>;

  if (typeof repoUrl !== 'string' || !repoUrl) {
    throw new GitHubAPIError('INVALID_INPUT', 'repoUrl must be a non-empty string', false);
  }

  if (!Number.isInteger(prNumber) || (prNumber as number) < 1) {
    throw new GitHubAPIError(
      'INVALID_INPUT',
      'prNumber must be a positive integer',
      false
    );
  }
}

// ============================================================
// Diff Parsing
// ============================================================

/**
 * Parse GitHub's raw diff patch format into structured hunks + lines
 * Format example:
 *   @@ -15,8 +15,42 @@
 *    context line
 *   -deleted line
 *   +added line
 *    context line
 */
function parseDiff(patch: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  const lines = patch.split('\n');
  let currentHunk: DiffHunk | null = null;
  let newLineNum = 0;

  for (const line of lines) {
    // Detect hunk header
    if (line.startsWith('@@')) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        newLineNum = parseInt(match[1], 10);
        currentHunk = {
          header: line,
          lines: [],
        };
        hunks.push(currentHunk);
      }
    } else if (currentHunk) {
      // Skip lines starting with backslash (patch metadata)
      if (line.startsWith('\\')) {
        continue;
      }

      if (line.startsWith('+')) {
        // Addition
        currentHunk.lines.push({
          type: 'addition',
          lineNumber: newLineNum,
          content: line.slice(1),
        });
        newLineNum++;
      } else if (line.startsWith('-')) {
        // Deletion
        currentHunk.lines.push({
          type: 'deletion',
          lineNumber: newLineNum,
          content: line.slice(1),
        });
        // Don't increment newLineNum for deletions
      } else if (line.startsWith(' ')) {
        // Context line
        currentHunk.lines.push({
          type: 'context',
          lineNumber: newLineNum,
          content: line.slice(1),
        });
        newLineNum++;
      }
    }
  }

  return hunks;
}

// ============================================================
// GitHub API Calls
// ============================================================

/**
 * Check rate limit status from GitHub response headers
 */
function getRateLimitInfo(headers: Record<string, string | string[] | undefined>): { remaining: number; reset: Date } {
  const remainingHeader = headers['x-ratelimit-remaining'];
  const resetHeader = headers['x-ratelimit-reset'];
  const remaining = parseInt(Array.isArray(remainingHeader) ? remainingHeader[0] : (remainingHeader ?? '0'), 10);
  const resetTimestamp = parseInt(Array.isArray(resetHeader) ? resetHeader[0] : (resetHeader ?? '0'), 10) * 1000;
  const reset = new Date(resetTimestamp);

  return { remaining, reset };
}

/**
 * Fetch PR from GitHub API with error handling
 */
async function fetchPRFromGitHub(
  client: Octokit,
  owner: string,
  repo: string,
  prNumber: number
) {
  try {
    const response = await client.rest.pulls.get({
      owner,
      repo,
      pull_number: prNumber,
    });

    return response.data;
  } catch (err: unknown) {
    const httpErr = err as { status?: number; response?: { headers?: Record<string, string | string[]> }; code?: string };
    if (httpErr.status === 404) {
      throw new GitHubAPIError(
        'PULL_REQUEST_NOT_FOUND',
        `PR #${prNumber} not found in ${owner}/${repo}`,
        false
      );
    } else if (httpErr.status === 403) {
      const rateLimit = getRateLimitInfo(httpErr.response?.headers ?? {});
      if (rateLimit.remaining === 0) {
        throw new GitHubAPIError(
          'RATE_LIMIT_EXCEEDED',
          `GitHub API rate limit exceeded. Reset at ${rateLimit.reset.toISOString()}`,
          true
        );
      } else {
        throw new GitHubAPIError(
          'GITHUB_AUTH_ERROR',
          'GitHub API returned 403. Check token permissions.',
          false
        );
      }
    } else if (httpErr.status === 401) {
      throw new GitHubAPIError(
        'GITHUB_AUTH_ERROR',
        'GitHub API token invalid or expired',
        false
      );
    } else if (httpErr.code === 'ECONNREFUSED' || httpErr.code === 'ENOTFOUND') {
      throw new GitHubAPIError(
        'NETWORK_ERROR',
        'Network error connecting to GitHub API',
        true
      );
    } else if (httpErr.code === 'ETIMEDOUT') {
      throw new GitHubAPIError(
        'NETWORK_ERROR',
        'GitHub API request timed out',
        true
      );
    } else {
      throw err; // Re-throw unknown errors
    }
  }
}

/**
 * Fetch PR files with pagination
 */
async function fetchPRFiles(
  client: Octokit,
  owner: string,
  repo: string,
  prNumber: number
): Promise<GitHubPRFile[]> {
  try {
    const files = await client.paginate('GET /repos/{owner}/{repo}/pulls/{pull_number}/files', {
      owner,
      repo,
      pull_number: prNumber,
      per_page: 100,
    });

    return files as GitHubPRFile[];
  } catch (err: unknown) {
    const httpErr = err as { status?: number; response?: { headers?: Record<string, string | string[]> } };
    if (httpErr.status === 403) {
      const rateLimit = getRateLimitInfo(httpErr.response?.headers ?? {});
      if (rateLimit.remaining === 0) {
        throw new GitHubAPIError(
          'RATE_LIMIT_EXCEEDED',
          'GitHub API rate limit exceeded during file fetch',
          true
        );
      }
    }
    throw err;
  }
}

// ============================================================
// Lambda Handler
// ============================================================

/**
 * Main handler for fetchGitHubPR Lambda
 */
export async function handler(rawEvent: unknown): Promise<FetchGitHubPRResponse> {
  try {
    // Amplify Gen 2 passes mutation arguments under `arguments` key
    const ev = rawEvent as Record<string, unknown>;
    const input = (ev['arguments'] as Record<string, unknown> | undefined) ?? ev;

    console.log('[fetchGitHubPR] RawEvent keys:', Object.keys(ev));
    console.log('[fetchGitHubPR] Request:', {
      repoUrl: input?.repoUrl,
      prNumber: input?.prNumber,
      skipCache: input?.skipCache,
    });

    // Validate input
    validateInput(input);
    const { repoUrl, prNumber } = input as { repoUrl: string; prNumber: number; skipCache?: boolean };

    // Parse GitHub URL
    const { owner, repo } = parseGitHubUrl(repoUrl);

    // Get GitHub token
    const token = getGitHubToken();

    // Initialize Octokit client
    const client = new Octokit({
      auth: token,
      baseUrl: 'https://api.github.com',
      timeout: GITHUB_API_TIMEOUT,
    });

    // Fetch PR metadata
    const prData = await fetchPRFromGitHub(client, owner, repo, prNumber);

    // Fetch PR files
    const files = await fetchPRFiles(client, owner, repo, prNumber);

    // Check total diff size
    const totalSize = files.reduce((sum: number, f: GitHubPRFile) => sum + (f.patch?.length ?? 0), 0);
    if (totalSize > MAX_DIFF_SIZE) {
      throw new GitHubAPIError(
        'DIFF_TOO_LARGE',
        `Diff is ${(totalSize / 1_000_000).toFixed(1)}MB, exceeds 10MB limit`,
        false
      );
    }

    // Parse diffs
    const diffFiles = files.map((f: GitHubPRFile) => ({
      path: f.filename,
      status: f.status as 'added' | 'modified' | 'deleted' | 'renamed',
      additions: f.additions,
      deletions: f.deletions,
      hunks: parseDiff(f.patch ?? ''),
    }));

    // Determine PR state — GitHub's API returns 'open' or 'closed';
    // merged PRs have state 'closed' with a non-null merged_at.
    const prMerged = 'merged_at' in prData && prData.merged_at !== null;
    const prState: 'open' | 'closed' | 'merged' = prMerged
      ? 'merged'
      : (prData.state as 'open' | 'closed');

    // Build response
    const response: FetchGitHubPRResponse = {
      success: true,
      data: {
        prNumber: prData.number,
        title: prData.title,
        description: prData.body ?? '',
        author: prData.user?.login ?? 'unknown',
        state: prState,
        filesChanged: files.length,
        additions: files.reduce((s: number, f: GitHubPRFile) => s + f.additions, 0),
        deletions: files.reduce((s: number, f: GitHubPRFile) => s + f.deletions, 0),
        diff: {
          files: diffFiles,
        },
        metadata: {
          author: prData.user?.login ?? 'unknown',
          avatar: prData.user?.avatar_url ?? '',
          createdAt: prData.created_at,
          updatedAt: prData.updated_at,
          state: prState,
          labels: (prData.labels as GitHubPRLabel[] | undefined)
            ?.map((l) => l.name)
            .filter((name): name is string => name !== undefined) ?? [],
          htmlUrl: prData.html_url,
          reviewers: (prData.requested_reviewers as GitHubPRReviewer[] | undefined)?.map((r) => r.login ?? '') ?? [],
          featureBranch: prData.head.ref,
          baseBranch: prData.base.ref,
        },
        fetchedAt: new Date().toISOString(),
      },
      error: null,
    };

    console.log('[fetchGitHubPR] Success:', {
      prNumber,
      filesChanged: diffFiles.length,
      totalSize: totalSize / 1024 + ' KB',
    });

    return response;
  } catch (err: unknown) {
    console.error('[fetchGitHubPR] Error:', err instanceof Error ? err.message : String(err));

    // Handle known GitHub API errors
    if (err instanceof GitHubAPIError) {
      return {
        success: false,
        data: null,
        error: {
          code: err.code,
          message: err.message,
          retryable: err.retryable,
        },
      };
    }

    // Handle unexpected errors
    return {
      success: false,
      data: null,
      error: {
        code: 'UNKNOWN_ERROR',
        message: `Unexpected error: ${err instanceof Error ? err.message : 'Unknown'}`,
        retryable: true,
      },
    };
  }
}
