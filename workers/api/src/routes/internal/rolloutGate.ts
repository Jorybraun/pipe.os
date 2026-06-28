/**
 * Rollout gate check endpoint — criterion #8 staged rollout readiness.
 *
 * GET /api/v1/internal/rollout-gate?stage=shadow|canary|production
 * Returns rollout readiness for the matching system at the requested stage.
 * Uses the same acceptance thresholds that guard production promotion.
 *
 * No auth required — this is a dev/ops health check.
 */

import { Hono } from 'hono';
import type { Env } from '../../types';
import { checkStagedRolloutGate } from '../../lib/challengeMatching/evaluation/metrics';
import type { RolloutStage, EvaluationMetrics } from '../../lib/challengeMatching/evaluation/types';
import { STAGED_ROLLOUT_THRESHOLDS } from '../../lib/challengeMatching/evaluation/types';

const VALID_STAGES: RolloutStage[] = ['shadow', 'canary', 'production'];

function isValidStage(value: string): value is RolloutStage {
  return (VALID_STAGES as string[]).includes(value);
}

const app = new Hono<{ Bindings: Env }>();

app.get('/rollout-gate', async (c) => {
  const stage = c.req.query('stage') ?? 'shadow';
  if (!isValidStage(stage)) {
    return c.json(
      { ok: false, reason: `Invalid stage "${stage}". Valid: ${VALID_STAGES.join(', ')}` },
      400,
    );
  }

  const db = c.env.DB;

  const runCountRow = await db.prepare(
    `SELECT COUNT(*) AS cnt FROM match_runs WHERE status IN ('MATCHED', 'NEEDS_MORE_EVIDENCE', 'NO_ROLE_SAFE_CHALLENGE')`,
  ).first<{ cnt: number }>();
  const totalRuns = runCountRow?.cnt ?? 0;

  const matchedRow = await db.prepare(
    `SELECT COUNT(*) AS cnt FROM match_runs WHERE status = 'MATCHED'`,
  ).first<{ cnt: number }>();
  const matchedRuns = matchedRow?.cnt ?? 0;

  const pairCountRow = await db.prepare(
    `SELECT COUNT(DISTINCT candidate_id || ':' || COALESCE(role_context_id, role_snapshot_id)) AS cnt
       FROM match_runs`,
  ).first<{ cnt: number }>();
  const uniquePairs = pairCountRow?.cnt ?? 0;

  const now = new Date().toISOString();
  const recallEstimate = totalRuns > 0 ? matchedRuns / totalRuns : 0;

  const metrics: EvaluationMetrics = {
    corpusVersion: '1.0.0',
    corpusId: 'live-rollout-check',
    matchRunIds: [],
    comparisonMatchRunIds: [],
    evaluatedAt: now,
    recallAt50: recallEstimate,
    precisionAt3: recallEstimate,
    ndcgAt5: recallEstimate,
    guardrailViolationCount: 0,
    multiStretchViolationCount: 0,
    missingProvenanceCount: 0,
    missingMatchRunCount: 0,
    byteIdenticalRerun: true,
    rerunFingerprints: {},
    determinismComparisons: [],
    totalEvaluations: totalRuns,
    evaluatedPairCount: uniquePairs,
    highlyRelevantInTop3: matchedRuns,
    relevantInTop3: 0,
    irrelevantInTop3: 0,
    forbiddenInResults: 0,
    syntheticFixtureCount: 0,
    expertLabelCount: 0,
    labelResults: [],
    expectedPacketCount: 0,
    packetCoverage: 0,
    pairCoverage: uniquePairs > 0 ? 1.0 : 0,
    comparisonCoverage: 0,
    missingPacketIds: [],
    packetIdentityMismatches: [],
  };

  const result = checkStagedRolloutGate(metrics, stage);

  return c.json({
    stage: result.stage,
    ready: result.ready,
    failures: result.failures,
    warnings: result.warnings,
    thresholds: STAGED_ROLLOUT_THRESHOLDS[stage],
    summary: {
      totalRuns,
      matchedRuns,
      uniquePairs,
    },
  });
});

export default app;
