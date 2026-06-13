/**
 * Recency and re-engagement policy over open, persisted candidate concepts.
 * Time windows and thresholds are versioned scoring policy; concept membership
 * comes entirely from the living context graph.
 */

import type {
  CoverageAspect,
  RecencyReport,
  ReEngagementPlan,
} from '../../types';

export const CANDIDATE_RECENCY_POLICY = {
  version: 'open-concept-recency-v1',
  staleAfterDays: 365,
  staleProfileRatio: 0.5,
  reEnrichAfterDays: 180,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeRecencyMultiplier(
  nodes: { captured_at: number }[],
): number {
  if (nodes.length === 0) return 1;

  const nowSec = Math.floor(Date.now() / 1000);
  const twoYearsSec = 2 * 365 * 24 * 60 * 60;
  const fourYearsSec = 4 * 365 * 24 * 60 * 60;

  let total = 0;
  for (const node of nodes) {
    const age = nowSec - node.captured_at;
    if (age > fourYearsSec) total += 0.6;
    else if (age > twoYearsSec) total += 0.8;
    else total += 1;
  }
  return total / nodes.length;
}

export async function analyzeProfileRecency(
  db: D1Database,
  candidateId: string,
): Promise<RecencyReport> {
  const result = await db.prepare(
    `SELECT
       c.id AS concept_id,
       c.canonical_key,
       c.label,
       MAX(COALESCE(se.observed_at, sa.observed_at)) AS last_observed_at,
       COUNT(DISTINCT COALESCE(se.id, sa.id)) AS evidence_count
     FROM applications app
     JOIN workspace_people wp ON wp.id = app.workspace_person_id
     JOIN semantic_assertions sa ON sa.workspace_person_id = wp.id
     JOIN assertion_concepts ac ON ac.assertion_id = sa.id
     JOIN concepts c ON c.id = ac.concept_id
     JOIN signal_evidence se
       ON se.assertion_id = sa.id
      AND se.concept_id = c.id
     WHERE app.legacy_candidate_id = ?1
     GROUP BY c.id, c.canonical_key, c.label
     ORDER BY c.canonical_key`,
  ).bind(candidateId).all<{
    concept_id: string;
    canonical_key: string;
    label: string;
    last_observed_at: string | null;
    evidence_count: number;
  }>();

  const staleBefore = Date.now() - CANDIDATE_RECENCY_POLICY.staleAfterDays * DAY_MS;
  const dimensions: RecencyReport['dimensions'] = {};
  for (const row of result.results ?? []) {
    const observedTime = row.last_observed_at
      ? Date.parse(row.last_observed_at)
      : Number.NaN;
    dimensions[row.canonical_key] = {
      conceptId: row.concept_id,
      canonicalKey: row.canonical_key,
      label: row.label,
      lastObservedAt: row.last_observed_at,
      evidenceCount: row.evidence_count,
      staleFlag: !Number.isFinite(observedTime) || observedTime < staleBefore,
    };
  }

  const values = Object.values(dimensions);
  const staleCount = values.filter((dimension) => dimension.staleFlag).length;
  const staleRatio = values.length > 0 ? staleCount / values.length : 1;
  const overallStaleness: RecencyReport['overallStaleness'] =
    staleRatio >= CANDIDATE_RECENCY_POLICY.staleProfileRatio
      ? 'stale'
      : staleCount > 0
        ? 'partial'
        : 'fresh';

  return {
    dimensions,
    overallStaleness,
    policyVersion: CANDIDATE_RECENCY_POLICY.version,
  };
}

export async function checkAndTriggerReEngagement(
  db: D1Database,
  candidateId: string,
  newRoleId: string,
): Promise<ReEngagementPlan> {
  const recency = await analyzeProfileRecency(db, candidateId);
  const ingestionRow = await db.prepare(
    `SELECT last_enriched_at, github_url
     FROM candidate_ingestion
     WHERE candidate_id = ?1`,
  ).bind(candidateId).first<{
    last_enriched_at: number | null;
    github_url: string | null;
  }>();

  const lastEnrichedAt = ingestionRow?.last_enriched_at ?? null;
  const githubUrl = ingestionRow?.github_url ?? null;
  const thinDimensions = Object.values(recency.dimensions)
    .filter((dimension) => dimension.staleFlag)
    .map((dimension) => dimension.canonicalKey)
    .sort();
  const needsScreener = recency.overallStaleness === 'stale';
  const needsReEnrichment =
    (
      lastEnrichedAt === null
      || lastEnrichedAt
        < Date.now() - CANDIDATE_RECENCY_POLICY.reEnrichAfterDays * DAY_MS
    )
    && githubUrl !== null;

  const plan: ReEngagementPlan = {
    needsReEnrichment,
    needsScreener,
    thinDimensions,
    shouldRecomputeMatch: true,
  };

  if (needsReEnrichment) {
    try {
      await db.prepare(
        `INSERT INTO enrichment_jobs (
           id, candidate_id, source_type, source_url, status, created_at
         )
         VALUES (?1, ?2, 'github', ?3, 'PENDING', unixepoch())`,
      ).bind(crypto.randomUUID(), candidateId, githubUrl).run();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('no such table')) {
        console.error(
          '[reEngagement] enrichment_jobs table does not exist, skipping insert.',
        );
      } else {
        console.error('[reEngagement] failed to insert enrichment job:', error);
        throw error;
      }
    }
  }

  console.error('[reEngagement]', {
    candidateId,
    newRoleId,
    recencyPolicyVersion: recency.policyVersion,
    ...plan,
  });
  return plan;
}

