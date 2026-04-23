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
import { scoreReviewSession, type PlantedBug } from '../../lib/scorerAgent';
import { scoreComprehensionSession, type ComprehensionGroundTruth } from '../../lib/comprehensionScorer';
import { computeImplementerMetrics } from '../../lib/implementerMetrics';
import { loadRcdForAssessment } from '../../lib/rcd';
import type { ReviewRound } from '../../lib/implementerAgent';

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
           ch.github_pr_title, ch.github_pr_description
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
    }>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }

  const transcript = parseJsonColumn<unknown>(session.transcript);
  const groundTruth = parseJsonColumn<unknown>(session.ground_truth);
  const serverConfig = parseJsonColumn<unknown>(session.server_config);

  return c.json({
    id: session.id,
    status: session.status,
    implementerPersona: session.implementer_persona,
    currentRound: session.current_round,
    maxRounds: session.max_rounds,
    transcript,
    groundTruth,
    serverConfig,
    prTitle: session.github_pr_title,
    prDescription: session.github_pr_description,
    instructions: session.instructions,
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
    SELECT rs.id, rs.assessment_id
    FROM review_sessions rs
    JOIN assessments a ON a.id = rs.assessment_id
    JOIN candidates cand ON cand.id = rs.candidate_id
    JOIN pipelines p ON p.id = cand.pipeline_id
    WHERE rs.id = ?1 AND p.owner_id = ?2
  `)
    .bind(sessionId, userId)
    .first<{ id: string; assessment_id: string }>();

  if (!session) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Review session not found.' } }, 404);
  }

  const now = new Date().toISOString();
  const scoreReportJson = JSON.stringify(scoreReport);

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

  // Load challenge for ground truth
  const ch = await c.env.DB.prepare(
    `SELECT ground_truth, server_config, github_pr_title, github_pr_description, instructions, cached_diff_json
     FROM challenges WHERE id = ?1`,
  )
    .bind(session.challenge_id)
    .first<{
      ground_truth: string | null;
      server_config: string | null;
      github_pr_title: string | null;
      github_pr_description: string | null;
      instructions: string | null;
      cached_diff_json: string | null;
    }>();

  if (!ch) {
    return c.json({ error: { code: 'NOT_FOUND', message: 'Challenge not found.' } }, 404);
  }

  const transcript = parseJsonColumn<{ rounds: ReviewRound[]; explainer_exchanges?: unknown[]; verdict?: unknown }>(session.transcript) ?? { rounds: [] };
  const groundTruth = parseJsonColumn<PlantedBug[]>(ch.ground_truth) ?? [];
  const serverConfig = parseJsonColumn<Record<string, unknown>>(ch.server_config);
  const plantedBugs = Array.isArray(serverConfig?.plantedBugs)
    ? (serverConfig.plantedBugs as PlantedBug[])
    : groundTruth;

  const scorerApiKey = c.env.GOOGLE_AI_API_KEY ?? '';
  const scorerProvider = c.env.GOOGLE_AI_API_KEY ? 'google-ai' as const : 'workers-ai' as const;

  try {
    await c.env.DB.prepare(
      `UPDATE review_sessions SET status = 'scoring', updated_at = ?1 WHERE id = ?2`,
    )
      .bind(new Date().toISOString(), sessionId)
      .run();

    const rcdScore = await loadRcdForAssessment(c.env.DB, session.assessment_id);
    const dispositionalWeightsScore = rcdScore?.technical_context?.dispositional_weights;

    const scoreReport = await scoreReviewSession({
      apiKey: scorerApiKey,
      provider: scorerProvider,
      ai: c.env.AI,
      transcript,
      groundTruth: plantedBugs,
      diff: ch.cached_diff_json,
      prTitle: ch.github_pr_title,
      prDescription: ch.github_pr_description,
      instructions: ch.instructions,
      ...(dispositionalWeightsScore ? { dispositionalWeights: dispositionalWeightsScore } : {}),
    });

    const implementerMetrics = computeImplementerMetrics(transcript.rounds);

    let comprehensionSupplement: Record<string, unknown> | undefined;
    if (transcript.explainer_exchanges && transcript.explainer_exchanges.length > 0) {
      try {
        const groundTruthRaw = parseJsonColumn<ComprehensionGroundTruth>(ch.ground_truth);
        const comprehensionGroundTruth: ComprehensionGroundTruth = groundTruthRaw?.mode === 'comprehension'
          ? groundTruthRaw
          : { mode: 'comprehension', keyInsights: [], idealVerdict: 'approve', idealRationale: '' };

        const compReport = await scoreComprehensionSession({
          apiKey: scorerApiKey,
          provider: scorerProvider,
          ai: c.env.AI,
          transcript: { mode: 'comprehension', exchanges: transcript.explainer_exchanges },
          groundTruth: comprehensionGroundTruth,
          prTitle: ch.github_pr_title,
          prDescription: ch.github_pr_description,
          instructions: ch.instructions,
        });
        comprehensionSupplement = compReport as unknown as Record<string, unknown>;
      } catch (compErr) {
        console.error('[reviewSessions/rescore] Supplementary comprehension scoring failed:', compErr);
      }
    }

    const fullReport = {
      ...scoreReport,
      implementer_metrics: implementerMetrics,
      ...(comprehensionSupplement ? { comprehension_supplement: comprehensionSupplement } : {}),
    };
    const scoredAt = new Date().toISOString();

    await c.env.DB.prepare(
      `UPDATE review_sessions SET score_report = ?1, status = 'scored', updated_at = ?2 WHERE id = ?3`,
    )
      .bind(JSON.stringify(fullReport), scoredAt, sessionId)
      .run();

    // Propagate score to challenge_submission
    const sub = await c.env.DB.prepare(
      `SELECT id FROM challenge_submissions
       WHERE assessment_id = ?1 AND challenge_id = ?2 LIMIT 1`,
    )
      .bind(session.assessment_id, session.challenge_id)
      .first<{ id: string }>();

    if (sub) {
      await c.env.DB.prepare(
        `UPDATE challenge_submissions
         SET score = ?1, feedback = ?2, scored_at = ?3, updated_at = ?3
         WHERE id = ?4`,
      )
        .bind(Math.round(scoreReport.overall.score), scoreReport.overall.narrative, scoredAt, sub.id)
        .run();

      await c.env.DB.prepare(
        `UPDATE assessments
         SET score = (
           SELECT AVG(score) FROM challenge_submissions
           WHERE assessment_id = ?1 AND score IS NOT NULL
         ), updated_at = ?2
         WHERE id = ?1`,
      )
        .bind(session.assessment_id, scoredAt)
        .run();
    }

    return c.json({
      success: true,
      status: 'scored',
      scoreReport: fullReport,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[reviewSessions/rescore] Scoring failed for session ${sessionId}:`, msg);
    await c.env.DB.prepare(
      `UPDATE review_sessions SET status = 'scoring_failed', updated_at = ?1 WHERE id = ?2`,
    )
      .bind(new Date().toISOString(), sessionId)
      .run();

    return c.json(
      { error: { code: 'AGENT_ERROR', message: `Scoring failed: ${msg}` } },
      502,
    );
  }
});

export { reviewSessions };
