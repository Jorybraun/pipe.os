/**
 * Type Definitions for fetchGitHubPR Lambda
 *
 * STREAM 2: GitHub PR Integration for Code Review Challenges
 * Phase 1: GitHub API Integration
 */

/**
 * Input to the fetchGitHubPR Lambda function
 */
export interface FetchGitHubPRInput {
  /** GitHub repository URL (e.g., "https://github.com/octocat/Hello-World") */
  repoUrl: string;

  /** PR number (e.g., 42) */
  prNumber: number;

  /** Optional: Skip cache, force fresh fetch from GitHub */
  skipCache?: boolean;
}

/**
 * Successful response from fetchGitHubPR
 */
export interface FetchGitHubPRSuccess {
  success: true;
  data: {
    prNumber: number;
    title: string;
    description: string;
    author: string;
    state: 'open' | 'closed' | 'merged';
    filesChanged: number;
    additions: number;
    deletions: number;
    diff: DiffJson;
    metadata: Metadata;
    fetchedAt: string;
    warnings?: string[];
  };
  error: null;
}

/**
 * Error response from fetchGitHubPR
 */
export interface FetchGitHubPRError {
  success: false;
  data: null;
  error: {
    code: ErrorCode;
    message: string;
    retryable: boolean;
  };
}

/** Type guard helper */
export type FetchGitHubPRResponse = FetchGitHubPRSuccess | FetchGitHubPRError;

/**
 * Error codes as defined in tech spec (Section 4.3)
 */
export type ErrorCode =
  | 'INVALID_INPUT'
  | 'INVALID_REPOSITORY'
  | 'PULL_REQUEST_NOT_FOUND'
  | 'GITHUB_AUTH_ERROR'
  | 'RATE_LIMIT_EXCEEDED'
  | 'DIFF_TOO_LARGE'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Structured diff representation
 * Converted from GitHub's raw patch format into hunks + lines
 */
export interface DiffJson {
  files: DiffFile[];
}

export interface DiffFile {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string; // "@@ -15,8 +15,42 @@ ..."
  lines: DiffLine[];
}

export interface DiffLine {
  type: 'addition' | 'deletion' | 'context';
  lineNumber: number;
  content: string;
}

/**
 * Metadata snapshot from GitHub PR
 * Cached with Challenge for recruiter review
 */
export interface Metadata {
  author: string;
  avatar: string;
  createdAt: string;
  updatedAt: string;
  state: 'open' | 'closed' | 'merged';
  labels: string[];
  htmlUrl: string;
  reviewers: string[];
  featureBranch: string;
  baseBranch: string;
}

/**
 * Parsed GitHub repository URL
 */
export interface ParsedGitHubRepo {
  owner: string;
  repo: string;
}

/**
 * Custom error classes for specific GitHub failure modes
 */
export class GitHubAPIError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public retryable: boolean
  ) {
    super(message);
    this.name = 'GitHubAPIError';
  }
}
