/**
 * Evidence confidence aggregation — combines multiple observations of the same
 * concept across interactions into composite confidence scores.
 *
 * Interaction-level evidence remains separate (stored per source span); this
 * module produces an aggregated view for matching and display without mutating
 * the underlying evidence records.
 *
 * Aggregation strategy:
 *   - Corroborated: multiple independent sources agreeing → higher confidence
 *   - Recency-weighted: recent observations contribute more than old ones
 *   - Diversity bonus: evidence from different interaction types is more valuable
 *   - Contradiction penalty: conflicting observations reduce composite confidence
 */

import {
  computeDecayMultiplier,
  parseObservedAtMs,
  type TemporalDecayConfig,
  DEFAULT_DECAY_CONFIG,
} from '../challengeMatching/temporalDecay';

export interface EvidenceObservation {
  assertionId: string;
  conceptKey: string;
  confidence: number;
  strength: number;
  observedAt: string | null;
  interactionType: string;
  polarity: 'positive' | 'negative' | 'neutral';
}

export interface AggregatedConceptEvidence {
  conceptKey: string;
  compositeConfidence: number;
  compositeStrength: number;
  observationCount: number;
  corroborationCount: number;
  contradictionCount: number;
  sourceDiversity: number;
  interactionTypes: string[];
  latestObservedAt: string | null;
  oldestObservedAt: string | null;
}

export interface AggregationConfig {
  decay: TemporalDecayConfig;
  /** Bonus multiplier per additional corroborating source (capped). */
  corroborationBonus: number;
  /** Maximum corroboration multiplier (e.g., 1.5 = 50% max boost). */
  maxCorroborationMultiplier: number;
  /** Penalty per contradiction (subtracted from composite). */
  contradictionPenalty: number;
  /** Bonus per additional unique interaction type providing evidence. */
  diversityBonus: number;
}

