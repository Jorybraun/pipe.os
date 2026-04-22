import { z } from 'zod';

export const QUESTION_BUDGETS = [5, 10, 15, 20] as const;

export const ROLE_CONTEXT_STATUSES = ['BASELINE', 'INTERVIEWING', 'COMPLETE', 'ABANDONED'] as const;

/**
 * Baseline form — role-agnostic fields only (ADR-028).
 * Tech-specific fields (level, stack, teamSize, reportsTo, workModel)
 * are removed — the agent discovers these during the interview.
 */
export const baselineSchema = z.object({
  title: z.string().min(1, 'title is required').max(200),
  department: z.string().optional(),
  companyName: z.string().optional(),
  companyUrl: z.string().optional(),
  location: z.string().optional(),
  /** Compensation range captured upfront — e.g. "$150K–$180K base + equity". */
  salaryRange: z.string().max(200).optional(),
  /** Must-have technologies captured upfront — e.g. ["React", "TypeScript", "PostgreSQL"]. */
  techStack: z.array(z.string().max(100)).max(20).optional(),
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

/**
 * Participant roles for the calibration question (ADR-028).
 */
export const PARTICIPANT_ROLES = [
  'HIRING_MANAGER',
  'INTERNAL_RECRUITER',
  'EXTERNAL_RECRUITER',
  'TEAM_MEMBER',
] as const;

/**
 * POST /api/v1/role-contexts/:id/calibrate — recruiter flags a gap in the RCD.
 */
export const calibrateSchema = z.object({
  participantId: z.string().min(1, 'participantId is required'),
  flagType: z.string().min(1, 'flagType is required'),
  gapType: z.string().min(1, 'gapType is required'),
  note: z.string().max(1000).optional(),
  domain: z.string().min(1, 'domain is required'),
  attribute: z.string().min(1, 'attribute is required'),
});

export type CalibrateInput = z.infer<typeof calibrateSchema>;

/**
 * POST /api/v1/role-contexts/:id/invite — invite team members.
 */
export const inviteSchema = z.object({
  invitees: z.array(
    z.object({
      name: z.string().min(1, 'name is required').max(200),
      email: z.string().email('valid email required'),
    }),
  ).min(1, 'at least one invitee required').max(10),
});
