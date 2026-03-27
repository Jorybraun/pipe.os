import { defineFunction } from '@aws-amplify/backend';

export const getChallenge = defineFunction({
  name: 'getChallenge',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 15,
  resourceGroupName: 'data',
  environment: {
    CANDIDATE_TABLE_NAME: 'Candidate',
    STAGE_TABLE_NAME: 'Stage',
    CHALLENGE_TABLE_NAME: 'Challenge',
    ASSESSMENT_TABLE_NAME: 'Assessment',
    CHALLENGE_SUBMISSION_TABLE_NAME: 'ChallengeSubmission',
  },
});
