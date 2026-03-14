import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * listGitHubPRs Lambda Function
 *
 * Lists pull requests from a GitHub repository.
 * Used by the ChallengePicker to browse PRs when creating CODE_REVIEW challenges.
 *
 * Called by: Admin/Recruiter UI during challenge creation
 * Authorization: Cognito authenticated (recruiters only)
 */
export const listGitHubPRs = defineFunction({
  name: 'listGitHubPRs',
  entry: './handler.ts',

  timeoutSeconds: 30,
  memoryMB: 256,

  environment: {
    GITHUB_TOKEN: secret('GITHUB_TOKEN'),
    LOG_LEVEL: 'INFO',
  },

  resourceGroupName: 'data',
  runtime: 22,
});
