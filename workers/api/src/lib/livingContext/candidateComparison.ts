/**
 * Cross-candidate evidence comparison.
 *
 * Given a set of candidate IDs sharing a pipeline/role, compares their
 * evidence profiles side by side — concept coverage, evidence diversity,
 * source depth, temporal freshness, and match quality when a challenge
 * packet is available.
 *
 * Returns a structured comparison that lets recruiters see:
 *   - Who has the strongest evidence for each demand area
 *   - Where candidates overlap vs diverge in their skill profiles
 *   - Who needs more evidence collection
 *   - How source diversity differs across candidates
 */

import {
  computeDecayMultiplier,
  parseObservedAtMs,
  DEFAULT_DECAY_CONFIG,
  type TemporalDecayConfig,
} from '../challengeMatching/temporalDecay';

// ── Types ────────────────────────────────────────────────────────────────────

export interface CandidateEvidenceProfile {
  candidateId: string;
  workspacePersonId: string | null;
  candidateName: string;
  totalInteractions: number;
  totalAssertions: number;
  totalSourceSpans: number;
  sourceDiversity: number;
  interactionBreakdown: Record<string, number>;
  topConcepts: ConceptEvidence[];
  latestInteractionAt: string | null;
  freshestEvidenceAt: string | null;
}

export interface ConceptEvidence {
  conceptKey: string;
  label: string;
  evidenceCount: number;
  bestStrength: number;
  effectiveStrength: number;
  sources: string[];
}

export interface ConceptComparison {
  conceptKey: string;
  label: string;
  candidates: Array<{
    candidateId: string;
    evidenceCount: number;
    bestStrength: number;
    effectiveStrength: number;
    coverageLevel: 'strong' | 'partial' | 'weak' | 'none';
  }>;
}

export interface ComparisonSummary {
  totalCandidates: number;
  comparedConceptCount: number;
  sharedConceptCount: number;
  uniqueConceptsPerCandidate: Record<string, number>;
  evidenceDiversityRanking: Array<{ candidateId: string; score: number }>;
  evidenceDepthRanking: Array<{ candidateId: string; totalAssertions: number }>;
  evidenceFreshnessRanking: Array<{ candidateId: string; freshestAt: string | null }>;
}

export interface CandidateComparisonReport {
  pipelineId: string | null;
  candidateProfiles: CandidateEvidenceProfile[];
  conceptComparisons: ConceptComparison[];
  summary: ComparisonSummary;
}

// ── Loader ───────────────────────────────────────────────────────────────────

interface CandidateRow {
  id: string;
  name: string;
  workspace_person_id: string | null;
}

interface InteractionRow {
  workspace_person_id: string;
  interaction_type: string;
  cnt: number;
  latest_at: string | null;
}

interface AssertionCountRow {
  workspace_person_id: string;
  cnt: number;
}

interface SourceSpanCountRow {
  workspace_person_id: string;
  cnt: number;
}

interface ConceptRow {
  workspace_person_id: string;
  canonical_key: string;
  label: string;
  evidence_count: number;
  best_strength: number;
  latest_observed_at: string | null;
  source_types: string;
}

interface D1Database {
  prepare(query: string): D1PreparedStatement;
  batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]>;
}

interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  all<T = unknown>(): Promise<D1Result<T>>;
  first<T = unknown>(): Promise<T | null>;
}

interface D1Result<T> {
  results?: T[];
  success: boolean;
}

