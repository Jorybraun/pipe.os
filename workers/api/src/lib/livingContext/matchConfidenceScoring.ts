/**
 * Match confidence scoring — given a candidate and a challenge packet, produces
 * a multi-dimensional confidence score quantifying how reliable the match is.
 *
 * Dimensions:
 * - coverage: what fraction of challenge demands have matching candidate evidence
 * - recency: how fresh the supporting evidence is (temporal decay)
 * - depth: how many independent corroborating sources support each demand
 * - consistency: whether evidence from different sources agrees
 *
 * The composite score drives UI confidence badges and recruiter decision support.
 */

import {
  computeDecayMultiplier,
  parseObservedAtMs,
  DEFAULT_DECAY_CONFIG,
  type TemporalDecayConfig,
} from '../challengeMatching/temporalDecay';
import { findConceptEvidenceMatches, scoreableDemandConcepts } from './conceptSemanticMatch';
import type { D1Database } from '@cloudflare/workers-types';

export type ConfidenceLevel = 'high' | 'moderate' | 'low' | 'insufficient';

export interface DemandConfidence {
  demandId: string;
  demandNarrative: string;
  demandWeight: number;
  demandConcepts: string[];
  matchedConcepts: string[];
  missingConcepts: string[];
  coverageRatio: number;
  averageRecency: number;
  corroboratingSourceCount: number;
  bestStrength: number;
  effectiveStrength: number;
  confidenceScore: number;
  confidenceLevel: ConfidenceLevel;
  isStretch: boolean;
  stretchReason: string | null;
}

export interface ConfidenceDimension {
  name: 'coverage' | 'recency' | 'depth' | 'consistency';
  label: string;
  score: number;
  weight: number;
  detail: string;
}

export interface MatchConfidenceReport {
  candidateId: string;
  workspacePersonId: string | null;
  challengeId: string;
  compositeScore: number;
  compositeLevel: ConfidenceLevel;
  dimensions: ConfidenceDimension[];
  demands: DemandConfidence[];
  stretchAreas: DemandConfidence[];
  strongMatches: DemandConfidence[];
  recommendations: string[];
  computedAt: string;
}

export interface MatchConfidenceOptions {
  decay?: Partial<TemporalDecayConfig>;
  coverageWeight?: number;
  recencyWeight?: number;
  depthWeight?: number;
  consistencyWeight?: number;
  stretchThreshold?: number;
  now?: Date;
}

interface EvidenceRow {
  assertion_id: string;
  narrative: string;
  concept_key: string | null;
  strength: number | null;
  evidence_level: string | null;
  observed_at: string | null;
  exact_text: string | null;
  interaction_type: string | null;
}

interface DemandInput {
  id: string;
  narrative: string;
  weight: number;
  concepts: string[];
}

interface PacketDemandInput {
  id?: string;
  narrative?: string;
  weight?: number;
  concepts?: string[];
  conceptKeys?: string[];
}

const DEFAULT_COVERAGE_WEIGHT = 0.35;
const DEFAULT_RECENCY_WEIGHT = 0.25;
const DEFAULT_DEPTH_WEIGHT = 0.25;
const DEFAULT_CONSISTENCY_WEIGHT = 0.15;
const DEFAULT_STRETCH_THRESHOLD = 0.3;

function classifyConfidence(score: number): ConfidenceLevel {
  if (score >= 0.7) return 'high';
  if (score >= 0.45) return 'moderate';
  if (score >= 0.2) return 'low';
  return 'insufficient';
}

function computeCorroborationScore(sourceTypes: Set<string>): number {
  const count = sourceTypes.size;
  if (count >= 3) return 1.0;
  if (count === 2) return 0.7;
  if (count === 1) return 0.4;
  return 0;
}

function computeConsistencyScore(strengths: number[]): number {
  if (strengths.length < 2) return 1.0;
  const mean = strengths.reduce((a, b) => a + b, 0) / strengths.length;
  const variance =
    strengths.reduce((sum, s) => sum + (s - mean) ** 2, 0) / strengths.length;
  const stdDev = Math.sqrt(variance);
  return Math.max(0, 1 - stdDev);
}

