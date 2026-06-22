/**
 * Runtime rollout gate enforcement for living context features.
 *
 * Provides a middleware-compatible guard and a utility for conditional
 * feature serving. Each request can check whether a gate is enabled
 * before exposing data to the caller.
 *
 * Acceptance criterion #8: controlled staged rollout enforcement.
 */

import type { Context, Next } from 'hono';
import { getRolloutGate, isGateEnabled, type RolloutStage } from './rollout';

export interface GateCheckResult {
  readonly allowed: boolean;
  readonly gate: string;
  readonly stage: RolloutStage | 'unknown';
  readonly reason?: string;
}

/**
 * Check whether a rollout gate allows the current request.
 * Returns a structured result instead of throwing.
 */
export function checkGate(gateKey: string): GateCheckResult {
  const gate = getRolloutGate(gateKey);
  if (!gate) {
    return { allowed: false, gate: gateKey, stage: 'unknown', reason: `Unknown gate: ${gateKey}` };
  }
  if (!isGateEnabled(gateKey)) {
    return { allowed: false, gate: gateKey, stage: gate.stage, reason: `Gate "${gateKey}" is disabled.` };
  }
  return { allowed: true, gate: gateKey, stage: gate.stage };
}

/**
 * Hono middleware factory that rejects requests when a gate is disabled.
 * Returns 404 with a structured error rather than leaking internal details.
 */
export function requireGate(gateKey: string): (c: Context, next: Next) => Promise<Response | void> {
  return async (c: Context, next: Next): Promise<Response | void> => {
    const result = checkGate(gateKey);
    if (!result.allowed) {
      return c.json(
        { error: { code: 'NOT_FOUND', message: 'Resource not available.' } },
        404,
      );
    }
    return next();
  };
}

/**
 * Conditionally include data in a response based on gate status.
 * Returns the value if the gate is enabled, undefined otherwise.
 */
export function gatedField<T>(gateKey: string, value: T): T | undefined {
  return isGateEnabled(gateKey) ? value : undefined;
}