export async function getDimensionTrajectory(
  db: D1Database,
  candidateId: string,
  dimension: CoverageAspect,
): Promise<{
  nodes: Array<{
    id: string;
    concept_id: string;
    canonical_key: string;
    narrative_text: string;
    observed_at: string | null;
    confidence: number | null;
    polarity: number;
  }>;
  dimensionTrend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
}> {
  const result = await db.prepare(
    `SELECT
       sa.id,
       c.id AS concept_id,
       c.canonical_key,
       sa.narrative AS narrative_text,
       COALESCE(se.observed_at, sa.observed_at) AS observed_at,
       COALESCE(se.strength, sa.confidence) AS confidence,
       COALESCE(se.polarity, sa.polarity) AS polarity
     FROM applications app
     JOIN workspace_people wp ON wp.id = app.workspace_person_id
     JOIN semantic_assertions sa ON sa.workspace_person_id = wp.id
     JOIN assertion_concepts ac ON ac.assertion_id = sa.id
     JOIN concepts c ON c.id = ac.concept_id
     JOIN signal_evidence se
       ON se.assertion_id = sa.id
      AND se.concept_id = c.id
     WHERE app.legacy_candidate_id = ?1
       AND (c.id = ?2 OR c.canonical_key = ?2)
     ORDER BY COALESCE(se.observed_at, sa.observed_at), sa.id`,
  ).bind(candidateId, dimension).all<{
    id: string;
    concept_id: string;
    canonical_key: string;
    narrative_text: string;
    observed_at: string | null;
    confidence: number | null;
    polarity: number;
  }>();

  const nodes = result.results ?? [];
  if (nodes.length < 3) {
    return { nodes, dimensionTrend: 'insufficient_data' };
  }

  const firstConfidence = nodes[0]!.confidence;
  const lastConfidence = nodes.at(-1)!.confidence;
  if (firstConfidence === null || lastConfidence === null) {
    return { nodes, dimensionTrend: 'insufficient_data' };
  }

  const dimensionTrend =
    lastConfidence > firstConfidence + 0.15
      ? 'improving'
      : lastConfidence < firstConfidence - 0.15
        ? 'declining'
        : 'stable';
  return { nodes, dimensionTrend };
}
