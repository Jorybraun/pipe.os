import { defineFunction, secret } from '@aws-amplify/backend';

/**
 * Question Agent Lambda Function
 *
 * Generates contextual questions for role discovery through a multi-step process:
 * 1. Extract facts from user responses
 * 2. Assess readiness (do we have enough context?)
 * 3. Generate targeted questions with quality review loop
 *
 * Performance Targets:
 * - Response time: < 5 seconds
 * - Cost per invocation: < $0.10
 *
 * Environment Variables:
 * - ANTHROPIC_API_KEY: Claude API key (from Secrets Manager)
 * - MAX_QUESTIONS_PER_BATCH: Maximum questions to generate (default: 5)
 * - COST_BUDGET_PER_SESSION: Maximum AI cost per session (default: 0.50)
 * - MAX_QUALITY_ITERATIONS: Maximum review loop iterations (default: 2)
 */
export const questionAgent = defineFunction({
  name: 'questionAgent',
  entry: './handler.ts',

  // Performance configuration
  timeoutSeconds: 30,        // Allow time for quality loop + Anthropic API calls
  memoryMB: 512,             // Optimize for cost (increase if needed)

  // Environment variables
  environment: {
    // Secret from AWS Secrets Manager
    ANTHROPIC_API_KEY: secret('ANTHROPIC_API_KEY'),

    // Configuration
    MAX_QUESTIONS_PER_BATCH: '5',           // From Product Brief constraint
    COST_BUDGET_PER_SESSION: '0.50',        // Budget constraint
    MAX_QUALITY_ITERATIONS: '2',            // Reduced from 3 for performance
    GENERATION_TIMEOUT_MS: '4500',          // 4.5s timeout for generation

    // Claude model configuration
    CLAUDE_MODEL: 'claude-sonnet-4-20250514',
    CLAUDE_MAX_TOKENS: '1024',

    // Cost tracking (USD per million tokens)
    CLAUDE_INPUT_COST_PER_M: '3',
    CLAUDE_OUTPUT_COST_PER_M: '15',
  },

  // Runtime
  runtime: 22,  // Node.js 22
});
