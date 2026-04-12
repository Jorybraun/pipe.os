/**
 * Voice Session Routes
 *
 * POST   /api/v1/voice-sessions            — Create a voice session, init the DO
 * GET    /api/v1/voice-sessions/:id/ws     — WebSocket upgrade → Durable Object
 * POST   /api/v1/voice-sessions/transcript-callback — Internal DO→Worker callback on session end
 *
 * Routes 1 & 2 require Clerk JWT auth (Bearer header or ?token= query param).
 * Route 3 is internal-only, authenticated via X-Internal-Secret header.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import { buildRoleAgentSystemPrompt } from '../../lib/roleAgentPrompts';
import type { Env, Variables } from '../../types';

// ─── Validation schemas ───────────────────────────────────────────────────────

const createSessionSchema = z.object({
  type: z.enum(['role-discovery', 'culture-interview', 'agent-interview']),
  contextId: z.string().optional(),
  challengeId: z.string().optional(),
  systemPrompt: z.string().optional(),
});

const transcriptEntrySchema = z.object({
  role: z.enum(['user', 'model']),
  text: z.string(),
});

const transcriptCallbackSchema = z.object({
  sessionId: z.string(),
  transcript: z.array(transcriptEntrySchema),
  metadata: z.object({
    type: z.enum(['role-discovery', 'culture-interview', 'agent-interview']),
    contextId: z.string().nullable(),
    challengeId: z.string().nullable(),
    ownerId: z.string(),
  }),
});

// ─── D1 row shape ─────────────────────────────────────────────────────────────

interface RoleContextRow {
  baseline: string | null;
}

// ─── Router ───────────────────────────────────────────────────────────────────

export const voiceSessions = new Hono<{ Bindings: Env; Variables: Variables }>();

// ─────────────────────────────────────────────────────────────────────────────
// POST /transcript-callback  (internal — must be registered BEFORE authMiddleware
//                             routes so the path does not require Clerk auth)
// ─────────────────────────────────────────────────────────────────────────────

voiceSessions.post('/transcript-callback', async (c) => {
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

  const { sessionId, transcript, metadata } = parsed.data;
  const endedAt = new Date().toISOString();

  // ── Persist transcript + mark COMPLETE ─────────────────────────────────────
  const transcriptJson = JSON.stringify(transcript);

  await c.env.DB.prepare(
    `UPDATE voice_sessions
        SET status = 'COMPLETE', transcript_json = ?, ended_at = ?
      WHERE id = ?`,
  )
    .bind(transcriptJson, endedAt, sessionId)
    .run();

  // ── Optionally stash transcript reference on role_contexts ─────────────────
  // Full synthesis pipeline is follow-up work (see STRATEGY.md).
  // For now we record that a voice session was completed so the context row is
  // queryable.  We use a simple JSON patch into knowledge_state rather than a
  // separate column, keeping the schema narrow.
  if (metadata.type === 'role-discovery' && metadata.contextId) {
    const synthesisSnippet = transcript
      .map((e) => `${e.role}: ${e.text}`)
      .join('\n')
      .slice(0, 8_000); // guard against excessively large patches

    await c.env.DB.prepare(
      `UPDATE role_contexts
          SET knowledge_state = json_patch(
                COALESCE(knowledge_state, '{}'),
                json_object('voice_transcript', ?)
              )
        WHERE id = ? AND owner_id = ?`,
    )
      .bind(synthesisSnippet, metadata.contextId, metadata.ownerId)
      .run();
  }

  return c.json({ ok: true });
});

// ─────────────────────────────────────────────────────────────────────────────
// Apply Clerk auth to all remaining routes
// ─────────────────────────────────────────────────────────────────────────────

voiceSessions.use('*', authMiddleware);

// ─────────────────────────────────────────────────────────────────────────────
// POST /  — Create a voice session
// ─────────────────────────────────────────────────────────────────────────────

voiceSessions.post('/', async (c) => {
  const userId = c.var.userId;

  // ── Parse + validate body ───────────────────────────────────────────────────
  let rawBody: unknown;
  try {
    rawBody = await c.req.json();
  } catch {
    return apiError(c, 'VALIDATION_ERROR', 'Request body must be valid JSON.');
  }

  const parsed = createSessionSchema.safeParse(rawBody);
  if (!parsed.success) {
    return apiError(c, 'VALIDATION_ERROR', parsed.error.issues[0]?.message ?? 'Validation failed.');
  }

  const { type, contextId, challengeId, systemPrompt: customSystemPrompt } = parsed.data;

  // ── Generate session ID ─────────────────────────────────────────────────────
  const sessionId = crypto.randomUUID();

  // ── Build system prompt ─────────────────────────────────────────────────────
  let systemPrompt: string;

  if (customSystemPrompt) {
    // Caller supplied an explicit prompt — use it verbatim.
    systemPrompt = customSystemPrompt;
  } else if (type === 'role-discovery' && contextId) {
    // Query the role context and build the role-discovery prompt from its baseline.
    const row = await c.env.DB.prepare(
      `SELECT baseline FROM role_contexts WHERE id = ? AND owner_id = ?`,
    )
      .bind(contextId, userId)
      .first<RoleContextRow>();

    if (row) {
      let baseline: Record<string, unknown> = {};
      try {
        baseline = JSON.parse(row.baseline ?? '{}') as Record<string, unknown>;
      } catch {
        // Malformed baseline — fall through to the generic prompt.
      }

      // buildRoleAgentSystemPrompt without a participantRole = recruiter voice session
      const base = buildRoleAgentSystemPrompt();
      // Embed the baseline context so the agent is grounded in this specific role.
      const baselineSection =
        Object.keys(baseline).length > 0
          ? `\n\n## Role Context\n\`\`\`json\n${JSON.stringify(baseline, null, 2)}\n\`\`\``
          : '';
      systemPrompt = base + baselineSection;
    } else {
      // Context not found or not owned — use generic fallback, do not 404
      // (session creation should still succeed; the DO will run with the generic prompt).
      console.error(
        '[voiceSessions] role context not found or not owned:',
        { contextId, userId },
      );
      systemPrompt = 'You are a helpful AI interviewer. Conduct a structured interview.';
    }
  } else {
    systemPrompt = 'You are a helpful AI interviewer. Conduct a structured interview.';
  }

  // ── Persist session row (PENDING) ───────────────────────────────────────────
  const contextRef = contextId ?? challengeId ?? null;
  const createdAt = new Date().toISOString();

  await c.env.DB.prepare(
    `INSERT INTO voice_sessions (id, type, context_id, owner_id, status, created_at)
     VALUES (?, ?, ?, ?, 'PENDING', ?)`,
  )
    .bind(sessionId, type, contextRef, userId, createdAt)
    .run();

  // ── Initialise the Durable Object ───────────────────────────────────────────
  const doId = c.env.VOICE_SESSION.idFromName(sessionId);
  const stub = c.env.VOICE_SESSION.get(doId);

  const completionCallbackUrl = new URL(
    '/api/v1/voice-sessions/transcript-callback',
    c.req.url,
  ).toString();

  const internalSecret = c.env.VOICE_SESSION_INTERNAL_SECRET ?? 'dev-secret';

  const initRes = await stub.fetch('https://do/__init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      systemPrompt,
      completionCallbackUrl,
      metadata: {
        type,
        contextId: contextId ?? null,
        challengeId: challengeId ?? null,
        ownerId: userId,
      },
      internalSecret,
    }),
  });

  if (!initRes.ok) {
    const errorText = await initRes.text().catch(() => 'unknown error');
    console.error('[voiceSessions] DO __init failed:', { sessionId, status: initRes.status, errorText });
    return apiError(c, 'INTERNAL_ERROR', 'Failed to initialise voice session.');
  }

  return c.json(
    {
      sessionId,
      wsUrl: `/api/v1/voice-sessions/${sessionId}/ws`,
    },
    201,
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id/ws  — WebSocket upgrade → Durable Object
// ─────────────────────────────────────────────────────────────────────────────

voiceSessions.get('/:id/ws', async (c) => {
  const { id } = c.req.param();

  // Verify this is a WebSocket upgrade request.
  const upgradeHeader = c.req.header('Upgrade');
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== 'websocket') {
    return apiError(c, 'VALIDATION_ERROR', 'Expected WebSocket upgrade.');
  }

  // ── Verify session exists and belongs to the authenticated user ─────────────
  // authMiddleware already ran (applied to '*' after transcript-callback),
  // so c.var.userId is available.  We do a lightweight existence check rather
  // than full token re-verification to keep WebSocket latency low.
  const userId = c.var.userId;

  const session = await c.env.DB.prepare(
    `SELECT status FROM voice_sessions WHERE id = ? AND owner_id = ?`,
  )
    .bind(id, userId)
    .first<{ status: string }>();

  if (!session) {
    return c.json(
      { error: { code: 'NOT_FOUND', message: 'Voice session not found.' } },
      404,
    );
  }

  if (session.status !== 'PENDING' && session.status !== 'ACTIVE') {
    return c.json(
      { error: { code: 'CONFLICT', message: `Voice session is ${session.status.toLowerCase()} and cannot accept connections.` } },
      409,
    );
  }

  // ── Transition to ACTIVE ────────────────────────────────────────────────────
  await c.env.DB.prepare(
    `UPDATE voice_sessions SET status = 'ACTIVE' WHERE id = ?`,
  )
    .bind(id)
    .run();

  // ── Forward to Durable Object ───────────────────────────────────────────────
  const doId = c.env.VOICE_SESSION.idFromName(id);
  const stub = c.env.VOICE_SESSION.get(doId);

  return stub.fetch(
    new Request('https://do/__ws', c.req.raw),
  );
});
