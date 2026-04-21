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
         profile_version, model_used, profile_generated_at,
         created_at, updated_at
       ) VALUES (?1, 'profile_generated', ?2, ?3, ?4, ?5, ?6, ?6, ?6)
       ON CONFLICT(candidate_id) DO UPDATE SET
         status = 'profile_generated',
         candidate_searchable_profile = excluded.candidate_searchable_profile,
         key_concepts_json = excluded.key_concepts_json,
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
      result.profileVersion,
      result.modelUsed,
      now,
    )
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
