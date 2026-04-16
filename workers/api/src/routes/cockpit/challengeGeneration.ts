/**
 * Challenge Generation routes — ADR-034 CA Phase 3
 *
 * Mounts under /api/v1/challenges/generate.
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Routes:
 *   POST /            — generate challenges from role discovery persona
 *   POST /batch-save  — save generated challenges as draft templates
 *   POST /refine      — AI-assisted refinement of an existing challenge
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { runGenerationPipeline } from '../../lib/challengeGeneration/pipeline';
import { createGenerationProvider } from '../../lib/llm/createProvider';
import { buildRefinementPrompt } from '../../lib/challengeGeneration/prompts';
import type { LLMMessage } from '../../lib/llm/types';
import type { Env, Variables, CandidatePersona, RoleContextDocument, RoleContextRow, ChallengeTemplateRow } from '../../types';

const TEMPLATE_TYPES = ['CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER'] as const;
const DIFFICULTIES = ['JUNIOR', 'MID', 'SENIOR'] as const;

const generateSchema = z.object({
  roleContextId: z.string().min(1).optional(),
  types: z.array(z.enum(TEMPLATE_TYPES)).optional(),
  count: z.number().int().min(1).max(10).optional(),
  seniority: z.enum(DIFFICULTIES).optional(),
  /** Free-text role description when no role context exists. */
  roleDescription: z.string().max(2000).optional(),
});

export const challengeGeneration = new Hono<{ Bindings: Env; Variables: Variables }>();
challengeGeneration.use('*', authMiddleware);

