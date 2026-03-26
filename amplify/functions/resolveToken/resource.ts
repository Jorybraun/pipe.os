import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * resolveToken Lambda
 *
 * Validates inviteToken, issues a short-lived JWT session token, and claims
 * the inviteToken (one-time use). The JWT is used for all subsequent
 * Lambda-authorized candidate API calls.
 *
 * Returns: { id, pipelineId, status, name, sessionToken }
 *
 * Authorization: publicApiKey only (this is the sole entry point for candidates).
 */
export const resolveToken = defineFunction({
  name: 'resolveToken',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 10,
  environment: {
    CANDIDATE_TABLE_NAME: 'Candidate', // overridden in backend.ts with real hashed name
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
  },
  resourceGroupName: 'data',
});