export function scoreMatchConfidence(
  evidence: EvidenceRow[],
  demands: DemandInput[],
  options: MatchConfidenceOptions = {},
): {
  demands: DemandConfidence[];
  dimensions: ConfidenceDimension[];
  compositeScore: number;
  compositeLevel: ConfidenceLevel;
  stretchAreas: DemandConfidence[];
  strongMatches: DemandConfidence[];
  recommendations: string[];
} {
  const now = options.now ?? new Date();
  const decayConfig: TemporalDecayConfig = {
    ...DEFAULT_DECAY_CONFIG,
    referenceTimeMs: now.getTime(),
    ...options.decay,
  };

  const coverageWeight = options.coverageWeight ?? DEFAULT_COVERAGE_WEIGHT;
  const recencyWeight = options.recencyWeight ?? DEFAULT_RECENCY_WEIGHT;
  const depthWeight = options.depthWeight ?? DEFAULT_DEPTH_WEIGHT;
  const consistencyWeight = options.consistencyWeight ?? DEFAULT_CONSISTENCY_WEIGHT;
  const stretchThreshold = options.stretchThreshold ?? DEFAULT_STRETCH_THRESHOLD;

  const evidenceWithConcepts = evidence.filter((row) => row.concept_key !== null);

  const demandConfidences: DemandConfidence[] = demands.map((demand) => {
    const matchedConcepts: string[] = [];
    const missingConcepts: string[] = [];
    const allStrengths: number[] = [];
    const allRecencies: number[] = [];
    const sourceTypes = new Set<string>();
    let bestStrength = 0;
    let bestEffective = 0;
    const scoredConcepts = scoreableDemandConcepts(demand.concepts);

    for (const concept of scoredConcepts) {
      const matches = findConceptEvidenceMatches(concept, evidenceWithConcepts);
      if (matches.length === 0) {
        missingConcepts.push(concept);
        continue;
      }

      matchedConcepts.push(concept);

      for (const match of matches) {
        const row = match.row;
        const rawStrength = row.strength ?? 0;
        const observedMs = parseObservedAtMs(row.observed_at);
        const decay = observedMs !== null
          ? computeDecayMultiplier(observedMs, decayConfig)
          : 1.0;
        const effective = rawStrength * decay;

        allStrengths.push(effective);
        allRecencies.push(decay);

        if (row.interaction_type) {
          sourceTypes.add(row.interaction_type);
        }

        if (effective > bestEffective) {
          bestEffective = effective;
          bestStrength = rawStrength;
        }
      }
    }

    const coverageRatio = scoredConcepts.length > 0
      ? matchedConcepts.length / scoredConcepts.length
      : 0;

    const averageRecency = allRecencies.length > 0
      ? allRecencies.reduce((a, b) => a + b, 0) / allRecencies.length
      : 0;

    const corroborationScore = computeCorroborationScore(sourceTypes);
    const consistencyScore = computeConsistencyScore(allStrengths);

    const confidenceScore = Math.min(
      coverageRatio * 0.4 +
      averageRecency * 0.2 +
      corroborationScore * 0.2 +
      consistencyScore * 0.1 +
      bestEffective * 0.1,
      1.0,
    );

    const isStretch = coverageRatio > 0 && coverageRatio < stretchThreshold;
    const stretchReason = isStretch
      ? `Only ${matchedConcepts.length}/${scoredConcepts.length} scoreable concepts matched — candidate has adjacent but incomplete evidence`
      : null;

    return {
      demandId: demand.id,
      demandNarrative: demand.narrative,
      demandWeight: demand.weight,
      demandConcepts: demand.concepts,
      matchedConcepts,
      missingConcepts,
      coverageRatio: Math.round(coverageRatio * 1000) / 1000,
      averageRecency: Math.round(averageRecency * 1000) / 1000,
      corroboratingSourceCount: sourceTypes.size,
      bestStrength,
      effectiveStrength: Math.round(bestEffective * 1000) / 1000,
      confidenceScore: Math.round(confidenceScore * 1000) / 1000,
      confidenceLevel: classifyConfidence(confidenceScore),
      isStretch,
      stretchReason,
    };
  });

  const totalWeight = demandConfidences.reduce((sum, d) => sum + d.demandWeight, 0);

  const weightedCoverage = totalWeight > 0
    ? demandConfidences.reduce(
        (sum, d) => sum + d.coverageRatio * d.demandWeight,
        0,
      ) / totalWeight
    : 0;

  const weightedRecency = totalWeight > 0
    ? demandConfidences.reduce(
        (sum, d) => sum + d.averageRecency * d.demandWeight,
        0,
      ) / totalWeight
    : 0;

  const avgCorroboration = demandConfidences.length > 0
    ? demandConfidences.reduce(
        (sum, d) => sum + computeCorroborationScore(new Set(Array.from({ length: d.corroboratingSourceCount }, (_, i) => String(i)))),
        0,
      ) / demandConfidences.length
    : 0;

  const allDemandStrengths = demandConfidences
    .filter((d) => d.effectiveStrength > 0)
    .map((d) => d.effectiveStrength);
  const overallConsistency = computeConsistencyScore(allDemandStrengths);

  const dimensions: ConfidenceDimension[] = [
    {
      name: 'coverage',
      label: 'Evidence Coverage',
      score: Math.round(weightedCoverage * 1000) / 1000,
      weight: coverageWeight,
      detail: `${demandConfidences.filter((d) => d.coverageRatio > 0).length}/${demandConfidences.length} demands have matching evidence`,
    },
    {
      name: 'recency',
      label: 'Evidence Recency',
      score: Math.round(weightedRecency * 1000) / 1000,
      weight: recencyWeight,
      detail: `Average temporal decay multiplier: ${Math.round(weightedRecency * 100)}%`,
    },
    {
      name: 'depth',
      label: 'Corroboration Depth',
      score: Math.round(avgCorroboration * 1000) / 1000,
      weight: depthWeight,
      detail: `Average ${Math.round(avgCorroboration * 3)} independent source types per demand`,
    },
    {
      name: 'consistency',
      label: 'Evidence Consistency',
      score: Math.round(overallConsistency * 1000) / 1000,
      weight: consistencyWeight,
      detail: overallConsistency >= 0.8
        ? 'Evidence strengths are consistent across sources'
        : 'Some variation in evidence strength across sources',
    },
  ];

  const compositeScore = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0) * 1000,
  ) / 1000;

  const stretchAreas = demandConfidences.filter((d) => d.isStretch);
  const strongMatches = demandConfidences.filter((d) => d.confidenceLevel === 'high');

  const recommendations = buildConfidenceRecommendations(demandConfidences, dimensions);

  return {
    demands: demandConfidences,
    dimensions,
    compositeScore,
    compositeLevel: classifyConfidence(compositeScore),
    stretchAreas,
    strongMatches,
    recommendations,
  };
}

