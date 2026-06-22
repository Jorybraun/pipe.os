import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth';
import { apiError } from '../middleware/errors';
import { generateRoomToken, hashRoomToken } from '../lib/roomTokens';
import {
  transcribeAudioDeepgramStructured,
  transcribeAudioWhisper,
} from '../lib/transcribe';
import { ingestMeetingTranscriptToLivingContext } from '../lib/livingContext';
import type {
  MeetingTranscriptAssertionInput,
  MeetingTranscriptSegmentInput,
} from '../lib/livingContext';
import type { Env, Variables } from '../types';

type RoomRole = 'HOST' | 'GUEST';

interface ResolvedRoom {
  room_id: string;
  meeting_id: string;
  session_id: string;
  room_status: string;
  role: RoomRole;
  owner_id: string;
  title: string;
  description: string | null;
  scheduled_at: string | null;
  meeting_type: string;
  meeting_status: string;
  started_at: string | null;
  ended_at: string | null;
  guest_contact_id: string | null;
}

interface MeetingAnalysis {
  summary: string;
  decisions: string[];
  actionItems: Array<{
    text: string;
    owner: string | null;
    dueDate: string | null;
  }>;
  topics: string[];
  followUps: string[];
  semanticAssertions: MeetingTranscriptAssertionInput[];
}

const roomEventSchema = z.object({
  event: z.enum(['JOINED', 'LEFT', 'STARTED', 'ENDED']),
});

const FALLBACK_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
];

const evidenceLevelSchema = z.enum([
  'mentioned',
  'used',
  'explained',
  'selected',
  'implemented',
  'demonstrated',
  'validated',
]);

const semanticAssertionSchema = z.object({
  sourceSegmentIds: z.array(z.string().min(1)).min(1),
  subjectSegmentId: z.string().min(1),
  predicate: z.string().min(1),
  narrative: z.string().min(1),
  objectType: z.string().min(1).nullable().optional(),
  objectValue: z.unknown().optional(),
  qualifiers: z.record(z.unknown()).optional(),
  confidence: z.number().min(0).max(1).nullable().optional(),
  polarity: z.number().min(-1).max(1).nullable().optional(),
  concepts: z.array(z.object({
    surface: z.string().min(1),
    relationship: z.string().min(1),
    weight: z.number().min(0).max(1),
    evidenceLevel: evidenceLevelSchema.nullable().optional(),
    strength: z.number().min(0).max(1).nullable().optional(),
  })).optional(),
});

function extractAiText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.response === 'string') return record.response;
  const choices = record.choices;
  if (!Array.isArray(choices) || choices.length === 0) return '';
  const first = choices[0];
  if (!first || typeof first !== 'object') return '';
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== 'object') return '';
  const content = (message as Record<string, unknown>).content;
  return typeof content === 'string' ? content : '';
}

function parseAnalysis(
  text: string,
  transcript: string,
  segments: MeetingTranscriptSegmentInput[],
): MeetingAnalysis {
  const segmentById = new Map(
    segments.flatMap((segment) => segment.stableSegmentId
      ? [[segment.stableSegmentId, segment] as const]
      : []),
  );
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const parsed = JSON.parse(match[0]) as Partial<MeetingAnalysis> & {
        semanticAssertions?: unknown[];
      };
      const semanticAssertions = (Array.isArray(parsed.semanticAssertions)
        ? parsed.semanticAssertions
        : []).flatMap((candidate) => {
          const result = semanticAssertionSchema.safeParse(candidate);
          if (!result.success) return [];
          const sourceSegmentIds = [...new Set(result.data.sourceSegmentIds)]
            .filter((segmentId) => segmentById.has(segmentId));
          if (
            sourceSegmentIds.length === 0
            || !sourceSegmentIds.includes(result.data.subjectSegmentId)
          ) {
            return [];
          }
          const sourceText = sourceSegmentIds
            .map((segmentId) => segmentById.get(segmentId)?.text ?? '')
            .join('\n')
            .toLocaleLowerCase();
          return [{
            ...result.data,
            sourceSegmentIds,
            qualifiers: result.data.qualifiers as MeetingTranscriptAssertionInput['qualifiers'],
            objectValue: result.data.objectValue as MeetingTranscriptAssertionInput['objectValue'],
            concepts: (result.data.concepts ?? []).filter((concept) =>
              sourceText.includes(concept.surface.trim().toLocaleLowerCase())
            ),
          } satisfies MeetingTranscriptAssertionInput];
        });
      return {
        summary: typeof parsed.summary === 'string' ? parsed.summary : transcript.slice(0, 500),
        decisions: Array.isArray(parsed.decisions) ? parsed.decisions.filter((v): v is string => typeof v === 'string') : [],
        actionItems: Array.isArray(parsed.actionItems)
          ? parsed.actionItems
              .filter((v): v is MeetingAnalysis['actionItems'][number] => (
                Boolean(v) && typeof v === 'object' && typeof v.text === 'string'
              ))
              .map((item) => ({
                text: item.text,
                owner: typeof item.owner === 'string' ? item.owner : null,
                dueDate: typeof item.dueDate === 'string' ? item.dueDate : null,
              }))
          : [],
        topics: Array.isArray(parsed.topics) ? parsed.topics.filter((v): v is string => typeof v === 'string') : [],
        followUps: Array.isArray(parsed.followUps) ? parsed.followUps.filter((v): v is string => typeof v === 'string') : [],
        semanticAssertions,
      };
    } catch {
      // Fall through to a transcript-only artifact.
    }
  }
  return {
    summary: transcript.slice(0, 500),
    decisions: [],
    actionItems: [],
    topics: [],
    followUps: [],
    semanticAssertions: [],
  };
}

