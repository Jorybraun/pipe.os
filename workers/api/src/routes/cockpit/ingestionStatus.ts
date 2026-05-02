/**
 * Ingestion status SSE — recruiter-facing real-time updates for candidate ingestion.
 *
 * GET /api/v1/candidates/:candidateId/ingestion-status
 *      Returns the current ingestion record as JSON when Accept is not text/event-stream.
 *      Opens an SSE stream that polls the DB every 3 s and emits `status` events
 *      until the ingestion reaches a terminal state, then emits `done` and closes.
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../../middleware/auth';
import type { Env, Variables } from '../../types';

const TERMINAL_STATES = new Set(['completed', 'failed', 'error']);

const SELECT_CANDIDATE_SQL = `SELECT c.id FROM candidates c
   JOIN pipelines p ON p.id = c.pipeline_id
   WHERE c.id = ? AND p.owner_id = ?`;

const SELECT_INGESTION_SQL = `SELECT
   status,
   candidate_searchable_profile,
   key_concepts_json,
   career_context_json,
   situation_signature_json,
   profile_version,
   model_used,
   error_text,
   created_at,
   updated_at
 FROM candidate_ingestion
 WHERE candidate_id = ?1`;

async function verifyCandidateOwnership(
  db: Env['DB'],
  candidateId: string,
  userId: string,
): Promise<boolean> {
  const candidate = await db
    .prepare(SELECT_CANDIDATE_SQL)
    .bind(candidateId, userId)
    .first<{ id: string }>();
  return !!candidate;
}

async function fetchIngestionRow(
  db: Env['DB'],
  candidateId: string,
): Promise<Record<string, unknown> | null> {
  return db
    .prepare(SELECT_INGESTION_SQL)
    .bind(candidateId)
    .first<Record<string, unknown>>();
}

const ingestionStatus = new Hono<{ Bindings: Env; Variables: Variables }>();
ingestionStatus.use('*', authMiddleware);

ingestionStatus.get('/:candidateId/ingestion-status', async (c) => {
  const candidateId = c.req.param('candidateId');
  const userId = c.var.userId;
  const acceptHeader = c.req.header('Accept');

  // ── Non-streaming path ──────────────────────────────────────────────────────
  if (acceptHeader !== 'text/event-stream') {
    if (!(await verifyCandidateOwnership(c.env.DB, candidateId, userId))) {
      return c.json(
        {
          error: {
            code: 'NOT_FOUND',
            message: 'Candidate not found.',
          },
        },
        404,
      );
    }

    const row = await fetchIngestionRow(c.env.DB, candidateId);

    if (!row) {
      return c.json({ status: 'not_started' }, 200);
    }

    return c.json(row);
  }

  // ── Streaming path: SSE ─────────────────────────────────────────────────────
  const response = streamSSE(c, async (stream) => {
    try {
      if (!(await verifyCandidateOwnership(c.env.DB, candidateId, userId))) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            code: 'NOT_FOUND',
            message: 'Candidate not found.',
          }),
        });
        return;
      }

      while (true) {
        const row = await fetchIngestionRow(c.env.DB, candidateId);

        if (!row) {
          await stream.writeSSE({
            event: 'status',
            data: JSON.stringify({ status: 'not_started' }),
          });
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({ status: 'not_started' }),
          });
          return;
        }

        await stream.writeSSE({
          event: 'status',
          data: JSON.stringify(row),
        });

        if (TERMINAL_STATES.has(row.status as string)) {
          await stream.writeSSE({
            event: 'done',
            data: JSON.stringify({ status: row.status }),
          });
          return;
        }

        await stream.sleep(3000);
      }
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        // Client disconnected — clean exit
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[ingestionStatus] Streaming error:', msg);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ code: 'INTERNAL_ERROR', message: msg }),
      });
    }
  });

  response.headers.set('Content-Type', 'text/event-stream; charset=utf-8');
  return response;
});

export { ingestionStatus };
