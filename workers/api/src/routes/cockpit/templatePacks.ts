/**
 * Template Pack routes — ADR-034 CA Phase 1
 *
 * Mounts under /api/v1/template-packs.
 * All routes require a valid Clerk JWT via authMiddleware.
 *
 * Routes:
 *   GET    /                     — list packs (filterable)
 *   GET    /:id                  — get pack with items (optionally expanded)
 *   POST   /                     — create custom pack
 *   POST   /:id/publish          — publish pack version
 *   POST   /:id/duplicate        — duplicate pack for customization
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import type {
  Env,
  Variables,
  TemplatePackRow,
  TemplatePackItemRow,
  ChallengeTemplateRow,
  TemplatePackResponse,
  TemplatePackItemResponse,
} from '../../types';

// ─── Validation schemas ───────────────────────────────────────────────────────

const ROLE_TYPES = [
  'FRONTEND', 'BACKEND', 'FULLSTACK', 'DATA_ENGINEERING', 'DEVOPS', 'MOBILE', 'CUSTOM',
] as const;
const SENIORITIES = ['JUNIOR', 'MID', 'SENIOR', 'ANY'] as const;
const PACK_SOURCES = ['SYSTEM', 'USER_CREATED'] as const;

const createPackSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  roleType: z.enum(ROLE_TYPES),
  seniority: z.enum(SENIORITIES),
  skills: z.array(z.string()),
  supportedLanguages: z.array(z.string()).optional(),
  source: z.enum(PACK_SOURCES).optional(),
  items: z.array(
    z.object({
      challengeTemplateId: z.string().min(1),
      sortOrder: z.number().int().min(0),
      weight: z.number().min(0).optional(),
      isRequired: z.boolean().optional(),
    }),
  ).optional(),
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

function packRowToResponse(row: TemplatePackRow): TemplatePackResponse {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    roleType: row.role_type,
    seniority: row.seniority,
    version: row.version,
    skills: parseJsonArr(row.skills),
    supportedLanguages: parseJsonArr(row.supported_languages),
    source: row.source,
    isPublished: !!row.is_published,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

// ─── Router ─────────────────────────────────────────────────────────────────

const templatePacks = new Hono<{ Bindings: Env; Variables: Variables }>();

templatePacks.use('*', authMiddleware);

// ─── GET / — list packs ─────────────────────────────────────────────────────

templatePacks.get('/', async (c) => {
  const roleType = c.req.query('roleType');
  const seniority = c.req.query('seniority');
  const publishedParam = c.req.query('published');

  const conditions: string[] = [];
  const bindings: (string | number)[] = [];

  if (roleType) {
    bindings.push(roleType);
    conditions.push(`role_type = ?${bindings.length}`);
  }
  if (seniority) {
    bindings.push(seniority);
    conditions.push(`seniority = ?${bindings.length}`);
  }
  if (publishedParam === 'true') {
    conditions.push('is_published = 1');
  } else if (publishedParam === 'false') {
    conditions.push('is_published = 0');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Return latest version of each pack
  const { results } = await c.env.DB.prepare(
    `SELECT * FROM template_packs ${whereClause} ORDER BY created_at DESC`,
  )
    .bind(...bindings)
    .all<TemplatePackRow>();

  return c.json({
    packs: (results ?? []).map(packRowToResponse),
  });
});

// ─── GET /:id — get pack with items ─────────────────────────────────────────

templatePacks.get('/:id', async (c) => {
  const packId = c.req.param('id');
  const versionParam = c.req.query('version');
  const expand = c.req.query('expand') === 'challenges';

  // Fetch the pack — latest version if no version specified
  let pack: TemplatePackRow | null;
  if (versionParam) {
    pack = await c.env.DB.prepare(
      'SELECT * FROM template_packs WHERE id = ?1 AND version = ?2',
    )
      .bind(packId, parseInt(versionParam, 10))
      .first<TemplatePackRow>();
  } else {
    pack = await c.env.DB.prepare(
      'SELECT * FROM template_packs WHERE id = ?1 ORDER BY version DESC LIMIT 1',
    )
      .bind(packId)
      .first<TemplatePackRow>();
  }

  if (!pack) return apiError(c, 'NOT_FOUND', 'Template pack not found.');

  // Fetch items
  const { results: itemRows } = await c.env.DB.prepare(
    `SELECT * FROM template_pack_items
     WHERE template_pack_id = ?1 AND template_pack_version = ?2
     ORDER BY sort_order ASC`,
  )
    .bind(pack.id, pack.version)
    .all<TemplatePackItemRow>();

  const items: TemplatePackItemResponse[] = [];

  if (expand && itemRows && itemRows.length > 0) {
    // Fetch all referenced challenge templates in one go
    const templateIds = itemRows.map((i) => i.challenge_template_id);
    const placeholders = templateIds.map((_, idx) => `?${idx + 1}`).join(', ');
    const { results: templateRows } = await c.env.DB.prepare(
      `SELECT * FROM challenge_templates WHERE id IN (${placeholders})`,
    )
      .bind(...templateIds)
      .all<ChallengeTemplateRow>();

    const templateMap = new Map(
      (templateRows ?? []).map((t) => [t.id, t]),
    );

    for (const item of itemRows) {
      const template = templateMap.get(item.challenge_template_id);
      items.push({
        challengeTemplateId: item.challenge_template_id,
        sortOrder: item.sort_order,
        weight: item.weight,
        isRequired: !!item.is_required,
        challenge: template
          ? {
              id: template.id,
              type: template.type,
              title: template.title,
              instructions: template.instructions,
              difficulty: template.difficulty,
              primarySkill: template.primary_skill,
              secondarySkills: parseJsonArr(template.secondary_skills),
              bloomLevel: template.bloom_level,
              estimatedMinutes: template.estimated_minutes,
              config: parseJsonObj(template.config),
              source: template.source,
              isPublished: !!template.is_published,
              createdBy: template.created_by,
              createdAt: template.created_at,
              updatedAt: template.updated_at,
            }
          : undefined,
      });
    }
  } else {
    for (const item of itemRows ?? []) {
      items.push({
        challengeTemplateId: item.challenge_template_id,
        sortOrder: item.sort_order,
        weight: item.weight,
        isRequired: !!item.is_required,
      });
    }
  }

  const response = packRowToResponse(pack);
  response.items = items;

  return c.json(response);
});

// ─── POST / — create pack ───────────────────────────────────────────────────

templatePacks.post('/', async (c) => {
  const userId = c.var.userId;

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = createPackSchema.safeParse(body);
  if (!parsed.success) {
    const message = parsed.error.errors.map((e) => e.message).join('; ');
    return apiError(c, 'VALIDATION_ERROR', message);
  }

  const input = parsed.data;
  const id = generateId();
  const now = new Date().toISOString();

  const statements: D1PreparedStatement[] = [];

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO template_packs
         (id, name, description, role_type, seniority, version, skills, supported_languages,
          source, is_published, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, ?8, 0, ?9, ?10)`,
    ).bind(
      id,
      input.name,
      input.description ?? null,
      input.roleType,
      input.seniority,
      JSON.stringify(input.skills),
      input.supportedLanguages ? JSON.stringify(input.supportedLanguages) : null,
      input.source ?? 'USER_CREATED',
      userId,
      now,
    ),
  );

  // Insert items if provided
  if (input.items) {
    for (const item of input.items) {
      statements.push(
        c.env.DB.prepare(
          `INSERT INTO template_pack_items
             (template_pack_id, template_pack_version, challenge_template_id, sort_order, weight, is_required)
           VALUES (?1, 1, ?2, ?3, ?4, ?5)`,
        ).bind(
          id,
          item.challengeTemplateId,
          item.sortOrder,
          item.weight ?? 1.0,
          item.isRequired !== false ? 1 : 0,
        ),
      );
    }
  }

  await c.env.DB.batch(statements);

  const created = await c.env.DB.prepare(
    'SELECT * FROM template_packs WHERE id = ?1 AND version = 1',
  )
    .bind(id)
    .first<TemplatePackRow>();

  return c.json(packRowToResponse(created!), 201);
});

// ─── POST /:id/publish — publish pack ───────────────────────────────────────

templatePacks.post('/:id/publish', async (c) => {
  const userId = c.var.userId;
  const packId = c.req.param('id');

  const pack = await c.env.DB.prepare(
    'SELECT * FROM template_packs WHERE id = ?1 ORDER BY version DESC LIMIT 1',
  )
    .bind(packId)
    .first<TemplatePackRow>();

  if (!pack) return apiError(c, 'NOT_FOUND', 'Template pack not found.');
  if (pack.created_by !== userId && pack.source !== 'SYSTEM')
    return apiError(c, 'FORBIDDEN', 'You do not own this pack.');
  if (pack.is_published)
    return apiError(c, 'VALIDATION_ERROR', 'Pack is already published.');

  // Verify the pack has at least one item
  const countRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS cnt FROM template_pack_items
     WHERE template_pack_id = ?1 AND template_pack_version = ?2`,
  )
    .bind(pack.id, pack.version)
    .first<{ cnt: number }>();

  if (!countRow || countRow.cnt === 0)
    return apiError(c, 'VALIDATION_ERROR', 'Pack must have at least one challenge template before publishing.');

  await c.env.DB.prepare(
    'UPDATE template_packs SET is_published = 1 WHERE id = ?1 AND version = ?2',
  )
    .bind(pack.id, pack.version)
    .run();

  const updated = await c.env.DB.prepare(
    'SELECT * FROM template_packs WHERE id = ?1 AND version = ?2',
  )
    .bind(pack.id, pack.version)
    .first<TemplatePackRow>();

  return c.json(packRowToResponse(updated!));
});

// ─── POST /:id/duplicate — duplicate pack for customization ─────────────────

templatePacks.post('/:id/duplicate', async (c) => {
  const userId = c.var.userId;
  const packId = c.req.param('id');

  const pack = await c.env.DB.prepare(
    'SELECT * FROM template_packs WHERE id = ?1 ORDER BY version DESC LIMIT 1',
  )
    .bind(packId)
    .first<TemplatePackRow>();

  if (!pack) return apiError(c, 'NOT_FOUND', 'Template pack not found.');

  const newId = generateId();
  const now = new Date().toISOString();

  const statements: D1PreparedStatement[] = [];

  statements.push(
    c.env.DB.prepare(
      `INSERT INTO template_packs
         (id, name, description, role_type, seniority, version, skills, supported_languages,
          source, is_published, created_by, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?7, 'USER_CREATED', 0, ?8, ?9)`,
    ).bind(
      newId,
      `${pack.name} (Copy)`,
      pack.description,
      pack.role_type,
      pack.seniority,
      pack.skills,
      pack.supported_languages,
      userId,
      now,
    ),
  );

  // Copy items
  const { results: itemRows } = await c.env.DB.prepare(
    `SELECT * FROM template_pack_items
     WHERE template_pack_id = ?1 AND template_pack_version = ?2
     ORDER BY sort_order ASC`,
  )
    .bind(pack.id, pack.version)
    .all<TemplatePackItemRow>();

  for (const item of itemRows ?? []) {
    statements.push(
      c.env.DB.prepare(
        `INSERT INTO template_pack_items
           (template_pack_id, template_pack_version, challenge_template_id, sort_order, weight, is_required)
         VALUES (?1, 1, ?2, ?3, ?4, ?5)`,
      ).bind(
        newId,
        item.challenge_template_id,
        item.sort_order,
        item.weight,
        item.is_required,
      ),
    );
  }

  await c.env.DB.batch(statements);

  const created = await c.env.DB.prepare(
    'SELECT * FROM template_packs WHERE id = ?1 AND version = 1',
  )
    .bind(newId)
    .first<TemplatePackRow>();

  return c.json(packRowToResponse(created!), 201);
});

// ─── expandPack — replaces expandPreset for template packs ──────────────────

/**
 * Expands a template pack into stages + challenges for pipeline creation.
 *
 * Returns a structure compatible with the existing pipeline creation batch
 * insert pattern. Each pack maps to one stage with all its challenge templates
 * expanded into concrete challenges.
 */
