import type { MiddlewareHandler } from 'hono';
import {
  isGateEnabled,
  getRolloutGate,
  getGateFromD1,
  type RolloutGate,
} from '../lib/livingContext/rollout';
import type { Env } from '../types';

/**
 * In-memory gate cache with 60 s TTL so D1 isn't hit on every request.
 * Cleared automatically per-isolate; Workers recycle isolates periodically.
 */
const gateCache = new Map<string, { gate: RolloutGate | undefined; expiresAt: number }>();
const CACHE_TTL_MS = 60_000;

async function resolveGate(
  gateKey: string,
  db: D1Database | undefined,
): Promise<{ enabled: boolean; label: string }> {
  if (!db) {
    const enabled = isGateEnabled(gateKey);
    const gate = getRolloutGate(gateKey);
    return { enabled, label: gate?.label ?? gateKey };
  }

  const now = Date.now();
  const cached = gateCache.get(gateKey);
  if (cached && cached.expiresAt > now) {
    const gate = cached.gate;
    return {
      enabled: gate !== undefined && gate.stage !== 'disabled',
      label: gate?.label ?? gateKey,
    };
  }

  try {
    const gate = await getGateFromD1(db, gateKey);
    gateCache.set(gateKey, { gate, expiresAt: now + CACHE_TTL_MS });
    return {
      enabled: gate !== undefined && gate.stage !== 'disabled',
      label: gate?.label ?? gateKey,
    };
  } catch {
    const fallback = getRolloutGate(gateKey);
    return {
      enabled: fallback !== undefined && fallback.stage !== 'disabled',
      label: fallback?.label ?? gateKey,
    };
  }
}

/**
 * Rollout gate middleware factory.
 *
 * Queries D1 for the gate stage (with a 60 s in-memory cache) and falls back
 * to hardcoded defaults when D1 is unavailable. This lets ops toggle features
 * via the admin API without redeploying.
 *
 * Usage:
 *   route.get('/living-context', requireGate('contact_living_context'), handler);
 *
 * Acceptance criterion #8: controlled staged rollout.
 */
export function requireGate(gateKey: string): MiddlewareHandler {
  return async (c, next): Promise<void> => {
    const db = (c.env as Env | undefined)?.DB;
    const { enabled, label } = await resolveGate(gateKey, db);
    if (!enabled) {
      c.res = c.json(
        { error: 'NOT_FOUND', message: `${label} is not currently available.` },
        404,
      );
      return;
    }
    await next();
  };
}

/**
 * Check if a gate is enabled for conditional rendering within a handler.
 * Synchronous — uses hardcoded defaults only. For D1-backed checks use
 * `resolveGate` or `requireGate` middleware.
 */
export function isFeatureEnabled(gateKey: string): boolean {
  return isGateEnabled(gateKey);
}

/** Exported for testing only. */
export function _clearGateCache(): void {
  gateCache.clear();
}