async function resolveRoom(db: D1Database, token: string): Promise<ResolvedRoom | null> {
  const tokenHash = await hashRoomToken(token);
  const now = new Date().toISOString();
  return db.prepare(
    `SELECT mr.id AS room_id, mr.meeting_id, mr.session_id,
            mr.status AS room_status, mrt.role,
            m.owner_id, m.title, m.description, m.scheduled_at,
            m.meeting_type, m.status AS meeting_status,
            m.started_at, m.ended_at,
            (
              SELECT mp.contact_id
                FROM meeting_room_tokens guest_token
                JOIN meeting_participants mp
                  ON mp.id = guest_token.participant_id
               WHERE guest_token.room_id = mr.id
                 AND guest_token.role = 'GUEST'
                 AND guest_token.participant_id IS NOT NULL
               ORDER BY guest_token.created_at DESC
               LIMIT 1
            ) AS guest_contact_id
     FROM meeting_room_tokens mrt
     INNER JOIN meeting_rooms mr ON mr.id = mrt.room_id
     INNER JOIN meetings m ON m.id = mr.meeting_id
     WHERE mrt.token_hash = ?
       AND mrt.revoked_at IS NULL
       AND mrt.expires_at > ?`,
  ).bind(tokenHash, now).first<ResolvedRoom>();
}

async function analyzeMeeting(
  ai: Ai,
  transcript: string,
  segments: MeetingTranscriptSegmentInput[],
): Promise<MeetingAnalysis> {
  const source = segments.map((segment) => {
    const id = segment.stableSegmentId ?? 'missing-segment-id';
    const speaker = segment.speakerRole ?? segment.speakerLabel ?? 'unknown-speaker';
    return `[${id}] ${speaker}: ${segment.text}`;
  }).join('\n\n');
  const result = await ai.run(
    '@cf/google/gemma-4-26b-a4b-it' as Parameters<typeof ai.run>[0],
    {
      messages: [
        {
          role: 'system',
          content: `You extract source-backed meeting intelligence. Return JSON only:
{
  "summary": "concise factual summary",
  "decisions": ["decision"],
  "actionItems": [{"text":"task","owner":null,"dueDate":null}],
  "topics": ["topic"],
  "followUps": ["follow-up"],
  "semanticAssertions": [{
    "sourceSegmentIds": ["exact segment id"],
    "subjectSegmentId": "segment spoken by the person making the claim",
    "predicate": "open source-grounded predicate; do not choose from a taxonomy",
    "narrative": "standalone factual narrative",
    "objectType": null,
    "objectValue": null,
    "qualifiers": {},
    "confidence": 0.0,
    "polarity": 1.0,
    "concepts": [{
      "surface": "exact meaning-bearing phrase copied from a source segment",
      "relationship": "open phrase describing how the assertion relates to the concept",
      "weight": 0.0,
      "evidenceLevel": "mentioned | used | explained | selected | implemented | demonstrated | validated",
      "strength": 0.0
    }]
  }]
}
Rules:
- Every assertion must cite existing segment IDs and include its speaker's subjectSegmentId.
- Concept surfaces must appear verbatim in a cited segment.
- Predicates, object types, relationships, concepts, and qualifiers are open data. Never force them into a known list.
- Do not invent facts, owners, dates, evidence levels, strengths, or speaker identities.
- Omit an assertion or concept when the source does not establish it. Use null or empty arrays when appropriate.`,
        },
        { role: 'user', content: source },
      ],
      max_tokens: 2400,
    } as unknown as Parameters<typeof ai.run>[1],
  );
  return parseAnalysis(extractAiText(result), transcript, segments);
}