function buildConfidenceRecommendations(
  demands: DemandConfidence[],
  dimensions: ConfidenceDimension[],
): string[] {
  const recs: string[] = [];

  const insufficient = demands.filter((d) => d.confidenceLevel === 'insufficient');
  if (insufficient.length > 0) {
    const highWeight = insufficient
      .filter((d) => d.demandWeight >= 0.6)
      .sort((a, b) => b.demandWeight - a.demandWeight);
    if (highWeight.length > 0) {
      recs.push(
        `${highWeight.length} high-weight demand${highWeight.length === 1 ? '' : 's'} lack sufficient evidence. ` +
        `Consider targeted assessment or interview covering: ${highWeight.slice(0, 3).map((d) => `"${d.demandNarrative.slice(0, 50)}"`).join(', ')}.`,
      );
    }
  }

  const recencyDim = dimensions.find((d) => d.name === 'recency');
  if (recencyDim && recencyDim.score < 0.5) {
    recs.push(
      'Evidence is aging — consider a follow-up interaction to refresh candidate signals.',
    );
  }

  const depthDim = dimensions.find((d) => d.name === 'depth');
  if (depthDim && depthDim.score < 0.4) {
    recs.push(
      'Low corroboration — most evidence comes from a single source type. Additional assessment channels would strengthen confidence.',
    );
  }

  const stretchCount = demands.filter((d) => d.isStretch).length;
  if (stretchCount > 0) {
    recs.push(
      `${stretchCount} demand${stretchCount === 1 ? '' : 's'} identified as stretch area${stretchCount === 1 ? '' : 's'} — candidate has adjacent but incomplete evidence.`,
    );
  }

  return recs;
}

