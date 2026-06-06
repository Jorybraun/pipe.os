/**
 * Video routes — session creation, WebSocket upgrade, TURN credentials.
 *
 * POST   /api/v1/video/sessions              — create a video session (returns session ID)
 * GET    /api/v1/video/sessions/:id/ws       — WebSocket upgrade → Durable Object
 * GET    /api/v1/video/sessions/:id/status   — get session status
 * GET    /api/v1/video/turn-credentials      — fetch TURN credentials from Metered.ca
 * POST   /api/v1/video/transcript-callback   — internal DO→Worker callback on session end
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { candidateAuth, type CandidateVariables } from '../../middleware/candidateAuth';
import { apiError } from '../../middleware/errors';
import type { Env, Variables } from '../../types';

// ─── Validation ─────────────────────────────────────────────────────────────

const createSessionSchema = z.object({
  stageId: z.string().min(1),
  candidateId: z.string().min(1),
  scheduledInterviewId: z.string().optional(),
});

const transcriptEntrySchema = z.object({
  role: z.enum(['user', 'model']),
  text: z.string(),
  timestamp: z.string().optional(),
});

const transcriptCallbackSchema = z.object({
  scheduledInterviewId: z.string(),
  transcript: z.array(transcriptEntrySchema),
  status: z.enum(['COMPLETED', 'FAILED']),
  errorMessage: z.string().optional(),
});

// ─── Router (no auth for internal callback) ───────────────────────────────────

const video = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─────────────────────────────────────────────────────────────────────────────
// POST /transcript-callback  (internal — must be registered BEFORE authMiddleware
//                             routes so the path does not require Clerk auth)
// ─────────────────────────────────────────────────────────────────────────────

video.post('/transcript-callback', async (c) => {
  // ── Auth: shared secret only ────────────────────────────────────────────────
  const expectedSecret = c.env.VOICE_SESSION_INTERNAL_SECRET ?? 'dev-secret';
  const providedSecret = c.req.header('X-Internal-Secret');

  if (!providedSecret || providedSecret !== expectedSecret) {
    return c.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid or missing internal secret.' } },
      401,
    );
  }

  // ── Parse + validate body ───────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = transcriptCallbackSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed.');
  }

  const { scheduledInterviewId, transcript, status, errorMessage } = parsed.data;
  const now = new Date().toISOString();

  // ── Create or update transcript artifact ─────────────────────────────────────
  const transcriptJson = JSON.stringify(transcript);

  // Check if artifact already exists
  const existing = await c.env.DB.prepare(
    `SELECT id FROM transcript_artifacts WHERE scheduled_interview_id = ?`,
  )
    .bind(scheduledInterviewId)
    .first<{ id: string }>();

  if (existing) {
    // Update existing artifact
    await c.env.DB.prepare(
      `UPDATE transcript_artifacts
         SET status = ?, transcript_json = ?, error_message = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(status, transcriptJson, errorMessage ?? null, now, existing.id)
      .run();
  } else {
    // Create new artifact
    const artifactId = crypto.randomUUID();
    await c.env.DB.prepare(
      `INSERT INTO transcript_artifacts (id, scheduled_interview_id, status, transcript_json, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(artifactId, scheduledInterviewId, status, transcriptJson, errorMessage ?? null, now, now)
      .run();
  }

  return c.json({ ok: true });
});

// ─── Recruiter routes (Clerk JWT) ───────────────────────────────────────────

const videoAuth = new Hono<{ Bindings: Env; Variables: Variables }>();
videoAuth.use('*', authMiddleware);

// POST /sessions — create a video session
videoAuth.post('/sessions', async (c) => {
  const userId = c.var.userId;
  const body = await c.req.json();
  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed');
  }

  const { stageId, candidateId, scheduledInterviewId } = parsed.data;
  // Deterministic session ID so both recruiter and candidate resolve to the same DO
  const sessionId = `${stageId}--${candidateId}`;

  // Build transcript callback URL
  const transcriptCallbackUrl = new URL(
    '/api/v1/video/transcript-callback',
    c.req.url,
  ).toString();

  const internalSecret = c.env.VOICE_SESSION_INTERNAL_SECRET ?? 'dev-secret';

  // Initialize the Durable Object
  const doId = c.env.VIDEO_ROOM.idFromName(sessionId);
  const stub = c.env.VIDEO_ROOM.get(doId);

  const initResponse = await stub.fetch(new Request('https://do/init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      stageId,
      candidateId,
      recruiterId: userId,
      scheduledInterviewId,
      transcriptCallbackUrl,
      internalSecret,
    }),
  }));

  if (!initResponse.ok) {
    return apiError(c, 'INTERNAL_ERROR', 'Failed to initialize video session.');
  }

  return c.json({
    session: {
      id: sessionId,
      stageId,
      candidateId,
      recruiterId: userId,
      status: 'WAITING',
    },
  }, 201);
});

// GET /sessions/:id/ws — WebSocket upgrade (recruiter)
videoAuth.get('/sessions/:id/ws', async (c) => {
  const { id } = c.req.param();
  const upgradeHeader = c.req.header('Upgrade');

  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return apiError(c, 'VALIDATION_ERROR', 'Expected WebSocket upgrade.');
  }

  const doId = c.env.VIDEO_ROOM.idFromName(id);
  const stub = c.env.VIDEO_ROOM.get(doId);

  // Forward the WebSocket upgrade request to the Durable Object
  const url = new URL(c.req.url);
  return stub.fetch(new Request(`https://do/ws?role=RECRUITER`, {
    headers: c.req.raw.headers,
  }));
});

// GET /sessions/:id/status — get session status (recruiter)
videoAuth.get('/sessions/:id/status', async (c) => {
  const { id } = c.req.param();

  const doId = c.env.VIDEO_ROOM.idFromName(id);
  const stub = c.env.VIDEO_ROOM.get(doId);

  const response = await stub.fetch(new Request('https://do/status'));
  const data = await response.json() as { status: string; peers: number };

  return c.json(data);
});

// GET /turn-credentials — fetch TURN credentials from Metered.ca
videoAuth.get('/turn-credentials', async (c) => {
  const meteredApiKey = (c.env as unknown as Record<string, string>)['METERED_API_KEY'];
  if (!meteredApiKey) {
    // Return STUN-only fallback
    return c.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
  }

  try {
    const response = await fetch(
      `https://pipe-os.metered.live/api/v1/turn/credentials?apiKey=${meteredApiKey}`,
    );

    if (!response.ok) {
      console.error('[video] Metered TURN fetch failed:', response.status);
      return c.json({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
        ],
      });
    }

    const iceServers = await response.json();
    return c.json({ iceServers });
  } catch (err) {
    console.error('[video] TURN credentials error:', err);
    return c.json({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });
  }
});

// ─── Candidate routes (session JWT) ─────────────────────────────────────────

const videoCandidate = new Hono<{ Bindings: Env; Variables: CandidateVariables }>();
videoCandidate.use('*', candidateAuth);

// GET /sessions/:id/ws — WebSocket upgrade (candidate)
videoCandidate.get('/sessions/:id/ws', async (c) => {
  const { id } = c.req.param();
  const upgradeHeader = c.req.header('Upgrade');

  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return apiError(c, 'VALIDATION_ERROR', 'Expected WebSocket upgrade.');
  }

  const doId = c.env.VIDEO_ROOM.idFromName(id);
  const stub = c.env.VIDEO_ROOM.get(doId);

  return stub.fetch(new Request(`https://do/ws?role=CANDIDATE`, {
    headers: c.req.raw.headers,
  }));
});

export { video, videoAuth, videoCandidate };