async function processRecording(
  env: Env,
  room: ResolvedRoom,
  recordingKey: string,
): Promise<void> {
  try {
    const object = await env.STORAGE.get(recordingKey);
    if (!object) throw new Error('Recording was not found after upload.');
    const audioBuffer = await object.arrayBuffer();
    const contentType = object.httpMetadata?.contentType ?? 'video/webm';
    const structured = env.DEEPGRAM_API_KEY
      ? await transcribeAudioDeepgramStructured(
          audioBuffer,
          env.DEEPGRAM_API_KEY,
          contentType,
        )
      : null;
    let provider = structured ? 'deepgram-multichannel' : 'workers-ai-whisper';
    let segments: MeetingTranscriptSegmentInput[];
    let transcript: string;
    if (structured) {
      segments = structured.segments.map((segment) => ({
        stableSegmentId: segment.stableSegmentId,
        text: segment.text,
        speakerLabel: segment.speakerLabel,
        speakerRole: segment.channel === 0
          ? 'host'
          : segment.channel === 1
            ? 'guest'
            : null,
        contactId: segment.channel === 1 ? room.guest_contact_id : null,
        channel: segment.channel,
        timestampStartMs: segment.timestampStartMs,
        timestampEndMs: segment.timestampEndMs,
        confidence: segment.confidence,
        metadata: {
          providerSegmentId: segment.providerSegmentId,
        },
      }));
      transcript = structured.transcript;
    } else {
      const whisperTranscript = await transcribeAudioWhisper(env.AI, audioBuffer);
      if (!whisperTranscript) throw new Error('Transcription returned no text.');
      transcript = whisperTranscript;
      segments = [{
        stableSegmentId: 'mixed-0001',
        text: transcript,
        speakerLabel: 'mixed',
      }];
    }

    const analysis = await analyzeMeeting(env.AI, transcript, segments);
    const transcriptJson = JSON.stringify(segments.map((segment) => ({
      stable_segment_id: segment.stableSegmentId,
      speaker: segment.speakerLabel ?? null,
      role: segment.speakerRole ?? null,
      contact_id: segment.contactId ?? null,
      channel: segment.channel ?? null,
      text: segment.text,
      timestamp_start_ms: segment.timestampStartMs ?? null,
      timestamp_end_ms: segment.timestampEndMs ?? null,
      confidence: segment.confidence ?? null,
    })));
    const now = new Date().toISOString();
    await env.DB.prepare(
      `UPDATE meetings
       SET transcript_status = 'READY',
           transcript_json = ?,
           transcript_summary = ?,
           transcript_analysis_json = ?,
           transcript_error = NULL,
           recording_r2_key = ?,
           updated_at = ?
       WHERE id = ?`,
    ).bind(
      transcriptJson,
      analysis.summary,
      JSON.stringify(analysis),
      recordingKey,
      now,
      room.meeting_id,
    ).run();
    await ingestMeetingTranscriptToLivingContext(env.DB, {
      meetingId: room.meeting_id,
      ownerId: room.owner_id,
      transcript,
      segments,
      summary: analysis.summary,
      semanticAssertions: analysis.semanticAssertions,
      extractorVersion: 'meeting-transcript-open-v1',
      startedAt: room.started_at,
      endedAt: room.ended_at,
      recordingKey,
      provider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await env.DB.prepare(
      `UPDATE meetings
       SET transcript_status = 'FAILED', transcript_error = ?, updated_at = ?
       WHERE id = ?`,
    ).bind(message, new Date().toISOString(), room.meeting_id).run();
    console.error('[meetingRooms] Recording processing failed:', message);
  }
}

export const meetingRooms = new Hono<{ Bindings: Env }>();

meetingRooms.get('/:token', async (c) => {
  const room = await resolveRoom(c.env.DB, c.req.param('token'));
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');

  const participants = await c.env.DB.prepare(
    `SELECT c.name, mp.role
     FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.meeting_id = ?
     ORDER BY mp.role, c.name`,
  ).bind(room.meeting_id).all<{ name: string; role: string }>();

  return c.json({
    room: {
      id: room.room_id,
      meetingId: room.meeting_id,
      sessionId: room.session_id,
      role: room.role,
      status: room.room_status,
      title: room.title,
      description: room.description,
      scheduledAt: room.scheduled_at,
      meetingType: room.meeting_type,
      participants: participants.results,
    },
  });
});

meetingRooms.get('/:token/turn-credentials', async (c) => {
  const room = await resolveRoom(c.env.DB, c.req.param('token'));
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');

  if (!c.env.METERED_API_KEY) {
    return c.json({
      iceServers: FALLBACK_ICE_SERVERS,
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1800);
  try {
    const response = await fetch(
      `https://pipe-os.metered.live/api/v1/turn/credentials?apiKey=${c.env.METERED_API_KEY}`,
      { signal: controller.signal },
    );
    if (!response.ok) {
      return c.json({ iceServers: FALLBACK_ICE_SERVERS });
    }
    return c.json({ iceServers: await response.json() });
  } catch {
    return c.json({ iceServers: FALLBACK_ICE_SERVERS });
  } finally {
    clearTimeout(timeout);
  }
});

meetingRooms.get('/:token/ws', async (c) => {
  const room = await resolveRoom(c.env.DB, c.req.param('token'));
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  if (c.req.header('Upgrade')?.toLowerCase() !== 'websocket') {
    return apiError(c, 'VALIDATION_ERROR', 'Expected WebSocket upgrade.');
  }

  const doId = c.env.VIDEO_ROOM.idFromName(room.session_id);
  const stub = c.env.VIDEO_ROOM.get(doId);
  await stub.fetch(new Request('https://do/ensure', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      meetingId: room.meeting_id,
      hostId: room.owner_id,
      resetEnded: room.room_status === 'WAITING',
    }),
  }));
  return stub.fetch(new Request(`https://do/ws?role=${room.role}`, {
    headers: c.req.raw.headers,
  }));
});

meetingRooms.post('/:token/events', async (c) => {
  const room = await resolveRoom(c.env.DB, c.req.param('token'));
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  const parsed = roomEventSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return apiError(c, 'VALIDATION_ERROR', 'Invalid room event.');

  const now = new Date().toISOString();
  const event = parsed.data.event;
  if (event === 'STARTED' && room.role === 'HOST') {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE meeting_rooms SET status = 'ACTIVE', updated_at = ? WHERE id = ?`,
      ).bind(now, room.room_id),
      c.env.DB.prepare(
        `UPDATE meetings
         SET status = 'IN_PROGRESS', started_at = COALESCE(started_at, ?),
             transcript_status = 'RECORDING', updated_at = ?
         WHERE id = ?`,
      ).bind(now, now, room.meeting_id),
    ]);
  } else if (event === 'ENDED' && room.role === 'HOST') {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE meeting_rooms SET status = 'ENDED', updated_at = ? WHERE id = ?`,
      ).bind(now, room.room_id),
      c.env.DB.prepare(
        `UPDATE meetings
         SET status = 'COMPLETED', ended_at = ?,
             duration_secs = CASE
               WHEN started_at IS NULL THEN NULL
               ELSE CAST((julianday(?) - julianday(started_at)) * 86400 AS INTEGER)
             END,
             updated_at = ?
         WHERE id = ?`,
      ).bind(now, now, now, room.meeting_id),
    ]);
  }

  return c.json({ accepted: true });
});