export async function computeMatchConfidence(
  db: D1Database,
  candidateId: string,
  challengePacketId: string,
  options: MatchConfidenceOptions = {},
): Promise<MatchConfidenceReport> {
  const now = options.now ?? new Date();
  const decayConfig: TemporalDecayConfig = {
    ...DEFAULT_DECAY_CONFIG,
    referenceTimeMs: now.getTime(),
    ...options.decay,
  };

  const wpResult = await db.prepare(
    `SELECT wp.id FROM workspace_people wp
     JOIN applications app ON app.workspace_person_id = wp.id
     JOIN candidates c ON c.id = app.legacy_candidate_id
     WHERE c.id = ?
     LIMIT 1`,
  ).bind(candidateId).first<{ id: string }>();

  const packetRow = await db.prepare(
    `SELECT packet_json FROM review_challenge_packets WHERE id = ?`,
  ).bind(challengePacketId).first<{ packet_json: string }>();

  if (!packetRow) {
    throw new Error(`Challenge packet ${challengePacketId} not found`);
  }

  const packet = JSON.parse(packetRow.packet_json) as {
    id: string;
    demands?: PacketDemandInput[];
  };
  const demands = (packet.demands ?? []).map((demand, index): DemandInput => ({
    id: demand.id ?? `demand-${index + 1}`,
    narrative: demand.narrative ?? demand.id ?? `Demand ${index + 1}`,
    weight: typeof demand.weight === 'number' && Number.isFinite(demand.weight)
      ? demand.weight
      : 1,
    concepts: Array.isArray(demand.concepts)
      ? demand.concepts
      : Array.isArray(demand.conceptKeys)
        ? demand.conceptKeys
        : [],
  }));

  let evidence: EvidenceRow[] = [];
  if (wpResult) {
    const rows = await db.prepare(
      `SELECT
         sa.id AS assertion_id,
         sa.narrative,
         c.canonical_key AS concept_key,
         se.strength,
         se.evidence_level,
         sa.observed_at,
         NULL AS exact_text,
         i.interaction_type
       FROM semantic_assertions sa
       LEFT JOIN assertion_concepts ac ON ac.assertion_id = sa.id
       LEFT JOIN concepts c ON c.id = ac.concept_id
       LEFT JOIN signal_evidence se ON se.assertion_id = sa.id
       LEFT JOIN interactions i ON i.id = se.interaction_id
       WHERE sa.workspace_person_id = ?
       ORDER BY sa.observed_at DESC`,
    ).bind(wpResult.id).all<EvidenceRow>();

    evidence = rows.results ?? [];
  }

  const result = scoreMatchConfidence(evidence, demands, options);

  return {
    candidateId,
    workspacePersonId: wpResult?.id ?? null,
    challengeId: challengePacketId,
    compositeScore: result.compositeScore,
    compositeLevel: result.compositeLevel,
    dimensions: result.dimensions,
    demands: result.demands,
    stretchAreas: result.stretchAreas,
    strongMatches: result.strongMatches,
    recommendations: result.recommendations,
    computedAt: now.toISOString(),
  };
}
