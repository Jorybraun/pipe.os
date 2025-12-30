/**
 * Input Validation with Zod
 *
 * Validates all user inputs and prevents prompt injection attacks.
 */

import { z } from 'zod';
import type { FormSection } from './types';

// Baseline schema
export const BaselineSchema = z.object({
  title: z.string().min(1).max(200),
  level: z.enum(['junior', 'mid', 'senior', 'staff', 'principal', 'lead', 'manager']),
  department: z.string().min(1).max(100),
  workModel: z.enum(['remote', 'hybrid', 'onsite']),
  teamSize: z.string().min(1).max(100),
  reportsTo: z.string().min(1).max(100),
  stack: z.array(z.string().max(50)).min(1).max(20),
});

// Question response schema
export const QuestionResponseSchema = z.object({
  questionId: z.string().uuid(),
  response: z.union([
    z.string().max(5000),
    z.array(z.string().max(100)).max(20),
  ]),
});

/**
 * Validates FormSection has allowed number of questions.
 *
 * @param section - Form section to validate
 * @throws Error if validation fails
 */
export function validateFormSection(section: FormSection): void {
  const maxQuestions = parseInt(process.env.MAX_QUESTIONS_PER_BATCH || '5');

  if (section.questions.length > maxQuestions) {
    throw new Error(
      `FormSection has ${section.questions.length} questions, max allowed is ${maxQuestions}`
    );
  }

  if (section.questions.length === 0) {
    throw new Error('FormSection must have at least 1 question');
  }

  // Validate each question has required fields
  for (const question of section.questions) {
    if (!question.id || !question.text || !question.type) {
      throw new Error(`Invalid question structure: ${JSON.stringify(question)}`);
    }
  }
}

/**
 * Sanitizes user input to prevent prompt injection.
 *
 * Filters out common prompt injection patterns and limits length.
 *
 * @param input - Raw user input
 * @returns Sanitized input safe for LLM prompts
 */
export function sanitizeUserInput(input: string): string {
  return input
    .replace(/ignore previous instructions/gi, '[filtered]')
    .replace(/system:/gi, '[filtered]')
    .replace(/assistant:/gi, '[filtered]')
    .replace(/<\|im_start\|>/gi, '[filtered]')
    .replace(/<\|im_end\|>/gi, '[filtered]')
    .replace(/\[INST\]/gi, '[filtered]')
    .replace(/\[\/INST\]/gi, '[filtered]')
    .slice(0, 5000);  // Hard limit
}

/**
 * Validates QuestionAgentRequest structure.
 *
 * @param request - Request to validate
 * @throws Error if validation fails
 */
export function validateQuestionAgentRequest(request: unknown): void {
  if (typeof request !== 'object' || request === null) {
    throw new Error('Request must be an object');
  }

  const req = request as Record<string, unknown>;

  if (!req.roleContext || typeof req.roleContext !== 'object') {
    throw new Error('roleContext is required');
  }

  // Validate responses if provided
  if (req.responses) {
    if (!Array.isArray(req.responses)) {
      throw new Error('responses must be an array');
    }

    for (const response of req.responses) {
      try {
        QuestionResponseSchema.parse(response);
      } catch (error) {
        throw new Error(`Invalid response structure: ${error}`);
      }
    }
  }
}
