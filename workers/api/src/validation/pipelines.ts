import { z } from 'zod';

/**
 * Valid pipeline experience levels.
 * Matches the CHECK constraint in the D1 schema.
 */
export const LEVEL_VALUES = [
  'Junior',
  'Mid',
  'Senior',
  'Staff',
  'Principal',
  'Lead',
  'Manager',
] as const;

/**
 * Zod schema for the POST /api/v1/pipelines request body.
 */
export const createPipelineSchema = z.object({
  /** Display title for the pipeline. */
  title: z
    .string({ required_error: 'title is required' })
    .min(1, 'title must not be empty')
    .max(200, 'title must be 200 characters or fewer'),

  /** Experience level for the role. */
  level: z.enum(LEVEL_VALUES, {
    errorMap: () => ({
      message: `level must be one of: ${LEVEL_VALUES.join(', ')}`,
    }),
  }),

  /** Optional technology stack tags. */
  stack: z.array(z.string()).optional(),

  /** Optional free-text description. */
  description: z.string().optional(),

  /** Pipeline status. Defaults to DRAFT. */
  status: z.enum(['DRAFT', 'ACTIVE']).optional().default('DRAFT'),

  /** How the pipeline was created. */
  creationMode: z.enum(['BLANK', 'PRESET']).optional().default('BLANK'),

  /** Optional preset ID to expand into stages + challenges. */
  presetId: z.string().optional(),
});

export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
