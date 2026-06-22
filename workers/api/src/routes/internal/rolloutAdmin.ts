/**
 * Internal rollout gate administration endpoint.
 *
 * GET  /api/v1/internal/rollout          — list all gates with current stages
 * GET  /api/v1/internal/rollout/:key     — get a single gate
 * PUT  /api/v1/internal/rollout/:key     — update a gate's stage
 * POST /api/v1/internal/rollout/validate — validate all prerequisite chains
 *
 * Auth: requires ADMIN_TTL_OVERRIDE_SECRET in X-Admin-Token header.
 */

import { Hono } from 'hono';
import type { Env } from '../../types';
import {
  loadGatesFromD1,
  getGateFromD1,
  updateGateStage,
  validateD1GatePrerequisites,
  getGateAuditLog,
} from '../../lib/livingContext/rollout';
import type { RolloutStage } from '../../lib/livingContext/rollout';

const VALID_STAGES: readonly string[] = ['disabled', 'internal_only', 'canary', 'general_availability'];

const app = new Hono<{ Bindings: Env }>();

function checkAdmin(c: { req: { header(name: string): string | undefined }; env: Env; json: (body: unknown, status: number) => Response }): Response | null {
  const adminToken = c.req.header('X-Admin-Token');
  const expectedToken = c.env.ADMIN_TTL_OVERRIDE_SECRET;
  if (!expectedToken || adminToken !== expectedToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

app.get('/rollout', async (c) => {
  const authErr = checkAdmin(c);
  if (authErr) return authErr;

  const gates = await loadGatesFromD1(c.env.DB);
  return c.json({ gates });
});

app.get('/rollout/:key', async (c) => {
  const authErr = checkAdmin(c);
  if (authErr) return authErr;

  const { key } = c.req.param();
  const gate = await getGateFromD1(c.env.DB, key);
  if (!gate) {
    return c.json({ error: `Unknown gate: ${key}` }, 404);
  }
  return c.json({ gate });
});

app.put('/rollout/:key', async (c) => {
  const authErr = checkAdmin(c);
  if (authErr) return authErr;

  const { key } = c.req.param();
  const body = await c.req.json<{ stage?: string; reason?: string }>().catch((): { stage?: string; reason?: string } => ({}));
  if (!body.stage || !VALID_STAGES.includes(body.stage)) {
    return c.json(
      { error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` },
      400,
    );
  }

  const result = await updateGateStage(
    c.env.DB,
    key,
    body.stage as RolloutStage,
    'admin',
    body.reason,
  );

  if (!result.success) {
    return c.json({ error: result.error }, 400);
  }
  return c.json({ success: true, gate_key: key, stage: body.stage });
});

app.post('/rollout/validate', async (c) => {
  const authErr = checkAdmin(c);
  if (authErr) return authErr;

  const errors = await validateD1GatePrerequisites(c.env.DB);
  return c.json({ valid: errors.length === 0, errors });
});

app.get('/rollout/audit', async (c) => {
  const authErr = checkAdmin(c);
  if (authErr) return authErr;

  const gateKey = c.req.query('gate_key') || undefined;
  const limit = Math.min(Math.max(1, Number(c.req.query('limit')) || 50), 200);
  const entries = await getGateAuditLog(c.env.DB, gateKey, limit);
  return c.json({ entries });
});

export { app as rolloutAdmin };
