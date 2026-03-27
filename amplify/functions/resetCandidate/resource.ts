import { defineFunction } from '@aws-amplify/backend';

export const resetCandidate = defineFunction({
  name: 'resetCandidate',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 30,
  resourceGroupName: 'data',
  environment: {
    CANDIDATE_TABLE_NAME: 'Candidate',
    ASSESSMENT_TABLE_NAME: 'Assessment',
    CHALLENGE_SUBMISSION_TABLE_NAME: 'ChallengeSubmission',
    CANDIDATE_MEDIA_TABLE_NAME: 'CandidateMedia',
  },
});
