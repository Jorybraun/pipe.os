/**
 * Challenge submission routes — recruiter-facing scoring
 *
 * PATCH /api/v1/challenge-submissions/:id — recruiter updates score + feedback
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { apiError } from '../../middleware/errors';
import type { Env, Variables } from '../../types';

// ─── Validation ──────────────────────────────────────────────────────────────

const patchSubmissionSchema = z.object({
  score: z.number().min(0).max(100).optional(),
  feedback: z.string().max(5000).optional(),
});

// ─── Routes ──────────────────────────────────────────────────────────────────

const challengeSubmissions = new Hono<{ Bindings: Env; Variables: Variables }>();
challengeSubmissions.use('*', authMiddleware);

// POST /:submissionId/confirm-score — confirm HITL-reviewed implementation score
challengeSubmissions.post('/:submissionId/confirm-score', async (c) => {
  const userId = c.var.userId;
  const { submissionId } = c.req.param();
  const db = c.env.DB;

  // Ownership check
  const submission = await db
    .prepare(
      `SELECT cs.id, cs.challenge_id, cs.candidate_id, cs.score_report_json
       FROM challenge_submissions cs
       JOIN candidates cd ON cd.id = cs.candidate_id
       JOIN pipelines p ON p.id = cd.pipeline_id
       WHERE cs.id = ? AND p.owner_id = ?`
    )
    .bind(submissionId, userId)
    .first<{ id: string; challenge_id: string; candidate_id: string; score_report_json: string | null }>();

  if (!submission) return apiError(c, 'NOT_FOUND', 'Submission not found.');
  if (!submission.score_report_json) {
    return apiError(c, 'VALIDATION_ERROR', 'Submission has not been scored yet.');
  }

  const now = new Date().toISOString();

  // Set HITL status to CONFIRMED
  await db
    .prepare(`UPDATE challenge_submissions SET hitl_status = 'CONFIRMED', updated_at = ? WHERE id = ?`)
    .bind(now, submissionId)
    .run();

  // Parse score report and set the overall score on the submission
  try {
    const report = JSON.parse(submission.score_report_json) as { dimensions?: Array<{ bars_score: number }> };
    const dims = report.dimensions ?? [];
    const avgBars = dims.length > 0
      ? dims.reduce((sum, d) => sum + (d.bars_score ?? 0), 0) / dims.length
      : 0;
    const overallScore = Math.round((avgBars / 5) * 100);

    await db
      .prepare(`UPDATE challenge_submissions SET score = ?, scored_at = ? WHERE id = ?`)
      .bind(overallScore, now, submissionId)
      .run();

    // Re-aggregate assessment score
    await db.prepare(`
      UPDATE assessments
      SET score = (
        SELECT AVG(score) FROM challenge_submissions
        WHERE assessment_id = ?1 AND score IS NOT NULL
      ), updated_at = ?2
      WHERE id = ?1
    `)
      .bind(submission.candidate_id, now)
      .run();
  } catch {
    // If parsing fails, just confirm without setting score
  }

  return c.json({ success: true, status: 'CONFIRMED' });
});

// PATCH /:submissionId — update score and/or feedback
challengeSubmissions.patch('/:submissionId', async (c) => {
  const userId = c.var.userId;
  const { submissionId } = c.req.param();
  const db = c.env.DB;

  // Ownership check: submission belongs to a candidate the recruiter owns
  const submission = await db
    .prepare(
      `SELECT cs.id, cs.challenge_id, cs.candidate_id
       FROM challenge_submissions cs
       JOIN candidates cd ON cd.id = cs.candidate_id
       JOIN pipelines p ON p.id = cd.pipeline_id
       WHERE cs.id = ? AND p.owner_id = ?`
    )
    .bind(submissionId, userId)
    .first<{ id: string; challenge_id: string; candidate_id: string }>();

  if (!submission) return apiError(c, 'NOT_FOUND', 'Submission not found.');

  const body = await c.req.json();
  const parsed = patchSubmissionSchema.safeParse(body);
  if (!parsed.success) {
    return apiError(
      c,
      'VALIDATION_ERROR',
      parsed.error.issues[0]?.message ?? 'Validation failed',
    );
  }

  const updates: string[] = [];
  const values: unknown[] = [];

  if (parsed.data.score !== undefined) {
    updates.push('score = ?');
    values.push(parsed.data.score);
    updates.push('scored_at = ?');
    values.push(new Date().toISOString());
  }
  if (parsed.data.feedback !== undefined) {
    updates.push('feedback = ?');
    values.push(parsed.data.feedback);
  }

  if (updates.length === 0) {
    return apiError(c, 'VALIDATION_ERROR', 'No fields to update.');
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(submissionId);

  await db
    .prepare(`UPDATE challenge_submissions SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return c.json({ success: true });
});

export { challengeSubmissions };
