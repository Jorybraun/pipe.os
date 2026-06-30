/**
 * Evidence gap analysis — given a candidate and a challenge packet, produces a
 * structured report of which demands are covered by source-backed evidence,
 * which have weak coverage, and which have no evidence at all.
 *
 * This enables recruiters to see exactly what a candidate is missing before or
 * after matching, and prioritize follow-up interactions accordingly.
 */

import {
  computeDecayMultiplier,
  parseObservedAtMs,
  DEFAULT_DECAY_CONFIG,
  type TemporalDecayConfig,
} from '../challengeMatching/temporalDecay';

export type CoverageLevel = 'strong' | 'partial' | 'weak' | 'none';

export interface DemandCoverage {
  demandId: string;
  demandNarrative: string;
  demandWeight: number;
  demandConcepts: string[];
  coverageLevel: CoverageLevel;
  matchedConcepts: string[];
  missingConcepts: string[];
  evidenceCount: number;
  bestEvidenceLevel: string | null;
  bestStrength: number;
  effectiveStrength: number;
  supportingAssertions: Array<{
    assertionId: string;
    narrative: string;
    conceptKey: string;
    strength: number;
    decayMultiplier: number;
    effectiveStrength: number;
    observedAt: string | null;
    exactText: string | null;
  }>;
}

export interface GapSummary {
  strongCount: number;
  partialCount: number;
  weakCount: number;
  noneCount: number;
  totalDemands: number;
  coverageScore: number;
  weightedCoverageScore: number;
}

export interface EvidenceGapReport {
  candidateId: string;
  workspacePersonId: string | null;
  challengeId: string;
  demands: DemandCoverage[];
  summary: GapSummary;
  recommendations: string[];
}

interface CandidateEvidenceRow {
  assertion_id: string;
  narrative: string;
  concept_key: string | null;
  strength: number | null;
  evidence_level: string | null;
  observed_at: string | null;
  exact_text: string | null;
  decay_multiplier: number;
  effective_strength: number;
}

interface DemandInput {
  id: string;
  narrative: string;
  weight: number;
  concepts: string[];
}

export interface GapAnalysisOptions {
  decay?: Partial<TemporalDecayConfig>;
  strongThreshold?: number;
  partialThreshold?: number;
  weakThreshold?: number;
}

const DEFAULT_STRONG_THRESHOLD = 0.6;
const DEFAULT_PARTIAL_THRESHOLD = 0.3;
const DEFAULT_WEAK_THRESHOLD = 0.1;

function classifyCoverage(
  effectiveStrength: number,
  conceptOverlap: number,
  options: GapAnalysisOptions,
): CoverageLevel {
  const strong = options.strongThreshold ?? DEFAULT_STRONG_THRESHOLD;
  const partial = options.partialThreshold ?? DEFAULT_PARTIAL_THRESHOLD;
  const weak = options.weakThreshold ?? DEFAULT_WEAK_THRESHOLD;

  if (effectiveStrength >= strong && conceptOverlap >= 0.5) return 'strong';
  if (effectiveStrength >= partial || conceptOverlap >= 0.3) return 'partial';
  if (effectiveStrength >= weak || conceptOverlap > 0) return 'weak';
  return 'none';
}

function coverageLevelScore(level: CoverageLevel): number {
  switch (level) {
    case 'strong': return 1.0;
    case 'partial': return 0.5;
    case 'weak': return 0.2;
    case 'none': return 0;
  }
}

