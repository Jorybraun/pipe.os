import { defineFunction, secret } from '@aws-amplify/backend';

export const sessionAuthorizer = defineFunction({
  name: 'sessionAuthorizer',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 128,
  timeoutSeconds: 5,
  environment: {
    SESSION_TOKEN_SECRET: secret('SESSION_TOKEN_SECRET'),
  },
});
