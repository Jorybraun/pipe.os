import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Job Description Agent Lambda Function
 *
 * Generates comprehensive job descriptions and interview recommendations
 * from accumulated role context.
 *
 * Only invoked when RoleContext status === 'ready'.
 *
 * Outputs:
 * 1. Job Description (with all required sections)
 * 2. Candidate Filters (screening criteria)
 * 3. Suggested Interview Stages (for future phase)
 *
 * Performance Targets:
 * - Response time: < 15 seconds
 * - Cost per invocation: < $0.15
 *
 * Environment Variables:
 * - ANTHROPIC_API_KEY: Claude API key (from Secrets Manager)
 */
export const jobDescriptionAgent = defineFunction({
  name: 'jobDescriptionAgent',
  entry: './handler.ts',

  // Performance configuration
  timeoutSeconds: 60,        // Allow time for comprehensive generation
  memoryMB: 1024,            // More memory for larger context processing

  // Environment variables
  environment: {
    // Secret from AWS Secrets Manager
    ANTHROPIC_API_KEY: secret('ANTHROPIC_API_KEY'),

    // Configuration
    GENERATION_TIMEOUT_MS: '15000',  // 15s timeout for JD generation

    // Claude model configuration
    CLAUDE_MODEL: 'claude-sonnet-4-20250514',
    CLAUDE_MAX_TOKENS: '2048',       // Longer output for job description

    // Cost tracking (USD per million tokens)
    CLAUDE_INPUT_COST_PER_M: '3',
    CLAUDE_OUTPUT_COST_PER_M: '15',
  },

  // Runtime
  runtime: 22,  // Node.js 22
});