export async function compareCandidateEvidence(
  db: D1Database,
  candidateIds: string[],
  userId: string,
  options?: {
    pipelineId?: string;
    conceptLimit?: number;
    decayConfig?: TemporalDecayConfig;
  },
): Promise<CandidateComparisonReport> {
  const conceptLimit = options?.conceptLimit ?? 30;
  const decayConfig = options?.decayConfig ?? DEFAULT_DECAY_CONFIG;
  const now = Date.now();

  // Resolve workspace_person_ids for all candidates with ownership check
  const placeholders = candidateIds.map((_, i) => `?${i + 1}`).join(', ');
  const candidateRows = await db.prepare(
    `SELECT c.id, c.name, app.workspace_person_id
       FROM candidates c
       LEFT JOIN pipelines p ON p.id = c.pipeline_id
       LEFT JOIN applications app ON app.legacy_candidate_id = c.id
      WHERE c.id IN (${placeholders})
        AND (c.owner_id = ?${candidateIds.length + 1} OR p.owner_id = ?${candidateIds.length + 1})`,
  ).bind(...candidateIds, userId).all<CandidateRow>();

  const candidates = candidateRows.results ?? [];
  if (candidates.length === 0) {
    return {
      pipelineId: options?.pipelineId ?? null,
      candidateProfiles: [],
      conceptComparisons: [],
      summary: {
        totalCandidates: 0,
        comparedConceptCount: 0,
        sharedConceptCount: 0,
        uniqueConceptsPerCandidate: {},
        evidenceDiversityRanking: [],
        evidenceDepthRanking: [],
        evidenceFreshnessRanking: [],
      },
    };
  }

  const wpIds = candidates
    .map((c) => c.workspace_person_id)
    .filter((id): id is string => id !== null);

  // Build profiles in parallel
  const profiles: CandidateEvidenceProfile[] = [];

  if (wpIds.length > 0) {
    const wpPlaceholders = wpIds.map((_, i) => `?${i + 1}`).join(', ');

    const [interactionRows, assertionCounts, spanCounts, conceptRows] = await Promise.all([
      db.prepare(
        `SELECT workspace_person_id, interaction_type, COUNT(*) AS cnt,
                MAX(started_at) AS latest_at
           FROM interactions
          WHERE workspace_person_id IN (${wpPlaceholders})
          GROUP BY workspace_person_id, interaction_type
          ORDER BY cnt DESC`,
      ).bind(...wpIds).all<InteractionRow>(),

      db.prepare(
        `SELECT workspace_person_id, COUNT(*) AS cnt
           FROM semantic_assertions
          WHERE workspace_person_id IN (${wpPlaceholders})
          GROUP BY workspace_person_id`,
      ).bind(...wpIds).all<AssertionCountRow>(),

      db.prepare(
        `SELECT a.workspace_person_id, COUNT(DISTINCT ss.id) AS cnt
           FROM source_spans ss
           JOIN artifact_versions av ON av.id = ss.artifact_version_id
           JOIN artifacts a ON a.id = av.artifact_id
          WHERE a.workspace_person_id IN (${wpPlaceholders})
          GROUP BY a.workspace_person_id`,
      ).bind(...wpIds).all<SourceSpanCountRow>(),

      db.prepare(
        `SELECT sa.workspace_person_id,
                co.canonical_key,
                co.label,
                COUNT(DISTINCT ac.assertion_id) AS evidence_count,
                MAX(COALESCE(se.strength, sa.confidence, 0.5)) AS best_strength,
                MAX(sa.observed_at) AS latest_observed_at,
                GROUP_CONCAT(DISTINCT i.interaction_type) AS source_types
           FROM concepts co
           JOIN assertion_concepts ac ON ac.concept_id = co.id
           JOIN semantic_assertions sa ON sa.id = ac.assertion_id
           LEFT JOIN signal_evidence se ON se.assertion_id = sa.id AND se.concept_id = co.id
           LEFT JOIN episodes ep ON ep.id = sa.episode_id
           LEFT JOIN interactions i ON i.id = ep.interaction_id
          WHERE sa.workspace_person_id IN (${wpPlaceholders})
          GROUP BY sa.workspace_person_id, co.id, co.canonical_key, co.label
          ORDER BY evidence_count DESC`,
      ).bind(...wpIds).all<ConceptRow>(),
    ]);

    // Index rows by workspace_person_id
    const interactionsByWp = groupBy(interactionRows.results ?? [], (r) => r.workspace_person_id);
    const assertionsByWp = indexBy(assertionCounts.results ?? [], (r) => r.workspace_person_id);
    const spansByWp = indexBy(spanCounts.results ?? [], (r) => r.workspace_person_id);
    const conceptsByWp = groupBy(conceptRows.results ?? [], (r) => r.workspace_person_id);

    for (const cand of candidates) {
      const wpId = cand.workspace_person_id;
      if (!wpId) {
        profiles.push(emptyProfile(cand.id, cand.name));
        continue;
      }

      const interactions = interactionsByWp[wpId] ?? [];
      const breakdown: Record<string, number> = {};
      let totalInteractions = 0;
      let latestInteractionAt: string | null = null;
      for (const row of interactions) {
        breakdown[row.interaction_type] = row.cnt;
        totalInteractions += row.cnt;
        if (row.latest_at && (!latestInteractionAt || row.latest_at > latestInteractionAt)) {
          latestInteractionAt = row.latest_at;
        }
      }

      const maxSourceTypes = 6;
      const sourceDiversity = Math.min(Object.keys(breakdown).length / maxSourceTypes, 1);

      const concepts = (conceptsByWp[wpId] ?? []).slice(0, conceptLimit);
      let freshestAt: string | null = null;
      const topConcepts: ConceptEvidence[] = concepts.map((row) => {
        if (row.latest_observed_at && (!freshestAt || row.latest_observed_at > freshestAt)) {
          freshestAt = row.latest_observed_at;
        }
        const observedMs = parseObservedAtMs(row.latest_observed_at);
        const decay = observedMs !== null
          ? computeDecayMultiplier(observedMs, { ...decayConfig, referenceTimeMs: now })
          : 1.0;
        return {
          conceptKey: row.canonical_key,
          label: row.label,
          evidenceCount: row.evidence_count,
          bestStrength: row.best_strength,
          effectiveStrength: row.best_strength * decay,
          sources: row.source_types ? row.source_types.split(',') : [],
        };
      });

      profiles.push({
        candidateId: cand.id,
        workspacePersonId: wpId,
        candidateName: cand.name,
        totalInteractions,
        totalAssertions: assertionsByWp[wpId]?.cnt ?? 0,
        totalSourceSpans: spansByWp[wpId]?.cnt ?? 0,
        sourceDiversity,
        interactionBreakdown: breakdown,
        topConcepts,
        latestInteractionAt,
        freshestEvidenceAt: freshestAt,
      });
    }
  }

  // Add empty profiles for candidates without workspace identity
  for (const cand of candidates) {
    if (!cand.workspace_person_id) {
      profiles.push(emptyProfile(cand.id, cand.name));
    }
  }

  // Build concept comparisons
  const allConceptKeys = new Set<string>();
  const conceptLabelMap = new Map<string, string>();
  for (const profile of profiles) {
    for (const concept of profile.topConcepts) {
      allConceptKeys.add(concept.conceptKey);
      conceptLabelMap.set(concept.conceptKey, concept.label);
    }
  }

  const conceptComparisons: ConceptComparison[] = [];
  for (const conceptKey of allConceptKeys) {
    const label = conceptLabelMap.get(conceptKey) ?? conceptKey;
    const candidateEntries = profiles.map((profile) => {
      const evidence = profile.topConcepts.find((c) => c.conceptKey === conceptKey);
      return {
        candidateId: profile.candidateId,
        evidenceCount: evidence?.evidenceCount ?? 0,
        bestStrength: evidence?.bestStrength ?? 0,
        effectiveStrength: evidence?.effectiveStrength ?? 0,
        coverageLevel: classifyCoverage(evidence?.effectiveStrength ?? 0, evidence?.evidenceCount ?? 0),
      };
    });
    conceptComparisons.push({ conceptKey, label, candidates: candidateEntries });
  }

  // Sort by number of candidates who have evidence (shared concepts first)
  conceptComparisons.sort((a, b) => {
    const aShared = a.candidates.filter((c) => c.evidenceCount > 0).length;
    const bShared = b.candidates.filter((c) => c.evidenceCount > 0).length;
    if (bShared !== aShared) return bShared - aShared;
    const aMax = Math.max(...a.candidates.map((c) => c.effectiveStrength));
    const bMax = Math.max(...b.candidates.map((c) => c.effectiveStrength));
    return bMax - aMax;
  });

  // Summary
  const sharedConceptCount = conceptComparisons.filter(
    (cc) => cc.candidates.filter((c) => c.evidenceCount > 0).length > 1,
  ).length;

  const uniqueConceptsPerCandidate: Record<string, number> = {};
  for (const profile of profiles) {
    const uniqueCount = conceptComparisons.filter((cc) => {
      const thisCandidate = cc.candidates.find((c) => c.candidateId === profile.candidateId);
      const othersHaveIt = cc.candidates.some(
        (c) => c.candidateId !== profile.candidateId && c.evidenceCount > 0,
      );
      return (thisCandidate?.evidenceCount ?? 0) > 0 && !othersHaveIt;
    }).length;
    uniqueConceptsPerCandidate[profile.candidateId] = uniqueCount;
  }

  const evidenceDiversityRanking = [...profiles]
    .sort((a, b) => b.sourceDiversity - a.sourceDiversity)
    .map((p) => ({ candidateId: p.candidateId, score: p.sourceDiversity }));

  const evidenceDepthRanking = [...profiles]
    .sort((a, b) => b.totalAssertions - a.totalAssertions)
    .map((p) => ({ candidateId: p.candidateId, totalAssertions: p.totalAssertions }));

  const evidenceFreshnessRanking = [...profiles]
    .sort((a, b) => {
      if (!a.freshestEvidenceAt && !b.freshestEvidenceAt) return 0;
      if (!a.freshestEvidenceAt) return 1;
      if (!b.freshestEvidenceAt) return -1;
      return b.freshestEvidenceAt.localeCompare(a.freshestEvidenceAt);
    })
    .map((p) => ({ candidateId: p.candidateId, freshestAt: p.freshestEvidenceAt }));

  return {
    pipelineId: options?.pipelineId ?? null,
    candidateProfiles: profiles,
    conceptComparisons,
    summary: {
      totalCandidates: profiles.length,
      comparedConceptCount: conceptComparisons.length,
      sharedConceptCount,
      uniqueConceptsPerCandidate,
      evidenceDiversityRanking,
      evidenceDepthRanking,
      evidenceFreshnessRanking,
    },
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function classifyCoverage(
  effectiveStrength: number,
  evidenceCount: number,
): 'strong' | 'partial' | 'weak' | 'none' {
  if (evidenceCount === 0) return 'none';
  if (effectiveStrength >= 0.6 && evidenceCount >= 2) return 'strong';
  if (effectiveStrength >= 0.3) return 'partial';
  return 'weak';
}

function emptyProfile(candidateId: string, candidateName: string): CandidateEvidenceProfile {
  return {
    candidateId,
    workspacePersonId: null,
    candidateName,
    totalInteractions: 0,
    totalAssertions: 0,
    totalSourceSpans: 0,
    sourceDiversity: 0,
    interactionBreakdown: {},
    topConcepts: [],
    latestInteractionAt: null,
    freshestEvidenceAt: null,
  };
}

function groupBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const key = keyFn(item);
    if (!result[key]) result[key] = [];
    result[key].push(item);
  }
  return result;
}

function indexBy<T>(items: T[], keyFn: (item: T) => string): Record<string, T> {
  const result: Record<string, T> = {};
  for (const item of items) {
    result[keyFn(item)] = item;
  }
  return result;
}
