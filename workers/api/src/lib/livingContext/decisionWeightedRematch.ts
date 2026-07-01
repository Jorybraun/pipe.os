/**
 * Decision-weighted rematch — criterion #5 (evidence-based matching).
 *
 * Integrates prior recruiter accept/reject/defer decisions into the
 * rematch pipeline. When re-matching a candidate:
 *
 *   - Previously rejected challenges are excluded (the recruiter said no).
 *   - Previously accepted challenges are excluded (already assigned).
 *   - Deferred challenges remain eligible (the recruiter wants to reconsider).
 *
 * Exclusions are per-candidate: a challenge rejected for candidate A
 * remains available for candidate B.
 */

import type { D1Database } from '@cloudflare/workers-types';
import type { MatchDecisionVerdict } from './matchDecisionAudit';

export interface DecisionExclusion {
  challengeId: string;
  repoId: string;
  prNumber: number;
  verdict: MatchDecisionVerdict;
  matchRunId: string;
  decidedAt: string;
}

export interface DecisionExclusionResult {
  candidateId: string;
  excludedPacketIds: string[];
  exclusions: DecisionExclusion[];
  deferredCount: number;
  totalDecisions: number;
}

/**
 * Loads challenge packet IDs that should be excluded from future match runs
 * based on recruiter decisions. Returns both the excluded IDs and the full
 * exclusion context for diagnostics.
 */
export async function loadPriorDecisionExclusions(
  db: D1Database,
  candidateId: string,
): Promise<DecisionExclusionResult> {
  const rows = await db.prepare(
    `SELECT cr.id, cr.qualifiers_json, cr.observed_at, cr.rowid
       FROM context_records cr
      WHERE cr.scope_type = 'candidate'
        AND cr.scope_id = ?1
        AND cr.record_type = 'match_decision'
      ORDER BY cr.observed_at DESC, cr.rowid DESC`,
  ).bind(candidateId).all<{
    id: string;
    qualifiers_json: string;
    observed_at: string;
    rowid: number;
  }>();

  const results = rows.results ?? [];
  const exclusions: DecisionExclusion[] = [];
  const excludedPacketIds: string[] = [];
  let deferredCount = 0;

  // Track the latest decision per challenge to handle overrides.
  // (e.g., first rejected, then deferred on rematch = eligible.)
  // Rows arrive most-recent-first (observed_at DESC, rowid DESC),
  // so the first occurrence per challenge is the latest decision.
  const latestByChallenge = new Map<string, {
    verdict: MatchDecisionVerdict;
    observedAt: string;
    rowid: number;
  }>();

  for (const row of results) {
    const qualifiers = JSON.parse(row.qualifiers_json) as {
      verdict: MatchDecisionVerdict;
      matchRunId: string;
      challengeId: string;
      repoId: string;
      prNumber: number;
    };

    if (latestByChallenge.has(qualifiers.challengeId)) {
      continue;
    }
    latestByChallenge.set(qualifiers.challengeId, {
      verdict: qualifiers.verdict,
      observedAt: row.observed_at,
      rowid: row.rowid,
    });
  }

  for (const row of results) {
    const qualifiers = JSON.parse(row.qualifiers_json) as {
      verdict: MatchDecisionVerdict;
      matchRunId: string;
      challengeId: string;
      repoId: string;
      prNumber: number;
    };

    const latest = latestByChallenge.get(qualifiers.challengeId);
    if (!latest || latest.rowid !== row.rowid) {
      continue;
    }

    if (qualifiers.verdict === 'deferred') {
      deferredCount++;
      continue;
    }

    const exclusion: DecisionExclusion = {
      challengeId: qualifiers.challengeId,
      repoId: qualifiers.repoId,
      prNumber: qualifiers.prNumber,
      verdict: qualifiers.verdict,
      matchRunId: qualifiers.matchRunId,
      decidedAt: row.observed_at,
    };
    exclusions.push(exclusion);
    excludedPacketIds.push(qualifiers.challengeId);
  }

  return {
    candidateId,
    excludedPacketIds: [...new Set(excludedPacketIds)],
    exclusions,
    deferredCount,
    totalDecisions: results.length,
  };
}

export interface DecisionExclusionDiagnostic {
  challengeId: string;
  repoId: string;
  prNumber: number;
  reason: 'RECRUITER_REJECTED' | 'RECRUITER_PREVIOUSLY_ACCEPTED';
  decidedAt: string;
  matchRunId: string;
}

/**
 * Converts decision exclusions into challenge match exclusion diagnostics
 * for inclusion in match run results.
 */
export function buildDecisionExclusionDiagnostics(
  exclusions: DecisionExclusion[],
): DecisionExclusionDiagnostic[] {
  return exclusions.map((exclusion) => ({
    challengeId: exclusion.challengeId,
    repoId: exclusion.repoId,
    prNumber: exclusion.prNumber,
    reason: exclusion.verdict === 'rejected'
      ? 'RECRUITER_REJECTED'
      : 'RECRUITER_PREVIOUSLY_ACCEPTED',
    decidedAt: exclusion.decidedAt,
    matchRunId: exclusion.matchRunId,
  }));
}
