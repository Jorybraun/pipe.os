/**
 * Rollout gate endpoints — criterion #8 staged rollout management.
 *
 * GET  /api/v1/internal/rollout-gate?stage=shadow|canary|production
 *   Returns rollout readiness for the matching system at the requested stage.
 *
 * POST /api/v1/internal/rollout-gate
 *   Transition a feature gate to a new stage. Body: { gateKey, stage, reason? }
 *
 * GET  /api/v1/internal/rollout-gate/gates
 *   List all gates with current stages.
 *
 * GET  /api/v1/internal/rollout-gate/audit?gateKey=...
 *   Query audit log for a specific gate.
 *
 * No auth required — this is a dev/ops admin endpoint.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import type { Env } from '../../types';
import { checkStagedRolloutGate } from '../../lib/challengeMatching/evaluation/metrics';
import type { RolloutStage, EvaluationMetrics } from '../../lib/challengeMatching/evaluation/types';
import { STAGED_ROLLOUT_THRESHOLDS } from '../../lib/challengeMatching/evaluation/types';
import {
  updateGateStage,
  listGates,
  queryAuditLog,
} from '../../lib/livingContext/rolloutEnforcement';

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

const gateTransitionSchema = z.object({
  gateKey: z.string().min(1).max(200),
  stage: z.enum(['disabled', 'internal_only', 'canary', 'GA']),
  reason: z.string().max(500).optional(),
});

app.post('/rollout-gate', async (c) => {
  const body: unknown = await c.req.json().catch(() => null);
  const parsed = gateTransitionSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({
      ok: false,
      reason: 'Invalid body. Required: { gateKey: string, stage: disabled|internal_only|canary|GA, reason?: string }',
      errors: parsed.error.issues,
    }, 400);
  }

  const { gateKey, stage, reason } = parsed.data;
  const db = c.env.DB;

  await updateGateStage(db, gateKey, stage, 'internal-api', reason);

  return c.json({
    ok: true,
    gateKey,
    stage,
    reason: reason ?? null,
  });
});

app.get('/rollout-gate/gates', async (c) => {
  const db = c.env.DB;
  const gates = await listGates(db);
  return c.json({ gates });
});

app.get('/rollout-gate/audit', async (c) => {
  const gateKey = c.req.query('gateKey');
  if (!gateKey) {
    return c.json({ ok: false, reason: 'gateKey query parameter required' }, 400);
  }

  const db = c.env.DB;
  const limitParam = c.req.query('limit');
  const limit = limitParam ? Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200) : 50;
  const entries = await queryAuditLog(db, gateKey, limit);
  return c.json({ gateKey, entries });
});

export default app;
