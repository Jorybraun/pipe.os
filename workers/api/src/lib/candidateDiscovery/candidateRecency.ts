/**
 * Profile recency analysis and re-engagement triggering for the living candidate graph.
 *
 * Operates on `candidate_nodes` (migration 0052) and `candidate_ingestion`
 * (migration 0038). Computes per-dimension staleness, decides whether a
 * candidate needs re-enrichment or a screener, and can queue enrichment jobs.
 */

import type {
  CoverageAspect,
  RecencyReport,
  ReEngagementPlan,
} from '../../types';

const STALENESS_THRESHOLD_MS = 365 * 24 * 60 * 60 * 1000; // 12 months
const SIX_MONTHS_MS = 180 * 24 * 60 * 60 * 1000; // 6 months

const DIMENSION_NODE_TYPES: Record<CoverageAspect, string[]> = {
  experience: ['Experience', 'Accomplishment', 'Project'],
  cultural: ['CulturalSignal'],
  technical: ['Skill', 'TechnicalDemonstration', 'Education', 'Credential'],
  motivation: ['Motivation', 'WorkingStyle', 'CareerArc'],
  context: ['Context'],
};

const ALL_DIMENSIONS: CoverageAspect[] = [
  'experience',
  'cultural',
  'technical',
  'motivation',
  'context',
];

function buildInPlaceholders(count: number): string {
  return Array.from({ length: count }, () => '?').join(', ');
}

/**
 * Analyse per-dimension recency for a candidate's living graph.
 *
 * Queries `candidate_nodes` for active (non-superseded) nodes grouped by
 * coverage aspect. Returns the latest `captured_at`, active node count, and
 * a stale flag per dimension.
 */
export async function analyzeProfileRecency(
  db: D1Database,
  candidateId: string,
): Promise<RecencyReport> {
  const now = Date.now();
  const dimensions = {} as RecencyReport['dimensions'];

  await Promise.all(
    ALL_DIMENSIONS.map(async (dim) => {
      const types = DIMENSION_NODE_TYPES[dim];
      const placeholders = buildInPlaceholders(types.length);

      const row = await db
        .prepare(
          `SELECT MAX(captured_at) AS last_captured_at, COUNT(*) AS node_count
           FROM candidate_nodes
           WHERE candidate_id = ?1
             AND node_type IN (${placeholders})
             AND superseded_at IS NULL`,
        )
        .bind(candidateId, ...types)
        .first<{
          last_captured_at: number | null;
          node_count: number;
        }>();

      const lastCapturedAt = row?.last_captured_at ?? null;
      const nodeCount = row?.node_count ?? 0;
      const staleFlag =
        lastCapturedAt !== null && lastCapturedAt < now - STALENESS_THRESHOLD_MS;

      dimensions[dim] = { lastCapturedAt, nodeCount, staleFlag };
    }),
  );

  const staleCount = ALL_DIMENSIONS.filter((d) => dimensions[d].staleFlag).length;
  const motivationStale = dimensions.motivation.staleFlag;
  const contextStale = dimensions.context.staleFlag;

  let overallStaleness: RecencyReport['overallStaleness'];
  if (staleCount >= 3 || (motivationStale && contextStale)) {
    overallStaleness = 'stale';
  } else if (staleCount >= 1) {
    overallStaleness = 'partial';
  } else {
    overallStaleness = 'fresh';
  }

  return { dimensions, overallStaleness };
}

/**
 * Check recency and candidate state, then build (and optionally execute) a
 * re-engagement plan.
 *
 * - Queues an `enrichment_jobs` row when the profile is old enough and a
 *   `github_url` is available.
 * - Logs the plan to stderr for observability.
 * - Always returns a plan; never throws for missing `enrichment_jobs` table.
 */
export async function checkAndTriggerReEngagement(
  db: D1Database,
  candidateId: string,
  newRoleId: string,
): Promise<ReEngagementPlan> {
  const recency = await analyzeProfileRecency(db, candidateId);

  const ingestionRow = await db
    .prepare(
      `SELECT last_enriched_at, github_url
       FROM candidate_ingestion
       WHERE candidate_id = ?1`,
    )
    .bind(candidateId)
    .first<{
      last_enriched_at: number | null;
      github_url: string | null;
    }>();

  const lastEnrichedAt = ingestionRow?.last_enriched_at ?? null;
  const githubUrl = ingestionRow?.github_url ?? null;

  const thinDimensions = ALL_DIMENSIONS.filter(
    (d) => recency.dimensions[d].staleFlag,
  );

  const needsScreener = recency.overallStaleness === 'stale';
  const needsReEnrichment =
    (lastEnrichedAt === null || lastEnrichedAt < Date.now() - SIX_MONTHS_MS) &&
    githubUrl !== null;
  const shouldRecomputeMatch = true;

  const plan: ReEngagementPlan = {
    needsReEnrichment,
    needsScreener,
    thinDimensions,
    shouldRecomputeMatch,
  };

  if (needsReEnrichment) {
    try {
      await db
        .prepare(
          `INSERT INTO enrichment_jobs (id, candidate_id, source_type, source_url, status, created_at)
           VALUES (?1, ?2, 'github', ?3, 'PENDING', unixepoch())`,
        )
        .bind(crypto.randomUUID(), candidateId, githubUrl)
        .run();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes('no such table')) {
        console.error('[reEngagement] enrichment_jobs table does not exist, skipping insert. TODO: create migration.');
      } else {
        console.error('[reEngagement] failed to insert enrichment job:', err);
        throw err;
      }
    }
  }

  console.error('[reEngagement]', {
    candidateId,
    newRoleId,
    ...plan,
  });

  return plan;
}

/**
 * Return the full trajectory (active + superseded) for a single coverage
 * dimension and compute a trend from the active nodes' confidence scores.
 */
export async function getDimensionTrajectory(
  db: D1Database,
  candidateId: string,
  dimension: CoverageAspect,
): Promise<{
  nodes: Array<{
    id: string;
    node_type: string;
    narrative_text: string;
    captured_at: number;
    confidence: number | null;
    superseded_at: number | null;
  }>;
  dimensionTrend: 'improving' | 'stable' | 'declining' | 'insufficient_data';
}> {
  const types = DIMENSION_NODE_TYPES[dimension];
  const placeholders = buildInPlaceholders(types.length);

  const { results } = await db
    .prepare(
      `SELECT id, node_type, narrative_text, captured_at, confidence, superseded_at
       FROM candidate_nodes
       WHERE candidate_id = ?1
         AND node_type IN (${placeholders})
       ORDER BY captured_at ASC`,
    )
    .bind(candidateId, ...types)
    .all<{
      id: string;
      node_type: string;
      narrative_text: string;
      captured_at: number;
      confidence: number | null;
      superseded_at: number | null;
    }>();

  const nodes = results ?? [];

  const activeNodes = nodes.filter((n) => n.superseded_at === null);

  if (activeNodes.length < 3) {
    return { nodes, dimensionTrend: 'insufficient_data' };
  }

  const firstConfidence = activeNodes[0]!.confidence;
  const lastConfidence = activeNodes[activeNodes.length - 1]!.confidence;

  if (firstConfidence === null || lastConfidence === null) {
    return { nodes, dimensionTrend: 'insufficient_data' };
  }

  let dimensionTrend: 'improving' | 'stable' | 'declining';
  if (lastConfidence > firstConfidence + 0.15) {
    dimensionTrend = 'improving';
  } else if (lastConfidence < firstConfidence - 0.15) {
    dimensionTrend = 'declining';
  } else {
    dimensionTrend = 'stable';
  }

  return { nodes, dimensionTrend };
}
