/**
 * Challenge Template routes — ADR-034 CA Phase 1
 *
 * Mounts under /api/v1/challenge-templates.
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Routes:
 *   GET    /                     — list templates (filterable)
 *   GET    /:id                  — get template with language variants
 *   POST   /                     — create template (draft)
 *   PUT    /:id                  — update draft template
 *   POST   /:id/publish          — publish (makes immutable)
 *   GET    /:id/variants         — list language variants
 *   POST   /:id/variants         — add language variant
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import type {
  Env,
  Variables,
  ChallengeTemplateRow,
  ChallengeLanguageVariantRow,
  ChallengeTemplateResponse,
  LanguageVariantResponse,
} from '../../types';

// ─── Validation schemas ───────────────────────────────────────────────────────

const TEMPLATE_TYPES = ['CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER'] as const;
const DIFFICULTIES = ['JUNIOR', 'MID', 'SENIOR'] as const;
const SOURCES = ['SYSTEM', 'AI_GENERATED', 'USER_CREATED'] as const;
const BLOOM_LEVELS = ['remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'] as const;

const createTemplateSchema = z.object({
  type: z.enum(TEMPLATE_TYPES),
  title: z.string().min(1).max(400),
  instructions: z.string().min(1),
  difficulty: z.enum(DIFFICULTIES),
  primarySkill: z.string().min(1).max(100),
  secondarySkills: z.array(z.string()).optional(),
  bloomLevel: z.enum(BLOOM_LEVELS).nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(180).nullable().optional(),
  config: z.record(z.unknown()),
  serverConfig: z.record(z.unknown()).optional(),
  source: z.enum(SOURCES).optional(),
});

const updateTemplateSchema = z.object({
  title: z.string().min(1).max(400).optional(),
  instructions: z.string().min(1).optional(),
  difficulty: z.enum(DIFFICULTIES).optional(),
  primarySkill: z.string().min(1).max(100).optional(),
  secondarySkills: z.array(z.string()).optional(),
  bloomLevel: z.enum(BLOOM_LEVELS).nullable().optional(),
  estimatedMinutes: z.number().int().min(1).max(180).nullable().optional(),
  config: z.record(z.unknown()).optional(),
  serverConfig: z.record(z.unknown()).optional(),
});

const createVariantSchema = z.object({
  language: z.string().min(1).max(50),
  starterCode: z.string().min(1),
  testSuite: z.string().min(1),
  testFramework: z.string().min(1).max(50),
  testCommand: z.string().min(1).max(200),
  solutionCode: z.string().nullable().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function parseJsonArr(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

function parseJsonObj(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

function templateRowToResponse(
  row: ChallengeTemplateRow,
  includeServerConfig: boolean,
): ChallengeTemplateResponse {
  const response: ChallengeTemplateResponse = {
    id: row.id,
    type: row.type,
    title: row.title,
    instructions: row.instructions,
    difficulty: row.difficulty,
    primarySkill: row.primary_skill,
    secondarySkills: parseJsonArr(row.secondary_skills),
    bloomLevel: row.bloom_level,
    estimatedMinutes: row.estimated_minutes,
    config: parseJsonObj(row.config),
    source: row.source,
    isPublished: !!row.is_published,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (includeServerConfig) {
    response.serverConfig = parseJsonObj(row.server_config);
  }
  return response;
}

function variantRowToResponse(
  row: ChallengeLanguageVariantRow,
  includeSolution: boolean,
): LanguageVariantResponse {
  const response: LanguageVariantResponse = {
    id: row.id,
    language: row.language,
    starterCode: row.starter_code,
    testSuite: row.test_suite,
    testFramework: row.test_framework,
    testCommand: row.test_command,
  };
  if (includeSolution) {
    response.solutionCode = row.solution_code;
  }
  return response;
}

// ─── Router ─────────────────────────────────────────────────────────────────

const challengeTemplates = new Hono<{ Bindings: Env; Variables: Variables }>();

challengeTemplates.use('*', authMiddleware);

// ─── GET / — list templates ─────────────────────────────────────────────────

challengeTemplates.get('/', async (c) => {
  const type = c.req.query('type');
  const difficulty = c.req.query('difficulty');
  const skill = c.req.query('skill');
  const source = c.req.query('source');
  const publishedParam = c.req.query('published');

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (type) {
    bindings.push(type);
    conditions.push(`type = ?${bindings.length}`);
  }
  if (difficulty) {
    bindings.push(difficulty);
    conditions.push(`difficulty = ?${bindings.length}`);
  }
  if (skill) {
    bindings.push(skill);
    conditions.push(`primary_skill = ?${bindings.length}`);
  }
  if (source) {
    bindings.push(source);
    conditions.push(`source = ?${bindings.length}`);
  }
  if (publishedParam === 'true') {
    conditions.push('is_published = 1');
  } else if (publishedParam === 'false') {
    conditions.push('is_published = 0');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await c.env.DB.prepare(
    `SELECT * FROM challenge_templates ${whereClause} ORDER BY created_at DESC`,
  )
    .bind(...bindings)
    .all<ChallengeTemplateRow>();

  return c.json({
    templates: (results ?? []).map((row) => templateRowToResponse(row, false)),
  });
});

// ─── GET /:id — get template with variants ──────────────────────────────────

challengeTemplates.get('/:id', async (c) => {
  const userId = c.var.userId;
  const templateId = c.req.param('id');

  const row = await c.env.DB.prepare(
    'SELECT * FROM challenge_templates WHERE id = ?1',
  )
    .bind(templateId)
    .first<ChallengeTemplateRow>();

  if (!row) return apiError(c, 'NOT_FOUND', 'Challenge template not found.');

  const isOwner = row.created_by === userId;

  const { results: variantRows } = await c.env.DB.prepare(
    'SELECT * FROM challenge_language_variants WHERE challenge_template_id = ?1',
  )
    .bind(templateId)
    .all<ChallengeLanguageVariantRow>();

  const response = templateRowToResponse(row, isOwner);
  response.variants = (variantRows ?? []).map((v) => variantRowToResponse(v, isOwner));

  return c.json(response);
});

// ─── POST / — create template ───────────────────────────────────────────────

challengeTemplates.post('/', async (c) => {
  const userId = c.var.userId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = createTemplateSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const input = parsed.data;
  const id = generateId();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO challenge_templates
       (id, type, title, instructions, difficulty, primary_skill, secondary_skills,
        bloom_level, estimated_minutes, config, server_config, source, is_published,
        created_by, created_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 0, ?13, ?14, ?14)`,
  )
    .bind(
      id,
      input.type,
      input.title,
      input.instructions,
      input.difficulty,
      input.primarySkill,
      input.secondarySkills ? JSON.stringify(input.secondarySkills) : null,
      input.bloomLevel ?? null,
      input.estimatedMinutes ?? null,
      JSON.stringify(input.config),
      input.serverConfig ? JSON.stringify(input.serverConfig) : null,
      input.source ?? 'USER_CREATED',
      userId,
      now,
    )
    .run();

  const created = await c.env.DB.prepare(
    'SELECT * FROM challenge_templates WHERE id = ?1',
  )
    .bind(id)
    .first<ChallengeTemplateRow>();

  return c.json(templateRowToResponse(created!, true), 201);
});

// ─── PUT /:id — update draft template ───────────────────────────────────────

challengeTemplates.put('/:id', async (c) => {
  const userId = c.var.userId;
  const templateId = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM challenge_templates WHERE id = ?1',
  )
    .bind(templateId)
    .first<ChallengeTemplateRow>();

  if (!existing) return apiError(c, 'NOT_FOUND', 'Challenge template not found.');
  if (existing.created_by !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this template.');
  if (existing.is_published)
    return apiError(c, 'VALIDATION_ERROR', 'Published templates are immutable. Create a new version instead.');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = updateTemplateSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const input = parsed.data;
  const setClauses: string[] = [];
  const bindings: (string | number | null)[] = [];

  const addField = (column: string, value: string | number | null) => {
    bindings.push(value);
    setClauses.push(`${column} = ?${bindings.length}`);
  };

  if (input.title !== undefined) addField('title', input.title);
  if (input.instructions !== undefined) addField('instructions', input.instructions);
  if (input.difficulty !== undefined) addField('difficulty', input.difficulty);
  if (input.primarySkill !== undefined) addField('primary_skill', input.primarySkill);
  if (input.secondarySkills !== undefined)
    addField('secondary_skills', JSON.stringify(input.secondarySkills));
  if ('bloomLevel' in input) addField('bloom_level', input.bloomLevel ?? null);
  if ('estimatedMinutes' in input) addField('estimated_minutes', input.estimatedMinutes ?? null);
  if (input.config !== undefined) addField('config', JSON.stringify(input.config));
  if (input.serverConfig !== undefined) addField('server_config', JSON.stringify(input.serverConfig));

  if (setClauses.length === 0)
    return apiError(c, 'VALIDATION_ERROR', 'No updatable fields provided.');

  const now = new Date().toISOString();
  addField('updated_at', now);
  bindings.push(templateId);

  await c.env.DB.prepare(
    `UPDATE challenge_templates SET ${setClauses.join(', ')} WHERE id = ?${bindings.length}`,
  )
    .bind(...bindings)
    .run();

  const updated = await c.env.DB.prepare(
    'SELECT * FROM challenge_templates WHERE id = ?1',
  )
    .bind(templateId)
    .first<ChallengeTemplateRow>();

  return c.json(templateRowToResponse(updated!, true));
});

// ─── POST /:id/publish — publish template (immutable) ───────────────────────

challengeTemplates.post('/:id/publish', async (c) => {
  const userId = c.var.userId;
  const templateId = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM challenge_templates WHERE id = ?1',
  )
    .bind(templateId)
    .first<ChallengeTemplateRow>();

  if (!existing) return apiError(c, 'NOT_FOUND', 'Challenge template not found.');
  if (existing.created_by !== userId && existing.source !== 'SYSTEM')
    return apiError(c, 'FORBIDDEN', 'You do not own this template.');
  if (existing.is_published)
    return apiError(c, 'VALIDATION_ERROR', 'Template is already published.');

  await c.env.DB.prepare(
    'UPDATE challenge_templates SET is_published = 1, updated_at = ?1 WHERE id = ?2',
  )
    .bind(new Date().toISOString(), templateId)
    .run();

  const updated = await c.env.DB.prepare(
    'SELECT * FROM challenge_templates WHERE id = ?1',
  )
    .bind(templateId)
    .first<ChallengeTemplateRow>();

  return c.json(templateRowToResponse(updated!, true));
});

// ─── GET /:id/variants — list language variants ─────────────────────────────

challengeTemplates.get('/:id/variants', async (c) => {
  const userId = c.var.userId;
  const templateId = c.req.param('id');

  const template = await c.env.DB.prepare(
    'SELECT id, created_by FROM challenge_templates WHERE id = ?1',
  )
    .bind(templateId)
    .first<{ id: string; created_by: string | null }>();

  if (!template) return apiError(c, 'NOT_FOUND', 'Challenge template not found.');

  const isOwner = template.created_by === userId;

  const { results } = await c.env.DB.prepare(
    'SELECT * FROM challenge_language_variants WHERE challenge_template_id = ?1',
  )
    .bind(templateId)
    .all<ChallengeLanguageVariantRow>();

  return c.json({
    variants: (results ?? []).map((v) => variantRowToResponse(v, isOwner)),
  });
});

// ─── POST /:id/variants — add language variant ──────────────────────────────

challengeTemplates.post('/:id/variants', async (c) => {
  const userId = c.var.userId;
  const templateId = c.req.param('id');

  const template = await c.env.DB.prepare(
    'SELECT * FROM challenge_templates WHERE id = ?1',
  )
    .bind(templateId)
    .first<ChallengeTemplateRow>();

  if (!template) return apiError(c, 'NOT_FOUND', 'Challenge template not found.');
  if (template.created_by !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this template.');
  if (template.type !== 'CODE_IMPLEMENTATION')
    return apiError(c, 'VALIDATION_ERROR', 'Language variants are only supported for CODE_IMPLEMENTATION templates.');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = createVariantSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const input = parsed.data;
  const id = generateId();

  try {
    await c.env.DB.prepare(
      `INSERT INTO challenge_language_variants
         (id, challenge_template_id, language, starter_code, test_suite, test_framework, test_command, solution_code)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
    )
      .bind(
        id,
        templateId,
        input.language,
        input.starterCode,
        input.testSuite,
        input.testFramework,
        input.testCommand,
        input.solutionCode ?? null,
      )
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes('UNIQUE')) {
      return apiError(c, 'VALIDATION_ERROR', `A variant for language "${input.language}" already exists.`);
    }
    throw err;
  }

  const created = await c.env.DB.prepare(
    'SELECT * FROM challenge_language_variants WHERE id = ?1',
  )
    .bind(id)
    .first<ChallengeLanguageVariantRow>();

  return c.json(variantRowToResponse(created!, true), 201);
});

// DELETE /:id — delete a draft template (owner only, draft only)
challengeTemplates.delete('/:id', async (c) => {
  const templateId = c.req.param('id');
  const userId = c.var.userId;

  const existing = await c.env.DB.prepare(
    'SELECT id, created_by, is_published FROM challenge_templates WHERE id = ?1',
  )
    .bind(templateId)
    .first<Pick<ChallengeTemplateRow, 'id' | 'created_by' | 'is_published'>>();

  if (!existing) return apiError(c, 'NOT_FOUND', 'Template not found.');
  if (existing.created_by !== userId) return apiError(c, 'FORBIDDEN', 'You can only delete your own templates.');
  if (existing.is_published) return apiError(c, 'VALIDATION_ERROR', 'Published templates cannot be deleted.');

  // Delete variants first, then the template
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM challenge_language_variants WHERE challenge_template_id = ?1').bind(templateId),
    c.env.DB.prepare('DELETE FROM challenge_templates WHERE id = ?1').bind(templateId),
  ]);

  return c.json({ deleted: true });
});

export { challengeTemplates };
