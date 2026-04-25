/**
 * Dev container TTL resolution.
 *
 * The effective TTL for a dev container session has three configuration
 * layers, resolved exactly once in the launch handler so the chosen value
 * is immutable for the life of the session:
 *
 *   1. Global default    — DEV_CONTAINER_DEFAULT_TTL_SECONDS (wrangler vars)
 *   2. Per-challenge     — challenges.dev_container_ttl_seconds
 *   3. Per-launch override — ttlSecondsOverride in the launch body
 *                             (honored only with X-Pipe-Admin-Override header)
 *
 * Precedence is override ?? challenge ?? global, then clamped to
 * [MIN_TTL_SECONDS, hardCap]. The source is returned alongside the value
 * so the cockpit can explain why a session expired when it did.
 *
 * This module is intentionally env-free — callers pass primitives, the
 * route handler pulls them from c.env and the challenge row.
 */

export type TtlSource = 'GLOBAL' | 'CHALLENGE' | 'OVERRIDE';

export interface ComputeEffectiveTtlInput {
  globalDefault: number;
  challengeTtl: number | null | undefined;
  override: number | null | undefined;
  hardCap: number;
}

export interface EffectiveTtl {
  ttlSeconds: number;
  source: TtlSource;
}

/** Minimum TTL — anything lower would expire before code-server boots. */
export const MIN_TTL_SECONDS = 30;

/**
 * Resolve the effective TTL for a new dev container session.
 *
 * Throws on non-finite / negative inputs and on a hardCap below MIN.
 * The caller is expected to translate these into a 400 BAD_REQUEST or
 * a 500 config error — we deliberately do not swallow them here.
 */
export function computeEffectiveTtl(input: ComputeEffectiveTtlInput): EffectiveTtl {
  const { globalDefault, challengeTtl, override, hardCap } = input;

  if (!Number.isFinite(hardCap) || hardCap < MIN_TTL_SECONDS) {
    throw new Error(
      `dev container hardCap must be >= ${MIN_TTL_SECONDS}s, got ${hardCap}`,
    );
  }
  if (!Number.isFinite(globalDefault) || globalDefault <= 0) {
    throw new Error(
      `dev container globalDefault must be a positive number, got ${globalDefault}`,
    );
  }

  let chosen: number;
  let source: TtlSource;

  if (override != null && Number.isFinite(override)) {
    if (override < MIN_TTL_SECONDS) {
      throw new Error(
        `dev container ttlSecondsOverride must be >= ${MIN_TTL_SECONDS}s, got ${override}`,
      );
    }
    chosen = override;
    source = 'OVERRIDE';
  } else if (challengeTtl != null && Number.isFinite(challengeTtl) && challengeTtl > 0) {
    chosen = challengeTtl;
    source = 'CHALLENGE';
  } else {
    chosen = globalDefault;
    source = 'GLOBAL';
  }

  // Clamp at the hard cap (quietly — this is a platform ceiling, not user error).
  // Clamp at the floor (loudly — we want to know if someone configured an impossible value).
  const clampedHigh = Math.min(chosen, hardCap);
  if (clampedHigh < MIN_TTL_SECONDS) {
    throw new Error(
      `dev container effective TTL fell below ${MIN_TTL_SECONDS}s after clamping, got ${clampedHigh}`,
    );
  }

  return { ttlSeconds: clampedHigh, source };
}
