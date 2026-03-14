/**
 * listGitHubPRs Lambda Types
 *
 * Lists open (or filtered) pull requests from a GitHub repository.
 * Returns lightweight PR summaries without file diffs.
 */

export interface ListGitHubPRsInput {
  repoUrl: string;             // e.g. "https://github.com/owner/repo"
  state?: 'open' | 'closed' | 'all'; // default: 'open'
}

export interface PRSummary {
  number: number;
  title: string;
  description: string;
  author: string;
  avatar: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;
  createdAt: string;
  updatedAt: string;
  htmlUrl: string;
  labels: string[];
  baseBranch: string;
  featureBranch: string;
}

export interface RepoInfo {
  owner: string;
  name: string;
  fullName: string;
}

export interface ListGitHubPRsData {
  prs: PRSummary[];
  repo: RepoInfo;
  totalCount: number;
}

export interface ListGitHubPRsError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ListGitHubPRsResponse {
  success: boolean;
  data?: ListGitHubPRsData;
  error?: ListGitHubPRsError;
}
