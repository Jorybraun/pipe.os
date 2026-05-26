/**
 * Neo4j health check endpoint — smoke test only.
 *
 * GET /api/v1/internal/neo4j-health
 * Returns 200 { ok: true } if Neo4j responds to RETURN 1.
 * Returns 503 { ok: false, reason: '...' } otherwise.
 *
 * No auth required — this is a dev/ops smoke test.
 */

import { Hono } from 'hono';
import type { Env } from '../../types';
import { buildNeo4jConfig } from '../../lib/neo4j/driver';
import { neo4jHealthCheck, getDriverOrNull } from '../../lib/neo4j/query';

const app = new Hono<{ Bindings: Env }>();

app.get('/neo4j-health', async (c) => {
  const config = buildNeo4jConfig(c.env);
  if (!config) {
    return c.json(
      { ok: false, reason: 'Neo4j config missing (NEO4J_URI or NEO4J_PASSWORD)' },
      503,
    );
  }

  const driver = getDriverOrNull(config);
  if (!driver) {
    return c.json({ ok: false, reason: 'Failed to initialise Neo4j driver' }, 503);
  }

  const healthy = await neo4jHealthCheck(driver);
  if (healthy) {
    return c.json({ ok: true });
  }

  return c.json({ ok: false, reason: 'Neo4j did not respond to health query' }, 503);
});

export default app;
