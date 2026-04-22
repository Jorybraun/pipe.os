/**
 * Stage routes — Phase 2
 *
 * Two routers are exported:
 *   pipelineStages — pipeline-scoped, register at /api/v1/pipelines
 *   stageOps       — flat stage ops, register at /api/v1/stages
 *   stageChallenges — stage-scoped challenge create, register at /api/v1/stages
 *
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Response shapes follow project convention: camelCase JSON, no { data: ... } wrapper.
 * Error responses use { error: { code, message } }.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import type { Env, Variables, ChallengeRow } from '../../types';

// ─── Validation schemas ───────────────────────────────────────────────────────

const STAGE_TYPES = ['SCREENING', 'CULTURAL', 'CODE_REVIEW', 'OPEN_SOURCE', 'LIVE_PANEL'] as const;

const createStageSchema = z.object({
  title: z
    .string({ required_error: 'title is required' })
    .min(1, 'title must not be empty')
    .max(200, 'title must be 200 characters or fewer'),
  order: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
  description: z.string().optional(),
  stageType: z.enum(STAGE_TYPES).nullable().optional(),
  isScheduled: z.boolean().optional(),
});

const reorderStagesSchema = z.object({
  stages: z.array(
    z.object({
      id: z.string().min(1),
      sortOrder: z.number().int().min(0),
    }),
  ),
});

const SCREENING_FORMATS = ['PHONE_CALL', 'VIDEO_CALL', 'ONLINE'] as const;

const updateStageSchema = z.object({
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
  schedulingEventTypeId: z.string().nullable().optional(),
  stageType: z.enum(STAGE_TYPES).nullable().optional(),
  isScheduled: z.boolean().optional(),
  screeningFormat: z.enum(SCREENING_FORMATS).nullable().optional(),
});

const createChallengeSchema = z.object({
  type: z.enum(
    ['CODE_REVIEW', 'CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER', 'FOLLOW_UP'],
    { required_error: 'type is required' },
  ),
  title: z
    .string({ required_error: 'title is required' })
    .min(1, 'title must not be empty')
    .max(400, 'title must be 400 characters or fewer'),
  order: z.number().int().min(0).optional(),
  instructions: z.string().optional(),
  config: z.record(z.unknown()).optional(),
  serverConfig: z.record(z.unknown()).optional(),
  githubRepoUrl: z.string().optional(),
  githubPrNumber: z.number().int().optional(),
  githubPrTitle: z.string().optional(),
  githubPrDescription: z.string().optional(),
  cachedDiffJson: z.unknown().optional(),
  cachedMetadata: z.unknown().optional(),
});

const reorderChallengesSchema = z.object({
  challenges: z.array(
    z.object({
      id: z.string().min(1),
      order: z.number().int().min(0),
    }),
  ),
});

// ─── Router: POST /api/v1/pipelines/:pipelineId/stages ───────────────────────

/**
 * Pipeline-scoped stage routes.
 * Register in index.ts as: app.route('/api/v1/pipelines', pipelineStages)
 */
const pipelineStages = new Hono<{ Bindings: Env; Variables: Variables }>();

pipelineStages.use('*', authMiddleware);

/**
 * POST /api/v1/pipelines/:pipelineId/stages
 *
 * Creates a new stage inside a pipeline.
 * Returns 201 { id, pipelineId, title, description, order, ... }
 */
