/**
 * Contacts routes — unified address book for leads, candidates, customers, etc.
 *
 * GET    /api/v1/contacts          — list contacts for the current user
 * POST   /api/v1/contacts          — create a contact
 * GET    /api/v1/contacts/:id      — get a single contact
 * PATCH  /api/v1/contacts/:id      — update a contact
 * DELETE /api/v1/contacts/:id      — delete a contact
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import {
  ensureContactLivingContext,
  loadContactLivingContext,
  loadContactLivingContextSummary,
  loadWorkspacePersonLivingContext,
  loadWorkspacePersonLivingContextSummary,
  searchSourceContent,
  requireGate,
} from '../../lib/livingContext';
import type { Env, Variables } from '../../types';

// ─── Validation ──────────────────────────────────────────────────────────────

const CONTACT_TYPES = [
  'lead',
  'candidate',
  'customer',
  'hiring_manager',
  'recruiter',
  'other',
] as const;

const createContactSchema = z.object({
  email:    z.string().email('valid email required'),
  name:     z.string().max(200).optional(),
  company:  z.string().max(200).optional(),
  role:     z.string().max(200).optional(),
  phone:    z.string().max(50).optional(),
  linkedin: z.string().max(500).optional(),
  notes:    z.string().max(5000).optional(),
  type:     z.enum(CONTACT_TYPES).default('lead'),
});

const updateContactSchema = z.object({
  email:    z.string().email().optional(),
  name:     z.string().max(200).optional(),
  company:  z.string().max(200).optional(),
  role:     z.string().max(200).optional(),
  phone:    z.string().max(50).optional(),
  linkedin: z.string().max(500).optional(),
  notes:    z.string().max(5000).optional(),
  type:     z.enum(CONTACT_TYPES).optional(),
});

// ─── Row type ────────────────────────────────────────────────────────────────

interface ContactRow {
  id:         string;
  owner_id:   string;
  email:      string;
  name:       string | null;
  company:    string | null;
  role:       string | null;
  phone:      string | null;
  linkedin:   string | null;
  notes:      string | null;
  type:       string;
  created_at: string;
  updated_at: string;
}

interface WorkspacePersonRow {
  person_id: string;
  owner_id: string;
  email: string;
  name: string | null;
  phone: string | null;
  relationship_summary: string | null;
  context_json: string | null;
  role: string | null;
  created_at: string;
  updated_at: string;
}

interface SourceReadTarget {
  exists: boolean;
  workspacePersonId: string | null;
}

function parsePositiveInt(value: string | undefined, fallback: number, max: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, parsed));
}

function parseContext(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function stringFromContext(context: Record<string, unknown>, key: string): string | null {
  const value = context[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function isActiveTalentPoolContext(context: Record<string, unknown>): boolean {
  const talentPool = context.talentPool;
  if (
    typeof talentPool === 'object'
    && talentPool !== null
    && !Array.isArray(talentPool)
    && (talentPool as Record<string, unknown>).status === 'active'
  ) {
    return true;
  }
  return Array.isArray(context.legacyCandidateIds) && context.legacyCandidateIds.length > 0;
}

function workspacePersonToContact(row: WorkspacePersonRow): ContactRow {
  const context = parseContext(row.context_json);
  return {
    id: row.person_id,
    owner_id: row.owner_id,
    email: row.email,
    name: row.name,
    company: stringFromContext(context, 'company'),
    role: row.role ?? stringFromContext(context, 'role'),
    phone: row.phone,
    linkedin: null,
    notes: row.relationship_summary,
    type: isActiveTalentPoolContext(context) ? 'candidate' : 'person',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

const unifiedPeopleListCte = `
WITH contact_rows AS (
  SELECT c.id,
         c.owner_id,
         c.email,
         c.name,
         c.company,
         c.role,
         c.phone,
         c.linkedin,
         c.notes,
         CASE
           WHEN EXISTS (
             SELECT 1
               FROM workspace_people wp
               JOIN people p ON p.id = wp.person_id
              WHERE wp.workspace_id = c.owner_id
                AND (
                  json_extract(wp.context_json, '$.contactId') = c.id
                  OR (
                    c.email IS NOT NULL
                    AND p.primary_email IS NOT NULL
                    AND lower(c.email) = lower(p.primary_email)
                  )
                )
                AND (
                  json_extract(wp.context_json, '$.talentPool.status') = 'active'
                  OR json_type(wp.context_json, '$.legacyCandidateIds') = 'array'
                )
           ) THEN 'candidate'
           ELSE c.type
         END AS type,
         c.created_at,
         c.updated_at
    FROM contacts c
   WHERE c.owner_id = ?1
),
workspace_person_rows AS (
  SELECT p.id,
         wp.workspace_id AS owner_id,
         COALESCE(p.primary_email, '') AS email,
         p.display_name AS name,
         json_extract(wp.context_json, '$.company') AS company,
         COALESCE(
           (
             SELECT pr.label
               FROM person_roles pr
              WHERE pr.workspace_person_id = wp.id
              ORDER BY pr.created_at DESC
              LIMIT 1
           ),
           json_extract(wp.context_json, '$.role')
         ) AS role,
         p.primary_phone AS phone,
         CAST(NULL AS TEXT) AS linkedin,
         wp.relationship_summary AS notes,
         CASE
           WHEN json_extract(wp.context_json, '$.talentPool.status') = 'active'
             OR json_type(wp.context_json, '$.legacyCandidateIds') = 'array'
           THEN 'candidate'
           ELSE 'person'
         END AS type,
         wp.created_at,
         wp.updated_at
    FROM workspace_people wp
    JOIN people p ON p.id = wp.person_id
   WHERE wp.workspace_id = ?1
     AND NOT EXISTS (
       SELECT 1
         FROM contacts c
        WHERE c.owner_id = wp.workspace_id
          AND c.id = json_extract(wp.context_json, '$.contactId')
     )
     AND NOT EXISTS (
       SELECT 1
         FROM contacts c
        WHERE c.owner_id = wp.workspace_id
          AND c.email IS NOT NULL
          AND p.primary_email IS NOT NULL
          AND lower(c.email) = lower(p.primary_email)
     )
),
unified_people AS (
  SELECT * FROM contact_rows
  UNION ALL
  SELECT * FROM workspace_person_rows
)`;

async function loadWorkspacePersonAsContact(
  db: D1Database,
  ownerId: string,
  personId: string,
): Promise<ContactRow | null> {
  const row = await db.prepare(
    `SELECT p.id AS person_id,
            wp.workspace_id AS owner_id,
            p.primary_email AS email,
            p.display_name AS name,
            p.primary_phone AS phone,
            wp.relationship_summary,
            wp.context_json,
            (
              SELECT pr.label
                FROM person_roles pr
               WHERE pr.workspace_person_id = wp.id
               ORDER BY pr.created_at DESC
               LIMIT 1
            ) AS role,
            wp.created_at,
            wp.updated_at
       FROM workspace_people wp
       JOIN people p ON p.id = wp.person_id
      WHERE wp.workspace_id = ?1
        AND p.id = ?2
      LIMIT 1`,
  ).bind(ownerId, personId).first<WorkspacePersonRow>();

  return row ? workspacePersonToContact(row) : null;
}

async function resolveSourceReadTarget(
  db: D1Database,
  ownerId: string,
  id: string,
): Promise<SourceReadTarget> {
  const contact = await db
    .prepare('SELECT id FROM contacts WHERE id = ?1 AND owner_id = ?2')
    .bind(id, ownerId)
    .first<{ id: string }>();

  if (contact) {
    const workspacePerson = await db.prepare(
      `SELECT wp.id
         FROM workspace_people wp
        WHERE wp.workspace_id = ?1
          AND json_extract(wp.context_json, '$.contactId') = ?2
        LIMIT 1`,
    ).bind(ownerId, id).first<{ id: string }>();
    return { exists: true, workspacePersonId: workspacePerson?.id ?? null };
  }

  const workspacePerson = await db.prepare(
    `SELECT wp.id
       FROM workspace_people wp
       JOIN people p ON p.id = wp.person_id
      WHERE wp.workspace_id = ?1
        AND p.id = ?2
      LIMIT 1`,
  ).bind(ownerId, id).first<{ id: string }>();

  return workspacePerson
    ? { exists: true, workspacePersonId: workspacePerson.id }
    : { exists: false, workspacePersonId: null };
}

// ─── Router ──────────────────────────────────────────────────────────────────

const contacts = new Hono<{ Bindings: Env; Variables: Variables }>();
contacts.use('*', authMiddleware);

// GET / — list contacts
contacts.get('/', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;
  const page = parsePositiveInt(c.req.query('page'), 1, 10_000);
  const limit = parsePositiveInt(c.req.query('limit'), 100, 500);
  const offset = (page - 1) * limit;

  const countRow = await db
    .prepare(`${unifiedPeopleListCte}
      SELECT COUNT(*) AS total FROM unified_people`)
    .bind(userId)
    .first<{ total: number }>();
  const total = countRow?.total ?? 0;

  const { results } = await db
    .prepare(`${unifiedPeopleListCte}
      SELECT id, owner_id, email, name, company, role, phone, linkedin, notes, type, created_at, updated_at
        FROM unified_people
       ORDER BY created_at DESC, id DESC
       LIMIT ?2 OFFSET ?3`)
    .bind(userId, limit, offset)
    .all<ContactRow>();

  return c.json({
    contacts: results ?? [],
    total,
    page,
    limit,
    hasMore: offset + (results?.length ?? 0) < total,
  });
});

// POST / — create contact
contacts.post('/', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json().catch(() => ({}));
  const parsed = createContactSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
  }
  const data = parsed.data;

  // Check for duplicate email per owner
  const existing = await db
    .prepare('SELECT id FROM contacts WHERE owner_id = ? AND email = ?')
    .bind(userId, data.email)
    .first<{ id: string }>();
  if (existing) {
    return apiError(c, 'CONFLICT', 'A contact with this email already exists.');
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await db
    .prepare(
      `INSERT INTO contacts (id, owner_id, email, name, company, role, phone, linkedin, notes, type, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, userId,
      data.email,
      data.name    ?? null,
      data.company ?? null,
      data.role    ?? null,
      data.phone   ?? null,
      data.linkedin ?? null,
      data.notes   ?? null,
      data.type,
      now, now,
    )
    .run();

  await ensureContactLivingContext(db, id);

  const contact = await db
    .prepare('SELECT * FROM contacts WHERE id = ?')
    .bind(id)
    .first<ContactRow>();

  return c.json({ contact }, 201);
});

// GET /:id — single contact
contacts.get('/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const contact = await db
    .prepare('SELECT * FROM contacts WHERE id = ? AND owner_id = ?')
    .bind(id, userId)
    .first<ContactRow>();

  if (contact) return c.json({ contact });

  const personContact = await loadWorkspacePersonAsContact(db, userId, id);
  if (!personContact) return apiError(c, 'NOT_FOUND', 'Person not found.');
  return c.json({ contact: personContact });
});

// GET /:id/living-context/summary — first-paint contact living context projection
contacts.get('/:id/living-context/summary', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const contact = await db
    .prepare('SELECT id FROM contacts WHERE id = ? AND owner_id = ?')
    .bind(id, userId)
    .first<{ id: string }>();
  if (!contact) {
    const livingContext = await loadWorkspacePersonLivingContextSummary(db, userId, id);
    if (!livingContext) return apiError(c, 'NOT_FOUND', 'Person not found.');
    return c.json(livingContext);
  }

  await ensureContactLivingContext(db, id);
  const livingContext = await loadContactLivingContextSummary(db, id);
  if (!livingContext) {
    return c.json({
      person: null,
      summary: {
        interactionCount: 0,
        artifactCount: 0,
        contextRecordCount: 0,
        assertionCount: 0,
        signalCount: 0,
        sourceSpanCount: 0,
      },
      interactions: [],
      artifacts: [],
      contextRecords: [],
      assertions: [],
      signals: [],
      relationships: [],
    });
  }

  return c.json(livingContext);
});

// GET /:id/living-context — contact living context graph
contacts.get('/:id/living-context', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  // Verify ownership
  const contact = await db
    .prepare('SELECT id FROM contacts WHERE id = ? AND owner_id = ?')
    .bind(id, userId)
    .first<{ id: string }>();
  if (!contact) {
    const livingContext = await loadWorkspacePersonLivingContext(db, userId, id);
    if (!livingContext) return apiError(c, 'NOT_FOUND', 'Person not found.');
    return c.json(livingContext);
  }

  await ensureContactLivingContext(db, id);
  const livingContext = await loadContactLivingContext(db, id);
  if (!livingContext) {
    // Contact exists but has no living context yet — return empty structure
    return c.json({
      person: null,
      summary: {
        interactionCount: 0,
        artifactCount: 0,
        contextRecordCount: 0,
        assertionCount: 0,
        signalCount: 0,
        sourceSpanCount: 0,
      },
      interactions: [],
      artifacts: [],
      contextRecords: [],
      assertions: [],
      signals: [],
      relationships: [],
    });
  }

  return c.json(livingContext);
});

// GET /:id/living-context/search?q=... — search contact source content
contacts.get('/:id/living-context/search', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;
  const query = c.req.query('q') ?? '';

  const target = await resolveSourceReadTarget(db, userId, id);
  if (!target.exists) return apiError(c, 'NOT_FOUND', 'Person not found.');
  if (!target.workspacePersonId) return c.json({ personId: id, query, hits: [] });

  const result = await searchSourceContent(db, target.workspacePersonId, query);
  return c.json(result);
});

// GET /:id/living-context/timeline — chronological evidence accumulation feed
contacts.get('/:id/living-context/timeline', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;
  const limitParam = c.req.query('limit');
  const before = c.req.query('before') ?? undefined;
  const after = c.req.query('after') ?? undefined;

  const target = await resolveSourceReadTarget(db, userId, id);
  if (!target.exists) return apiError(c, 'NOT_FOUND', 'Person not found.');
  if (!target.workspacePersonId) return c.json({ workspacePersonId: null, totalEntries: 0, entries: [] });

  const { loadPersonEvidenceTimeline } = await import('../../lib/livingContext');
  const limit = limitParam ? Math.min(parseInt(limitParam, 10) || 100, 500) : 100;
  const timeline = await loadPersonEvidenceTimeline(db, target.workspacePersonId, { limit, before, after });
  return c.json(timeline);
});

// GET /:id/living-context/evidence-depth — per-source-type evidence scoring
contacts.get('/:id/living-context/evidence-depth', requireGate('living_context_read'), async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const target = await resolveSourceReadTarget(db, userId, id);
  if (!target.exists) return apiError(c, 'NOT_FOUND', 'Person not found.');
  if (!target.workspacePersonId) {
    return c.json({
      contactId: id,
      workspacePersonId: null,
      sourceDiversity: 0,
      totalInteractions: 0,
      totalAssertions: 0,
      totalSourceSpans: 0,
      totalContextRecords: 0,
      sources: {},
      topConcepts: [],
    });
  }

  const [interactionBreakdown, assertionCount, sourceSpanCount, contextRecordCount, topConcepts] = await Promise.all([
    db.prepare(
      `SELECT interaction_type, COUNT(*) AS cnt
         FROM interactions
        WHERE workspace_person_id = ?1
        GROUP BY interaction_type
        ORDER BY cnt DESC`,
    ).bind(target.workspacePersonId).all<{ interaction_type: string; cnt: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS cnt FROM semantic_assertions WHERE workspace_person_id = ?1`,
    ).bind(target.workspacePersonId).first<{ cnt: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS cnt
         FROM source_spans ss
         JOIN artifact_versions av ON av.id = ss.artifact_version_id
         JOIN artifacts a ON a.id = av.artifact_id
        WHERE a.workspace_person_id = ?1`,
    ).bind(target.workspacePersonId).first<{ cnt: number }>(),
    db.prepare(
      `SELECT COUNT(*) AS cnt FROM context_records WHERE workspace_person_id = ?1`,
    ).bind(target.workspacePersonId).first<{ cnt: number }>(),
    db.prepare(
      `SELECT c.canonical_key, c.label, COUNT(DISTINCT ac.assertion_id) AS evidence_count
         FROM concepts c
         JOIN assertion_concepts ac ON ac.concept_id = c.id
         JOIN semantic_assertions sa ON sa.id = ac.assertion_id
        WHERE sa.workspace_person_id = ?1
        GROUP BY c.id, c.canonical_key, c.label
        ORDER BY evidence_count DESC
        LIMIT 20`,
    ).bind(target.workspacePersonId).all<{ canonical_key: string; label: string; evidence_count: number }>(),
  ]);

  const sources: Record<string, number> = {};
  let totalInteractions = 0;
  for (const row of interactionBreakdown.results ?? []) {
    sources[row.interaction_type] = row.cnt;
    totalInteractions += row.cnt;
  }

  const distinctSourceTypes = Object.keys(sources).length;
  const maxSourceTypes = 6;
  const sourceDiversity = Math.min(distinctSourceTypes / maxSourceTypes, 1);

  return c.json({
    contactId: id,
    workspacePersonId: target.workspacePersonId,
    sourceDiversity,
    totalInteractions,
    totalAssertions: assertionCount?.cnt ?? 0,
    totalSourceSpans: sourceSpanCount?.cnt ?? 0,
    totalContextRecords: contextRecordCount?.cnt ?? 0,
    sources,
    topConcepts: (topConcepts.results ?? []).map((row) => ({
      key: row.canonical_key,
      label: row.label,
      evidenceCount: row.evidence_count,
    })),
  });
});

// PATCH /:id — update contact
contacts.patch('/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const existing = await db
    .prepare('SELECT * FROM contacts WHERE id = ? AND owner_id = ?')
    .bind(id, userId)
    .first<ContactRow>();
  if (!existing) return apiError(c, 'NOT_FOUND', 'Contact not found.');

  const body = await c.req.json().catch(() => ({}));
  const parsed = updateContactSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Invalid input');
  }
  const data = parsed.data;

  const updated = {
    email:    data.email    ?? existing.email,
    name:     data.name     !== undefined ? data.name     : existing.name,
    company:  data.company  !== undefined ? data.company  : existing.company,
    role:     data.role     !== undefined ? data.role     : existing.role,
    phone:    data.phone    !== undefined ? data.phone    : existing.phone,
    linkedin: data.linkedin !== undefined ? data.linkedin : existing.linkedin,
    notes:    data.notes    !== undefined ? data.notes    : existing.notes,
    type:     data.type     ?? existing.type,
  };

  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE contacts
       SET email=?, name=?, company=?, role=?, phone=?, linkedin=?, notes=?, type=?, updated_at=?
       WHERE id=? AND owner_id=?`
    )
    .bind(
      updated.email, updated.name, updated.company, updated.role,
      updated.phone, updated.linkedin, updated.notes, updated.type,
      now, id, userId,
    )
    .run();

  await ensureContactLivingContext(db, id);

  const contact = await db
    .prepare('SELECT * FROM contacts WHERE id = ?')
    .bind(id)
    .first<ContactRow>();

  return c.json({ contact });
});

// DELETE /:id — delete contact
contacts.delete('/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const existing = await db
    .prepare('SELECT id FROM contacts WHERE id = ? AND owner_id = ?')
    .bind(id, userId)
    .first<{ id: string }>();
  if (!existing) return apiError(c, 'NOT_FOUND', 'Contact not found.');

  await db.prepare('DELETE FROM contacts WHERE id = ? AND owner_id = ?').bind(id, userId).run();
  return c.json({ success: true });
});

export { contacts };
