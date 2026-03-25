import { defineFunction } from '@aws-amplify/backend';

/**
 * generateMediaUploadUrl Lambda
 *
 * Validates a candidateId exists in the Candidate table, then returns a
 * presigned S3 PUT URL so the candidate can upload their media recording
 * directly to S3 without needing Cognito credentials.
 *
 * Authorization: publicApiKey (candidates are not Cognito users).
 *
 * S3 path: candidate-submissions/{candidateId}/{challengeId}.webm
 * URL TTL: 5 minutes — sufficient for a single upload attempt.
 */
export const generateMediaUploadUrl = defineFunction({
  name: 'generateMediaUploadUrl',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 10,
  environment: {
    ASSET_BUCKET_NAME: 'pipeAssets', // overridden in backend.ts with real bucket name
    CANDIDATE_TABLE_NAME: 'Candidate', // overridden in backend.ts with real hashed name
  },
  resourceGroupName: 'data',
});
