import { defineFunction } from '@aws-amplify/backend';

export const submitChallengeResponse = defineFunction({
  name: 'submitChallengeResponse',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 15,
  resourceGroupName: 'data',
  environment: {
    CANDIDATE_TABLE_NAME: 'Candidate',
    STAGE_TABLE_NAME: 'Stage',
    ASSESSMENT_TABLE_NAME: 'Assessment',
    CHALLENGE_TABLE_NAME: 'Challenge',
    CHALLENGE_SUBMISSION_TABLE_NAME: 'ChallengeSubmission',
  },
});