export async function expandPack(
  db: D1Database,
  packId: string,
  version?: number,
): Promise<{
  pack: TemplatePackRow;
  stages: Array<{
    title: string;
    description: string | null;
    sortOrder: number;
    challenges: Array<{
      type: string;
      title: string;
      instructions: string;
      config: string;
      serverConfig: string | null;
    }>;
  }>;
} | null> {
  let pack: TemplatePackRow | null;
  if (version !== undefined) {
    pack = await db
      .prepare('SELECT * FROM template_packs WHERE id = ?1 AND version = ?2')
      .bind(packId, version)
      .first<TemplatePackRow>();
  } else {
    pack = await db
      .prepare(
        'SELECT * FROM template_packs WHERE id = ?1 AND is_published = 1 ORDER BY version DESC LIMIT 1',
      )
      .bind(packId)
      .first<TemplatePackRow>();
  }

  if (!pack) return null;

  const { results: itemRows } = await db
    .prepare(
      `SELECT tpi.*, ct.type, ct.title, ct.instructions, ct.config, ct.server_config
       FROM template_pack_items tpi
       JOIN challenge_templates ct ON ct.id = tpi.challenge_template_id
       WHERE tpi.template_pack_id = ?1 AND tpi.template_pack_version = ?2
       ORDER BY tpi.sort_order ASC`,
    )
    .bind(pack.id, pack.version)
    .all<TemplatePackItemRow & { type: string; title: string; instructions: string; config: string; server_config: string | null }>();

  const challenges = (itemRows ?? []).map((item) => ({
    type: item.type,
    title: item.title,
    instructions: item.instructions,
    config: item.config,
    serverConfig: item.server_config,
  }));

  return {
    pack,
    stages: [
      {
        title: pack.name,
        description: pack.description,
        sortOrder: 0,
        challenges,
      },
    ],
  };
}

// DELETE /:id — delete a draft pack (owner only, draft only)
templatePacks.delete('/:id', async (c) => {
  const packId = c.req.param('id');
  const userId = c.var.userId;

  // Get the latest version of this pack
  const existing = await c.env.DB.prepare(
    'SELECT id, version, created_by, is_published FROM template_packs WHERE id = ?1 ORDER BY version DESC LIMIT 1',
  )
    .bind(packId)
    .first<Pick<TemplatePackRow, 'id' | 'version' | 'created_by' | 'is_published'>>();

  if (!existing) return apiError(c, 'NOT_FOUND', 'Pack not found.');
  if (existing.created_by !== userId) return apiError(c, 'FORBIDDEN', 'You can only delete your own packs.');
  if (existing.is_published) return apiError(c, 'VALIDATION_ERROR', 'Published packs cannot be deleted.');

  // Delete items first, then all versions of the pack
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM template_pack_items WHERE template_pack_id = ?1').bind(packId),
    c.env.DB.prepare('DELETE FROM template_packs WHERE id = ?1').bind(packId),
  ]);

  return c.json({ deleted: true });
});

export { templatePacks };