meetingRooms.post('/:token/recording', async (c) => {
  const room = await resolveRoom(c.env.DB, c.req.param('token'));
  if (!room) return apiError(c, 'NOT_FOUND', 'Room link is invalid or expired.');
  if (room.role !== 'HOST') return apiError(c, 'FORBIDDEN', 'Only the host can upload a room recording.');

  const contentLength = Number(c.req.header('Content-Length') ?? '0');
  if (contentLength > 100 * 1024 * 1024) {
    return apiError(c, 'VALIDATION_ERROR', 'Recording exceeds the 100 MB limit.');
  }
  const bytes = await c.req.arrayBuffer();
  if (bytes.byteLength === 0) return apiError(c, 'VALIDATION_ERROR', 'Recording is empty.');

  const contentType = c.req.header('Content-Type') ?? 'audio/webm';
  const recordingKey = `meetings/${room.owner_id}/${room.meeting_id}/recording.webm`;
  await c.env.STORAGE.put(recordingKey, bytes, {
    httpMetadata: { contentType },
    customMetadata: { meetingId: room.meeting_id, roomId: room.room_id },
  });
  await c.env.DB.prepare(
    `UPDATE meetings
     SET transcript_status = 'PROCESSING', recording_r2_key = ?,
         transcript_error = NULL, updated_at = ?
     WHERE id = ?`,
  ).bind(recordingKey, new Date().toISOString(), room.meeting_id).run();

  c.executionCtx.waitUntil(processRecording(c.env, room, recordingKey));
  return c.json({ accepted: true, transcriptStatus: 'PROCESSING' }, 202);
});

