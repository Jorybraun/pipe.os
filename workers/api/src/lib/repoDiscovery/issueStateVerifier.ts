/**
 * Issue State Verifier — runtime check before challenge assignment (RD-P6).
 *
 * Issues are volatile — they can close, get assigned, or receive new activity
 * after we crawl them. This verifier checks the current state via GitHub API
 * before assigning an issue as a CODE_IMPLEMENTATION challenge.
 *
 * Called by: challenge assignment routes
 * Rate limits: Uses the same GITHUB_TOKEN as the crawler (5k/hour authenticated)
 */

import { fetchIssue } from '../github/issueClient';
import type { IssueStateCheck, RepoIssueRow } from '../../types';

export interface VerifyIssueStateOptions {
  /** GitHub personal access token (optional, increases rate limit). */
  token?: string;
}

/**
 * Verify the current state of an issue before challenge assignment.
 *
 * Returns state check result:
 *   - stillOpen: false → issue was closed, pick another
 *   - assignedToSomeone: true → warn recruiter (optional block)
 *   - hasNewActivity: true → body may have been updated, consider refresh
 */
export async function verifyIssueState(
  owner: string,
  repo: string,
  storedIssue: Pick<RepoIssueRow, 'issue_number' | 'github_updated_at' | 'crawled_at'>,
  options: VerifyIssueStateOptions = {},
): Promise<IssueStateCheck> {
  const { token } = options;

  const current = await fetchIssue(owner, repo, storedIssue.issue_number, token);

  // Issue not found (deleted?) — treat as closed
  if (!current) {
    return {
      stillOpen: false,
      hasNewActivity: false,
      assignedToSomeone: false,
      currentState: 'closed',
    };
  }

  const stillOpen = current.state === 'open';
  const storedUpdatedAt = new Date(storedIssue.github_updated_at).getTime();
  const currentUpdatedAt = new Date(current.github_updated_at).getTime();
  const hasNewActivity = currentUpdatedAt > storedUpdatedAt;

  // Check if issue has been assigned to someone
  // (We don't store assignee, so we fetch it fresh and check)
  const assignedToSomeone = await checkAssignee(owner, repo, storedIssue.issue_number, token);

  return {
    stillOpen,
    hasNewActivity,
    assignedToSomeone,
    currentState: current.state,
  };
}

/**
 * Check if an issue is currently assigned to someone.
 * Separate call because fetchIssue doesn't return assignee info.
 */
async function checkAssignee(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string,
): Promise<boolean> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'pipe-api/1.0',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
      { headers },
    );

    if (!response.ok) return false;

    const data = (await response.json()) as {
      assignee: { login: string } | null;
      assignees?: Array<{ login: string }>;
    };

    return data.assignee !== null || (data.assignees?.length ?? 0) > 0;
  } catch {
    // Fail open — don't block assignment if we can't check
    return false;
  }
}

/**
 * Pick the next valid issue from a candidate list.
 * Verifies each issue in order until one passes state check.
 *
 * @param candidates - Issues sorted by preference (best first)
 * @returns The first issue that passes state verification, or null if all fail
 */
export async function pickValidIssue(
  owner: string,
  repo: string,
  candidates: Array<Pick<RepoIssueRow, 'id' | 'issue_number' | 'github_updated_at' | 'crawled_at'>>,
  options: VerifyIssueStateOptions = {},
): Promise<{
  issue: typeof candidates[0];
  stateCheck: IssueStateCheck;
} | null> {
  for (const issue of candidates) {
    const stateCheck = await verifyIssueState(owner, repo, issue, options);

    if (stateCheck.stillOpen) {
      return { issue, stateCheck };
    }

    // Issue closed — continue to next candidate
    console.log(
      `[issueStateVerifier] Issue #${issue.issue_number} is now ${stateCheck.currentState}, skipping`,
    );
  }

  // All candidates failed
  return null;
}

/**
 * Extract owner and repo from a GitHub URL.
 * e.g., "https://github.com/facebook/react" → { owner: "facebook", repo: "react" }
 */
export function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== 'github.com') return null;
    const parts = u.pathname.replace(/^\//, '').replace(/\.git$/, '').split('/');
    if (parts.length < 2 || !parts[0] || !parts[1]) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}
