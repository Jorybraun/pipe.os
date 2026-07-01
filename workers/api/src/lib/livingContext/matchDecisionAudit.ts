/**
 * Match Decision Audit Trail — criterion #2 (preserve meaning), #5 (evidence-based), #8 (production quality).
 *
 * Records recruiter accept/reject/defer decisions on match suggestions as
 * source-backed context records in the living context graph. Decisions become
 * evidence that future match runs can reference: "recruiter previously accepted
 * challenge X for this candidate" or "recruiter rejected Y citing evidence gap".
 *
 * Each decision links back to the match run, the challenge, and optionally
 * the specific evidence alignments the recruiter referenced in their reasoning.
 */

import type { D1Database } from '@cloudflare/workers-types';
import { LivingContextStore, deterministicEntityId } from './persistence';
import type { ContextRecordInput, ContextRecordSourceInput, JsonObject } from './types';

export type MatchDecisionVerdict = 'accepted' | 'rejected' | 'deferred';

export interface MatchDecisionInput {
  candidateId: string;
  matchRunId: string;
  challengeId: string;
  repoId: string;
  prNumber: number;
  verdict: MatchDecisionVerdict;
  reason?: string;
  /** IDs of specific alignments the recruiter cited */
  citedAlignmentIds?: string[];
  /** Free-form recruiter notes */
  notes?: string;
  /** Recruiter user ID (set by route from auth context) */
  recruiterId: string;
}

export interface MatchDecisionResult {
  success: boolean;
  decisionId: string;
  contextRecordId: string;
  candidateId: string;
  matchRunId: string;
  challengeId: string;
  verdict: MatchDecisionVerdict;
  recordedAt: string;
}

export interface MatchDecisionHistoryEntry {
  decisionId: string;
  matchRunId: string;
  challengeId: string;
  repoId: string;
  prNumber: number;
  verdict: MatchDecisionVerdict;
  reason: string | null;
  notes: string | null;
  recruiterId: string;
  recordedAt: string;
}

export interface MatchDecisionHistory {
  candidateId: string;
  decisions: MatchDecisionHistoryEntry[];
  totalDecisions: number;
  acceptedCount: number;
  rejectedCount: number;
  deferredCount: number;
}

/**
 * Records a recruiter's accept/reject/defer decision on a match suggestion.
 * Creates an immutable context record with source refs linking to the match run.
 */
