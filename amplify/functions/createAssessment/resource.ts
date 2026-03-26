import { defineFunction } from '@aws-amplify/backend';

export const createAssessment = defineFunction({
  name: 'createAssessment',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 15,
  resourceGroupName: 'data',
  environment: {
    CANDIDATE_TABLE_NAME: 'Candidate',
    ASSESSMENT_TABLE_NAME: 'Assessment',
  },
});
