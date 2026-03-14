import { defineFunction, secret } from '@aws-amplify/backend';

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
    // GitHub token from Amplify secrets (set via: npx ampx sandbox secret set GITHUB_TOKEN)
    GITHUB_TOKEN: secret('GITHUB_TOKEN'),

    // AWS region is automatically provided by Lambda runtime
    // Access via process.env.AWS_REGION in handler code

    // Logging
    LOG_LEVEL: 'INFO',
  },

  // Resource group
  resourceGroupName: 'data',

  // Runtime
  runtime: 22, // Node.js 22
});
