/**
 * Batch rematch — runs decision-weighted rematch across multiple candidates
 * in a single API call. Criterion #5 (evidence-based matching).
 *
 * Each candidate gets independent exclusion lists from their prior decisions.
 * Results are returned per-candidate so the recruiter can compare outcomes
 * across the pipeline.
 */

import { loadPriorDecisionExclusions } from './decisionWeightedRematch';
import type { DecisionExclusionResult } from './decisionWeightedRematch';

export interface BatchRematchCandidate {
  candidateId: string;
  workspacePersonId: string | null;
}

export interface BatchRematchResultEntry {
  candidateId: string;
  status: string;
  matchRunId: string | null;
  repoId: number | null;
  prNumber: number | null;
  evaluatedCount: number;
  topChallenge: {
    challengeId: string;
    repoId: string;
    prNumber: number;
    rank: number | null;
    alignedDemandCount: number;
    stretchCount: number;
    eligible: boolean;
  } | null;
  priorDecisions: {
    excludedCount: number;
    deferredCount: number;
    totalDecisions: number;
  } | null;
  error: string | null;
}

export interface BatchRematchResult {
  totalCandidates: number;
  processedCount: number;
  results: BatchRematchResultEntry[];
  skippedCandidateIds: string[];
}

export async function runBatchRematch(
  db: D1Database,
  candidateIds: string[],
  ownerId: string,
): Promise<BatchRematchResult> {
  const candidateRows = await loadOwnedCandidates(db, candidateIds, ownerId);
  const validCandidateMap = new Map<string, string | null>();
  for (const row of candidateRows) {
    validCandidateMap.set(row.candidate_id, row.workspace_person_id);
  }

  const skippedCandidateIds = candidateIds.filter((id) => !validCandidateMap.has(id));
  const results: BatchRematchResultEntry[] = [];

  for (const [candidateId, wpId] of validCandidateMap) {
    const entry = await rematchSingleCandidate(db, candidateId, wpId);
    results.push(entry);
  }

  return {
    totalCandidates: candidateIds.length,
    processedCount: results.length,
    results,
    skippedCandidateIds,
  };
}

async function loadOwnedCandidates(
  db: D1Database,
  candidateIds: string[],
  ownerId: string,
): Promise<Array<{ candidate_id: string; workspace_person_id: string | null }>> {
  if (candidateIds.length === 0) return [];

  const batchSize = 50;
  const allRows: Array<{ candidate_id: string; workspace_person_id: string | null }> = [];

  for (let i = 0; i < candidateIds.length; i += batchSize) {
    const batch = candidateIds.slice(i, i + batchSize);
    const placeholders = batch.map(() => '?').join(',');
    const rows = await db.prepare(
      `SELECT c.id as candidate_id, wp.id as workspace_person_id
         FROM candidates c
         LEFT JOIN pipelines p ON p.id = c.pipeline_id
         LEFT JOIN applications app ON app.legacy_candidate_id = c.id
         LEFT JOIN workspace_people wp ON wp.id = app.workspace_person_id
        WHERE c.id IN (${placeholders})
          AND (c.owner_id = ? OR p.owner_id = ?)`,
    ).bind(...batch, ownerId, ownerId).all<{
      candidate_id: string;
      workspace_person_id: string | null;
    }>();
    allRows.push(...rows.results);
  }

  return allRows;
}

async function rematchSingleCandidate(
  db: D1Database,
  candidateId: string,
  workspacePersonId: string | null,
): Promise<BatchRematchResultEntry> {
  if (!workspacePersonId) {
    return {
      candidateId,
      status: 'NEEDS_MORE_EVIDENCE',
      matchRunId: null,
      repoId: null,
      prNumber: null,
      evaluatedCount: 0,
      topChallenge: null,
      priorDecisions: null,
      error: 'Candidate has no workspace identity.',
    };
  }

  let decisionExclusions: DecisionExclusionResult;
  try {
    decisionExclusions = await loadPriorDecisionExclusions(db, candidateId);
  } catch (err) {
    return {
      candidateId,
      status: 'ERROR',
      matchRunId: null,
      repoId: null,
      prNumber: null,
      evaluatedCount: 0,
      topChallenge: null,
      priorDecisions: null,
      error: `Failed to load prior decisions: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  let match: {
    status: string;
    matchRunId: string | null;
    repoId?: number | null;
    prNumber?: number | null;
    diagnostics?: {
      evaluatedChallenges: Array<{
        challengeId: string;
        repoId: string;
        prNumber: number;
        rank: number | null;
        alignedDemandCount: number;
        stretchCount: number;
        eligible: boolean;
      }>;
    };
  };

  try {
    const { matchCandidateToReviewChallenge } = await import(
      '../../lib/challengeMatching/d1Matcher'
    );
    match = await matchCandidateToReviewChallenge(db, candidateId, {
      temporalDecay: { halfLifeDays: 90 },
      excludePacketIds: decisionExclusions.excludedPacketIds.length > 0
        ? decisionExclusions.excludedPacketIds
        : undefined,
    });
  } catch (err) {
    return {
      candidateId,
      status: 'ERROR',
      matchRunId: null,
      repoId: null,
      prNumber: null,
      evaluatedCount: 0,
      topChallenge: null,
      priorDecisions: decisionExclusions.totalDecisions > 0
        ? {
            excludedCount: decisionExclusions.excludedPacketIds.length,
            deferredCount: decisionExclusions.deferredCount,
            totalDecisions: decisionExclusions.totalDecisions,
          }
        : null,
      error: `Match failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const evaluated = match.diagnostics?.evaluatedChallenges ?? [];
  const top = evaluated.length > 0
    ? evaluated.reduce((best, cur) =>
        (cur.rank !== null && (best.rank === null || cur.rank < best.rank)) ? cur : best,
      )
    : null;

  return {
    candidateId,
    status: match.status,
    matchRunId: match.matchRunId,
    repoId: match.repoId ?? null,
    prNumber: match.prNumber ?? null,
    evaluatedCount: evaluated.length,
    topChallenge: top ? {
      challengeId: top.challengeId,
      repoId: top.repoId,
      prNumber: top.prNumber,
      rank: top.rank,
      alignedDemandCount: top.alignedDemandCount,
      stretchCount: top.stretchCount,
      eligible: top.eligible,
    } : null,
    priorDecisions: decisionExclusions.totalDecisions > 0
      ? {
          excludedCount: decisionExclusions.excludedPacketIds.length,
          deferredCount: decisionExclusions.deferredCount,
          totalDecisions: decisionExclusions.totalDecisions,
        }
      : null,
    error: null,
  };
}
