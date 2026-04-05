import { z } from 'zod';

export const QUESTION_BUDGETS = [5, 10, 15, 20] as const;

export const ROLE_CONTEXT_STATUSES = ['BASELINE', 'INTERVIEWING', 'COMPLETE', 'ABANDONED'] as const;

/**
 * Baseline form — structured data always collected (free + pro tier).
 */
export const baselineSchema = z.object({
  title: z.string().min(1, 'title is required').max(200),
  level: z.string().optional(),
  stack: z.array(z.string()).optional(),
  department: z.string().optional(),
  workModel: z.string().optional(),
  location: z.string().optional(),
  teamSize: z.string().optional(),
  reportsTo: z.string().optional(),
});

/**
 * POST /api/v1/role-contexts — create a new role context with baseline.
 */
export const createRoleContextSchema = z.object({
  baseline: baselineSchema,
  questionBudget: z
    .number()
    .int()
    .refine((n) => (QUESTION_BUDGETS as readonly number[]).includes(n), {
      message: `questionBudget must be one of: ${QUESTION_BUDGETS.join(', ')}`,
    })
    .optional()
    .default(10),
});

export type CreateRoleContextInput = z.infer<typeof createRoleContextSchema>;

/**
 * POST /api/v1/role-contexts/:id/respond — submit answer, get next question.
 */
export const respondSchema = z.object({
  answer: z
    .string()
    .min(1, 'answer is required')
    .max(2000, 'answer must be 2000 characters or fewer'),
  questionId: z.string().min(1, 'questionId is required'),
});

export type RespondInput = z.infer<typeof respondSchema>;
