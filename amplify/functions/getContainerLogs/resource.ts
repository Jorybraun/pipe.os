import { defineFunction } from '@aws-amplify/backend';

export const getContainerLogs = defineFunction({
  name: 'getContainerLogs',
  entry: './handler.ts',
  runtime: 22,
  timeoutSeconds: 30,
});
