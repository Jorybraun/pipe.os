import { defineFunction, secret } from '@aws-amplify/backend';

export const scoringAgent = defineFunction({
  name: 'scoringAgent',
  entry: './handler.ts',
  runtime: 22,
  memoryMB: 512,
  timeoutSeconds: 60,
  environment: {
    ASSESSMENT_TABLE_NAME: 'Assessment',
    CHALLENGE_TABLE_NAME: 'Challenge',

    // Mistral — used for agentic CODE_REVIEW scoring
    MISTRAL_API_KEY: secret('MISTRAL_API_KEY'),
    MISTRAL_MODEL: 'mistral-large-latest',
    MODEL_MAX_TOKENS: '512',
  },
  resourceGroupName: 'data',
});
