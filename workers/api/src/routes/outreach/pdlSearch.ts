/**
 * PDL Search + Sourcing Pool routes — candidate discovery via People Data Labs.
 *
 * POST /api/v1/outreach/search      — search PDL (cached per query)
 * POST /api/v1/outreach/flag        — flag a discovered person
 * POST /api/v1/outreach/dismiss     — dismiss a discovered person
 * POST /api/v1/outreach/contact   — first interaction: promote to graph + create Interaction
 * POST /api/v1/outreach/enrich      — enrich a known person by name/email
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { searchPeople, enrichPerson } from '../../lib/pdl';
import { LivingContextStore, deterministicEntityId } from '../../lib/livingContext';
import type { Env, Variables } from '../../types';

// ─── Validation ─────────────────────────────────────────────────────────────

const searchSchema = z.object({
  jobTitleRole: z.string().optional(),
  jobTitleLevel: z.string().optional(),
  jobCompanyName: z.string().optional(),
  locationCountry: z.string().optional(),
  locationRegion: z.string().optional(),
  skills: z.array(z.string()).optional(),
  hasPhone: z.boolean().optional(),
  hasEmail: z.boolean().optional(),
  size: z.number().int().min(1).max(100).optional().default(10),
});

const poolActionSchema = z.object({
  poolId: z.string().min(1),
});

const contactSchema = z.object({
  poolId: z.string().min(1),
  channel: z.enum(['phone', 'email', 'invite']),
  context: z.record(z.unknown()).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function stableJson(value: unknown): string {
  return JSON.stringify(value, Object.keys(value as object).sort());
}

function queryHash(params: Record<string, unknown>): string {
  const clone = { ...params };
  delete (clone as Record<string, unknown>).size; // size doesn't affect identity
  return stableJson(clone);
}

// ─── Router ─────────────────────────────────────────────────────────────────

const pdlSearch = new Hono<{ Bindings: Env; Variables: Variables }>();
pdlSearch.use('*', authMiddleware);

// POST /api/v1/outreach/search
pdlSearch.post('/search', async (c) => {
  const apiKey = c.env.PDL_API_KEY;
  if (!apiKey) {
    return apiError(c, 'SERVICE_UNAVAILABLE', 'PDL integration not configured.');
  }

  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json().catch(() => ({}));
  const parsed = searchSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  const qHash = queryHash(parsed.data);
  const now = new Date().toISOString();

  // 1. Try cache (discovered or flagged from same query in last 7 days)
  const cached = await db
    .prepare(
      `SELECT id, data_json, status, person_id
       FROM sourcing_pool
       WHERE workspace_id = ?1 AND query_hash = ?2
         AND status IN ('discovered', 'flagged')
         AND expires_at > ?3
       ORDER BY updated_at DESC`,
    )
    .bind(userId, qHash, now)
    .all<{ id: string; data_json: string; status: string; person_id: string | null }>();

  if (cached.results && cached.results.length > 0) {
    const results = cached.results.map((row) => ({
      poolId: row.id,
      status: row.status,
      personId: row.person_id,
      ...(JSON.parse(row.data_json) as Record<string, unknown>),
    }));
    return c.json({ results, total: results.length, cached: true });
  }

  // 2. Cache miss → call PDL
  let data: Record<string, unknown>[];
  let total: number;
  try {
    const result = await searchPeople(apiKey, parsed.data);
    data = result.data as Record<string, unknown>[];
    total = result.total;
  } catch (err) {
    console.error('[pdlSearch] search failed:', err);
    const message = err instanceof Error ? err.message : 'Search failed';
    return apiError(c, 'SERVICE_UNAVAILABLE', message);
  }

  // 3. Write to sourcing pool
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const resultsWithPoolId: Record<string, unknown>[] = [];
  for (const person of data) {
    const pdlId = typeof person.id === 'string' ? person.id : null;
    const poolId = crypto.randomUUID();
    await db
      .prepare(
        `INSERT INTO sourcing_pool
         (id, workspace_id, pdl_id, query_hash, data_json, status, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, 'discovered', ?, ?, ?)
         ON CONFLICT(workspace_id, pdl_id) DO UPDATE SET
           query_hash = excluded.query_hash,
           data_json = excluded.data_json,
           status = CASE WHEN sourcing_pool.status = 'dismissed' THEN 'discovered' ELSE sourcing_pool.status END,
           updated_at = excluded.updated_at,
           expires_at = excluded.expires_at`,
      )
      .bind(poolId, userId, pdlId, qHash, JSON.stringify(person), now, now, expiresAt)
      .run();
    resultsWithPoolId.push({ poolId, status: 'discovered', personId: null, ...person });
  }

  return c.json({ results: resultsWithPoolId, total, cached: false });
});

// POST /api/v1/outreach/flag
pdlSearch.post('/flag', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const parsed = poolActionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE sourcing_pool
       SET status = 'flagged', updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(now, parsed.data.poolId, userId)
    .run();

  return c.json({ success: true });
});

// POST /api/v1/outreach/dismiss
pdlSearch.post('/dismiss', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;
  const body = await c.req.json().catch(() => ({}));
  const parsed = poolActionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE sourcing_pool
       SET status = 'dismissed', updated_at = ?
       WHERE id = ? AND workspace_id = ?`,
    )
    .bind(now, parsed.data.poolId, userId)
    .run();

  return c.json({ success: true });
});

// POST /api/v1/outreach/contact — first interaction: promote to living context graph
pdlSearch.post('/contact', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json().catch(() => ({}));
  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  const poolRow = await db
    .prepare('SELECT data_json FROM sourcing_pool WHERE id = ? AND workspace_id = ?')
    .bind(parsed.data.poolId, userId)
    .first<{ data_json: string }>();

  if (!poolRow) {
    return apiError(c, 'NOT_FOUND', 'Discovery record not found.');
  }

  const record = JSON.parse(poolRow.data_json) as Record<string, unknown>;
  const fullName = typeof record.full_name === 'string' ? record.full_name : null;
  const firstName = typeof record.first_name === 'string' ? record.first_name : null;
  const lastName = typeof record.last_name === 'string' ? record.last_name : null;
  const displayName = fullName ?? (firstName && lastName ? `${firstName} ${lastName}` : firstName ?? lastName);

  const emails = Array.isArray(record.emails)
    ? (record.emails as Array<{ address?: string }>)
    : [];
  const primaryEmail = emails[0]?.address ?? null;

  const phoneNumbers = Array.isArray(record.phone_numbers)
    ? (record.phone_numbers as Array<{ number?: string }>)
    : [];
  const primaryPhone = phoneNumbers[0]?.number ?? null;

  if (!primaryEmail) {
    return apiError(c, 'VALIDATION_ERROR', 'No email in discovery record.');
  }

  const now = new Date().toISOString();
  const store = new LivingContextStore(db);

  // Check for existing Person by email
  const existingPerson = await db
    .prepare('SELECT id FROM people WHERE primary_email = ? ORDER BY created_at LIMIT 1')
    .bind(primaryEmail)
    .first<{ id: string }>();

  let personId: string;
  if (existingPerson) {
    personId = existingPerson.id;
  } else {
    const person = await store.upsertPerson({
      ingestionKey: `email:${primaryEmail}`,
      displayName,
      primaryEmail,
      primaryPhone,
      externalIds: { pdlId: record.id as string },
    });
    personId = person.id;
  }

  // Check for existing WorkspacePerson
  const existingWp = await db
    .prepare('SELECT id FROM workspace_people WHERE workspace_id = ? AND person_id = ?')
    .bind(userId, personId)
    .first<{ id: string }>();

  let workspacePersonId: string;
  if (existingWp) {
    workspacePersonId = existingWp.id;
  } else {
    const wp = await store.upsertWorkspacePerson({
      ingestionKey: `workspace:${userId}:person:${personId}`,
      workspaceId: userId,
      personId,
      context: { source: 'pdl_discovery' },
    });
    workspacePersonId = wp.id;
  }

  // Create Interaction
  const interaction = await store.upsertInteraction({
    ingestionKey: `discovery:${parsed.data.poolId}:${parsed.data.channel}:${now}`,
    workspacePersonId,
    interactionType: parsed.data.channel,
    externalReference: parsed.data.poolId,
    startedAt: now,
    metadata: parsed.data.context,
  });

  // Add PersonRole: discovered
  await store.upsertPersonRole({
    ingestionKey: `workspace:${userId}:person:${personId}:role:discovered`,
    workspacePersonId,
    roleType: 'discovered',
    label: 'Discovered via PDL',
  });

  // Update sourcing_pool status
  await db
    .prepare(
      `UPDATE sourcing_pool
       SET status = 'contacted', person_id = ?, interaction_count = interaction_count + 1, last_interacted_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .bind(personId, now, now, parsed.data.poolId)
    .run();

  return c.json({
    personId,
    workspacePersonId,
    interactionId: interaction.id,
    channel: parsed.data.channel,
  }, 201);
});

// POST /api/v1/outreach/enrich
pdlSearch.post('/enrich', async (c) => {
  const apiKey = c.env.PDL_API_KEY;
  if (!apiKey) {
    return apiError(c, 'SERVICE_UNAVAILABLE', 'PDL integration not configured.');
  }

  const body = await c.req.json().catch(() => ({}));
  const schema = z.object({
    email: z.string().email().optional(),
    name: z.string().optional(),
    company: z.string().optional(),
    domain: z.string().optional(),
  });
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
  }

  try {
    const result = await enrichPerson(apiKey, parsed.data);
    if (!result) {
      return apiError(c, 'NOT_FOUND', 'No enrichment data found for this person.');
    }
    return c.json({ result });
  } catch (err) {
    console.error('[pdlSearch] enrich failed:', err);
    const message = err instanceof Error ? err.message : 'Enrichment failed';
    return apiError(c, 'SERVICE_UNAVAILABLE', message);
  }
});

export { pdlSearch };
