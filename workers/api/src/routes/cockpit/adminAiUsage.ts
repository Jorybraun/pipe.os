/**
 * Admin AI-usage dashboard — reads aggregates from `ai_usage_events`.
 *
 * Mounts under /api/v1/admin.
 * Routes:
 *   GET /ai-usage                 — totals + per-feature summaries (MTD)
 *   GET /ai-usage/sessions        — recent session-level breakdown (top 50)
 *
 * Clerk JWT required via authMiddleware.
 */

import { Hono } from 'hono';
import { authMiddleware } from '../../middleware/auth';
import type { Env, Variables } from '../../types';

const adminAiUsage = new Hono<{ Bindings: Env; Variables: Variables }>();

adminAiUsage.use('*', authMiddleware);

// ─── Row types ────────────────────────────────────────────────────────────────

interface FeatureSummaryRow {
  feature: string;
  event_count: number;
  session_count: number;
  success_count: number;
  failed_count: number;
  total_cost: number;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_input_audio_tokens: number | null;
  total_output_audio_tokens: number | null;
}

interface TotalsRow {
  event_count: number;
  session_count: number;
  total_cost: number;
  failed_count: number;
}

interface SessionRow {
  feature: string;
  ref_id: string | null;
  event_count: number;
  total_cost: number;
  success: number;
  total_input_tokens: number | null;
  total_output_tokens: number | null;
  total_input_audio_tokens: number | null;
  total_output_audio_tokens: number | null;
  total_audio_seconds: number | null;
  last_event_at: string;
  last_error: string | null;
}

// ─── GET /ai-usage — totals + feature summaries (current month) ───────────────

adminAiUsage.get('/ai-usage', async (c) => {
  const db = c.env.DB;

  const totalsRow = await db
    .prepare(
      `SELECT
         COUNT(*) AS event_count,
         COUNT(DISTINCT COALESCE(ref_id, id)) AS session_count,
         COALESCE(SUM(usd_cost), 0) AS total_cost,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed_count
       FROM ai_usage_events
       WHERE created_at >= date('now', 'start of month')`,
    )
    .first<TotalsRow>();

  const perFeatureResult = await db
    .prepare(
      `SELECT
         feature,
         COUNT(*) AS event_count,
         COUNT(DISTINCT COALESCE(ref_id, id)) AS session_count,
         SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
         SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failed_count,
         COALESCE(SUM(usd_cost), 0) AS total_cost,
         SUM(input_tokens) AS total_input_tokens,
         SUM(output_tokens) AS total_output_tokens,
         SUM(input_audio_tokens) AS total_input_audio_tokens,
         SUM(output_audio_tokens) AS total_output_audio_tokens
       FROM ai_usage_events
       WHERE created_at >= date('now', 'start of month')
       GROUP BY feature
       ORDER BY total_cost DESC`,
    )
    .all<FeatureSummaryRow>();

  const features = (perFeatureResult.results ?? []).map((row) => {
    const sessionCount = row.session_count || 0;
    const avgCostPerSession = sessionCount > 0 ? row.total_cost / sessionCount : 0;
    return {
      feature: row.feature,
      eventCount: row.event_count,
      sessionCount,
      successCount: row.success_count,
      failedCount: row.failed_count,
      totalCost: row.total_cost,
      avgCostPerSession,
      totalInputTokens: row.total_input_tokens ?? 0,
      totalOutputTokens: row.total_output_tokens ?? 0,
      totalInputAudioTokens: row.total_input_audio_tokens ?? 0,
      totalOutputAudioTokens: row.total_output_audio_tokens ?? 0,
    };
  });

  return c.json({
    monthly: {
      eventCount: totalsRow?.event_count ?? 0,
      sessionCount: totalsRow?.session_count ?? 0,
      failedCount: totalsRow?.failed_count ?? 0,
      totalCost: totalsRow?.total_cost ?? 0,
    },
    features,
  });
});

// ─── GET /ai-usage/sessions — recent sessions across features ─────────────────

adminAiUsage.get('/ai-usage/sessions', async (c) => {
  const db = c.env.DB;
  const feature = c.req.query('feature');
  const limit = Math.min(Number.parseInt(c.req.query('limit') ?? '50', 10) || 50, 200);

  const whereClauses: string[] = [];
  const params: Array<string | number> = [];
  if (feature) {
    whereClauses.push('feature = ?');
    params.push(feature);
  }
  const where = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  // Aggregate per (feature, ref_id) — one row per "session". Events without a
  // ref_id collapse into their own event id so they still appear.
  const stmt = db
    .prepare(
      `SELECT
         feature,
         COALESCE(ref_id, id) AS ref_id,
         COUNT(*) AS event_count,
         COALESCE(SUM(usd_cost), 0) AS total_cost,
         MIN(success) AS success,
         SUM(input_tokens) AS total_input_tokens,
         SUM(output_tokens) AS total_output_tokens,
         SUM(input_audio_tokens) AS total_input_audio_tokens,
         SUM(output_audio_tokens) AS total_output_audio_tokens,
         SUM(audio_seconds) AS total_audio_seconds,
         MAX(created_at) AS last_event_at,
         MAX(CASE WHEN success = 0 THEN error_message END) AS last_error
       FROM ai_usage_events
       ${where}
       GROUP BY feature, COALESCE(ref_id, id)
       ORDER BY last_event_at DESC
       LIMIT ?`,
    )
    .bind(...params, limit);

  const { results } = await stmt.all<SessionRow>();

  return c.json({
    sessions: (results ?? []).map((row) => ({
      feature: row.feature,
      refId: row.ref_id,
      eventCount: row.event_count,
      totalCost: row.total_cost,
      success: row.success === 1,
      inputTokens: row.total_input_tokens ?? 0,
      outputTokens: row.total_output_tokens ?? 0,
      inputAudioTokens: row.total_input_audio_tokens ?? 0,
      outputAudioTokens: row.total_output_audio_tokens ?? 0,
      audioSeconds: row.total_audio_seconds ?? 0,
      lastEventAt: row.last_event_at,
      lastError: row.last_error,
    })),
  });
});

export { adminAiUsage };
