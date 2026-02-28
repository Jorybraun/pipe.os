import { defineFunction } from '@aws-amplify/backend';
import { auth } from '@aws-amplify/backend/auth';
import { data } from '@aws-amplify/backend/data';

export const scoringAgent = defineFunction({
  name: 'scoringAgent',
  entryPoint: './handler.ts',
  runtime: 'nodejs18',
  memory: 256,
  timeout: 30,
});

