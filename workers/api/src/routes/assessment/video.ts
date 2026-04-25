/**
 * Video routes — session creation, WebSocket upgrade, TURN credentials.
 *
 * POST   /api/v1/video/sessions              — create a video session (returns session ID)
 * GET    /api/v1/video/sessions/:id/ws       — WebSocket upgrade → Durable Object
 * GET    /api/v1/video/sessions/:id/status   — get session status
 * GET    /api/v1/video/turn-credentials      — fetch TURN credentials from Metered.ca
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

  const { stageId, candidateId } = parsed.data;
  // Deterministic session ID so both recruiter and candidate resolve to the same DO
  const sessionId = `${stageId}--${candidateId}`;

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

export { videoAuth, videoCandidate };
