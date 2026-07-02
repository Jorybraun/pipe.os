/**
 * Evidence freshness indicators — computes temporal freshness metadata for
 * evidence visualization. Adds decay multipliers and freshness labels to
 * timeline entries and evidence summaries so the UI can show which evidence
 * is current vs. aging.
 */

import {
  computeDecayMultiplier,
  DEFAULT_DECAY_CONFIG,
  type TemporalDecayConfig,
} from '../challengeMatching/temporalDecay';
import { resolveCandidateWorkspacePersonId } from './compatibility';

export type FreshnessLevel = 'fresh' | 'recent' | 'aging' | 'stale';

export interface EvidenceFreshnessEntry {
  id: string;
  observedAt: string | null;
  ageDays: number;
  decayMultiplier: number;
  freshnessLevel: FreshnessLevel;
  effectiveWeight: number;
}

export interface EvidenceFreshnessSummary {
  totalEntries: number;
  freshCount: number;
  recentCount: number;
  agingCount: number;
  staleCount: number;
  averageDecay: number;
  medianAgeDays: number;
  oldestObservedAt: string | null;
  newestObservedAt: string | null;
  entries: EvidenceFreshnessEntry[];
}

const MS_PER_DAY = 86_400_000;

function classifyFreshness(decayMultiplier: number): FreshnessLevel {
  if (decayMultiplier >= 0.9) return 'fresh';
  if (decayMultiplier >= 0.6) return 'recent';
  if (decayMultiplier >= 0.35) return 'aging';
  return 'stale';
}

export interface EvidenceRow {
  id: string;
  observedAt: string | null;
  baseWeight?: number;
}

/**
 * Computes freshness indicators for a set of evidence entries.
 * Each entry gets its decay multiplier, freshness level, and effective weight.
 */
export function computeEvidenceFreshness(
  entries: EvidenceRow[],
  decayConfig?: Partial<TemporalDecayConfig>,
): EvidenceFreshnessSummary {
  const decay: TemporalDecayConfig = {
    ...DEFAULT_DECAY_CONFIG,
    referenceTimeMs: Date.now(),
    ...decayConfig,
  };

  const freshnessEntries: EvidenceFreshnessEntry[] = [];
  let freshCount = 0;
  let recentCount = 0;
  let agingCount = 0;
  let staleCount = 0;
  let totalDecay = 0;
  const ageDaysArray: number[] = [];
  let oldest: string | null = null;
  let newest: string | null = null;

  for (const entry of entries) {
    let ageDays = 0;
    let mult = 1.0;

    if (entry.observedAt) {
      const observedMs = Date.parse(entry.observedAt);
      if (Number.isFinite(observedMs)) {
        ageDays = Math.max(0, (decay.referenceTimeMs - observedMs) / MS_PER_DAY);
        mult = computeDecayMultiplier(observedMs, decay);
      }

      if (!oldest || entry.observedAt < oldest) oldest = entry.observedAt;
      if (!newest || entry.observedAt > newest) newest = entry.observedAt;
    }

    const freshnessLevel = classifyFreshness(mult);
    const effectiveWeight = (entry.baseWeight ?? 1.0) * mult;

    switch (freshnessLevel) {
      case 'fresh': freshCount++; break;
      case 'recent': recentCount++; break;
      case 'aging': agingCount++; break;
      case 'stale': staleCount++; break;
    }

    totalDecay += mult;
    ageDaysArray.push(ageDays);

    freshnessEntries.push({
      id: entry.id,
      observedAt: entry.observedAt,
      ageDays,
      decayMultiplier: mult,
      freshnessLevel,
      effectiveWeight,
    });
  }

  const sortedAges = ageDaysArray.sort((a, b) => a - b);
  const medianAgeDays = sortedAges.length > 0
    ? sortedAges[Math.floor(sortedAges.length / 2)]!
    : 0;

  return {
    totalEntries: entries.length,
    freshCount,
    recentCount,
    agingCount,
    staleCount,
    averageDecay: entries.length > 0 ? totalDecay / entries.length : 0,
    medianAgeDays,
    oldestObservedAt: oldest,
    newestObservedAt: newest,
    entries: freshnessEntries,
  };
}

/**
 * Loads evidence freshness summary for a candidate by fetching assertion
 * timestamps from D1 and computing decay multipliers.
 */
export async function loadCandidateEvidenceFreshness(
  db: D1Database,
  candidateId: string,
  decayConfig?: Partial<TemporalDecayConfig>,
): Promise<EvidenceFreshnessSummary> {
  interface AssertionTimestampRow {
    id: string;
    observed_at: string | null;
    strength: number | null;
  }

  const workspacePersonId = await resolveCandidateWorkspacePersonId(db, candidateId);
  if (!workspacePersonId) return computeEvidenceFreshness([], decayConfig);

  const result = await db.prepare(
    `SELECT sa.id,
            COALESCE(sa.observed_at, sa.created_at) AS observed_at,
            (SELECT MAX(se.strength) FROM signal_evidence se WHERE se.assertion_id = sa.id) AS strength
       FROM semantic_assertions sa
      WHERE sa.workspace_person_id = ?1
      ORDER BY COALESCE(sa.observed_at, sa.created_at) DESC`,
  ).bind(workspacePersonId).all<AssertionTimestampRow>();

  const entries: EvidenceRow[] = (result.results ?? []).map((row) => ({
    id: row.id,
    observedAt: row.observed_at,
    baseWeight: row.strength ?? undefined,
  }));

  return computeEvidenceFreshness(entries, decayConfig);
}
