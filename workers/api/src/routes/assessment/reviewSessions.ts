/**
 * Review session routes — recruiter-facing (Clerk JWT auth)
 *
 * GET  /api/v1/review-sessions/:id/report     — full transcript + score report
 * PATCH /api/v1/review-sessions/:id/score     — manual score override (recruiter)
 * GET  /api/v1/review-sessions/:id/transcript — raw transcript for analysis
 *
 * Scoring happens automatically via Devstral after verdict submission
 * (see review.ts POST /rpc/review/:id/verdict → scorerAgent.ts).
 * The PATCH /score endpoint exists for manual overrides / re-scoring.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import type { Env, Variables } from '../../types';
import { scoreAndPropagate, type ScoreAndPropagateTranscript } from '../../lib/review/scoreAndPropagate';
import { ingestCodeReviewScoreReportToLivingContext } from '../../lib/livingContext/codeReview';
import { loadSourceBackedReviewDiff } from '../../lib/review/sourceBackedReviewDiff';

const reviewSessions = new Hono<{ Bindings: Env; Variables: Variables }>();
reviewSessions.use('*', authMiddleware);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseJsonColumn<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

// ─── GET /:sessionId/report ─────────────────────────────────────────────────
// Full score report with dimensional breakdown for recruiters

reviewSessions.get('/:sessionId/report', async (c) => {
  const userId = c.var.userId;
  const sessionId = c.req.param('sessionId');

  // Load session with ownership check via pipeline
  const session = await c.env.DB.prepare(`
    SELECT rs.id, rs.challenge_id, rs.assessment_id, rs.candidate_id,
           rs.implementer_persona, rs.current_round, rs.max_rounds,
           rs.status, rs.transcript, rs.score_report, rs.next_comment_id,
           rs.created_at, rs.updated_at,
           ch.ground_truth, ch.server_config
    FROM review_sessions rs
    JOIN challenges ch ON ch.id = rs.challenge_id
    JOIN assessments a ON a.id = rs.assessment_id
    JOIN candidates cand ON cand.id = rs.candidate_id
    JOIN pipelines p ON p.id = cand.pipeline_id
    WHERE rs.id = ?1 AND p.owner_id = ?2
  `)
    .bind(sessionId, userId)
    .first<{
      id: string;
      challenge_id: string;
      assessment_id: string;
      candidate_id: string;
      implementer_persona: string;
      current_round: number;
      max_rounds: number;
      status: string;
      transcript: string | null;
      score_report: string | null;
      next_comment_id: number;
      created_at: string;
      updated_at: string;
      ground_truth: string | null;
      server_config: string | null;
    }>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }

  const transcript = parseJsonColumn<unknown>(session.transcript);
  const scoreReport = parseJsonColumn<unknown>(session.score_report);

  return c.json({
    id: session.id,
    challengeId: session.challenge_id,
    candidateId: session.candidate_id,
    implementerPersona: session.implementer_persona,
    currentRound: session.current_round,
    maxRounds: session.max_rounds,
    status: session.status,
    transcript,
    scoreReport,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  });
});

// ─── GET /:sessionId/transcript ─────────────────────────────────────────────
// Raw transcript + ground truth for analysis

reviewSessions.get('/:sessionId/transcript', async (c) => {
  const userId = c.var.userId;
  const sessionId = c.req.param('sessionId');

  const session = await c.env.DB.prepare(`
    SELECT rs.id, rs.transcript, rs.status, rs.implementer_persona,
           rs.current_round, rs.max_rounds,
           ch.ground_truth, ch.server_config,
           ch.cached_diff_json, ch.instructions,
           ch.github_pr_title, ch.github_pr_description,
           ch.github_repo_url, ch.github_pr_number,
           cca.id as assignment_id,
           COALESCE(cca.github_repo_url, ch.github_repo_url) as effective_repo_url,
           COALESCE(cca.github_pr_number, ch.github_pr_number) as effective_pr_number
    FROM review_sessions rs
    JOIN challenges ch ON ch.id = rs.challenge_id
    JOIN assessments a ON a.id = rs.assessment_id
    JOIN candidates cand ON cand.id = rs.candidate_id
    JOIN pipelines p ON p.id = cand.pipeline_id
    LEFT JOIN candidate_challenge_assignment cca
      ON cca.challenge_id = ch.id
     AND cca.candidate_id = rs.candidate_id
    WHERE rs.id = ?1 AND p.owner_id = ?2
  `)
    .bind(sessionId, userId)
    .first<{
      id: string;
      transcript: string | null;
      status: string;
      implementer_persona: string;
      current_round: number;
      max_rounds: number;
      ground_truth: string | null;
      server_config: string | null;
      cached_diff_json: string | null;
      instructions: string | null;
      github_pr_title: string | null;
      github_pr_description: string | null;
      github_repo_url: string | null;
      github_pr_number: number | null;
      assignment_id: string | null;
      effective_repo_url: string | null;
      effective_pr_number: number | null;
    }>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }

  const transcript = parseJsonColumn<unknown>(session.transcript);
  const assignmentBacked = typeof session.assignment_id === 'string' && session.assignment_id.length > 0;
  const repoUrl = session.effective_repo_url ?? session.github_repo_url ?? null;
  const prNumber = session.effective_pr_number ?? session.github_pr_number ?? null;
  const sourceBackedDiff = assignmentBacked && repoUrl && typeof prNumber === 'number'
    ? await loadSourceBackedReviewDiff(c.env.DB, repoUrl, prNumber)
    : null;
  const groundTruth = assignmentBacked ? null : parseJsonColumn<unknown>(session.ground_truth);
  const serverConfig = assignmentBacked ? null : parseJsonColumn<unknown>(session.server_config);
  const prTitle = assignmentBacked
    ? sourceBackedDiff?.metadata.title ?? null
    : session.github_pr_title;
  const prDescription = assignmentBacked
    ? sourceBackedDiff?.metadata.description ?? null
    : session.github_pr_description;

  return c.json({
    id: session.id,
    status: session.status,
    implementerPersona: session.implementer_persona,
    currentRound: session.current_round,
    maxRounds: session.max_rounds,
    transcript,
    groundTruth,
    serverConfig,
    prTitle,
    prDescription,
    instructions: session.instructions,
    reviewProvenance: {
      assignmentBacked,
      sourceBackedReady: assignmentBacked ? sourceBackedDiff !== null : null,
      repoUrl,
      prNumber,
    },
  });
});

// ─── PATCH /:sessionId/score ────────────────────────────────────────────────
// Manual score override. Primary scoring is automatic via scorerAgent after verdict.

reviewSessions.patch('/:sessionId/score', async (c) => {
  const userId = c.var.userId;
  const sessionId = c.req.param('sessionId');

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Invalid JSON.' } }, 400);
  }

  const scoreReport = body.scoreReport;
  if (!scoreReport || typeof scoreReport !== 'object') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'scoreReport object is required.' } },
      400,
    );
  }

  // Validate ownership via pipeline
  const session = await c.env.DB.prepare(`
    SELECT rs.id, rs.assessment_id, rs.challenge_id, rs.candidate_id, rs.created_at
    FROM review_sessions rs
    JOIN assessments a ON a.id = rs.assessment_id
    JOIN candidates cand ON cand.id = rs.candidate_id
    JOIN pipelines p ON p.id = cand.pipeline_id
    WHERE rs.id = ?1 AND p.owner_id = ?2
  `)
    .bind(sessionId, userId)
    .first<{
      id: string;
      assessment_id: string;
      challenge_id: string;
      candidate_id: string;
      created_at: string;
    }>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }

  const now = new Date().toISOString();
  const scoreReportJson = JSON.stringify(scoreReport);
  await ingestCodeReviewScoreReportToLivingContext(c.env.DB, {
    sessionId,
    candidateId: session.candidate_id,
    challengeId: session.challenge_id,
    assessmentId: session.assessment_id,
    scoreReportJson,
    observedAt: now,
    producer: 'recruiter_override',
    producerId: userId,
    startedAt: session.created_at,
  });

  // Write score_report and update status
  await c.env.DB.prepare(`
    UPDATE review_sessions
    SET score_report = ?1, status = 'scored', updated_at = ?2
    WHERE id = ?3
  `)
    .bind(scoreReportJson, now, sessionId)
    .run();

  // Also update the challenge_submission score if there's an overall score
  const overall = (scoreReport as Record<string, unknown>).overall as Record<string, unknown> | undefined;
  const overallScore = typeof overall?.score === 'number' ? overall.score : null;

  if (overallScore !== null) {
    // Find the corresponding challenge_submission
    const sub = await c.env.DB.prepare(`
      SELECT cs.id FROM challenge_submissions cs
      WHERE cs.assessment_id = ?1
      AND cs.challenge_id = (SELECT challenge_id FROM review_sessions WHERE id = ?2)
      LIMIT 1
    `)
      .bind(session.assessment_id, sessionId)
      .first<{ id: string }>();

    if (sub) {
      const narrative = typeof overall?.narrative === 'string' ? overall.narrative : null;
      await c.env.DB.prepare(`
        UPDATE challenge_submissions
        SET score = ?1, feedback = ?2, scored_at = ?3, updated_at = ?3
        WHERE id = ?4
      `)
        .bind(Math.round(overallScore), narrative, now, sub.id)
        .run();

      // Re-aggregate assessment score
      await c.env.DB.prepare(`
        UPDATE assessments
        SET score = (
          SELECT AVG(score) FROM challenge_submissions
          WHERE assessment_id = ?1 AND score IS NOT NULL
        ), updated_at = ?2
        WHERE id = ?1
      `)
        .bind(session.assessment_id, now)
        .run();
    }
  }

  return c.json({ success: true, status: 'scored' });
});

// ─── POST /:sessionId/rescore ───────────────────────────────────────────────
// Manual retry for sessions stuck in scoring_failed.

reviewSessions.post('/:sessionId/rescore', async (c) => {
  const userId = c.var.userId;
  const sessionId = c.req.param('sessionId');

  // Load session with ownership check via pipeline
  const session = await c.env.DB.prepare(`
    SELECT rs.id, rs.challenge_id, rs.assessment_id, rs.candidate_id,
           rs.status, rs.transcript, rs.implementer_persona,
           rs.current_round, rs.max_rounds
    FROM review_sessions rs
    JOIN assessments a ON a.id = rs.assessment_id
    JOIN candidates cand ON cand.id = rs.candidate_id
    JOIN pipelines p ON p.id = cand.pipeline_id
    WHERE rs.id = ?1 AND p.owner_id = ?2
  `)
    .bind(sessionId, userId)
    .first<{
      id: string;
      challenge_id: string;
      assessment_id: string;
      candidate_id: string;
      status: string;
      transcript: string | null;
      implementer_persona: string;
      current_round: number;
      max_rounds: number;
    }>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }

  if (session.status !== 'scoring_failed' && session.status !== 'verdict_submitted') {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Session must be in scoring_failed or verdict_submitted state to rescore.' } },
      400,
    );
  }

  const transcript = parseJsonColumn<ScoreAndPropagateTranscript>(session.transcript) ?? { rounds: [] };

  await c.env.DB.prepare(
    `UPDATE review_sessions SET status = 'scoring', updated_at = ?1 WHERE id = ?2`,
  )
    .bind(new Date().toISOString(), sessionId)
    .run();

  c.executionCtx.waitUntil(
    scoreAndPropagate({
      env: c.env,
      sessionId,
      assessmentId: session.assessment_id,
      challengeId: session.challenge_id,
      transcript,
      scope: 'reviewSessions/rescore',
    }),
  );

  return c.json({ success: true, status: 'scoring' });
});

export { reviewSessions };
