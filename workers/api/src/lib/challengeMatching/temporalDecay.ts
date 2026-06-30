/**
 * Temporal evidence decay — applies time-based attenuation to evidence strength.
 *
 * Recent evidence carries full weight; older evidence decays logarithmically.
 * The decay is bounded: evidence never drops below FLOOR_MULTIPLIER regardless
 * of age, ensuring historical signals remain usable while prioritizing fresh data.
 */

export interface TemporalDecayConfig {
  /** Reference time (epoch ms). Evidence age is computed relative to this. */
  referenceTimeMs: number;
  /** Half-life in days. Evidence at this age retains 50% of its weight. */
  halfLifeDays: number;
  /** Minimum multiplier floor (0–1). Evidence never decays below this. */
  floorMultiplier: number;
  /** Grace period in days. Evidence younger than this receives full weight. */
  gracePeriodDays: number;
}

export const DEFAULT_DECAY_CONFIG: TemporalDecayConfig = {
  referenceTimeMs: Date.now(),
  halfLifeDays: 90,
  floorMultiplier: 0.25,
  gracePeriodDays: 14,
};

const MS_PER_DAY = 86_400_000;

/**
 * Computes the temporal decay multiplier for a piece of evidence.
 * Returns a value in [config.floorMultiplier, 1.0].
 */
export function computeDecayMultiplier(
  observedAtMs: number,
  config: TemporalDecayConfig,
): number {
  const ageDays = (config.referenceTimeMs - observedAtMs) / MS_PER_DAY;

  if (ageDays <= config.gracePeriodDays) return 1.0;

  const effectiveAge = ageDays - config.gracePeriodDays;
  const rawMultiplier = Math.pow(0.5, effectiveAge / config.halfLifeDays);

  return Math.max(config.floorMultiplier, Math.min(1.0, rawMultiplier));
}

/**
 * Applies temporal decay to a strength value.
 * Returns the decayed strength (strength × decay multiplier).
 */
export function applyTemporalDecay(
  strength: number,
  observedAtMs: number,
  config: TemporalDecayConfig,
): number {
  return strength * computeDecayMultiplier(observedAtMs, config);
}

/**
 * Parses an ISO date string or SQLite datetime to epoch milliseconds.
 * Returns null if the input is null/undefined/invalid.
 */
export function parseObservedAtMs(observedAt: string | null | undefined): number | null {
  if (!observedAt) return null;
  const ms = Date.parse(observedAt);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Computes the effective evidence age in days relative to a reference time.
 */
export function evidenceAgeDays(
  observedAtMs: number,
  referenceTimeMs: number,
): number {
  return Math.max(0, (referenceTimeMs - observedAtMs) / MS_PER_DAY);
}
