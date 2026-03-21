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
 * Steps:
 * 1. Validate input (assessmentId)
 * 2. Fetch Assessment + linked Challenge from DynamoDB
 * 3. Extract candidate annotations and challenge diff/code context
 * 4. Call Claude to generate exactly 5 SHORT_ANSWER questions
 * 5. Save questions to Assessment.followUpQuestionsJson
 * 6. Return questions
 *
 * Performance Targets:
 * - Response time: < 10 seconds
 * - Cost per invocation: < $0.05
 *
 * Environment Variables:
 * - ANTHROPIC_API_KEY: Claude API key (from Secrets Manager)
 * - ASSESSMENT_TABLE_NAME: DynamoDB table for Assessment
 * - CHALLENGE_TABLE_NAME: DynamoDB table for Challenge
 */
export const codeReviewFollowUpAgent = defineFunction({
  name: 'codeReviewFollowUpAgent',
  entry: './handler.ts',

  // Performance configuration
  timeoutSeconds: 60,   // Claude API call + DynamoDB reads/write
  memoryMB: 512,

  // Environment variables
  environment: {
    ANTHROPIC_API_KEY: secret('ANTHROPIC_API_KEY'),

    // Database config
    ASSESSMENT_TABLE_NAME: 'Assessment',
    CHALLENGE_TABLE_NAME: 'Challenge',

    // Claude model configuration
    CLAUDE_MODEL: 'claude-sonnet-4-20250514',
    CLAUDE_MAX_TOKENS: '2048',

    // Cost tracking (USD per million tokens)
    CLAUDE_INPUT_COST_PER_M: '3',
    CLAUDE_OUTPUT_COST_PER_M: '15',

    // Budget
    COST_BUDGET_PER_SESSION: '0.10',
  },

  // Runtime
  runtime: 22,

  // Resource group — grants DynamoDB table access
  resourceGroupName: 'data',
});
