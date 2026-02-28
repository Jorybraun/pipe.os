import { defineFunction } from '@aws-amplify/backend';

export const scoringAgent = defineFunction({
  name: 'scoringAgent',
  entry: './handler.ts',
  runtime: 20,
  memoryMB: 256,
  timeoutSeconds: 30,
});
