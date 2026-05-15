/**
 * shadowRead.ts — Parallel D1 + Neo4j matching execution with divergence logging.
 *
 * When SHADOW_READ_NEO4J='true', every role→candidate matching query runs
 * against both stores. The D1 result is served to the caller; Neo4j is
 * computed in parallel and compared.
 *
 * Divergence metrics:
 *   - top10Overlap: intersection size of top-10 candidate IDs [0-10]
 *   - scoreDeviation: average absolute difference of normalized scores
 *
 * Neo4j failures are logged but never surfaced to the user.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../../types';

import type { MatchRouterInput, UnifiedCandidateMatch } from './matchRouter';
import { matchViaD1, matchViaNeo4j } from './matchRouter';

export interface ShadowDivergenceEvent {
  timestamp: number;
  roleContextIdHash: string;
  top10Overlap: number;
  scoreDeviation: number;
  d1Top10: string[];
  neo4jTop10: string[];
  d1Count: number;
  neo4jCount: number;
  neo4jError?: string;
}

export interface ShadowReadResult {
  /** Results served to caller (always from D1 during shadow phase) */
  results: UnifiedCandidateMatch[];
  servedFrom: 'd1';
  /** Divergence metrics if both paths produced results */
  divergence: ShadowDivergenceEvent | null;
  d1LatencyMs: number;
  neo4jLatencyMs: number;
}

// In-memory ring buffer for recent divergence events (per-worker isolate).
// In production, Workers are ephemeral — structured JSON logs are the
// persistent source of truth. This buffer is for the parity dashboard.
const MAX_BUFFER_SIZE = 100;
const divergenceBuffer: ShadowDivergenceEvent[] = [];

/**
 * Execute matching against both D1 and Neo4j in parallel.
 * Serves D1 result; logs divergence metrics.
 *
 * @returns ShadowReadResult with divergence telemetry.
 */
export async function shadowMatchRead(
  input: MatchRouterInput,
): Promise<ShadowReadResult> {
  const { roleContextId, db, env, limit = 20, ownerId } = input;

  // Run D1 path
  const d1Start = Date.now();
  const d1Promise = matchViaD1({ roleContextId, db, env, limit, ownerId })
    .then((results) => ({ results, error: null as string | null }))
    .catch((err) => ({
      results: [] as UnifiedCandidateMatch[],
      error: err instanceof Error ? err.message : String(err),
    }));

  // Run Neo4j path
  const neo4jStart = Date.now();
  const neo4jPromise = matchViaNeo4j({ roleContextId, db, env })
    .then((results) => ({ results, error: null as string | null }))
    .catch((err) => ({
      results: [] as UnifiedCandidateMatch[],
      error: err instanceof Error ? err.message : String(err),
    }));

  const [d1Outcome, neo4jOutcome] = await Promise.all([d1Promise, neo4jPromise]);

  const d1LatencyMs = Date.now() - d1Start;
  const neo4jLatencyMs = Date.now() - neo4jStart;

  // If D1 failed, propagate the error — D1 is still primary during shadow.
  if (d1Outcome.error) {
    throw new Error(`D1 match failed during shadow read: ${d1Outcome.error}`);
  }

  // Log Neo4j error silently (non-blocking)
  if (neo4jOutcome.error) {
    console.error(
      JSON.stringify({
        event: 'shadow_read_neo4j_error',
        role_context_id_hash: hashRoleId(roleContextId),
        error: neo4jOutcome.error,
        d1_latency_ms: d1LatencyMs,
      }),
    );
  }

  // Compute divergence
  const divergence = computeDivergence(
    d1Outcome.results,
    neo4jOutcome.results,
    roleContextId,
    neo4jOutcome.error ?? undefined,
  );

  if (divergence) {
    divergenceBuffer.push(divergence);
    if (divergenceBuffer.length > MAX_BUFFER_SIZE) {
      divergenceBuffer.shift();
    }
    console.log(
      JSON.stringify({
        event: 'shadow_read_divergence',
        ...divergence,
        d1_latency_ms: d1LatencyMs,
        neo4j_latency_ms: neo4jLatencyMs,
      }),
    );
  }

  return {
    results: d1Outcome.results,
    servedFrom: 'd1',
    divergence,
    d1LatencyMs,
    neo4jLatencyMs,
  };
}

