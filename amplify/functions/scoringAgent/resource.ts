import { defineFunction } from '@aws-amplify/backend';

export const scoringAgent = defineFunction({
  name: 'scoringAgent',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 256,
  timeoutSeconds: 30,
  environment: {
    ASSESSMENT_TABLE_NAME: 'Assessment',
    CHALLENGE_TABLE_NAME: 'Challenge',
  },
  resourceGroupName: 'data',
});
