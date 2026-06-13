import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import type { Env, Variables, Meeting, MeetingStatus, MeetingType, MeetingParticipant } from '../types';
import { createRoomToken, hashRoomToken } from '../lib/roomTokens';

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

  // Validate participant ownership BEFORE creating the meeting to prevent orphans
  const uniqueContactIds = [...new Set(participant_contact_ids)];
  if (uniqueContactIds.length > 0) {
    const placeholders = uniqueContactIds.map(() => '?').join(', ');
    const owned = await c.env.DB.prepare(
      `SELECT id FROM contacts WHERE id IN (${placeholders}) AND owner_id = ?`
    ).bind(...uniqueContactIds, userId).all<{ id: string }>();

    if (owned.results.length !== uniqueContactIds.length) {
      return apiError(c, 'VALIDATION_ERROR', 'One or more participant contact_ids not found.');
    }
  }

  await c.env.DB.prepare(
    `INSERT INTO meetings (id, owner_id, title, description, meeting_type, scheduled_at, scheduled_interview_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(id, userId, title, description ?? null, meeting_type, scheduled_at ?? null, scheduled_interview_id ?? null, now, now)
    .run();

  // Add validated participants
  if (uniqueContactIds.length > 0) {
    const stmts = uniqueContactIds.map((contactId) => {
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

/** POST /api/v1/meetings/:id/room — Create or reopen the standalone video room. */
meetings.post('/:id/room', async (c) => {
  const userId = c.var.userId;
  const meetingId = c.req.param('id');
  const meeting = await c.env.DB.prepare(
    'SELECT id, meeting_url FROM meetings WHERE id = ? AND owner_id = ?',
  ).bind(meetingId, userId).first<{ id: string; meeting_url: string | null }>();

  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  let room = await c.env.DB.prepare(
    'SELECT id, session_id FROM meeting_rooms WHERE meeting_id = ?',
  ).bind(meetingId).first<{ id: string; session_id: string }>();

  if (!room) {
    room = {
      id: crypto.randomUUID(),
      session_id: `meeting--${meetingId}`,
    };
    await c.env.DB.prepare(
      `INSERT INTO meeting_rooms
        (id, meeting_id, session_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'WAITING', ?, ?)`,
    ).bind(room.id, meetingId, room.session_id, now, now).run();
  }

  await c.env.DB.prepare(
    `UPDATE meeting_room_tokens
     SET revoked_at = ?
     WHERE room_id = ? AND role = 'HOST' AND revoked_at IS NULL`,
  ).bind(now, room.id).run();

  const hostToken = createRoomToken();
  const hostTokenHash = await hashRoomToken(hostToken);
  await c.env.DB.prepare(
    `INSERT INTO meeting_room_tokens
      (id, room_id, token_hash, role, expires_at, created_at)
     VALUES (?, ?, ?, 'HOST', ?, ?)`,
  ).bind(crypto.randomUUID(), room.id, hostTokenHash, expiresAt, now).run();

  const roomAppUrl = (c.env.VIDEO_ROOM_APP_URL ?? 'http://localhost:5175').replace(/\/$/, '');
  const meetingParticipants = await c.env.DB.prepare(
    `SELECT id
       FROM meeting_participants
      WHERE meeting_id = ?
      ORDER BY created_at, id`,
  ).bind(meetingId).all<{ id: string }>();
  const guestParticipantId = meetingParticipants.results.length === 1
    ? meetingParticipants.results[0]?.id ?? null
    : null;
  let guestToken: string | null = null;
  if (meeting.meeting_url) {
    try {
      const existingUrl = new URL(meeting.meeting_url);
      guestToken = existingUrl.pathname.split('/').filter(Boolean).pop() ?? null;
      if (guestToken) {
        const existingHash = await hashRoomToken(guestToken);
        const valid = await c.env.DB.prepare(
          `SELECT id FROM meeting_room_tokens
           WHERE room_id = ? AND token_hash = ? AND role = 'GUEST'
             AND revoked_at IS NULL AND expires_at > ?`,
        ).bind(room.id, existingHash, now).first();
        if (!valid) {
          guestToken = null;
        } else if (guestParticipantId) {
          await c.env.DB.prepare(
            `UPDATE meeting_room_tokens
                SET participant_id = ?
              WHERE id = ? AND participant_id IS NULL`,
          ).bind(guestParticipantId, (valid as { id: string }).id).run();
        }
      }
    } catch {
      guestToken = null;
    }
  }

  if (!guestToken) {
    guestToken = createRoomToken();
    const guestTokenHash = await hashRoomToken(guestToken);
    await c.env.DB.prepare(
      `INSERT INTO meeting_room_tokens
        (id, room_id, token_hash, role, participant_id, expires_at, created_at)
       VALUES (?, ?, ?, 'GUEST', ?, ?, ?)`,
    ).bind(
      crypto.randomUUID(),
      room.id,
      guestTokenHash,
      guestParticipantId,
      expiresAt,
      now,
    ).run();
  }

  const hostUrl = `${roomAppUrl}/room/${hostToken}`;
  const guestUrl = `${roomAppUrl}/room/${guestToken}`;
  await c.env.DB.prepare(
    'UPDATE meetings SET meeting_url = ?, updated_at = ? WHERE id = ?',
  ).bind(guestUrl, now, meetingId).run();

  return c.json({
    room: {
      id: room.id,
      sessionId: room.session_id,
      hostUrl,
      guestUrl,
      expiresAt,
    },
  });
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
