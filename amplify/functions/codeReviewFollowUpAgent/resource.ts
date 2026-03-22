import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Code Review Follow-Up Agent Lambda
 *
 * Generates 5 contextual SHORT_ANSWER follow-up questions after a candidate
 * submits a CODE_REVIEW challenge. Questions probe the reasoning behind specific
 * annotations, prioritisation decisions, and awareness of issues the candidate
 * may have missed.
 *
 * Trigger: generateCodeReviewFollowUps AppSync mutation
 *
 * Uses Mistral Large via the Mistral API (api.mistral.ai) with MISTRAL_API_KEY.
 *
 * Steps:
 * 1. Validate input (assessmentId)
 * 2. Fetch Assessment + linked Challenge from DynamoDB
 * 3. Extract candidate annotations and challenge diff/code context
 * 4. Call Mistral on Bedrock to generate exactly 5 SHORT_ANSWER questions
 * 5. Save questions to Assessment.followUpQuestionsJson
 * 6. Return questions
 *
 * Performance Targets:
 * - Response time: < 10 seconds
 * - Cost per invocation: < $0.05
 *
 * Environment Variables:
 * - MISTRAL_API_KEY: Mistral API key (from Secrets Manager)
 * - ASSESSMENT_TABLE_NAME: DynamoDB table for Assessment
 * - CHALLENGE_TABLE_NAME: DynamoDB table for Challenge
 */
export const codeReviewFollowUpAgent = defineFunction({
  name: 'codeReviewFollowUpAgent',
  entry: './handler.ts',

  // Performance configuration
  timeoutSeconds: 60,   // Bedrock call + DynamoDB reads/write
  memoryMB: 512,

  // Environment variables
  environment: {
    MISTRAL_API_KEY: secret('MISTRAL_API_KEY'),
    MISTRAL_AGENT_ID: secret('MISTRAL_AGENT_ID'),

    // Database config
    ASSESSMENT_TABLE_NAME: 'Assessment',
    CHALLENGE_TABLE_NAME: 'Challenge',

    // Mistral model configuration
    MISTRAL_MODEL: 'mistral-large-latest',
    MODEL_MAX_TOKENS: '2048',

    // Cost tracking (USD per million tokens — Mistral Large 2407 on Bedrock)
    MODEL_INPUT_COST_PER_M: '3',
    MODEL_OUTPUT_COST_PER_M: '9',

    // Budget
    COST_BUDGET_PER_SESSION: '0.10',
  },

  // Runtime
  runtime: 22,

  // Resource group — grants DynamoDB table access
  resourceGroupName: 'data',
});