// POST / — generate challenges from persona
challengeGeneration.post('/', async (c) => {
  const body = await c.req.json();
  const parsed = generateSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const { roleContextId, types, count, seniority, roleDescription } = parsed.data;

  // Resolve persona + RCD: from role context if provided, or build a minimal
  // persona from roleDescription. RCD is preferred (ADR-036 Phase 3) —
  // consumer_slice provides the legacy persona shape for backwards compat
  // during the migration window.
  let persona: CandidatePersona | null = null;
  let rcd: RoleContextDocument | null = null;

  if (roleContextId) {
    const row = await c.env.DB.prepare(
      'SELECT id, persona_json, rcd_json FROM role_contexts WHERE id = ?1',
    )
      .bind(roleContextId)
      .first<Pick<RoleContextRow, 'id' | 'persona_json' | 'rcd_json'>>();

    if (!row) {
      return apiError(c, 'NOT_FOUND', 'Role context not found.');
    }

    if (row.rcd_json) {
      try {
        rcd = JSON.parse(row.rcd_json) as RoleContextDocument;
        persona = rcd.consumer_slice;
      } catch {
        return apiError(c, 'INTERNAL_ERROR', 'Failed to parse stored RCD.');
      }
    }

    if (!persona && row.persona_json) {
      try {
        persona = JSON.parse(row.persona_json) as CandidatePersona;
      } catch {
        return apiError(c, 'INTERNAL_ERROR', 'Failed to parse stored persona.');
      }
    }
  }

  // Fallback: build a generic persona from seniority + roleDescription
  if (!persona) {
    const seniorityLabel = seniority ?? 'MID';
    persona = {
      seniority: seniorityLabel,
      archetype: roleDescription ?? 'Software Engineer',
      mustHaveSkills: ['Problem Solving', 'Code Quality', 'Communication'],
      niceToHaveSkills: [],
      disposition: [],
      careerSignal: '',
      redFlags: [],
      dealbreakers: [],
    };
  }

  // Run the 4-stage generation pipeline
  try {
    const result = await runGenerationPipeline(c.env, persona, {
      ...(types !== undefined ? { types } : {}),
      ...(count !== undefined ? { count } : {}),
      ...(seniority !== undefined ? { seniority } : {}),
    }, rcd);
    return c.json(result);
  } catch (err) {
    console.error('[challengeGeneration] Pipeline failed:', err);
    return apiError(
      c,
      'INTERNAL_ERROR',
      `Challenge generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
    );
  }
});

// ─── POST /batch-save — save generated challenges as draft templates ─────────

const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;

const batchSaveSchema = z.object({
  challenges: z.array(z.object({
    type: z.enum(TEMPLATE_TYPES),
    title: z.string().min(1).max(400),
    instructions: z.string().min(1),
    difficulty: z.enum(DIFFICULTIES),
    primarySkill: z.string().min(1).max(100),
    secondarySkills: z.array(z.string()).optional(),
    bloomLevel: z.enum(BLOOM_LEVELS).nullable().optional(),
    estimatedMinutes: z.number().int().min(1).max(180).nullable().optional(),
    config: z.record(z.unknown()),
  })).min(1).max(20),
});

challengeGeneration.post('/batch-save', async (c) => {
  const body = await c.req.json();
  const parsed = batchSaveSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const userId = c.var.userId;
  const now = new Date().toISOString();
  const savedIds: string[] = [];

  for (const ch of parsed.data.challenges) {
    const id = crypto.randomUUID().replace(/-/g, '');
    await c.env.DB.prepare(
      `INSERT INTO challenge_templates
        (id, type, title, instructions, difficulty, primary_skill, secondary_skills,
         bloom_level, estimated_minutes, config, server_config, source, is_published,
         created_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`,
    )
      .bind(
        id,
        ch.type,
        ch.title,
        ch.instructions,
        ch.difficulty,
        ch.primarySkill,
        JSON.stringify(ch.secondarySkills ?? []),
        ch.bloomLevel ?? null,
        ch.estimatedMinutes ?? null,
        JSON.stringify(ch.config),
        null,
        'AI_GENERATED',
        0, // draft
        userId,
        now,
        now,
      )
      .run();
    savedIds.push(id);
  }

  return c.json({ savedIds, count: savedIds.length }, 201);
});

// ─── POST /refine — AI-assisted refinement of an existing challenge ──────────

const refineSchema = z.object({
  challengeTemplateId: z.string().min(1),
  instructions: z.string().min(1).max(1000),
});

challengeGeneration.post('/refine', async (c) => {
  const body = await c.req.json();
  const parsed = refineSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const { challengeTemplateId, instructions } = parsed.data;

  // Fetch existing challenge
  const row = await c.env.DB.prepare(
    'SELECT * FROM challenge_templates WHERE id = ?1',
  )
    .bind(challengeTemplateId)
    .first<ChallengeTemplateRow>();

  if (!row) return apiError(c, 'NOT_FOUND', 'Challenge template not found.');

  const challenge = {
    type: row.type,
    title: row.title,
    instructions: row.instructions,
    difficulty: row.difficulty,
    primarySkill: row.primary_skill,
    secondarySkills: JSON.parse(row.secondary_skills ?? '[]') as string[],
    bloomLevel: row.bloom_level,
    estimatedMinutes: row.estimated_minutes,
    config: JSON.parse(row.config) as Record<string, unknown>,
  };

  // Mock path
  if (c.env.MOCK_AI === 'true') {
    return c.json({
      refined: {
        ...challenge,
        title: `[Refined] ${challenge.title}`,
        instructions: `${challenge.instructions}\n\n_Refined per: ${instructions}_`,
      },
    });
  }

  const provider = createGenerationProvider(c.env, '@cf/google/gemma-4-26b-a4b-it');
  if (!provider) return apiError(c, 'INTERNAL_ERROR', 'AI binding not available.');

  const prompt = buildRefinementPrompt(challenge, instructions);
  const messages: LLMMessage[] = [
    { role: 'system', content: prompt },
    { role: 'user', content: 'Refine the challenge now. Return only the JSON.' },
  ];

  try {
    const completion = await provider.complete(messages, { forceJson: true, maxTokens: 2048 });
    if (!completion.content) throw new Error('Empty response');
    const refined = JSON.parse(completion.content) as Record<string, unknown>;
    return c.json({ refined });
  } catch (err) {
    console.error('[challengeGeneration] Refine failed:', err);
    return apiError(c, 'INTERNAL_ERROR', 'AI refinement failed.');
  }
});
