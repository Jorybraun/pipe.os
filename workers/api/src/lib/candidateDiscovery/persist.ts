/**
 * Persistence helpers for the Candidate Discovery pipeline.
 *
 * Writes to `candidate_ingestion` (migration 0038). The pipeline progresses
 * the row through four states:
 *
 *   pending            — default after row creation
 *   profile_generated  — Candidate Discovery agent produced a searchable profile
 *   embedded           — profile vector upserted into CANDIDATE_INDEX Vectorize
 *   matched            — matchReposForCandidate resolved matched_repo_id and
 *                        wrote candidate_challenge_assignment rows
 *   failed             — any step raised; error_text holds the reason
 *
 * Each transition is idempotent — upsert semantics via ON CONFLICT on
 * candidate_id.
 */

import type { CandidateDiscoveryResult } from './agent';

export type CandidateIngestionStatus =
  | 'pending'
  | 'profile_generated'
  | 'embedded'
  | 'matched'
  | 'failed';

function nowIso(): string {
  return new Date().toISOString();
}

export async function upsertPendingIngestion(
  db: D1Database,
  candidateId: string,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO candidate_ingestion (candidate_id, status, created_at, updated_at)
       VALUES (?1, 'pending', ?2, ?2)
       ON CONFLICT(candidate_id) DO UPDATE SET
         status = 'pending',
         error_text = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(candidateId, now)
    .run();
}

export async function persistCandidateProfile(
  db: D1Database,
  candidateId: string,
  result: CandidateDiscoveryResult,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO candidate_ingestion (
         candidate_id, status, candidate_searchable_profile, key_concepts_json,
         career_context_json, situation_signature_json,
         profile_version, model_used, profile_generated_at,
         created_at, updated_at
       ) VALUES (?1, 'profile_generated', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8, ?8)
       ON CONFLICT(candidate_id) DO UPDATE SET
         status = 'profile_generated',
         candidate_searchable_profile = excluded.candidate_searchable_profile,
         key_concepts_json = excluded.key_concepts_json,
         career_context_json = excluded.career_context_json,
         situation_signature_json = excluded.situation_signature_json,
         profile_version = excluded.profile_version,
         model_used = excluded.model_used,
         profile_generated_at = excluded.profile_generated_at,
         error_text = NULL,
         updated_at = excluded.updated_at`,
    )
    .bind(
      candidateId,
      result.candidateSearchableProfile,
      JSON.stringify(result.keyConcepts),
      JSON.stringify(result.careerContext),
      JSON.stringify(result.situationSignature),
      result.profileVersion,
      result.modelUsed,
      now,
    )
    .run();
}

export interface MarkIngestionMatchedInput {
  candidateId: string;
  matchedRepoId: number;
  triangulatedScore?: number | undefined;
  dimensionsJson?: string | undefined;
  reasoningJson?: string | undefined;
  matchPhilosophy?: string | undefined;
}

export async function markIngestionMatched(
  db: D1Database,
  input: MarkIngestionMatchedInput,
): Promise<void> {
  const now = nowIso();
  const {
    candidateId,
    matchedRepoId,
    triangulatedScore,
    dimensionsJson,
    reasoningJson,
    matchPhilosophy,
  } = input;

  await db
    .prepare(
      `UPDATE candidate_ingestion
         SET status = 'matched',
             matched_repo_id = ?2,
             matched_at = ?3,
             triangulated_score = ?4,
             dimensions_json = ?5,
             reasoning_json = ?6,
             match_philosophy = ?7,
             error_text = NULL,
             updated_at = ?3
       WHERE candidate_id = ?1`,
    )
    .bind(
      candidateId,
      matchedRepoId,
      now,
      triangulatedScore ?? null,
      dimensionsJson ?? null,
      reasoningJson ?? null,
      matchPhilosophy ?? null,
    )
    .run();
}

export interface CandidateChallengeAssignmentInput {
  id: string;
  candidateId: string;
  stageId: string;
  challengeId: string;
  repoId: number;
  githubRepoUrl: string;
  githubPrNumber: number | null;
  issueNumber: number | null;
}

/**
 * Upsert a per-candidate challenge override. UNIQUE (candidate_id, stage_id)
 * — re-running ingestion for the same candidate cleanly replaces the prior
 * assignment for each stage.
 */
export async function upsertCandidateChallengeAssignment(
  db: D1Database,
  row: CandidateChallengeAssignmentInput,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO candidate_challenge_assignment
         (id, candidate_id, stage_id, challenge_id, repo_id, github_repo_url, github_pr_number, issue_number)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
       ON CONFLICT(candidate_id, stage_id) DO UPDATE SET
         challenge_id = excluded.challenge_id,
         repo_id = excluded.repo_id,
         github_repo_url = excluded.github_repo_url,
         github_pr_number = excluded.github_pr_number,
         issue_number = excluded.issue_number,
         assigned_at = (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
    )
    .bind(
      row.id,
      row.candidateId,
      row.stageId,
      row.challengeId,
      row.repoId,
      row.githubRepoUrl,
      row.githubPrNumber,
      row.issueNumber,
    )
    .run();
}

export async function markIngestionEmbedded(
  db: D1Database,
  candidateId: string,
  embeddedAt: string,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `UPDATE candidate_ingestion
         SET status = 'embedded',
             profile_embedded_at = ?2,
             error_text = NULL,
             updated_at = ?3
       WHERE candidate_id = ?1`,
    )
    .bind(candidateId, embeddedAt, now)
    .run();
}

export async function markIngestionFailed(
  db: D1Database,
  candidateId: string,
  errorText: string,
): Promise<void> {
  const now = nowIso();
  await db
    .prepare(
      `INSERT INTO candidate_ingestion (candidate_id, status, error_text, created_at, updated_at)
       VALUES (?1, 'failed', ?2, ?3, ?3)
       ON CONFLICT(candidate_id) DO UPDATE SET
         status = 'failed',
         error_text = excluded.error_text,
         updated_at = excluded.updated_at`,
    )
    .bind(candidateId, errorText.slice(0, 2000), now)
    .run();
}
