/**
 * Recruiter-facing read-only routes for dev container session data.
 *
 * GET /api/v1/pipelines/:pipelineId/dev-container-sessions
 *   — list all sessions for a pipeline, newest first, capped at 100.
 * GET /api/v1/dev-container-sessions/:sessionId
 *   — single session by its public session_id.
 *
 * Both routes:
 *   - Require a valid Clerk JWT (authMiddleware).
 *   - Verify that the pipeline belongs to the authenticated user before
 *     returning data, so a recruiter cannot read another org's sessions.
 *   - Never expose the internal row id or the proxy url column.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import {
  listSessionsByPipeline,
  getSessionByPublicId,
  type CockpitSessionRow,
} from '../../lib/devContainerSessions';
import type { Env, Variables } from '../../types';

const devContainerSessions = new Hono<{ Bindings: Env; Variables: Variables }>();

devContainerSessions.use('*', authMiddleware);

// ─── Shared helper ────────────────────────────────────────────────────────────

/** Map snake_case D1 row to camelCase response shape. */
function toResponse(row: CockpitSessionRow): Record<string, unknown> {
  return {
    sessionId: row.session_id,
    candidateId: row.candidate_id,
    challengeId: row.challenge_id,
    pipelineId: row.pipeline_id,
    status: row.status,
    ttlSeconds: row.ttl_seconds,
    ttlSource: row.ttl_source,
    expiresAt: row.expires_at,
    warnedAt: row.warned_at,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

/**
 * Verify the pipeline exists and is owned by the authenticated user.
 * Returns the pipeline id on success, null if not found / not owned.
 */
async function verifyPipelineOwnership(
  db: D1Database,
  pipelineId: string,
  userId: string,
): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT id FROM pipelines WHERE id = ?1 AND owner_id = ?2 LIMIT 1`,
    )
    .bind(pipelineId, userId)
    .first<{ id: string }>();
  return row !== null;
}

// ─── GET /pipelines/:pipelineId/dev-container-sessions ───────────────────────

devContainerSessions.get('/pipelines/:pipelineId/dev-container-sessions', async (c) => {
  const userId = c.var.userId;
  const { pipelineId } = c.req.param();
  const db = c.env.DB;

  try {
    const owned = await verifyPipelineOwnership(db, pipelineId, userId);
    if (!owned) {
      return apiError(c, 'NOT_FOUND', 'Pipeline not found.');
    }

    const rows = await listSessionsByPipeline(db, pipelineId);
    return c.json({ sessions: rows.map(toResponse) });
  } catch (err) {
    console.error('[cockpit.devContainerSessions] listSessionsByPipeline failed:', err);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to list dev container sessions.' } },
      500,
    );
  }
});

// ─── GET /dev-container-sessions/:sessionId ──────────────────────────────────

devContainerSessions.get('/dev-container-sessions/:sessionId', async (c) => {
  const userId = c.var.userId;
  const { sessionId } = c.req.param();
  const db = c.env.DB;

  try {
    const session = await getSessionByPublicId(db, sessionId);
    if (!session) {
      return apiError(c, 'NOT_FOUND', 'Dev container session not found.');
    }

    if (!session.pipeline_id) {
      return apiError(c, 'NOT_FOUND', 'Dev container session not found.');
    }

    // Verify the session's pipeline belongs to the authenticated recruiter.
    const owned = await verifyPipelineOwnership(db, session.pipeline_id, userId);
    if (!owned) {
      // Conflate not-found and not-owned to avoid leaking session existence.
      return apiError(c, 'NOT_FOUND', 'Dev container session not found.');
    }

    return c.json({ session: toResponse(session) });
  } catch (err) {
    console.error('[cockpit.devContainerSessions] getSessionByPublicId failed:', err);
    return c.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Failed to fetch dev container session.' } },
      500,
    );
  }
});

export { devContainerSessions };