/**
 * Compute overlap and score deviation between D1 and Neo4j results.
 * Returns null if there is nothing to compare.
 */
function computeDivergence(
  d1Results: UnifiedCandidateMatch[],
  neo4jResults: UnifiedCandidateMatch[],
  roleContextId: string,
  neo4jError?: string,
): ShadowDivergenceEvent | null {
  if (d1Results.length === 0 && neo4jResults.length === 0) return null;

  const d1Top10 = d1Results.slice(0, 10).map((r) => r.candidateId);
  const neo4jTop10 = neo4jResults.slice(0, 10).map((r) => r.candidateId);

  const neo4jSet = new Set(neo4jTop10);
  const intersection = d1Top10.filter((id) => neo4jSet.has(id));
  const top10Overlap = intersection.length;

  // Normalize scores to [0,1] within each result set for comparison
  const d1Max = Math.max(...d1Results.map((r) => r.score), 0.0001);
  const neo4jMax = Math.max(...neo4jResults.map((r) => r.score), 0.0001);

  let totalDev = 0;
  let devCount = 0;

  for (const d1Match of d1Results) {
    const neo4jMatch = neo4jResults.find(
      (r) => r.candidateId === d1Match.candidateId,
    );
    if (neo4jMatch) {
      const d1Norm = d1Match.score / d1Max;
      const neo4jNorm = neo4jMatch.score / neo4jMax;
      totalDev += Math.abs(d1Norm - neo4jNorm);
      devCount++;
    }
  }

  const scoreDeviation = devCount > 0 ? totalDev / devCount : 0;

  return {
    timestamp: Date.now(),
    roleContextIdHash: hashRoleId(roleContextId),
    top10Overlap,
    scoreDeviation: Math.round(scoreDeviation * 10000) / 10000, // 4 decimals
    d1Top10,
    neo4jTop10,
    d1Count: d1Results.length,
    neo4jCount: neo4jResults.length,
    neo4jError,
  };
}

function hashRoleId(roleId: string): string {
  let h = 0;
  for (let i = 0; i < roleId.length; i++) {
    h = ((h << 5) - h + roleId.charCodeAt(i)) | 0;
  }
  return h.toString(16);
}

// ─── Dashboard accessors ──────────────────────────────────────────────────────

export function getRecentDivergences(limit = 10): ShadowDivergenceEvent[] {
  return divergenceBuffer.slice(-limit).reverse();
}

export function getDivergenceStats(): {
  totalReads: number;
  avgTop10Overlap: number;
  avgScoreDeviation: number;
  neo4jErrorCount: number;
  cutoverReady: boolean;
} {
  if (divergenceBuffer.length === 0) {
    return {
      totalReads: 0,
      avgTop10Overlap: 0,
      avgScoreDeviation: 0,
      neo4jErrorCount: 0,
      cutoverReady: false,
    };
  }

  const totalReads = divergenceBuffer.length;
  const overlapSum = divergenceBuffer.reduce((s, d) => s + d.top10Overlap, 0);
  const deviationSum = divergenceBuffer.reduce((s, d) => s + d.scoreDeviation, 0);
  const errorCount = divergenceBuffer.filter((d) => d.neo4jError).length;

  const avgTop10Overlap = overlapSum / totalReads;
  const avgScoreDeviation = deviationSum / totalReads;

  // Cutover readiness gate (from knowledge plan):
  // avg_top10_overlap >= 8 (80%) and avg_score_deviation < 0.05
  const cutoverReady = avgTop10Overlap >= 8 && avgScoreDeviation < 0.05;

  return {
    totalReads,
    avgTop10Overlap: Math.round(avgTop10Overlap * 100) / 100,
    avgScoreDeviation: Math.round(avgScoreDeviation * 10000) / 10000,
    neo4jErrorCount: errorCount,
    cutoverReady,
  };
}
