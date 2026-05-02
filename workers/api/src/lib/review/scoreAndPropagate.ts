/**
 * Shared scoring + propagation for review sessions.
 * Invoked from both the post-verdict flow (finalizeReviewSession) and the
 * manual /rescore endpoint. Catches its own errors and flips status to
 * 'scoring_failed' on failure — callers wrap this in waitUntil.
 */

import type { Env } from '../../types';
import { scoreReviewSession, type PlantedBug } from '../scorerAgent';
import {
  scoreComprehensionSession,
  type ComprehensionGroundTruth,
} from '../comprehensionScorer';
import { computeImplementerMetrics } from '../implementerMetrics';
import { loadRcdForAssessment } from '../rcd';
import type { ReviewRound } from '../implementerAgent';
import type { ComprehensionExchange } from '../explainerAgent';
import { decomposeCodeReviewToGraph } from '../candidateDiscovery/decomposeCodeReview';

export interface ScoreAndPropagateTranscript {
  rounds: ReviewRound[];
  explainer_exchanges?: ComprehensionExchange[];
  verdict?: unknown;
}

export interface ScoreAndPropagateInput {
  env: Env;
  sessionId: string;
  assessmentId: string;
  challengeId: string;
  transcript: ScoreAndPropagateTranscript;
  scope: string;
}

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

export async function scoreAndPropagate(
  input: ScoreAndPropagateInput,
): Promise<void> {
  const { env, sessionId, assessmentId, challengeId, transcript, scope } = input;

  try {
    const ch = await env.DB.prepare(
      `SELECT ground_truth, server_config, github_pr_title, github_pr_description, instructions, cached_diff_json
       FROM challenges WHERE id = ?1`,
    )
      .bind(challengeId)
      .first<{
        ground_truth: string | null;
        server_config: string | null;
        github_pr_title: string | null;
        github_pr_description: string | null;
        instructions: string | null;
        cached_diff_json: string | null;
      }>();

    if (!ch) {
      console.error(`[${scope}] Challenge not found for scoring, sessionId: ${sessionId}`);
      return;
    }

    const groundTruth = parseJsonColumn<PlantedBug[]>(ch.ground_truth) ?? [];
    const serverConfig = parseJsonColumn<Record<string, unknown>>(ch.server_config);
    const plantedBugs = Array.isArray(serverConfig?.plantedBugs)
      ? (serverConfig.plantedBugs as PlantedBug[])
      : groundTruth;

    await env.DB.prepare(
      `UPDATE review_sessions SET status = 'scoring', updated_at = ?1 WHERE id = ?2`,
    )
      .bind(new Date().toISOString(), sessionId)
      .run();

    const apiKey = env.GOOGLE_AI_API_KEY ?? '';
    const provider = env.GOOGLE_AI_API_KEY ? ('google-ai' as const) : ('workers-ai' as const);

    const rcd = await loadRcdForAssessment(env.DB, assessmentId);
    const dispositionalWeights = rcd?.technical_context?.dispositional_weights;

    const scoreReport = await scoreReviewSession({
      apiKey,
      provider,
      ai: env.AI,
      transcript,
      groundTruth: plantedBugs,
      diff: ch.cached_diff_json,
      prTitle: ch.github_pr_title,
      prDescription: ch.github_pr_description,
      instructions: ch.instructions,
      ...(dispositionalWeights ? { dispositionalWeights } : {}),
    });

    const implementerMetrics = computeImplementerMetrics(transcript.rounds);

    let comprehensionSupplement: Record<string, unknown> | undefined;
    if (transcript.explainer_exchanges && transcript.explainer_exchanges.length > 0) {
      try {
        const gtRaw = parseJsonColumn<ComprehensionGroundTruth>(ch.ground_truth);
        const comprehensionGroundTruth: ComprehensionGroundTruth =
          gtRaw?.mode === 'comprehension'
            ? gtRaw
            : { mode: 'comprehension', keyInsights: [], idealVerdict: 'approve', idealRationale: '' };

        const compReport = await scoreComprehensionSession({
          apiKey,
          provider,
          ai: env.AI,
          transcript: { mode: 'comprehension', exchanges: transcript.explainer_exchanges },
          groundTruth: comprehensionGroundTruth,
          prTitle: ch.github_pr_title,
          prDescription: ch.github_pr_description,
          instructions: ch.instructions,
        });
        comprehensionSupplement = compReport as unknown as Record<string, unknown>;
      } catch (compErr) {
        console.error(`[${scope}] Supplementary comprehension scoring failed:`, compErr);
      }
    }

    const fullReport = {
      ...scoreReport,
      implementer_metrics: implementerMetrics,
      ...(comprehensionSupplement ? { comprehension_supplement: comprehensionSupplement } : {}),
    };
    const scoredAt = new Date().toISOString();

    await env.DB.prepare(
      `UPDATE review_sessions SET score_report = ?1, status = 'scored', updated_at = ?2 WHERE id = ?3`,
    )
      .bind(JSON.stringify(fullReport), scoredAt, sessionId)
      .run();

    // Decompose score report into candidate graph nodes (non-blocking — errors caught inside)
    try {
      const session = await env.DB.prepare(
        `SELECT id, candidate_id, updated_at, implementer_persona, challenge_id
         FROM review_sessions WHERE id = ?1`,
      )
        .bind(sessionId)
        .first<{
          id: string;
          candidate_id: string;
          updated_at: string;
          implementer_persona: string;
          challenge_id: string;
        }>();

      if (session) {
        await decomposeCodeReviewToGraph(env.DB, env, session, scoreReport, env.CANDIDATE_INDEX, transcript.rounds);
      }
    } catch (decompErr) {
      const msg = decompErr instanceof Error ? decompErr.message : String(decompErr);
      console.error(`[${scope}] Graph decomposition failed for session ${sessionId}:`, msg);
    }

    const sub = await env.DB.prepare(
      `SELECT id FROM challenge_submissions
       WHERE assessment_id = ?1 AND challenge_id = ?2 LIMIT 1`,
    )
      .bind(assessmentId, challengeId)
      .first<{ id: string }>();

    if (sub) {
      await env.DB.prepare(
        `UPDATE challenge_submissions
         SET score = ?1, feedback = ?2, scored_at = ?3, updated_at = ?3
         WHERE id = ?4`,
      )
        .bind(Math.round(scoreReport.overall.score), scoreReport.overall.narrative, scoredAt, sub.id)
        .run();

      await env.DB.prepare(
        `UPDATE assessments
         SET score = (
           SELECT AVG(score) FROM challenge_submissions
           WHERE assessment_id = ?1 AND score IS NOT NULL
         ), updated_at = ?2
         WHERE id = ?1`,
      )
        .bind(assessmentId, scoredAt)
        .run();
    }

    console.log(
      `[${scope}] Scoring complete for session ${sessionId}: ${scoreReport.overall.score}/100 (${scoreReport.overall.band})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[${scope}] Scoring failed for session ${sessionId}:`, msg);
    await env.DB.prepare(
      `UPDATE review_sessions SET status = 'scoring_failed', updated_at = ?1 WHERE id = ?2`,
    )
      .bind(new Date().toISOString(), sessionId)
      .run();
  }
}
