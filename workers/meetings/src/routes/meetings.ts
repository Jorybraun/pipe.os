import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import type { Env, Variables, Meeting, MeetingStatus, MeetingType, MeetingParticipant } from '../types';

const MEETING_STATUSES: readonly MeetingStatus[] = ['SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'];
const MEETING_TYPES: readonly MeetingType[] = ['DISCOVERY', 'INTERVIEW', 'FOLLOW_UP', 'DEMO', 'OTHER'];

const createMeetingSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(5000).optional(),
  meeting_type: z.enum(MEETING_TYPES as unknown as [string, ...string[]]).default('OTHER'),
  scheduled_at: z.string().datetime().optional(),
  scheduled_interview_id: z.string().optional(),
  participant_contact_ids: z.array(z.string()).max(50).default([]),
});

const updateMeetingSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(5000).nullable().optional(),
  status: z.enum(MEETING_STATUSES as unknown as [string, ...string[]]).optional(),
  meeting_type: z.enum(MEETING_TYPES as unknown as [string, ...string[]]).optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
  started_at: z.string().datetime().nullable().optional(),
  ended_at: z.string().datetime().nullable().optional(),
  duration_secs: z.number().int().min(0).nullable().optional(),
  meeting_url: z.string().url().nullable().optional(),
});

const addParticipantSchema = z.object({
  contact_id: z.string().min(1),
  role: z.enum(['HOST', 'ATTENDEE', 'OBSERVER']).default('ATTENDEE'),
});

export const meetings = new Hono<{ Bindings: Env; Variables: Variables }>();
meetings.use('*', authMiddleware);

/** POST /api/v1/meetings — Create a new meeting. */
meetings.post('/', async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body) return apiError(c, 'VALIDATION_ERROR', 'Invalid JSON body.');

  const parsed = createMeetingSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const { title, description, meeting_type, scheduled_at, scheduled_interview_id, participant_contact_ids } = parsed.data;
  const userId = c.var.userId;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO meetings (id, owner_id, title, description, meeting_type, scheduled_at, scheduled_interview_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, title, description ?? null, meeting_type, scheduled_at ?? null, scheduled_interview_id ?? null, now, now)
    .run();

  // Add participants if provided
  if (participant_contact_ids.length > 0) {
    const stmts = participant_contact_ids.map((contactId) => {
      const participantId = crypto.randomUUID();
      return c.env.DB.prepare(
        `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at, updated_at)
         VALUES (?, ?, ?, 'ATTENDEE', ?, ?)`
      ).bind(participantId, id, contactId, now, now);
    });
    await c.env.DB.batch(stmts);
  }

  const meeting = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(id).first<Meeting>();
  const participants = await c.env.DB.prepare(
    `SELECT mp.*, c.name as contact_name, c.email as contact_email
     FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.meeting_id = ?`
  ).bind(id).all();

  return c.json({ meeting, participants: participants.results }, 201);
});

/** GET /api/v1/meetings — List meetings for the authenticated user. */
meetings.get('/', async (c) => {
  const userId = c.var.userId;
  const status = c.req.query('status') as MeetingStatus | undefined;
  const meetingType = c.req.query('type') as MeetingType | undefined;
  const limit = Math.min(parseInt(c.req.query('limit') ?? '50', 10), 100);
  const offset = parseInt(c.req.query('offset') ?? '0', 10);

  let query = 'SELECT * FROM meetings WHERE owner_id = ?';
  const params: unknown[] = [userId];

  if (status && MEETING_STATUSES.includes(status)) {
    query += ' AND status = ?';
    params.push(status);
  }

  if (meetingType && MEETING_TYPES.includes(meetingType)) {
    query += ' AND meeting_type = ?';
    params.push(meetingType);
  }

  query += ' ORDER BY COALESCE(scheduled_at, created_at) DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);

  const result = await c.env.DB.prepare(query).bind(...params).all<Meeting>();

  // Total count
  let countQuery = 'SELECT COUNT(*) as count FROM meetings WHERE owner_id = ?';
  const countParams: unknown[] = [userId];
  if (status && MEETING_STATUSES.includes(status)) {
    countQuery += ' AND status = ?';
    countParams.push(status);
  }
  if (meetingType && MEETING_TYPES.includes(meetingType)) {
    countQuery += ' AND meeting_type = ?';
    countParams.push(meetingType);
  }
  const countResult = await c.env.DB.prepare(countQuery).bind(...countParams).first<{ count: number }>();

  return c.json({
    meetings: result.results,
    total: countResult?.count ?? 0,
    limit,
    offset,
  });
});

