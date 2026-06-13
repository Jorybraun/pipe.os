import { Hono } from 'hono';
import { z } from 'zod';
import { apiError } from '../middleware/errors';
import { hashRoomToken } from '../lib/roomTokens';
import {
  transcribeAudioDeepgramStructured,
  transcribeAudioWhisper,
} from '../lib/transcribe';
import { ingestMeetingTranscriptToLivingContext } from '../lib/livingContext';
import type {
  MeetingTranscriptAssertionInput,
  MeetingTranscriptSegmentInput,
} from '../lib/livingContext';
import type { Env } from '../types';

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
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
  }

  const response = await fetch(
    `https://pipe-os.metered.live/api/v1/turn/credentials?apiKey=${c.env.METERED_API_KEY}`,
  );
  if (!response.ok) return apiError(c, 'INTERNAL_ERROR', 'TURN credentials are unavailable.');
  return c.json({ iceServers: await response.json() });
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
