import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import type { Env, Variables, Contact, ContactType } from '../types';

const CONTACT_TYPES: readonly ContactType[] = ['PROSPECT', 'CANDIDATE', 'HIRING_MANAGER', 'RECRUITER', 'OTHER'];

const createContactSchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().optional(),
  phone: z.string().max(30).optional(),
  company: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  type: z.enum(CONTACT_TYPES as unknown as [string, ...string[]]).default('OTHER'),
  notes: z.string().max(5000).optional(),
  candidate_id: z.string().optional(),
  tags: z.array(z.string().max(50)).max(20).default([]),
});

const updateContactSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  email: z.string().email().nullable().optional(),
  phone: z.string().max(30).nullable().optional(),
  company: z.string().max(200).nullable().optional(),
  title: z.string().max(200).nullable().optional(),
  type: z.enum(CONTACT_TYPES as unknown as [string, ...string[]]).optional(),
  notes: z.string().max(5000).nullable().optional(),
  candidate_id: z.string().nullable().optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
});

export const contacts = new Hono<{ Bindings: Env; Variables: Variables }>();
contacts.use('*', authMiddleware);

/** POST /api/v1/contacts — Create a new contact. */
contacts.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return apiError(c, 'VALIDATION_ERROR', 'Invalid JSON body.');

  const parsed = createContactSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const { name, email, phone, company, title, type, notes, candidate_id, tags } = parsed.data;
  const userId = c.var.userId;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO contacts (id, owner_id, type, name, email, phone, company, title, notes, candidate_id, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, type, name, email ?? null, phone ?? null, company ?? null, title ?? null, notes ?? null, candidate_id ?? null, JSON.stringify(tags), now, now)
    .run();

  const contact = await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first<Contact>();
  return c.json({ contact }, 201);
});

/** GET /api/v1/contacts — List contacts for the authenticated user. */
contacts.get('/', async (c) => {
  const userId = c.var.userId;
  const type = c.req.query('type') as ContactType | undefined;
  const search = c.req.query('search');
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  let query = 'SELECT * FROM contacts WHERE owner_id = ?';
  const params: unknown[] = [userId];

  if (type && CONTACT_TYPES.includes(type)) {
    query += ' AND type = ?';
    params.push(type);
  }

  if (search) {
    query += ' AND (name LIKE ? OR email LIKE ? OR company LIKE ?)';
    const searchPattern = `%${search}%`;
    params.push(searchPattern, searchPattern, searchPattern);
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = await c.env.DB.prepare(query).bind(...params).all<Contact>();

  // Get total count for pagination
  let countQuery = 'SELECT COUNT(*) as count FROM contacts WHERE owner_id = ?';
  const countParams: unknown[] = [userId];
  if (type && CONTACT_TYPES.includes(type)) {
    countQuery += ' AND type = ?';
    countParams.push(type);
  }
  if (search) {
    countQuery += ' AND (name LIKE ? OR email LIKE ? OR company LIKE ?)';
    const searchPattern = `%${search}%`;
    countParams.push(searchPattern, searchPattern, searchPattern);
  }
  const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>();

  return c.json({
    contacts: result.results,
    total: countResult?.count ?? 0,
    limit,
    offset,
  });
});

/** GET /api/v1/contacts/:id — Get a single contact with meeting history. */
contacts.get('/:id', async (c) => {
  const userId = c.var.userId;
  const contactId = c.req.param('id');

  const contact = await c.env.DB.prepare(
    'SELECT * FROM contacts WHERE id = ? AND owner_id = ?'
  ).bind(contactId, userId).first<Contact>();

  if (!contact) return apiError(c, 'NOT_FOUND', 'Contact not found.');

  // Fetch recent meetings this contact participated in
  const meetings = await c.env.DB.prepare(
    `SELECT m.* FROM meetings m
     INNER JOIN meeting_participants mp ON mp.meeting_id = m.id
     WHERE mp.contact_id = ? AND m.owner_id = ?
     ORDER BY m.scheduled_at DESC
     LIMIT 20`
  ).bind(contactId, userId).all();

  return c.json({ contact, meetings: meetings.results });
});

/** PATCH /api/v1/contacts/:id — Update a contact. */
contacts.patch('/:id', async (c) => {
  const userId = c.var.userId;
  const contactId = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM contacts WHERE id = ? AND owner_id = ?'
  ).bind(contactId, userId).first<Contact>();

  if (!existing) return apiError(c, 'NOT_FOUND', 'Contact not found.');

  const body = await c.req.json().catch(() => null);
  if (!body) return apiError(c, 'VALIDATION_ERROR', 'Invalid JSON body.');

  const parsed = updateContactSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const updates = parsed.data;
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name); }
  if (updates.email !== undefined) { setClauses.push('email = ?'); values.push(updates.email); }
  if (updates.phone !== undefined) { setClauses.push('phone = ?'); values.push(updates.phone); }
  if (updates.company !== undefined) { setClauses.push('company = ?'); values.push(updates.company); }
  if (updates.title !== undefined) { setClauses.push('title = ?'); values.push(updates.title); }
  if (updates.type !== undefined) { setClauses.push('type = ?'); values.push(updates.type); }
  if (updates.notes !== undefined) { setClauses.push('notes = ?'); values.push(updates.notes); }
  if (updates.candidate_id !== undefined) { setClauses.push('candidate_id = ?'); values.push(updates.candidate_id); }
  if (updates.tags !== undefined) { setClauses.push('tags = ?'); values.push(JSON.stringify(updates.tags)); }

  if (setClauses.length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'No fields to update.');
  }

  const now = new Date().toISOString();
  setClauses.push('updated_at = ?');
  values.push(now, contactId, userId);

  await c.env.DB.prepare(
    `UPDATE contacts SET ${setClauses.join(', ')} WHERE id = ? AND owner_id = ?`
  ).bind(...values).run();

  const updated = await c.env.DB.prepare('SELECT * FROM contacts WHERE id = ?').bind(contactId).first<Contact>();
  return c.json({ contact: updated });
});

/** DELETE /api/v1/contacts/:id — Delete a contact. */
contacts.delete('/:id', async (c) => {
  const userId = c.var.userId;
  const contactId = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM contacts WHERE id = ? AND owner_id = ?'
  ).bind(contactId, userId).first();

  if (!existing) return apiError(c, 'NOT_FOUND', 'Contact not found.');

  await c.env.DB.prepare('DELETE FROM contacts WHERE id = ? AND owner_id = ?')
    .bind(contactId, userId).run();

  return c.json({ deleted: true });
});