/** GET /api/v1/meetings/:id — Get a single meeting with participants. */
meetings.get('/:id', async (c) => {
  const userId = c.var.userId;
  const meetingId = c.req.param('id');

  const meeting = await c.env.DB.prepare(
    'SELECT * FROM meetings WHERE id = ? AND owner_id = ?'
  ).bind(meetingId, userId).first<Meeting>();

  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const participants = await c.env.DB.prepare(
    `SELECT mp.*, c.name as contact_name, c.email as contact_email, c.type as contact_type
     FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.meeting_id = ?
     ORDER BY mp.role, c.name`
  ).bind(meetingId).all();

  return c.json({ meeting, participants: participants.results });
});

/** PATCH /api/v1/meetings/:id — Update a meeting. */
meetings.patch('/:id', async (c) => {
  const userId = c.var.userId;
  const meetingId = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM meetings WHERE id = ? AND owner_id = ?'
  ).bind(meetingId, userId).first<Meeting>();

  if (!existing) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const body = await c.req.json().catch(() => null);
  if (!body) return apiError(c, 'VALIDATION_ERROR', 'Invalid JSON body.');

  const parsed = updateMeetingSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const updates = parsed.data;
  const setClauses: string[] = [];
  const values: unknown[] = [];

  if (updates.title !== undefined) { setClauses.push('title = ?'); values.push(updates.title); }
  if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description); }
  if (updates.status !== undefined) { setClauses.push('status = ?'); values.push(updates.status); }
  if (updates.meeting_type !== undefined) { setClauses.push('meeting_type = ?'); values.push(updates.meeting_type); }
  if (updates.scheduled_at !== undefined) { setClauses.push('scheduled_at = ?'); values.push(updates.scheduled_at); }
  if (updates.started_at !== undefined) { setClauses.push('started_at = ?'); values.push(updates.started_at); }
  if (updates.ended_at !== undefined) { setClauses.push('ended_at = ?'); values.push(updates.ended_at); }
  if (updates.duration_secs !== undefined) { setClauses.push('duration_secs = ?'); values.push(updates.duration_secs); }
  if (updates.meeting_url !== undefined) { setClauses.push('meeting_url = ?'); values.push(updates.meeting_url); }

  if (setClauses.length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'No fields to update.');
  }

  const now = new Date().toISOString();
  setClauses.push('updated_at = ?');
  values.push(now, meetingId, userId);

  await c.env.DB.prepare(
    `UPDATE meetings SET ${setClauses.join(', ')} WHERE id = ? AND owner_id = ?`
  ).bind(...values).run();

  const updated = await c.env.DB.prepare('SELECT * FROM meetings WHERE id = ?').bind(meetingId).first<Meeting>();
  return c.json({ meeting: updated });
});

// ─── Participants ──────────────────────────────────────────────────────────────

/** POST /api/v1/meetings/:id/participants — Add a participant to a meeting. */
meetings.post('/:id/participants', async (c) => {
  const userId = c.var.userId;
  const meetingId = c.req.param('id');

  const meeting = await c.env.DB.prepare(
    'SELECT id FROM meetings WHERE id = ? AND owner_id = ?'
  ).bind(meetingId, userId).first();

  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const body = await c.req.json().catch(() => null);
  if (!body) return apiError(c, 'VALIDATION_ERROR', 'Invalid JSON body.');

  const parsed = addParticipantSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues.map((i) => i.message).join('; '));
  }

  const { contact_id, role } = parsed.data;

  // Verify the contact exists and belongs to this user
  const contact = await c.env.DB.prepare(
    'SELECT id FROM contacts WHERE id = ? AND owner_id = ?'
  ).bind(contact_id, userId).first();

  if (!contact) return apiError(c, 'NOT_FOUND', 'Contact not found.');

  // Check for duplicates
  const existing = await c.env.DB.prepare(
    'SELECT id FROM meeting_participants WHERE meeting_id = ? AND contact_id = ?'
  ).bind(meetingId, contact_id).first();

  if (existing) return apiError(c, 'CONFLICT', 'Contact is already a participant.');

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, meetingId, contact_id, role, now, now).run();

  const participant = await c.env.DB.prepare(
    `SELECT mp.*, c.name as contact_name, c.email as contact_email
     FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.id = ?`
  ).bind(id).first();

  return c.json({ participant }, 201);
});

/** DELETE /api/v1/meetings/:id/participants/:contactId — Remove a participant. */
meetings.delete('/:id/participants/:contactId', async (c) => {
  const userId = c.var.userId;
  const meetingId = c.req.param('id');
  const contactId = c.req.param('contactId');

  const meeting = await c.env.DB.prepare(
    'SELECT id FROM meetings WHERE id = ? AND owner_id = ?'
  ).bind(meetingId, userId).first();

  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const result = await c.env.DB.prepare(
    'DELETE FROM meeting_participants WHERE meeting_id = ? AND contact_id = ?'
  ).bind(meetingId, contactId).run();

  if (!result.meta.changes) return apiError(c, 'NOT_FOUND', 'Participant not found.');

  return c.json({ deleted: true });
});
