import { defineFunction } from '@aws-amplify/backend';

/**
 * submitCodeReview Lambda Function
 *
 * STREAM 2: Code Review Challenge Backend Infrastructure
 * Phase 4: Submission Handler
 *
 * Handles code review submissions from candidates:
 * - Validates annotation structure comprehensively
 * - Saves Assessment with annotations, summary, and timestamp
 * - Triggers async dev container destruction (non-blocking)
 * - Returns confirmation with submission metadata
 *
 * Performance Targets:
 * - Response time: < 2 seconds
 * - Success rate: 99.9%
 * - DynamoDB cost: < $0.01 per invocation
 *
 * Authorization: Public API key (candidate submission)
 */
export const submitCodeReview = defineFunction({
  name: 'submitCodeReview',
  entry: './handler.ts',

  // Performance configuration
  timeoutSeconds: 30, // Allow time for DynamoDB + async operations
  memoryMB: 256, // Modest memory for validation + I/O

  // Environment variables
  environment: {
    CHALLENGE_SUBMISSION_TABLE_NAME: 'ChallengeSubmission',
    LOG_LEVEL: 'INFO',
  },

  // Resource group
  resourceGroupName: 'data',

  // Runtime
  runtime: 22, // Node.js 22
});