export const DEFAULT_AGGREGATION_CONFIG: AggregationConfig = {
  decay: { ...DEFAULT_DECAY_CONFIG, referenceTimeMs: Date.now() },
  corroborationBonus: 0.08,
  maxCorroborationMultiplier: 1.5,
  contradictionPenalty: 0.15,
  diversityBonus: 0.05,
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/**
 * Aggregates multiple evidence observations for a single concept into a
 * composite confidence/strength score.
 */
export function aggregateConceptEvidence(
  observations: EvidenceObservation[],
  config: AggregationConfig = DEFAULT_AGGREGATION_CONFIG,
): AggregatedConceptEvidence {
  if (observations.length === 0) {
    return {
      conceptKey: '',
      compositeConfidence: 0,
      compositeStrength: 0,
      observationCount: 0,
      corroborationCount: 0,
      contradictionCount: 0,
      sourceDiversity: 0,
      interactionTypes: [],
      latestObservedAt: null,
      oldestObservedAt: null,
    };
  }

  const conceptKey = observations[0]!.conceptKey;
  const positiveObs = observations.filter((o) => o.polarity !== 'negative');
  const contradictions = observations.filter((o) => o.polarity === 'negative');
  const interactionTypes = [...new Set(observations.map((o) => o.interactionType))].sort();

  let weightedConfidenceSum = 0;
  let weightedStrengthSum = 0;
  let totalWeight = 0;
  let latestMs = -Infinity;
  let oldestMs = Infinity;
  let latestObservedAt: string | null = null;
  let oldestObservedAt: string | null = null;

  for (const obs of positiveObs) {
    const observedMs = parseObservedAtMs(obs.observedAt);
    const decayMultiplier = observedMs != null
      ? computeDecayMultiplier(observedMs, config.decay)
      : 0.5;
    const weight = decayMultiplier;
    weightedConfidenceSum += obs.confidence * weight;
    weightedStrengthSum += obs.strength * weight;
    totalWeight += weight;

    if (observedMs != null) {
      if (observedMs > latestMs) {
        latestMs = observedMs;
        latestObservedAt = obs.observedAt;
      }
      if (observedMs < oldestMs) {
        oldestMs = observedMs;
        oldestObservedAt = obs.observedAt;
      }
    }
  }

  const baseConfidence = totalWeight > 0 ? weightedConfidenceSum / totalWeight : 0;
  const baseStrength = totalWeight > 0 ? weightedStrengthSum / totalWeight : 0;

  const corroborationCount = Math.max(0, positiveObs.length - 1);
  const corroborationMultiplier = Math.min(
    config.maxCorroborationMultiplier,
    1 + corroborationCount * config.corroborationBonus,
  );

  const diversityCount = Math.max(0, interactionTypes.length - 1);
  const diversityMultiplier = 1 + diversityCount * config.diversityBonus;

  const contradictionReduction = contradictions.length * config.contradictionPenalty;

  const compositeConfidence = clamp01(
    baseConfidence * corroborationMultiplier * diversityMultiplier - contradictionReduction,
  );
  const compositeStrength = clamp01(
    baseStrength * corroborationMultiplier * diversityMultiplier - contradictionReduction,
  );

  return {
    conceptKey,
    compositeConfidence,
    compositeStrength,
    observationCount: observations.length,
    corroborationCount,
    contradictionCount: contradictions.length,
    sourceDiversity: interactionTypes.length,
    interactionTypes,
    latestObservedAt,
    oldestObservedAt,
  };
}

/**
 * Groups observations by concept key and aggregates each group independently.
 */
export function aggregateAllConceptEvidence(
  observations: EvidenceObservation[],
  config: AggregationConfig = DEFAULT_AGGREGATION_CONFIG,
): AggregatedConceptEvidence[] {
  const byConcept = new Map<string, EvidenceObservation[]>();
  for (const obs of observations) {
    const existing = byConcept.get(obs.conceptKey);
    if (existing) existing.push(obs);
    else byConcept.set(obs.conceptKey, [obs]);
  }
  return [...byConcept.entries()]
    .map(([, group]) => aggregateConceptEvidence(group, config))
    .sort((a, b) => b.compositeStrength - a.compositeStrength || a.conceptKey.localeCompare(b.conceptKey));
}

export interface LoadAggregatedEvidenceConfig {
  decay?: Partial<TemporalDecayConfig>;
  corroborationBonus?: number;
  maxCorroborationMultiplier?: number;
  contradictionPenalty?: number;
  diversityBonus?: number;
}

/**
 * Loads evidence observations for a candidate from D1 and returns aggregated concept evidence.
 */
export async function loadAggregatedCandidateEvidence(
  db: D1Database,
  candidateId: string,
  config?: LoadAggregatedEvidenceConfig,
): Promise<AggregatedConceptEvidence[]> {
  const fullConfig: AggregationConfig = {
    ...DEFAULT_AGGREGATION_CONFIG,
    ...(config?.corroborationBonus != null ? { corroborationBonus: config.corroborationBonus } : {}),
    ...(config?.maxCorroborationMultiplier != null ? { maxCorroborationMultiplier: config.maxCorroborationMultiplier } : {}),
    ...(config?.contradictionPenalty != null ? { contradictionPenalty: config.contradictionPenalty } : {}),
    ...(config?.diversityBonus != null ? { diversityBonus: config.diversityBonus } : {}),
    decay: {
      ...DEFAULT_AGGREGATION_CONFIG.decay,
      ...config?.decay,
      referenceTimeMs: config?.decay?.referenceTimeMs ?? Date.now(),
    },
  };

  interface ObservationRow {
    assertion_id: string;
    canonical_key: string;
    confidence: number;
    strength: number;
    observed_at: string | null;
    interaction_type: string;
    polarity: string;
  }

  const result = await db.prepare(
    `SELECT sa.id AS assertion_id,
            c.canonical_key,
            COALESCE(sa.confidence, 0.5) AS confidence,
            COALESCE(se.strength, 0.5) AS strength,
            COALESCE(sa.observed_at, sa.created_at) AS observed_at,
            COALESCE(i.interaction_type, 'unknown') AS interaction_type,
            COALESCE(sa.polarity, 'positive') AS polarity
       FROM applications app
       JOIN semantic_assertions sa ON sa.workspace_person_id = app.workspace_person_id
       JOIN assertion_concepts ac ON ac.assertion_id = sa.id
       JOIN concepts c ON c.id = ac.concept_id
       LEFT JOIN episodes ep ON ep.id = sa.episode_id
       LEFT JOIN interactions i ON i.id = ep.interaction_id
       LEFT JOIN signal_evidence se ON se.assertion_id = sa.id AND se.concept_id = ac.concept_id
      WHERE app.legacy_candidate_id = ?1
      ORDER BY c.canonical_key, COALESCE(sa.observed_at, sa.created_at) DESC`,
  ).bind(candidateId).all<ObservationRow>();

  const observations: EvidenceObservation[] = (result.results ?? []).map((row) => ({
    assertionId: row.assertion_id,
    conceptKey: row.canonical_key,
    confidence: row.confidence,
    strength: row.strength,
    observedAt: row.observed_at,
    interactionType: row.interaction_type,
    polarity: (row.polarity === 'negative' ? 'negative' : row.polarity === 'neutral' ? 'neutral' : 'positive') as 'positive' | 'negative' | 'neutral',
  }));

  return aggregateAllConceptEvidence(observations, fullConfig);
}
