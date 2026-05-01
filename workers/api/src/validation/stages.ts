import { z } from 'zod';

/**
 * Valid challenge types — matches the D1 CHECK constraint.
 */
/**
 * Valid stage types — validated at API layer, not DB constraint.
 */
export const STAGE_TYPES = [
  'SCREENING',
  'CULTURAL',
  'CODE_REVIEW',
  'OPEN_SOURCE',
  'LIVE_PANEL',
] as const;

export const CHALLENGE_TYPES = [
  'CODE_REVIEW',
  'CODE_IMPLEMENTATION',
  'QUIZ_MCQ',
  'QUIZ_SHORT_ANSWER',
  'FOLLOW_UP',
  'INTAKE',
] as const;

/**
 * Zod schema for POST /api/v1/pipelines/:pipelineId/stages
 */
export const createStageSchema = z.object({
  title: z
    .string({ required_error: 'title is required' })
    .min(1, 'title must not be empty')
    .max(200, 'title must be 200 characters or fewer'),
  description: z.string().optional(),
  order: z.number().int().min(0).optional(),
  stageType: z.enum(STAGE_TYPES).nullable().optional(),
  isScheduled: z.boolean().optional(),
});

export type CreateStageInput = z.infer<typeof createStageSchema>;

/**
 * Zod schema for PATCH /api/v1/stages/:stageId
 */
export const updateStageSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  timeLimit: z.number().int().min(1).nullable().optional(),
  mode: z.enum(['ASYNC', 'LIVE_VIDEO']).optional(),
  notificationTemplates: z
    .array(
      z.object({
        trigger: z.enum(['INVITATION', 'SUCCESS', 'FAILURE']),
        subject: z.string(),
        body: z.string(),
      }),
    )
    .optional(),
  schedulingEventTypeId: z.string().optional().nullable(),
  stageType: z.enum(STAGE_TYPES).nullable().optional(),
  isScheduled: z.boolean().optional(),
});

export type UpdateStageInput = z.infer<typeof updateStageSchema>;

/**
 * Zod schema for POST /api/v1/stages/:stageId/challenges
 */
export const createChallengeSchema = z.object({
  type: z.enum(CHALLENGE_TYPES, {
    errorMap: () => ({
      message: `type must be one of: ${CHALLENGE_TYPES.join(', ')}`,
    }),
  }),
  title: z
    .string({ required_error: 'title is required' })
    .min(1, 'title must not be empty')
    .max(300, 'title must be 300 characters or fewer'),
  instructions: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  serverConfig: z.record(z.unknown()).optional(),
  order: z.number().int().min(0).optional(),
  // GitHub PR fields (CODE_REVIEW only)
  githubRepoUrl: z.string().url().optional(),
  githubPrNumber: z.number().int().positive().optional(),
  githubPrTitle: z.string().optional(),
  githubPrDescription: z.string().optional(),
  // Dev container fields (CODE_IMPLEMENTATION / OPEN_SOURCE)
  devContainerRepoUrl: z.string().url().optional(),
  devContainerChallengeBranch: z.string().optional(),
});

export type CreateChallengeInput = z.infer<typeof createChallengeSchema>;

/**
 * Zod schema for PATCH /api/v1/stages/:stageId/challenges/reorder
 */
export const reorderChallengesSchema = z.object({
  challenges: z.array(
    z.object({
      id: z.string().min(1),
      order: z.number().int().min(0),
    }),
  ),
});

export type ReorderChallengesInput = z.infer<typeof reorderChallengesSchema>;

/**
 * Zod schema for PATCH /api/v1/challenges/:challengeId
 */
export const updateChallengeSchema = z.object({
  title: z.string().min(1).max(300).optional(),
  instructions: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  serverConfig: z.record(z.unknown()).optional(),
});

export type UpdateChallengeInput = z.infer<typeof updateChallengeSchema>;
