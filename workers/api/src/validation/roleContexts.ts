import { z } from 'zod';

export const QUESTION_BUDGETS = [6, 8, 10, 15] as const;

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
    .default(8),
});

export type CreateRoleContextInput = z.infer<typeof createRoleContextSchema>;

export const createSimpleJobDescriptionRoleContextSchema = z.object({
  jobDescriptionMd: z.string().min(20, 'jobDescriptionMd must be at least 20 characters').max(20000),
  title: z.string().min(1).max(200).optional(),
  pipelineId: z.string().min(1).optional(),
  selectedTerms: z.array(z.string().min(1).max(100)).max(50).optional(),
});

export type CreateSimpleJobDescriptionRoleContextInput = z.infer<
  typeof createSimpleJobDescriptionRoleContextSchema
>;

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

// ── Shared schemas for the new state-machine architecture ────────────────────

const domainCoverageSchema = z.enum(['none', 'sparse', 'partial', 'covered', 'deep']);

const queuedQuestionSchema = z.object({
  questionId: z.string(),
  text: z.string(),
  acknowledgment: z.string(),
  goal: z.string().optional(),
  expectedCoverage: z.object({
    domain: z.string(),
    from: domainCoverageSchema,
    to: domainCoverageSchema,
  }).optional(),
  probeAlignment: z.string().optional(),
  questionType: z.string().optional(),
  input: z.object({
    type: z.enum(['text', 'textarea', 'tags', 'select', 'radio']),
    options: z.array(z.string()).optional(),
    placeholder: z.string().optional(),
  }),
  suggestedAnswers: z.array(z.string()).optional(),
  knowledgeStateUpdate: z.record(z.record(z.unknown())),
  domainCoverage: z.record(domainCoverageSchema),
});

export const interviewStateSchema = z.object({
  baseline: z.record(z.unknown()),
  participantRole: z.string().nullable().optional(),
  questionBudget: z.number().int().min(1),
  exchanges: z.array(
    z.object({
      questionId: z.string(),
      acknowledgment: z.string().optional(),
      question: z.string(),
      input: z.record(z.unknown()),
      answer: z.string().optional(),
    }),
  ),
  knowledgeState: z.record(z.record(z.unknown())),
  coverage: z.record(domainCoverageSchema),
  phase: z.string(),
  questionsAsked: z.number().int().min(0),
  synthesisReady: z.boolean(),
  reasoning: z.string().optional(),
  urgentGaps: z.array(z.string()).optional(),
  questionStack: z.array(queuedQuestionSchema).optional().default([]),
  // Domain-driven column tracking (optional for backward compat)
  currentDomain: z.string().nullable().optional(),
  domainCompletion: z.record(z.string()).optional(),
  domainQuestions: z.record(z.array(z.record(z.unknown()))).optional(),
  domainQuestionsDelivered: z.record(z.number()).optional(),
  domainFollowUpsDelivered: z.number().optional(),
});

export const stateActionSchema = z.object({
  state: interviewStateSchema.optional(),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('ANSWER'), answer: z.string().min(1).max(2000), knowledgeStateUpdate: z.record(z.record(z.unknown())).optional(), domainCoverage: z.record(z.string()).optional() }),
    z.object({ type: z.literal('SKIP') }),
    z.object({ type: z.literal('FORCE_SYNTHESIZE') }),
  ]),
});

export type StateActionInput = z.infer<typeof stateActionSchema>;

/**
 * POST /api/v1/role-contexts/:id/respond — submit answer, get next question.
 */
export const respondSchema = z.object({
  answer: z
    .string()
    .min(1, 'answer is required')
    .max(2000, 'answer must be 2000 characters or fewer'),
  questionId: z.string().min(1, 'questionId is required'),
  state: interviewStateSchema.optional(),
});

export type RespondInput = z.infer<typeof respondSchema>;

/**
 * POST /api/v1/role-contexts/:id/question — generate next question from state.
 */
export const questionSchema = z.object({
  state: interviewStateSchema,
  enableEval: z.boolean().optional(),
});

export type QuestionInput = z.infer<typeof questionSchema>;

/**
 * POST /api/v1/role-contexts/:id/synthesize — synthesize persona + JD from state.
 */
export const synthesizeSchema = z.object({
  state: interviewStateSchema,
});

export type SynthesizeInput = z.infer<typeof synthesizeSchema>;

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