function buildRecommendations(demands: DemandCoverage[]): string[] {
  const recommendations: string[] = [];

  const noCoverage = demands.filter((d) => d.coverageLevel === 'none');
  const weakCoverage = demands.filter((d) => d.coverageLevel === 'weak');

  if (noCoverage.length > 0) {
    const conceptsNeeded = [...new Set(noCoverage.flatMap((d) => d.missingConcepts))];
    recommendations.push(
      `No evidence for ${noCoverage.length} demand${noCoverage.length === 1 ? '' : 's'}. ` +
      `Missing concepts: ${conceptsNeeded.slice(0, 5).join(', ')}${conceptsNeeded.length > 5 ? ` (+${conceptsNeeded.length - 5} more)` : ''}.`,
    );
  }

  if (weakCoverage.length > 0) {
    recommendations.push(
      `Weak evidence for ${weakCoverage.length} demand${weakCoverage.length === 1 ? '' : 's'}. ` +
      `Follow-up interview could strengthen coverage.`,
    );
  }

  const highWeightGaps = demands
    .filter((d) => d.demandWeight >= 0.7 && (d.coverageLevel === 'none' || d.coverageLevel === 'weak'))
    .sort((a, b) => b.demandWeight - a.demandWeight);
  if (highWeightGaps.length > 0) {
    recommendations.push(
      `${highWeightGaps.length} high-weight demand${highWeightGaps.length === 1 ? '' : 's'} lack${highWeightGaps.length === 1 ? 's' : ''} evidence: ` +
      highWeightGaps.map((d) => `"${d.demandNarrative.slice(0, 60)}"`).join(', ') + '.',
    );
  }

  return recommendations;
}

export function analyzeEvidenceGaps(
  candidateEvidence: CandidateEvidenceRow[],
  demands: DemandInput[],
  options: GapAnalysisOptions = {},
): { demands: DemandCoverage[]; summary: GapSummary; recommendations: string[] } {
  const evidenceByConceptKey = new Map<string, CandidateEvidenceRow[]>();
  for (const row of candidateEvidence) {
    if (!row.concept_key) continue;
    const existing = evidenceByConceptKey.get(row.concept_key);
    if (existing) {
      existing.push(row);
    } else {
      evidenceByConceptKey.set(row.concept_key, [row]);
    }
  }

  const demandCoverages: DemandCoverage[] = demands.map((demand) => {
    const matchedConcepts: string[] = [];
    const missingConcepts: string[] = [];
    const supportingAssertions: DemandCoverage['supportingAssertions'] = [];
    let bestStrength = 0;
    let bestEffective = 0;
    let bestLevel: string | null = null;

    for (const concept of demand.concepts) {
      const evidence = evidenceByConceptKey.get(concept);
      if (!evidence || evidence.length === 0) {
        missingConcepts.push(concept);
        continue;
      }

      matchedConcepts.push(concept);

      for (const row of evidence) {
        const eff = row.effective_strength;
        if (eff > bestEffective) {
          bestEffective = eff;
          bestStrength = row.strength ?? 0;
          bestLevel = row.evidence_level;
        }

        supportingAssertions.push({
          assertionId: row.assertion_id,
          narrative: row.narrative,
          conceptKey: concept,
          strength: row.strength ?? 0,
          decayMultiplier: row.decay_multiplier,
          effectiveStrength: eff,
          observedAt: row.observed_at,
          exactText: row.exact_text,
        });
      }
    }

    const conceptOverlap = demand.concepts.length > 0
      ? matchedConcepts.length / demand.concepts.length
      : 0;

    const coverageLevel = classifyCoverage(bestEffective, conceptOverlap, options);

    return {
      demandId: demand.id,
      demandNarrative: demand.narrative,
      demandWeight: demand.weight,
      demandConcepts: demand.concepts,
      coverageLevel,
      matchedConcepts,
      missingConcepts,
      evidenceCount: supportingAssertions.length,
      bestEvidenceLevel: bestLevel,
      bestStrength,
      effectiveStrength: bestEffective,
      supportingAssertions,
    };
  });

  const strongCount = demandCoverages.filter((d) => d.coverageLevel === 'strong').length;
  const partialCount = demandCoverages.filter((d) => d.coverageLevel === 'partial').length;
  const weakCount = demandCoverages.filter((d) => d.coverageLevel === 'weak').length;
  const noneCount = demandCoverages.filter((d) => d.coverageLevel === 'none').length;
  const totalDemands = demandCoverages.length;

  const coverageScore = totalDemands > 0
    ? demandCoverages.reduce((sum, d) => sum + coverageLevelScore(d.coverageLevel), 0) / totalDemands
    : 0;

  const totalWeight = demandCoverages.reduce((sum, d) => sum + d.demandWeight, 0);
  const weightedCoverageScore = totalWeight > 0
    ? demandCoverages.reduce((sum, d) => sum + coverageLevelScore(d.coverageLevel) * d.demandWeight, 0) / totalWeight
    : 0;

  const summary: GapSummary = {
    strongCount,
    partialCount,
    weakCount,
    noneCount,
    totalDemands,
    coverageScore: Math.round(coverageScore * 1000) / 1000,
    weightedCoverageScore: Math.round(weightedCoverageScore * 1000) / 1000,
  };

  return {
    demands: demandCoverages,
    summary,
    recommendations: buildRecommendations(demandCoverages),
  };
}

