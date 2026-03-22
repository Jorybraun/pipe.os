import { defineFunction } from '@aws-amplify/backend';

/**
 * resolveToken Lambda
 *
 * Replaces the client-side `Candidate.list({ filter: { inviteToken: { eq: token } } })` pattern.
 * Server-side validation ensures only the matching candidate's non-sensitive fields are returned.
 *
 * Returns: { id, pipelineId, status } — deliberately excludes name, email, and inviteToken.
 *
 * Authorization: publicApiKey only (unauthenticated candidates).
 */
export const resolveToken = defineFunction({
  name: 'resolveToken',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 10,
  environment: {
    CANDIDATE_TABLE_NAME: 'Candidate', // overridden in backend.ts with real hashed name
  },
  resourceGroupName: 'data',
});
