import type { Context, Next } from 'hono';
import type { Env } from '../../types';
import { deterministicEntityId } from './persistence';

/**
 * Rollout gate stages. Prerequisites enforce that downstream features
 * cannot advance past their dependencies.
 */
export type GateStage = 'disabled' | 'internal_only' | 'canary' | 'GA';

const STAGE_ORDER: GateStage[] = ['disabled', 'internal_only', 'canary', 'GA'];

export interface GateCheckResult {
  allowed: boolean;
  gate: string;
  stage: GateStage;
}

interface GateRow {
  gate_key: string;
  stage: string;
}

const gateCache = new Map<string, { stage: GateStage; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

function isValidStage(value: string): value is GateStage {
  return (STAGE_ORDER as string[]).includes(value);
}

/**
 * Check whether a rollout gate allows traffic at the current stage.
 * Returns a structured result so callers can act on the gate state.
 *
 * Uses a 60-second in-memory cache to avoid repeated D1 reads on hot paths.
 * Falls back to 'disabled' if the gate row doesn't exist.
 */
export async function checkGate(
  db: D1Database,
  gateKey: string,
): Promise<GateCheckResult> {
  const now = Date.now();
  const cached = gateCache.get(gateKey);
  if (cached && cached.expiresAt > now) {
    return {
      allowed: cached.stage !== 'disabled',
      gate: gateKey,
      stage: cached.stage,
    };
  }

  const row = await db.prepare(
    `SELECT gate_key, stage FROM rollout_gates WHERE gate_key = ?1`,
  ).bind(gateKey).first<GateRow>();

  const stage: GateStage = row && isValidStage(row.stage) ? row.stage : 'disabled';

  gateCache.set(gateKey, { stage, expiresAt: now + CACHE_TTL_MS });

  return {
    allowed: stage !== 'disabled',
    gate: gateKey,
    stage,
  };
}

/**
 * Hono middleware that rejects requests when a rollout gate is disabled.
 * Returns 404 (not 403) so that disabled features appear non-existent.
 */
export function requireGate(
  gateKey: string,
): (c: Context<{ Bindings: Env }>, next: Next) => Promise<Response | void> {
  return async (c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> => {
    const result = await checkGate(c.env.DB, gateKey);
    if (!result.allowed) {
      return c.json({ error: 'not_found' }, 404);
    }
    return next();
  };
}

/**
 * Conditionally serve a value based on gate state. Returns the value when
 * the gate is enabled, null otherwise. Useful for gating response fields
 * without blocking the entire endpoint.
 */
export async function gatedField<T>(
  db: D1Database,
  gateKey: string,
  value: T,
): Promise<T | null> {
  const result = await checkGate(db, gateKey);
  return result.allowed ? value : null;
}

/**
 * Update a gate stage with audit logging.
 */
export async function updateGateStage(
  db: D1Database,
  gateKey: string,
  newStage: GateStage,
  updatedBy: string,
  reason?: string,
): Promise<void> {
  const existing = await db.prepare(
    `SELECT gate_key, stage FROM rollout_gates WHERE gate_key = ?1`,
  ).bind(gateKey).first<GateRow>();

  const previousStage = existing?.stage ?? 'disabled';

  if (existing) {
    await db.prepare(
      `UPDATE rollout_gates SET stage = ?2, updated_by = ?3, updated_at = datetime('now') WHERE gate_key = ?1`,
    ).bind(gateKey, newStage, updatedBy).run();
  } else {
    const id = await deterministicEntityId('rollout_gate', `gate:${gateKey}`);
    await db.prepare(
      `INSERT INTO rollout_gates (id, gate_key, stage, updated_by, created_at, updated_at)
       VALUES (?1, ?2, ?3, ?4, datetime('now'), datetime('now'))`,
    ).bind(id, gateKey, newStage, updatedBy).run();
  }

  const auditId = await deterministicEntityId(
    'rollout_audit',
    `audit:${gateKey}:${new Date().toISOString()}:${newStage}`,
  );
  // Best-effort audit write — never blocks gate transitions
  try {
    await db.prepare(
      `INSERT INTO rollout_gate_audit_log (id, gate_key, previous_stage, new_stage, updated_by, reason, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, datetime('now'))`,
    ).bind(auditId, gateKey, previousStage, newStage, updatedBy, reason ?? null).run();
  } catch {
    // Best-effort: audit failure must never block gate transitions
  }

  // Invalidate cache
  gateCache.delete(gateKey);
}

/**
 * List all rollout gates with their current stages.
 */
export async function listGates(
  db: D1Database,
): Promise<Array<{ gateKey: string; stage: GateStage; updatedBy: string | null }>> {
  const rows = await db.prepare(
    `SELECT gate_key, stage, updated_by FROM rollout_gates ORDER BY gate_key`,
  ).all<{ gate_key: string; stage: string; updated_by: string | null }>();

  return (rows.results ?? []).map((row) => ({
    gateKey: row.gate_key,
    stage: isValidStage(row.stage) ? row.stage : 'disabled',
    updatedBy: row.updated_by,
  }));
}

/**
 * Query audit log for a specific gate.
 */
export async function queryAuditLog(
  db: D1Database,
  gateKey: string,
  limit: number = 50,
): Promise<Array<{
  gateKey: string;
  previousStage: string;
  newStage: string;
  updatedBy: string | null;
  reason: string | null;
  createdAt: string;
}>> {
  const rows = await db.prepare(
    `SELECT gate_key, previous_stage, new_stage, updated_by, reason, created_at
       FROM rollout_gate_audit_log
      WHERE gate_key = ?1
      ORDER BY created_at DESC
      LIMIT ?2`,
  ).bind(gateKey, limit).all<{
    gate_key: string;
    previous_stage: string;
    new_stage: string;
    updated_by: string | null;
    reason: string | null;
    created_at: string;
  }>();

  return (rows.results ?? []).map((row) => ({
    gateKey: row.gate_key,
    previousStage: row.previous_stage,
    newStage: row.new_stage,
    updatedBy: row.updated_by,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

/** Clear the in-memory gate cache (useful in tests). */
export function clearGateCache(): void {
  gateCache.clear();
}
