/**
 * GitHub Issue Client — fetches issues from the GitHub API.
 *
 * Used by:
 *   - Lazy issue fetch (match-time on-demand fetch)
 *   - Issue state verifier (runtime check before challenge assignment)
 *
 * Rate limits:
 *   - Unauthenticated: 60 requests/hour
 *   - Authenticated (GITHUB_TOKEN): 5,000 requests/hour
 */

// ─── Types ─────────────────────────────────────────────────────────────��────

/** GitHub API response for a single issue. */
interface GitHubIssueResponse {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  user: { login: string };
  labels: Array<{ name: string }>;
  comments: number;
  reactions?: {
    total_count: number;
  };
  created_at: string;
  updated_at: string;
  /** If present, this "issue" is actually a PR. Filter these out. */
  pull_request?: unknown;
  assignee: { login: string } | null;
  assignees?: Array<{ login: string }>;
}

/** GitHub API response for timeline events (to check for linked PRs). */
interface GitHubTimelineEvent {
  event: string;
  source?: {
    type: string;
    issue?: {
      number: number;
      state: string;
      pull_request?: unknown;
    };
  };
}

/** Parsed issue ready for storage. */
export interface ParsedIssue {
  github_issue_id: number;
  issue_number: number;
  title: string;
  body: string | null;
  author_login: string;
  labels: string[];
  comment_count: number;
  reactions_total: number;
  github_created_at: string;
  github_updated_at: string;
  state: 'open' | 'closed';
  has_merged_pr: boolean;
}

/** Options for fetching issues. */
export interface FetchIssuesOptions {
  /** GitHub personal access token (optional, increases rate limit). Undefined = unauthenticated. */
  token?: string | undefined;
  /** Maximum number of issues to fetch per repo. Default: 50. */
  limit?: number;
  /** Only fetch issues with these labels. Default: all labels. */
  labels?: string[];
  /** Issue state filter. Default: 'open'. */
  state?: 'open' | 'closed' | 'all';
  /** Sort field. Default: 'updated'. */
  sort?: 'created' | 'updated' | 'comments';
  /** Sort direction. Default: 'desc'. */
  direction?: 'asc' | 'desc';
}

// ─── Client ─────────────────────────────────────────────────────────────────

/**
 * Fetch open issues from a GitHub repository.
 * Filters out PRs (GitHub API returns PRs in the issues endpoint).
 */
export async function fetchIssues(
  owner: string,
  repo: string,
  options: FetchIssuesOptions = {},
): Promise<ParsedIssue[]> {
  const {
    token,
    limit = 50,
    state = 'open',
    sort = 'updated',
    direction = 'desc',
  } = options;

  const headers = buildHeaders(token);
  const perPage = Math.min(limit, 100);

  const url = new URL(`https://api.github.com/repos/${owner}/${repo}/issues`);
  url.searchParams.set('state', state);
  url.searchParams.set('sort', sort);
  url.searchParams.set('direction', direction);
  url.searchParams.set('per_page', String(perPage));

  const response = await fetch(url.toString(), { headers });

  if (!response.ok) {
    const status = response.status;
    if (status === 403) {
      throw new Error(`[issueClient] Rate limited (${owner}/${repo})`);
    }
    if (status === 404) {
      throw new Error(`[issueClient] Repo not found: ${owner}/${repo}`);
    }
    throw new Error(`[issueClient] GitHub API error: ${status}`);
  }

  const data = (await response.json()) as GitHubIssueResponse[];

  // Filter out PRs (they have a pull_request key)
  const issues = data.filter((item) => !item.pull_request);

  // Map to our parsed format
  const parsed: ParsedIssue[] = issues.slice(0, limit).map((issue) => ({
    github_issue_id: issue.id,
    issue_number: issue.number,
    title: issue.title,
    body: issue.body,
    author_login: issue.user.login,
    labels: issue.labels.map((l) => l.name),
    comment_count: issue.comments,
    reactions_total: issue.reactions?.total_count ?? 0,
    github_created_at: issue.created_at,
    github_updated_at: issue.updated_at,
    state: issue.state,
    has_merged_pr: false, // Will be updated by checkLinkedPRs if needed
  }));

  return parsed;
}

/**
 * Fetch a single issue by number (for runtime state verification).
 */
export async function fetchIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string,
): Promise<ParsedIssue | null> {
  const headers = buildHeaders(token);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    { headers },
  );

  if (!response.ok) {
    if (response.status === 404) return null;
    throw new Error(`[issueClient] GitHub API error: ${response.status}`);
  }

  const issue = (await response.json()) as GitHubIssueResponse;

  // PRs also live at the /issues endpoint
  if (issue.pull_request) return null;

  return {
    github_issue_id: issue.id,
    issue_number: issue.number,
    title: issue.title,
    body: issue.body,
    author_login: issue.user.login,
    labels: issue.labels.map((l) => l.name),
    comment_count: issue.comments,
    reactions_total: issue.reactions?.total_count ?? 0,
    github_created_at: issue.created_at,
    github_updated_at: issue.updated_at,
    state: issue.state,
    has_merged_pr: false,
  };
}

/**
 * Check if an issue has a linked merged PR (via timeline events).
 * Used to filter out already-implemented issues for CODE_IMPLEMENTATION.
 */
export async function checkLinkedMergedPR(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string,
): Promise<boolean> {
  const headers = buildHeaders(token);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/timeline`,
    {
      headers: {
        ...headers,
        // Timeline API requires this preview header
        Accept: 'application/vnd.github.mockingbird-preview+json',
      },
    },
  );

  if (!response.ok) {
    // Timeline API might not be available — fail open (assume no merged PR)
    console.warn(`[issueClient] Timeline API error for ${owner}/${repo}#${issueNumber}: ${response.status}`);
    return false;
  }

  const events = (await response.json()) as GitHubTimelineEvent[];

  // Look for "cross-referenced" events from merged PRs
  for (const event of events) {
    if (event.event === 'cross-referenced' && event.source?.type === 'issue') {
      const sourceIssue = event.source.issue;
      if (
        sourceIssue &&
        sourceIssue.pull_request &&
        sourceIssue.state === 'closed'
      ) {
        // This is a merged PR that references this issue
        return true;
      }
    }
  }

  return false;
}

/**
 * Batch check for linked merged PRs on multiple issues.
 * More efficient than calling checkLinkedMergedPR for each issue.
 */
export async function batchCheckLinkedMergedPRs(
  owner: string,
  repo: string,
  issueNumbers: number[],
  token?: string,
): Promise<Map<number, boolean>> {
  const results = new Map<number, boolean>();

  // Process in parallel with concurrency limit
  const CONCURRENCY = 5;
  for (let i = 0; i < issueNumbers.length; i += CONCURRENCY) {
    const batch = issueNumbers.slice(i, i + CONCURRENCY);
    const checks = await Promise.all(
      batch.map(async (num) => {
        const hasMergedPR = await checkLinkedMergedPR(owner, repo, num, token);
        return [num, hasMergedPR] as const;
      }),
    );
    for (const [num, hasMergedPR] of checks) {
      results.set(num, hasMergedPR);
    }
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function buildHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'pipe-api/1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}
