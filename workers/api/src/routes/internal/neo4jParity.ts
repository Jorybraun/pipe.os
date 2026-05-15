/**
 * Neo4j parity dashboard — shadow-read divergence metrics and cutover readiness.
 *
 * GET /api/v1/internal/neo4j-parity
 *
 * Returns:
 *   - neo4jHealth: whether Neo4j responds
 *   - shadowReadEnabled: whether SHADOW_READ_NEO4J='true'
 *   - primaryStore: current PRIMARY_MATCH_STORE value
 *   - stats: aggregate divergence metrics (total reads, avg overlap, avg deviation)
 *   - cutoverReady: whether thresholds are met for PRIMARY_MATCH_STORE=neo4j
 *   - recentDivergences: last N shadow-read events
 *
 * No auth required — dev/ops endpoint.
 */

import { Hono } from 'hono';
import type { Env } from '../../types';
import { buildNeo4jConfig } from '../../lib/neo4j/driver';
import { neo4jHealthCheck, getDriverOrNull } from '../../lib/neo4j/query';
import { getDivergenceStats, getRecentDivergences } from '../../lib/match/shadowRead';

const app = new Hono<{ Bindings: Env }>();

app.get('/neo4j-parity', async (c) => {
  const env = c.env;

  // Neo4j health
  let neo4jHealth: { ok: boolean; reason?: string } = { ok: false, reason: 'Config missing' };
  const config = buildNeo4jConfig(env);
  if (config) {
    const driver = getDriverOrNull(config);
    if (driver) {
      const healthy = await neo4jHealthCheck(driver);
      neo4jHealth = healthy
        ? { ok: true }
        : { ok: false, reason: 'Neo4j did not respond to health query' };
    } else {
      neo4jHealth = { ok: false, reason: 'Failed to initialise driver' };
    }
  }

  const shadowReadEnabled = env.SHADOW_READ_NEO4J === 'true';
  const primaryStore = env.PRIMARY_MATCH_STORE ?? 'd1';
  const stats = getDivergenceStats();
  const recentDivergences = getRecentDivergences(10);

  return c.json({
    neo4jHealth,
    shadowReadEnabled,
    primaryStore,
    stats: {
      totalReads: stats.totalReads,
      avgTop10Overlap: stats.avgTop10Overlap,
      avgScoreDeviation: stats.avgScoreDeviation,
      neo4jErrorCount: stats.neo4jErrorCount,
      cutoverReady: stats.cutoverReady,
    },
    recentDivergences: recentDivergences.map((d) => ({
      timestamp: d.timestamp,
      roleContextIdHash: d.roleContextIdHash,
      top10Overlap: d.top10Overlap,
      scoreDeviation: d.scoreDeviation,
      d1Count: d.d1Count,
      neo4jCount: d.neo4jCount,
      neo4jError: d.neo4jError,
    })),
    cutoverThresholds: {
      minTop10Overlap: 8,
      maxScoreDeviation: 0.05,
    },
  });
});

export default app;