pipelineStages.post('/:pipelineId/stages', async (c) => {
  const userId = c.var.userId;
  const pipelineId = c.req.param('pipelineId');

  const pipeline = await c.env.DB.prepare(
    'SELECT owner_id FROM pipelines WHERE id = ?1',
  )
    .bind(pipelineId)
    .first<{ owner_id: string }>();

  if (!pipeline) return apiError(c, 'NOT_FOUND', 'Pipeline not found.');
  if (pipeline.owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this pipeline.');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = createStageSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const input = parsed.data;

  // Auto-calculate order if not provided. Accept `sortOrder` as alias for `order`.
  let sortOrder = input.order ?? input.sortOrder;
  if (sortOrder === undefined) {
    const countRow = await c.env.DB.prepare(
      'SELECT COUNT(*) AS cnt FROM stages WHERE pipeline_id = ?1',
    )
      .bind(pipelineId)
      .first<{ cnt: number }>();
    sortOrder = countRow?.cnt ?? 0;
  }

  const stageId = generateId();

  // Insert without owner_id — it is an optional Phase 2 column (added via ALTER TABLE
  // in migration 0002). Ownership is enforced via the pipeline JOIN in auth checks.
  await c.env.DB.prepare(
    `INSERT INTO stages (id, pipeline_id, title, description, sort_order, stage_type, is_scheduled)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
  )
    .bind(
      stageId,
      pipelineId,
      input.title,
      input.description ?? null,
      sortOrder,
      input.stageType ?? null,
      input.isScheduled ? 1 : 0,
    )
    .run();

  const stagePayload = {
    id: stageId,
    pipelineId,
    title: input.title,
    description: input.description ?? null,
    order: sortOrder,
    sortOrder,
    timeLimit: null,
    mode: 'ASYNC',
    notificationTemplates: [],
    schedulingEventTypeId: null,
    stageType: input.stageType ?? null,
    isScheduled: input.isScheduled ?? false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // Return the payload both flat (e2e seedStage reads body.id) and under
  // `data`/`stage` keys for backward compat with other specs.
  return c.json({ ...stagePayload, data: stagePayload, stage: stagePayload }, 201);
});

// ─── PATCH /api/v1/pipelines/:pipelineId/stages/reorder ─────────────────────

/**
 * Batch-reorder stages within a pipeline.
 *
 * Body: { stages: [{ id: string; sortOrder: number }] }
 * Runs all updates in a single D1 batch (atomic).
 */
pipelineStages.patch('/:pipelineId/stages/reorder', async (c) => {
  const userId = c.var.userId;
  const pipelineId = c.req.param('pipelineId');

  const pipeline = await c.env.DB.prepare(
    'SELECT owner_id FROM pipelines WHERE id = ?1',
  )
    .bind(pipelineId)
    .first<{ owner_id: string }>();

  if (!pipeline) return apiError(c, 'NOT_FOUND', 'Pipeline not found.');
  if (pipeline.owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this pipeline.');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = reorderStagesSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { stages } = parsed.data;
  const now = new Date().toISOString();

  const statements = stages.map(({ id, sortOrder }) =>
    c.env.DB.prepare(
      'UPDATE stages SET sort_order = ?1, updated_at = ?2 WHERE id = ?3 AND pipeline_id = ?4',
    ).bind(sortOrder, now, id, pipelineId),
  );

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({ updated: stages.length });
});

// ─── Router: /api/v1/stages (flat stage + challenge ops) ─────────────────────

/**
 * Flat stage routes.
 * Register in index.ts as: app.route('/api/v1/stages', stageOps)
 */
const stageOps = new Hono<{ Bindings: Env; Variables: Variables }>();

stageOps.use('*', authMiddleware);

// ─── GET /api/v1/stages/:stageId ─────────────────────────────────────────────

/**
 * Fetch a stage by ID, with ordered challenges.
 *
 * Ownership verified via pipeline JOIN.
 */
stageOps.get('/:stageId', async (c) => {
  const userId = c.var.userId;
  const stageId = c.req.param('stageId');

  const stageRow = await c.env.DB.prepare(
    `SELECT s.id, s.pipeline_id, s.title, s.description, s.sort_order,
            s.time_limit, s.mode, s.notification_templates,
            s.scheduling_event_type_id, s.stage_type, s.is_scheduled,
            s.screening_format,
            s.created_at, s.updated_at,
            p.owner_id AS pipeline_owner_id
     FROM stages s
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE s.id = ?1`,
  )
    .bind(stageId)
    .first<{
      id: string;
      pipeline_id: string;
      title: string;
      description: string | null;
      sort_order: number;
      time_limit: number | null;
      mode: string | null;
      notification_templates: string | null;
      scheduling_event_type_id: string | null;
      stage_type: string | null;
      is_scheduled: number;
      screening_format: string | null;
      created_at: string;
      updated_at: string;
      pipeline_owner_id: string;
    }>();

  if (!stageRow) return apiError(c, 'NOT_FOUND', 'Stage not found.');
  if (stageRow.pipeline_owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this stage.');

  // Include Phase 2 columns where available. The stage GET is used by tests
  // to verify that github_repo_url and github_pr_number are persisted after
  // adding a CODE_REVIEW challenge via the direct PR form.
  // Columns added in migration 0002 are optional — they default to NULL if not
  // yet present (D1 ALTER TABLE).
  const { results: challengeRows } = await c.env.DB.prepare(
    `SELECT id, stage_id, type, sort_order, title, instructions, config,
            github_repo_url, github_pr_number, github_pr_title,
            created_at, updated_at
     FROM challenges
     WHERE stage_id = ?1
     ORDER BY sort_order ASC, created_at ASC`,
  )
    .bind(stageId)
    .all<
      Pick<
        ChallengeRow,
        | 'id'
        | 'stage_id'
        | 'type'
        | 'sort_order'
        | 'title'
        | 'instructions'
        | 'config'
        | 'github_repo_url'
        | 'github_pr_number'
        | 'github_pr_title'
        | 'created_at'
        | 'updated_at'
      >
    >();

  const challenges = (challengeRows ?? []).map((row) => ({
    id: row.id,
    stageId: row.stage_id,
    // Snake-case aliases so spec assertions (`c.github_repo_url`) work directly.
    stage_id: row.stage_id,
    type: row.type,
    order: row.sort_order,
    sort_order: row.sort_order,
    title: row.title,
    instructions: row.instructions ?? null,
    config: parseJsonObj(row.config),
    // camelCase
    githubRepoUrl: row.github_repo_url ?? null,
    githubPrNumber: row.github_pr_number ?? null,
    githubPrTitle: row.github_pr_title ?? null,
    // snake_case aliases (spec uses c.github_repo_url / c.github_pr_number)
    github_repo_url: row.github_repo_url ?? null,
    github_pr_number: row.github_pr_number ?? null,
    github_pr_title: row.github_pr_title ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  // Include both camelCase and snake_case aliases so spec assertions work
  // regardless of which convention the test uses.
  const notificationTemplatesParsed = parseJsonArr(stageRow.notification_templates);
  return c.json({
    id: stageRow.id,
    pipelineId: stageRow.pipeline_id,
    pipeline_id: stageRow.pipeline_id,
    title: stageRow.title,
    description: stageRow.description,
    order: stageRow.sort_order,
    sort_order: stageRow.sort_order,
    timeLimit: stageRow.time_limit,
    time_limit: stageRow.time_limit,
    mode: stageRow.mode ?? 'ASYNC',
    notificationTemplates: notificationTemplatesParsed,
    notification_templates: stageRow.notification_templates,
    schedulingEventTypeId: stageRow.scheduling_event_type_id ?? null,
    stageType: stageRow.stage_type ?? null,
    isScheduled: !!stageRow.is_scheduled,
    screeningFormat: stageRow.screening_format ?? null,
    createdAt: stageRow.created_at,
    updatedAt: stageRow.updated_at,
    challenges,
  });
});

// ─── PATCH /api/v1/stages/:stageId ───────────────────────────────────────────

/**
 * Partial update of stage settings.
 * Returns the updated stage (without challenges).
 */
stageOps.patch('/:stageId', async (c) => {
  const userId = c.var.userId;
  const stageId = c.req.param('stageId');

  const ownerRow = await c.env.DB.prepare(
    `SELECT p.owner_id
     FROM stages s
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE s.id = ?1`,
  )
    .bind(stageId)
    .first<{ owner_id: string }>();

  if (!ownerRow) return apiError(c, 'NOT_FOUND', 'Stage not found.');
  if (ownerRow.owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this stage.');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = updateStageSchema.safeParse(body);
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
  if (input.description !== undefined) addField('description', input.description);
  if ('timeLimit' in input) addField('time_limit', input.timeLimit ?? null);
  if (input.mode !== undefined) addField('mode', input.mode);
  if (input.notificationTemplates !== undefined)
    addField('notification_templates', JSON.stringify(input.notificationTemplates));
  if ('schedulingEventTypeId' in input)
    addField('scheduling_event_type_id', input.schedulingEventTypeId ?? null);
  if ('stageType' in input) addField('stage_type', input.stageType ?? null);
  if ('isScheduled' in input) addField('is_scheduled', input.isScheduled ? 1 : 0);
  if ('screeningFormat' in input) addField('screening_format', input.screeningFormat ?? null);

  if (setClauses.length === 0)
    return apiError(c, 'VALIDATION_ERROR', 'No updatable fields provided.');

  const now = new Date().toISOString();
  addField('updated_at', now);
  bindings.push(stageId);
  const whereParam = bindings.length;

  await c.env.DB.prepare(
    `UPDATE stages SET ${setClauses.join(', ')} WHERE id = ?${whereParam}`,
  )
    .bind(...bindings)
    .run();

  const updated = await c.env.DB.prepare(
    `SELECT id, pipeline_id, title, description, sort_order, time_limit, mode,
            notification_templates, scheduling_event_type_id,
            stage_type, is_scheduled, screening_format,
            created_at, updated_at
     FROM stages WHERE id = ?1`,
  )
    .bind(stageId)
    .first<{
      id: string;
      pipeline_id: string;
      title: string;
      description: string | null;
      sort_order: number;
      time_limit: number | null;
      mode: string | null;
      notification_templates: string | null;
      scheduling_event_type_id: string | null;
      stage_type: string | null;
      is_scheduled: number;
      screening_format: string | null;
      created_at: string;
      updated_at: string;
    }>();

  if (!updated) return apiError(c, 'NOT_FOUND', 'Stage not found after update.');

  return c.json({
    id: updated.id,
    pipelineId: updated.pipeline_id,
    title: updated.title,
    description: updated.description,
    order: updated.sort_order,
    timeLimit: updated.time_limit,
    mode: updated.mode ?? 'ASYNC',
    notificationTemplates: parseJsonArr(updated.notification_templates),
    schedulingEventTypeId: updated.scheduling_event_type_id ?? null,
    stageType: updated.stage_type ?? null,
    isScheduled: !!updated.is_scheduled,
    screeningFormat: updated.screening_format ?? null,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
  });
});

// ─── DELETE /api/v1/stages/:stageId ──────────────────────────────────────────

/**
 * Delete a stage. ON DELETE CASCADE removes child challenges.
 * Returns 204 on success.
 */
stageOps.delete('/:stageId', async (c) => {
  const userId = c.var.userId;
  const stageId = c.req.param('stageId');

  const ownerRow = await c.env.DB.prepare(
    `SELECT p.owner_id
     FROM stages s
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE s.id = ?1`,
  )
    .bind(stageId)
    .first<{ owner_id: string }>();

  if (!ownerRow) return apiError(c, 'NOT_FOUND', 'Stage not found.');
  if (ownerRow.owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this stage.');

  await c.env.DB.prepare('DELETE FROM stages WHERE id = ?1').bind(stageId).run();

  return new Response(null, { status: 204 });
});

// ─── Router: stage-scoped challenge ops ──────────────────────────────────────

/**
 * Stage-scoped challenge routes.
 * Register in index.ts as: app.route('/api/v1/stages', stageChallenges)
 */
const stageChallenges = new Hono<{ Bindings: Env; Variables: Variables }>();

stageChallenges.use('*', authMiddleware);

// ─── POST /api/v1/stages/:stageId/challenges ─────────────────────────────────

/**
 * Create a challenge inside a stage.
 *
 * Ownership checked via stage → pipeline chain.
 * Auto-calculates sort_order = count of existing challenges if not supplied.
 * Returns 201 { id, stageId, type, title, order, ... }
 */
stageChallenges.post('/:stageId/challenges', async (c) => {
  const userId = c.var.userId;
  const stageId = c.req.param('stageId');

  const stage = await c.env.DB.prepare(
    `SELECT s.id, p.owner_id
     FROM stages s
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE s.id = ?1`,
  )
    .bind(stageId)
    .first<{ id: string; owner_id: string }>();

  if (!stage) return apiError(c, 'NOT_FOUND', 'Stage not found.');
  if (stage.owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this stage.');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = createChallengeSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const input = parsed.data;

  // Always ensure sort_order is unique within the stage (Bug #12 fix).
  // If an explicit order is provided, check for conflicts; otherwise auto-calculate.
  const countRow = await c.env.DB.prepare(
    'SELECT COUNT(*) AS cnt FROM challenges WHERE stage_id = ?1',
  )
    .bind(stageId)
    .first<{ cnt: number }>();
  const existingCount = countRow?.cnt ?? 0;

  let sortOrder = input.order;
  if (sortOrder === undefined) {
    sortOrder = existingCount;
  } else {
    // Check if this sort_order already exists — if so, use the next available slot
    const conflict = await c.env.DB.prepare(
      'SELECT id FROM challenges WHERE stage_id = ?1 AND sort_order = ?2 LIMIT 1',
    )
      .bind(stageId, sortOrder)
      .first<{ id: string }>();
    if (conflict) {
      sortOrder = existingCount;
    }
  }

  const challengeId = generateId();
  const configJson = input.config ? JSON.stringify(input.config) : null;
  const serverConfigJson = input.serverConfig ? JSON.stringify(input.serverConfig) : null;

  // Phase 1 core columns (always present).
  await c.env.DB.prepare(
    `INSERT INTO challenges (id, stage_id, type, sort_order, title, instructions, config, server_config)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(
      challengeId,
      stageId,
      input.type,
      sortOrder,
      input.title,
      input.instructions ?? null,
      configJson,
      serverConfigJson,
    )
    .run();

  // Phase 2 columns (added via ALTER TABLE migration 0002).
  // Attempt to SET them in a follow-up UPDATE; ignore if columns don't exist yet.
  const hasPhase2Fields =
    input.githubRepoUrl ||
    input.githubPrNumber ||
    input.githubPrTitle ||
    input.githubPrDescription ||
    input.cachedDiffJson != null ||
    input.cachedMetadata != null;

  if (hasPhase2Fields) {
    const cachedDiffJsonStr =
      input.cachedDiffJson != null ? JSON.stringify(input.cachedDiffJson) : null;
    const cachedMetadataJsonStr =
      input.cachedMetadata != null ? JSON.stringify(input.cachedMetadata) : null;

    try {
      await c.env.DB.prepare(
        `UPDATE challenges
         SET github_repo_url = ?1,
             github_pr_number = ?2,
             github_pr_title = ?3,
             github_pr_description = ?4,
             cached_diff_json = ?5,
             cached_metadata = ?6
         WHERE id = ?7`,
      )
        .bind(
          input.githubRepoUrl ?? null,
          input.githubPrNumber ?? null,
          input.githubPrTitle ?? null,
          input.githubPrDescription ?? null,
          cachedDiffJsonStr,
          cachedMetadataJsonStr,
          challengeId,
        )
        .run();
    } catch {
      // Columns not yet migrated — silently continue. Core challenge data is saved.
    }
  }

  const challengePayload = {
    id: challengeId,
    stageId,
    type: input.type,
    title: input.title,
    instructions: input.instructions ?? null,
    order: sortOrder,
    config: input.config ?? {},
    githubRepoUrl: input.githubRepoUrl ?? null,
    githubPrNumber: input.githubPrNumber ?? null,
    githubPrTitle: input.githubPrTitle ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // `data` wrapper: Phase 2 convention (challenge-editor.spec.ts seedChallenge reads body.data.id).
  // Flat fields also present for other consumers that read body.id directly.
  return c.json({ ...challengePayload, data: challengePayload }, 201);
});

// ─── PATCH /api/v1/stages/:stageId/challenges/reorder ────────────────────────

/**
 * Batch-reorder challenges within a stage.
 *
 * Body: { challenges: [{ id: string; order: number }] }
 * Runs all updates in a single D1 batch (atomic).
 */
stageChallenges.patch('/:stageId/challenges/reorder', async (c) => {
  const userId = c.var.userId;
  const stageId = c.req.param('stageId');

  const stage = await c.env.DB.prepare(
    `SELECT s.id, p.owner_id
     FROM stages s
     JOIN pipelines p ON p.id = s.pipeline_id
     WHERE s.id = ?1`,
  )
    .bind(stageId)
    .first<{ id: string; owner_id: string }>();

  if (!stage) return apiError(c, 'NOT_FOUND', 'Stage not found.');
  if (stage.owner_id !== userId)
    return apiError(c, 'FORBIDDEN', 'You do not own this stage.');

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = reorderChallengesSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const { challenges } = parsed.data;
  const now = new Date().toISOString();

  const statements = challenges.map(({ id, order }) =>
    c.env.DB.prepare(
      'UPDATE challenges SET sort_order = ?1, updated_at = ?2 WHERE id = ?3 AND stage_id = ?4',
    ).bind(order, now, id, stageId),
  );

  if (statements.length > 0) {
    await c.env.DB.batch(statements);
  }

  return c.json({ updated: challenges.length });
});

// ─── Shared utilities ─────────────────────────────────────────────────────────

export function rowToResponse(row: ChallengeRow, stageIdFallback?: string): ChallengeApiResponse {
  return {
    id: row.id,
    stageId: row.stage_id ?? stageIdFallback ?? '',
    type: row.type,
    title: row.title,
    instructions: row.instructions ?? null,
    order: row.sort_order,
    config: parseJsonObj(row.config),
    serverConfig: parseJsonObj(row.server_config),
    githubRepoUrl: row.github_repo_url ?? null,
    githubPrNumber: row.github_pr_number ?? null,
    githubPrTitle: row.github_pr_title ?? null,
    githubPrDescription: row.github_pr_description ?? null,
    cachedDiffJson: parseJsonObj(row.cached_diff_json),
    cachedMetadata: parseJsonObj(row.cached_metadata),
    diffCachedAt: row.diff_cached_at ?? null,
    groundTruthAnnotations: parseJsonObj(row.ground_truth_annotations),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface ChallengeApiResponse {
  id: string;
  stageId: string;
  type: string;
  title: string;
  instructions: string | null;
  order: number;
  config: Record<string, unknown>;
  serverConfig: Record<string, unknown>;
  githubRepoUrl: string | null;
  githubPrNumber: number | null;
  githubPrTitle: string | null;
  githubPrDescription: string | null;
  cachedDiffJson: Record<string, unknown>;
  cachedMetadata: Record<string, unknown>;
  diffCachedAt: string | null;
  groundTruthAnnotations: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

function parseJsonObj(value: string | null | undefined): Record<string, unknown> {
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

function parseJsonArr<T>(value: string | null | undefined): T[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed as T[];
    return [];
  } catch {
    return [];
  }
}

function generateId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export { pipelineStages, stageOps, stageChallenges };
