/**
 * Contacts routes — unified address book for leads, candidates, customers, etc.
 *
 * GET    /api/v1/contacts          — list all contacts for the current user
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
  loadWorkspacePersonLivingContext,
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
    type: 'person',
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

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

// ─── Router ──────────────────────────────────────────────────────────────────

const contacts = new Hono<{ Bindings: Env; Variables: Variables }>();
contacts.use('*', authMiddleware);

// GET / — list contacts
contacts.get('/', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const { results } = await db
    .prepare('SELECT * FROM contacts WHERE owner_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<ContactRow>();

  return c.json({ contacts: results ?? [] });
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

// GET /:id/living-context — contact living context graph
contacts.get('/:id/living-context', async (c) => {
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