// ─── Authenticated meeting management ───────────────────────────────────────
// These routes let a recruiter create meetings, list them, and invite guests.
// The token-based room runtime above remains public (the opaque token IS the
// credential). Management of meetings themselves requires Clerk JWT auth.

const MEETING_TYPES = ['DISCOVERY', 'INTERVIEW', 'FOLLOW_UP', 'DEMO', 'OTHER'] as const;
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const createMeetingSchema = z.object({
  contactId: z.string().min(1).optional(),
  recipientEmail: z.string().email().optional(),
  recipientName: z.string().max(200).optional(),
  title: z.string().max(200).optional(),
  description: z.string().max(2000).optional(),
  meetingType: z.enum(MEETING_TYPES).optional(),
  scheduledAt: z.string().optional(),
  scheduledInterviewId: z.string().min(1).optional(),
}).refine(
  (data) => Boolean(data.contactId) || (Boolean(data.recipientEmail) && Boolean(data.recipientName)),
  'Either contactId or both recipientEmail and recipientName are required.',
);

const inviteGuestSchema = z.object({
  email: z.string().email(),
  message: z.string().max(1000).optional(),
});

interface MeetingRow {
  id: string;
  owner_id: string;
  title: string;
  description: string | null;
  status: string;
  scheduled_at: string | null;
  started_at: string | null;
  ended_at: string | null;
  duration_secs: number | null;
  meeting_url: string | null;
  meeting_type: string;
  transcript_status: string;
  transcript_summary: string | null;
  recording_r2_key: string | null;
  scheduled_interview_id: string | null;
  created_at: string;
  updated_at: string;
}

interface RoomRow {
  id: string;
  meeting_id: string;
  session_id: string;
  status: string;
}

