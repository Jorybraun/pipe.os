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

  /**
   * Experience level for the role.
   * Optional — omitted when creating pipelines without a level (e.g. e2e seed helpers).
   */
  level: z
    .enum(LEVEL_VALUES, {
      errorMap: () => ({
        message: `level must be one of: ${LEVEL_VALUES.join(', ')}`,
      }),
    })
    .optional()
    .nullable(),

  /** Optional technology stack tags. */
  stack: z.array(z.string()).optional(),

  /** Optional free-text description. */
  description: z.string().optional(),

  /** Pipeline status. Defaults to DRAFT. */
  status: z.enum(['DRAFT', 'ACTIVE']).optional().default('DRAFT'),

  /** How the pipeline was created. */
  creationMode: z.enum(['BLANK', 'PRESET', 'TEMPLATE_PACK']).optional().default('BLANK'),

  /** Optional preset ID to expand into stages + challenges. */
  presetId: z.string().optional(),

  /** Optional template pack ID to expand into stages + challenges (ADR-034). */
  templatePackId: z.string().optional(),

  /** Optional template pack version — defaults to latest published. */
  templatePackVersion: z.number().int().min(1).optional(),
});

export type CreatePipelineInput = z.infer<typeof createPipelineSchema>;
