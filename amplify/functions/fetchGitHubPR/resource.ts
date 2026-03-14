import { defineFunction } from '@aws-amplify/backend';

/**
 * fetchGitHubPR Lambda Function
 *
 * STREAM 2: GitHub PR Integration for Code Review Challenges
 * Phase 1: GitHub API Integration
 *
 * Fetches PR metadata and diff from GitHub API, parses into structured format
 * for caching with Challenge model.
 *
 * Called by: Admin UI during challenge creation
 * Authorization: Recruiter (Cognito authenticated)
 *
 * Performance Targets:
 * - Response time: < 2 seconds (typical PR)
 * - Success rate: 99.5% (accounting for network/GitHub API issues)
 * - Cost: < $0.01 per invocation
 */
export const fetchGitHubPR = defineFunction({
  name: 'fetchGitHubPR',
  entry: './handler.ts',

  // Performance configuration
  timeoutSeconds: 60, // GitHub API can be slow during pagination
  memoryMB: 512, // Need memory for diff parsing + Octokit

  // Environment variables
  environment: {
    // GitHub token stored in Secrets Manager
    GITHUB_TOKEN_SECRET_ARN: process.env.GITHUB_TOKEN_SECRET_ARN || 'pipe-github-pr-integration',

    // AWS region
    AWS_REGION: process.env.AWS_REGION || 'us-east-1',

    // Logging
    LOG_LEVEL: 'INFO',
  },

  // Resource group
  resourceGroupName: 'data',

  // Runtime
  runtime: 22, // Node.js 22
});