export async function recordMatchDecision(
  db: D1Database,
  input: MatchDecisionInput,
): Promise<MatchDecisionResult> {
  const store = new LivingContextStore(db);
  const now = new Date().toISOString();

  const decisionId = await deterministicEntityId(
    'match_decision',
    `${input.candidateId}:${input.matchRunId}:${input.challengeId}:${input.verdict}`,
  );

  // Resolve workspace person for the candidate
  const wp = await db.prepare(
    `SELECT wp.id
       FROM applications app
       JOIN workspace_people wp ON wp.id = app.workspace_person_id
      WHERE app.legacy_candidate_id = ?1
      LIMIT 1`,
  ).bind(input.candidateId).first<{ id: string }>();

  const workspacePersonId = wp?.id ?? null;

  // Build source refs linking to the match run and challenge
  const sources: ContextRecordSourceInput[] = [
    {
      sourceRefType: 'match_run',
      sourceRefId: input.matchRunId,
      evidenceRole: 'decision_subject',
      locator: {
        matchRunId: input.matchRunId,
        challengeId: input.challengeId,
        repoId: input.repoId,
        prNumber: input.prNumber,
      } as JsonObject,
      exactText: `Match run ${input.matchRunId} challenge ${input.challengeId} (${input.repoId}#${input.prNumber})`,
      contentHash: await deterministicEntityId('match_decision_ref', `${input.matchRunId}:${input.challengeId}`),
    },
  ];

  // Add cited alignment refs if the recruiter referenced specific alignments
  if (input.citedAlignmentIds && input.citedAlignmentIds.length > 0) {
    for (const alignmentId of input.citedAlignmentIds) {
      sources.push({
        sourceRefType: 'match_alignment',
        sourceRefId: alignmentId,
        evidenceRole: 'cited_evidence',
        locator: { alignmentId, matchRunId: input.matchRunId } as JsonObject,
        exactText: `Cited alignment ${alignmentId}`,
        contentHash: await deterministicEntityId('alignment_ref', `${input.matchRunId}:${alignmentId}`),
      });
    }
  }

  const narrative = buildDecisionNarrative(input);

  const contextRecord: ContextRecordInput = {
    ingestionKey: decisionId,
    scopeType: 'candidate',
    scopeId: input.candidateId,
    workspacePersonId,
    recordType: 'match_decision',
    predicate: `recruiter_${input.verdict}_match`,
    narrative,
    qualifiers: {
      verdict: input.verdict,
      matchRunId: input.matchRunId,
      challengeId: input.challengeId,
      repoId: input.repoId,
      prNumber: input.prNumber,
      recruiterId: input.recruiterId,
      ...(input.reason ? { reason: input.reason } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    } as JsonObject,
    confidence: 1.0,
    polarity: input.verdict === 'accepted' ? 1 : input.verdict === 'rejected' ? -1 : 0,
    observedAt: now,
    sources,
  };

  const persisted = await store.upsertContextRecord(contextRecord);

  return {
    success: true,
    decisionId,
    contextRecordId: persisted.id,
    candidateId: input.candidateId,
    matchRunId: input.matchRunId,
    challengeId: input.challengeId,
    verdict: input.verdict,
    recordedAt: now,
  };
}

/**
 * Loads the match decision history for a candidate, ordered most-recent-first.
 */
export async function loadMatchDecisionHistory(
  db: D1Database,
  candidateId: string,
  limit: number = 50,
): Promise<MatchDecisionHistory> {
  const rows = await db.prepare(
    `SELECT cr.id, cr.predicate, cr.narrative, cr.qualifiers_json, cr.observed_at
       FROM context_records cr
      WHERE cr.scope_type = 'candidate'
        AND cr.scope_id = ?1
        AND cr.record_type = 'match_decision'
      ORDER BY cr.observed_at DESC
      LIMIT ?2`,
  ).bind(candidateId, limit).all<{
    id: string;
    predicate: string;
    narrative: string;
    qualifiers_json: string;
    observed_at: string;
  }>();

  const decisions: MatchDecisionHistoryEntry[] = (rows.results ?? []).map((row) => {
    const qualifiers = JSON.parse(row.qualifiers_json) as {
      verdict: MatchDecisionVerdict;
      matchRunId: string;
      challengeId: string;
      repoId: string;
      prNumber: number;
      recruiterId: string;
      reason?: string;
      notes?: string;
    };
    return {
      decisionId: row.id,
      matchRunId: qualifiers.matchRunId,
      challengeId: qualifiers.challengeId,
      repoId: qualifiers.repoId,
      prNumber: qualifiers.prNumber,
      verdict: qualifiers.verdict,
      reason: qualifiers.reason ?? null,
      notes: qualifiers.notes ?? null,
      recruiterId: qualifiers.recruiterId,
      recordedAt: row.observed_at,
    };
  });

  const acceptedCount = decisions.filter((d) => d.verdict === 'accepted').length;
  const rejectedCount = decisions.filter((d) => d.verdict === 'rejected').length;
  const deferredCount = decisions.filter((d) => d.verdict === 'deferred').length;

  return {
    candidateId,
    decisions,
    totalDecisions: decisions.length,
    acceptedCount,
    rejectedCount,
    deferredCount,
  };
}

function buildDecisionNarrative(input: MatchDecisionInput): string {
  const action = input.verdict === 'accepted'
    ? 'accepted'
    : input.verdict === 'rejected'
      ? 'rejected'
      : 'deferred decision on';

  const base = `Recruiter ${action} match to ${input.repoId}#${input.prNumber} (challenge ${input.challengeId})`;
  if (input.reason) {
    return `${base}. Reason: ${input.reason}`;
  }
  return base;
}
