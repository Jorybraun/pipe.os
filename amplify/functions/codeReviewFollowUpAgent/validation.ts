/**
 * Input validation for codeReviewFollowUpAgent
 */

import type { FollowUpAgentInput } from './types';

/**
 * Validates the Lambda input event.
 *
 * @throws Error if validation fails
 */
export function validateInput(event: unknown): FollowUpAgentInput {
  if (typeof event !== 'object' || event === null) {
    throw new Error('VALIDATION: event must be an object');
  }

  const e = event as Record<string, unknown>;

  // AppSync mutations pass arguments under event.arguments
  const args = (e['arguments'] ?? e) as Record<string, unknown>;

  const challengeSubmissionId = args['challengeSubmissionId'];

  if (typeof challengeSubmissionId !== 'string' || challengeSubmissionId.trim().length === 0) {
    throw new Error('VALIDATION: challengeSubmissionId is required');
  }

  return { challengeSubmissionId: challengeSubmissionId.trim() };
}

/**
 * Sanitizes free-text content before embedding in prompts.
 * Strips common prompt injection patterns.
 */
export function sanitizeForPrompt(input: string, maxLength = 3000): string {
  return input
    .replace(/ignore previous instructions/gi, '[filtered]')
    .replace(/system:/gi, '[filtered]')
    .replace(/assistant:/gi, '[filtered]')
    .replace(/<\|im_start\|>/gi, '[filtered]')
    .replace(/<\|im_end\|>/gi, '[filtered]')
    .replace(/\[INST\]/gi, '[filtered]')
    .replace(/\[\/INST\]/gi, '[filtered]')
    .slice(0, maxLength);
}
