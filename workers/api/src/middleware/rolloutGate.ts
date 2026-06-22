import type { MiddlewareHandler } from 'hono';
import { isGateEnabled, getRolloutGate } from '../lib/livingContext/rollout';

/**
 * Rollout gate middleware factory.
 *
 * Returns Hono middleware that checks whether a named feature gate is enabled.
 * If the gate is disabled, the request is rejected with 404 (feature not found)
 * so clients cannot discover unreleased capabilities.
 *
 * Usage:
 *   route.get('/living-context', requireGate('contact_living_context'), handler);
 *
 * Acceptance criterion #8: controlled staged rollout.
 */
export function requireGate(gateKey: string): MiddlewareHandler {
  return async (c, next): Promise<void> => {
    if (!isGateEnabled(gateKey)) {
      const gate = getRolloutGate(gateKey);
      const label = gate?.label ?? gateKey;
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
 * Unlike requireGate middleware, this doesn't block the request — it lets
 * handlers omit optional sections of a response when a gate is off.
 */
export function isFeatureEnabled(gateKey: string): boolean {
  return isGateEnabled(gateKey);
}