export async function loadCandidateEvidenceForGapAnalysis(
  db: D1Database,
  candidateId: string,
  decayConfig?: Partial<TemporalDecayConfig>,
): Promise<{ workspacePersonId: string | null; evidence: CandidateEvidenceRow[] }> {
  const config: TemporalDecayConfig = {
    ...DEFAULT_DECAY_CONFIG,
    referenceTimeMs: Date.now(),
    ...decayConfig,
  };

  const wpResult = await db.prepare(
    `SELECT wp.id FROM workspace_people wp
     JOIN applications app ON app.workspace_person_id = wp.id
     JOIN candidates c ON c.id = app.legacy_candidate_id
     WHERE c.id = ?
     LIMIT 1`,
  ).bind(candidateId).first<{ id: string }>();

  if (!wpResult) {
    return { workspacePersonId: null, evidence: [] };
  }

  const rows = await db.prepare(
    `SELECT
       sa.id AS assertion_id,
       sa.narrative,
       ac.concept_id,
       c.canonical_key AS concept_key,
       se.strength,
       se.evidence_level,
       sa.observed_at,
       ss.exact_text
     FROM semantic_assertions sa
     LEFT JOIN assertion_concepts ac ON ac.assertion_id = sa.id
     LEFT JOIN concepts c ON c.id = ac.concept_id
     LEFT JOIN signal_evidence se ON se.assertion_id = sa.id
     LEFT JOIN assertion_source_spans ass ON ass.assertion_id = sa.id
     LEFT JOIN source_spans ss ON ss.id = ass.source_span_id
     WHERE sa.workspace_person_id = ?
     ORDER BY sa.observed_at DESC`,
  ).bind(wpResult.id).all<{
    assertion_id: string;
    narrative: string;
    concept_key: string | null;
    strength: number | null;
    evidence_level: string | null;
    observed_at: string | null;
    exact_text: string | null;
  }>();

  const evidence: CandidateEvidenceRow[] = (rows.results ?? []).map((row) => {
    const observedMs = parseObservedAtMs(row.observed_at);
    const decayMultiplier = observedMs !== null ? computeDecayMultiplier(observedMs, config) : 1.0;
    const rawStrength = row.strength ?? 0;
    return {
      ...row,
      decay_multiplier: decayMultiplier,
      effective_strength: rawStrength * decayMultiplier,
    };
  });

  return { workspacePersonId: wpResult.id, evidence };
}

export async function analyzeEvidenceGapsForChallenge(
  db: D1Database,
  candidateId: string,
  challengePacketId: string,
  options: GapAnalysisOptions = {},
): Promise<EvidenceGapReport> {
  const packetRow = await db.prepare(
    `SELECT packet_json FROM review_challenge_packets WHERE id = ?`,
  ).bind(challengePacketId).first<{ packet_json: string }>();

  if (!packetRow) {
    throw new Error(`Challenge packet ${challengePacketId} not found`);
  }

  const packet = JSON.parse(packetRow.packet_json) as {
    id: string;
    demands: Array<{ id: string; narrative: string; weight: number; concepts: string[] }>;
  };

  const { workspacePersonId, evidence } = await loadCandidateEvidenceForGapAnalysis(
    db, candidateId, options.decay,
  );

  const { demands, summary, recommendations } = analyzeEvidenceGaps(
    evidence, packet.demands, options,
  );

  return {
    candidateId,
    workspacePersonId,
    challengeId: challengePacketId,
    demands,
    summary,
    recommendations,
  };
}
