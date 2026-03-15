import { defineFunction } from '@aws-amplify/backend';

/**
 * scoreCodeReview Lambda Function
 *
 * STREAM 2: GitHub PR Integration for Code Review Challenges
 * Phase 4: Code Review Scoring Engine
 *
 * Evaluates candidate code review annotations against ground truth.
 * Compares what the candidate found vs. what was expected.
 * Returns a score (0-100) with detailed feedback.
 *
 * Called by: submitCodeReview Lambda after assessment saved
 * Authorization: Internal Lambda-to-Lambda
 *
 * Performance Targets:
 * - Response time: < 1 second (synchronous scoring)
 * - Success rate: 99.9% (minimal external dependencies)
 * - Cost: < $0.01 per invocation
 */
export const scoreCodeReview = defineFunction({
  name: 'scoreCodeReview',
  entry: './handler.ts',

  // Performance configuration
  timeoutSeconds: 30, // Scoring is fast; local algorithm only
  memoryMB: 256, // Minimal memory needed

  // Environment variables
  environment: {
    // Database config
    ASSESSMENT_TABLE_NAME: 'Assessment',

    // AWS region is automatically provided by Lambda runtime
    // Access via process.env.AWS_REGION in handler code

    // Logging
    LOG_LEVEL: 'INFO',
  },

  // Resource group
  resourceGroupName: 'data',

  // Runtime
  runtime: 22, // Node.js 22
});