async function createRoomAndHostToken(
  db: D1Database,
  meetingId: string,
  ownerId: string,
): Promise<{ room: RoomRow; hostToken: string }> {
  const roomId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO meeting_rooms (id, meeting_id, session_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'WAITING', ?, ?)`,
  ).bind(roomId, meetingId, sessionId, now, now).run();

  const hostToken = generateRoomToken();
  const hostHash = await hashRoomToken(hostToken);
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  await db.prepare(
    `INSERT INTO meeting_room_tokens (id, room_id, token_hash, role, expires_at, created_at)
     VALUES (?, ?, ?, 'HOST', ?, ?)`,
  ).bind(crypto.randomUUID(), roomId, hostHash, expiresAt, now).run();

  return {
    room: { id: roomId, meeting_id: meetingId, session_id: sessionId, status: 'WAITING' },
    hostToken,
  };
}

export async function ensureMeetingRoomLinks(
  db: D1Database,
  meetingId: string,
  roomAppUrl: string,
): Promise<{
  id: string;
  sessionId: string;
  hostUrl: string;
  guestUrl: string;
  expiresAt: string;
}> {
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  let room = await db.prepare(
    'SELECT id, session_id FROM meeting_rooms WHERE meeting_id = ?',
  ).bind(meetingId).first<{ id: string; session_id: string }>();

  if (!room) {
    room = {
      id: crypto.randomUUID(),
      session_id: crypto.randomUUID(),
    };
    await db.prepare(
      `INSERT INTO meeting_rooms (id, meeting_id, session_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'WAITING', ?, ?)`,
    ).bind(room.id, meetingId, room.session_id, now, now).run();
  }

  await db.prepare(
    `UPDATE meeting_room_tokens
     SET revoked_at = ?
     WHERE room_id = ? AND role = 'HOST' AND revoked_at IS NULL`,
  ).bind(now, room.id).run();

  const hostToken = generateRoomToken();
  const hostHash = await hashRoomToken(hostToken);
  await db.prepare(
    `INSERT INTO meeting_room_tokens (id, room_id, token_hash, role, expires_at, created_at)
     VALUES (?, ?, ?, 'HOST', ?, ?)`,
  ).bind(crypto.randomUUID(), room.id, hostHash, expiresAt, now).run();

  const meeting = await db.prepare(
    'SELECT meeting_url FROM meetings WHERE id = ?',
  ).bind(meetingId).first<{ meeting_url: string | null }>();
  const participants = await db.prepare(
    `SELECT id FROM meeting_participants
     WHERE meeting_id = ?
     ORDER BY created_at, id`,
  ).bind(meetingId).all<{ id: string }>();
  const guestParticipantId = participants.results.length === 1
    ? participants.results[0]?.id ?? null
    : null;

  let guestToken: string | null = null;
  if (meeting?.meeting_url) {
    try {
      const existingUrl = new URL(meeting.meeting_url);
      guestToken = existingUrl.pathname.split('/').filter(Boolean).pop() ?? null;
      if (guestToken) {
        const existingHash = await hashRoomToken(guestToken);
        const valid = await db.prepare(
          `SELECT id FROM meeting_room_tokens
           WHERE room_id = ? AND token_hash = ? AND role = 'GUEST'
             AND revoked_at IS NULL AND expires_at > ?`,
        ).bind(room.id, existingHash, now).first<{ id: string }>();
        if (!valid) {
          guestToken = null;
        } else if (guestParticipantId) {
          await db.prepare(
            `UPDATE meeting_room_tokens
             SET participant_id = ?
             WHERE id = ? AND participant_id IS NULL`,
          ).bind(guestParticipantId, valid.id).run();
        }
      }
    } catch {
      guestToken = null;
    }
  }

  if (!guestToken) {
    guestToken = await mintGuestToken(db, room.id, guestParticipantId);
  }

  const cleanRoomAppUrl = roomAppUrl.replace(/\/$/, '');
  const hostUrl = `${cleanRoomAppUrl}/room/${hostToken}`;
  const guestUrl = `${cleanRoomAppUrl}/room/${guestToken}`;
  await db.prepare(
    'UPDATE meetings SET meeting_url = ?, updated_at = ? WHERE id = ?',
  ).bind(guestUrl, now, meetingId).run();

  return {
    id: room.id,
    sessionId: room.session_id,
    hostUrl,
    guestUrl,
    expiresAt,
  };
}

async function mintGuestToken(
  db: D1Database,
  roomId: string,
  participantId: string | null,
): Promise<string> {
  const guestToken = generateRoomToken();
  const guestHash = await hashRoomToken(guestToken);
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();
  await db.prepare(
    `INSERT INTO meeting_room_tokens (id, room_id, token_hash, role, participant_id, expires_at, created_at)
     VALUES (?, ?, ?, 'GUEST', ?, ?, ?)`,
  ).bind(crypto.randomUUID(), roomId, guestHash, participantId, expiresAt, now).run();
  return guestToken;
}

export const meetingsAuth = new Hono<{ Bindings: Env; Variables: Variables }>();
meetingsAuth.use('*', authMiddleware);

// POST / — create a meeting + room + host token
meetingsAuth.post('/', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const body = await c.req.json().catch(() => ({}));
  const parsed = createMeetingSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }
  const data = parsed.data;

  // Resolve a contact when contactId is provided; otherwise create one from recipient info.
  let contactId: string | null = null;
  if (data.contactId) {
    const contact = await db
      .prepare('SELECT id FROM contacts WHERE id = ? AND owner_id = ?')
      .bind(data.contactId, userId)
      .first<{ id: string }>();
    if (!contact) return apiError(c, 'NOT_FOUND', 'Contact not found.');
    contactId = contact.id;
  } else if (data.recipientEmail && data.recipientName) {
    // Reuse an existing contact with this email if present, else create one.
    const existing = await db
      .prepare('SELECT id FROM contacts WHERE owner_id = ? AND email = ?')
      .bind(userId, data.recipientEmail)
      .first<{ id: string }>();
    if (existing) {
      contactId = existing.id;
    } else {
      contactId = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.prepare(
        `INSERT INTO contacts (id, owner_id, email, name, type, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'lead', ?, ?)`,
      ).bind(contactId, userId, data.recipientEmail, data.recipientName, now, now).run();
    }
  }

  const meetingId = crypto.randomUUID();
  const now = new Date().toISOString();
  const title = data.title ?? (data.recipientName ?? 'Meeting');
  const meetingType = data.meetingType ?? 'OTHER';

  await db.prepare(
    `INSERT INTO meetings
     (id, owner_id, title, description, status, scheduled_at, meeting_type,
      scheduled_interview_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'SCHEDULED', ?, ?, ?, ?, ?)`,
  ).bind(
    meetingId, userId, title, data.description ?? null,
    data.scheduledAt ?? null, meetingType,
    data.scheduledInterviewId ?? null, now, now,
  ).run();

  // Link the contact as a participant (ATTENDEE; host is the recruiter).
  if (contactId) {
    await db.prepare(
      `INSERT INTO meeting_participants (id, meeting_id, contact_id, role, created_at, updated_at)
       VALUES (?, ?, ?, 'ATTENDEE', ?, ?)`,
    ).bind(crypto.randomUUID(), meetingId, contactId, now, now).run();
  }

  const { room, hostToken } = await createRoomAndHostToken(db, meetingId, userId);

  return c.json({
    meeting: {
      id: meetingId,
      title,
      description: data.description ?? null,
      status: 'SCHEDULED',
      meetingType,
      scheduledAt: data.scheduledAt ?? null,
      scheduledInterviewId: data.scheduledInterviewId ?? null,
      contactId,
    },
    room: { id: room.id, sessionId: room.session_id, status: room.status },
    hostToken,
  }, 201);
});

// GET / — list owner's meetings with room status + participants
meetingsAuth.get('/', async (c) => {
  const userId = c.var.userId;
  const db = c.env.DB;

  const meetings = await db.prepare(
    `SELECT m.* FROM meetings m
     WHERE m.owner_id = ?
     ORDER BY m.created_at DESC
     LIMIT 100`,
  ).bind(userId).all<MeetingRow>();

  if (!meetings.results.length) {
    return c.json({ meetings: [] });
  }

  const meetingIds = meetings.results.map((m) => m.id);
  const placeholders = meetingIds.map(() => '?').join(',');
  const rooms = await db.prepare(
    `SELECT mr.* FROM meeting_rooms mr
     WHERE mr.meeting_id IN (${placeholders})`,
  ).bind(...meetingIds).all<RoomRow>();

  const participants = await db.prepare(
    `SELECT mp.meeting_id, mp.role, c.id AS contact_id, c.name, c.email
     FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.meeting_id IN (${placeholders})`,
  ).bind(...meetingIds).all<{
    meeting_id: string; role: string; contact_id: string; name: string | null; email: string | null;
  }>();

  const roomsByMeeting = new Map(rooms.results.map((r) => [r.meeting_id, r]));
  const participantsByMeeting = new Map<string, Array<{
    role: string; contactId: string; name: string | null; email: string | null;
  }>>();
  for (const p of participants.results) {
    const list = participantsByMeeting.get(p.meeting_id) ?? [];
    list.push({ role: p.role, contactId: p.contact_id, name: p.name, email: p.email });
    participantsByMeeting.set(p.meeting_id, list);
  }

  const result = meetings.results.map((m) => {
    const room = roomsByMeeting.get(m.id);
    return {
      id: m.id,
      title: m.title,
      description: m.description,
      status: m.status,
      meetingType: m.meeting_type,
      scheduledAt: m.scheduled_at,
      startedAt: m.started_at,
      endedAt: m.ended_at,
      durationSecs: m.duration_secs,
      transcriptStatus: m.transcript_status,
      recordingR2Key: m.recording_r2_key,
      scheduledInterviewId: m.scheduled_interview_id,
      room: room ? { id: room.id, sessionId: room.session_id, status: room.status } : null,
      participants: participantsByMeeting.get(m.id) ?? [],
      createdAt: m.created_at,
    };
  });

  return c.json({ meetings: result });
});

// GET /:id — meeting detail with transcript status
meetingsAuth.get('/:id', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const meeting = await db.prepare(
    'SELECT * FROM meetings WHERE id = ? AND owner_id = ?',
  ).bind(id, userId).first<MeetingRow>();
  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const room = await db.prepare(
    'SELECT * FROM meeting_rooms WHERE meeting_id = ?',
  ).bind(id).first<RoomRow>();

  const participants = await db.prepare(
    `SELECT mp.role, mp.joined_at, mp.left_at, c.id AS contact_id, c.name, c.email
     FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.meeting_id = ?`,
  ).bind(id).all<{
    role: string; joined_at: string | null; left_at: string | null;
    contact_id: string; name: string | null; email: string | null;
  }>();

  return c.json({
    meeting: {
      id: meeting.id,
      title: meeting.title,
      description: meeting.description,
      status: meeting.status,
      meetingType: meeting.meeting_type,
      scheduledAt: meeting.scheduled_at,
      startedAt: meeting.started_at,
      endedAt: meeting.ended_at,
      durationSecs: meeting.duration_secs,
      transcriptStatus: meeting.transcript_status,
      transcriptSummary: meeting.transcript_summary,
      recordingR2Key: meeting.recording_r2_key,
      scheduledInterviewId: meeting.scheduled_interview_id,
      room: room ? { id: room.id, sessionId: room.session_id, status: room.status } : null,
      participants: participants.results.map((p) => ({
        role: p.role,
        joinedAt: p.joined_at,
        leftAt: p.left_at,
        contactId: p.contact_id,
        name: p.name,
        email: p.email,
      })),
      createdAt: meeting.created_at,
      updatedAt: meeting.updated_at,
    },
  });
});

// POST /:id/room — create/reopen a standalone video room for a meeting.
meetingsAuth.post('/:id/room', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const meeting = await db.prepare(
    'SELECT id FROM meetings WHERE id = ? AND owner_id = ?',
  ).bind(id, userId).first<{ id: string }>();
  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const room = await ensureMeetingRoomLinks(
    db,
    meeting.id,
    c.env.VIDEO_ROOM_APP_URL ?? 'http://localhost:5175',
  );

  return c.json({ room });
});

// POST /:id/invite — mint a guest token and send via Resend with the join link
meetingsAuth.post('/:id/invite', async (c) => {
  const userId = c.var.userId;
  const { id } = c.req.param();
  const db = c.env.DB;

  const meeting = await db.prepare(
    'SELECT id, title, owner_id FROM meetings WHERE id = ? AND owner_id = ?',
  ).bind(id, userId).first<{ id: string; title: string; owner_id: string }>();
  if (!meeting) return apiError(c, 'NOT_FOUND', 'Meeting not found.');

  const room = await db.prepare(
    'SELECT id FROM meeting_rooms WHERE meeting_id = ?',
  ).bind(id).first<{ id: string }>();
  if (!room) return apiError(c, 'NOT_FOUND', 'Meeting room not found.');

  const body = await c.req.json().catch(() => ({}));
  const parsed = inviteGuestSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }
  const { email, message: customMessage } = parsed.data;

  // Resolve the participant for this email (must already be a meeting_participant).
  const participant = await db.prepare(
    `SELECT mp.id, c.name FROM meeting_participants mp
     INNER JOIN contacts c ON c.id = mp.contact_id
     WHERE mp.meeting_id = ? AND c.email = ?`,
  ).bind(id, email).first<{ id: string; name: string | null }>();

  const guestToken = await mintGuestToken(db, room.id, participant?.id ?? null);

  const baseUrl = c.env.APP_BASE_URL ?? 'https://pipe.build';
  const joinUrl = `${baseUrl}/meeting/${guestToken}`;
  const escapeHtml = (str: string): string =>
    str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const guestName = escapeHtml(participant?.name ?? email.split('@')[0] ?? 'there');
  const safeJoinUrl = encodeURI(joinUrl);
  const customBlock = customMessage
    ? `<p style="font-size:16px;line-height:1.6;margin-bottom:24px;padding:16px;background:rgba(255,255,255,0.05);border-left:3px solid rgba(96,165,250,0.4);border-radius:4px;">${escapeHtml(customMessage)}</p>`
    : '';

  const html = `<div style="font-family:'Space Mono',monospace;max-width:600px;margin:0 auto;padding:40px 20px;color:#e0e0e0;background:#0c0c0e;">
  <h1 style="font-size:24px;font-weight:700;margin-bottom:24px;color:#fff;">Hi ${guestName},</h1>
  <p style="font-size:16px;line-height:1.6;margin-bottom:24px;">
    You've been invited to a video call for <strong>${escapeHtml(meeting.title)}</strong>.
  </p>
  ${customBlock}
  <a href="${safeJoinUrl}" style="display:inline-block;padding:14px 32px;background:#fff;color:#0c0c0e;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:0.5px;border:none;">
    JOIN VIDEO CALL →
  </a>
  <p style="font-size:12px;color:#666;margin-top:40px;">
    If the button doesn't work, copy this link:<br/>
    <a href="${safeJoinUrl}" style="color:#888;">${escapeHtml(joinUrl)}</a>
  </p>
</div>`;

  if (!c.env.RESEND_API_KEY) {
    // No email service — return the join link directly (dev/test path).
    return c.json({ success: true, emailSent: false, joinUrl, guestToken });
  }

  const { Resend } = await import('resend');
  const resend = new Resend(c.env.RESEND_API_KEY);
  try {
    const sendResult = await resend.emails.send({
      from: 'Pipe <onboarding@resend.dev>',
      to: email,
      subject: `Video call invitation — ${meeting.title}`,
      html,
    });
    if (sendResult.error) {
      return c.json({ success: false, emailSent: false, joinUrl }, 502);
    }
  } catch (err) {
    console.error('[meetings/invite] Email send failed:', err);
    return c.json({ success: false, emailSent: false, joinUrl }, 502);
  }

  const now = new Date().toISOString();
  await db.prepare(
    `UPDATE meeting_participants SET invite_sent_at = COALESCE(invite_sent_at, ?), updated_at = ?
     WHERE meeting_id = ? AND contact_id = ?`,
  ).bind(now, now, id, participant?.id ?? '').run();

  return c.json({ success: true, emailSent: true, joinUrl });
});
