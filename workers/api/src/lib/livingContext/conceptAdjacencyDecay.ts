/**
 * Concept adjacency temporal weighting — applies time-based decay to concept
 * co-occurrence edges so that recently co-observed concepts have stronger
 * adjacency than historically co-observed ones.
 *
 * This ensures the concept graph evolves with fresh evidence: stale
 * co-occurrences fade while recently reinforced connections strengthen.
 */

import {
  computeDecayMultiplier,
  DEFAULT_DECAY_CONFIG,
  type TemporalDecayConfig,
} from '../challengeMatching/temporalDecay';

export interface WeightedAdjacency {
  fromConceptId: string;
  toConceptId: string;
  fromCanonicalKey: string;
  toCanonicalKey: string;
  dimension: string;
  stretchAllowed: boolean;
  rawConfidence: number;
  temporalWeight: number;
  effectiveConfidence: number;
  observationCount: number;
  latestObservedAt: number;
  oldestObservedAt: number;
}

interface AdjacencyRow {
  from_concept_id: string;
  to_concept_id: string;
  from_canonical_key: string;
  to_canonical_key: string;
  dimension: string;
  stretch_allowed: number;
  confidence: number | null;
  observed_at: number;
}

/**
 * Loads concept adjacencies for a given concept and applies temporal decay
 * to compute effective confidence scores. Multiple adjacency records for
 * the same concept pair are aggregated — more recent observations contribute
 * more weight.
 */
export async function loadTemporalAdjacencies(
  db: D1Database,
  conceptId: string,
  decayConfig?: Partial<TemporalDecayConfig>,
): Promise<WeightedAdjacency[]> {
  const decay: TemporalDecayConfig = {
    ...DEFAULT_DECAY_CONFIG,
    referenceTimeMs: Date.now(),
    ...decayConfig,
  };

  const result = await db.prepare(
    `SELECT ca.from_concept_id, ca.to_concept_id,
            cf.canonical_key AS from_canonical_key,
            ct.canonical_key AS to_canonical_key,
            ca.dimension, ca.stretch_allowed,
            ca.confidence, ca.observed_at
       FROM concept_adjacency ca
       JOIN concepts cf ON cf.id = ca.from_concept_id
       JOIN concepts ct ON ct.id = ca.to_concept_id
      WHERE ca.from_concept_id = ?1 OR ca.to_concept_id = ?1
      ORDER BY ca.observed_at DESC`,
  ).bind(conceptId).all<AdjacencyRow>();

  const rows = result.results ?? [];
  if (rows.length === 0) return [];

  type PairKey = string;
  function pairKey(row: AdjacencyRow): PairKey {
    const ids = [row.from_concept_id, row.to_concept_id].sort();
    return `${ids[0]}|${ids[1]}|${row.dimension}`;
  }

  const groups = new Map<PairKey, AdjacencyRow[]>();
  for (const row of rows) {
    const key = pairKey(row);
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  const weighted: WeightedAdjacency[] = [];
  for (const [, group] of groups) {
    const representative = group[0]!;
    let totalWeight = 0;
    let weightedConfidenceSum = 0;
    let maxObserved = -Infinity;
    let minObserved = Infinity;

    for (const row of group) {
      const observedMs = row.observed_at;
      const mult = computeDecayMultiplier(observedMs, decay);
      const rawConf = row.confidence ?? 0.5;
      totalWeight += mult;
      weightedConfidenceSum += rawConf * mult;
      if (observedMs > maxObserved) maxObserved = observedMs;
      if (observedMs < minObserved) minObserved = observedMs;
    }

    const avgRawConfidence = group.reduce(
      (sum, r) => sum + (r.confidence ?? 0.5),
      0,
    ) / group.length;

    const effectiveConfidence = totalWeight > 0
      ? weightedConfidenceSum / totalWeight
      : avgRawConfidence;

    const latestMult = computeDecayMultiplier(maxObserved, decay);

    weighted.push({
      fromConceptId: representative.from_concept_id,
      toConceptId: representative.to_concept_id,
      fromCanonicalKey: representative.from_canonical_key,
      toCanonicalKey: representative.to_canonical_key,
      dimension: representative.dimension,
      stretchAllowed: representative.stretch_allowed === 1,
      rawConfidence: avgRawConfidence,
      temporalWeight: latestMult,
      effectiveConfidence,
      observationCount: group.length,
      latestObservedAt: maxObserved,
      oldestObservedAt: minObserved,
    });
  }

  weighted.sort((a, b) => b.effectiveConfidence - a.effectiveConfidence);
  return weighted;
}

/**
 * Loads the temporally-weighted concept neighborhood for multiple concepts
 * at once. Returns adjacencies grouped by source concept.
 */
export async function loadTemporalNeighborhood(
  db: D1Database,
  conceptIds: string[],
  decayConfig?: Partial<TemporalDecayConfig>,
): Promise<Map<string, WeightedAdjacency[]>> {
  const result = new Map<string, WeightedAdjacency[]>();
  if (conceptIds.length === 0) return result;

  const adjacencyPromises = conceptIds.map(async (id) => {
    const adjacencies = await loadTemporalAdjacencies(db, id, decayConfig);
    return { id, adjacencies };
  });

  const settled = await Promise.all(adjacencyPromises);
  for (const { id, adjacencies } of settled) {
    result.set(id, adjacencies);
  }

  return result;
}
