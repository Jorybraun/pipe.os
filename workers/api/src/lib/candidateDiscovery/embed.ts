/**
 * Embeds a candidate_searchable_profile with bge-large-en-v1.5 and upserts
 * the vector into the CANDIDATE_INDEX Vectorize index as `candidate_{id}`.
 *
 * Symmetric with the repo-side embedding in `routes/cockpit/adminRepos.ts`
 * (vectorizeAndMark) and the role-side embedding in `lib/roleDiscovery/embedRole.ts`.
 * Profile text goes in as a DOCUMENT — the BGE query-side instruction prefix
 * is added by the consumer at query time, not at index time.
 *
 * Returns { embedded: true, embeddedAt } on success. Throws on unrecoverable
 * errors (bad vector shape, upsert failure) — the caller is expected to
 * wrap this in a try/catch and route failures through markIngestionFailed.
 */

import { preprocessForEmbedding, EMBEDDING_MODEL_VERSION } from '../embedding/preprocess';
import { retryWithBackoff } from '../ai/retryHelper';

export interface EmbedCandidateInput {
  ai: Ai;
  vectorize: VectorizeIndex;
  candidateId: string;
  profile: string;
  /** Optional metadata to attach to the vector — kept small (Vectorize metadata limits). */
  metadata?: Record<string, string | number | boolean>;
  /** Optional D1 database for persisting the embedding and model version stamp. */
  db?: D1Database;
}

export interface EmbedCandidateResult {
  embeddedAt: string;
  vectorDim: number;
  /** The raw embedding vector (also persisted to D1 as ground truth). */
  vector: number[];
  /** Version stamp of the embedding model that produced this vector. */
  modelVersion: string;
}

const BGE_MODEL = '@cf/baai/bge-large-en-v1.5';
const EXPECTED_DIM = 1024;

export async function embedAndUpsertCandidate(
  input: EmbedCandidateInput,
): Promise<EmbedCandidateResult> {
  const { ai, vectorize, candidateId, profile, metadata, db } = input;

  if (!profile || profile.trim().length === 0) {
    throw new Error(`[candidateEmbed] empty profile for candidate ${candidateId}`);
  }

  const normalized = preprocessForEmbedding(profile, 'document');

  const embedResult = await retryWithBackoff(
    async () =>
      ai.run(BGE_MODEL, {
        text: [normalized],
      }) as Promise<{ data?: number[][] }>,
    {
      maxRetries: 3,
      baseDelayMs: 1000,
      onRetry: (attempt, delay) =>
        console.warn(`[candidateEmbed] retry ${attempt} after ${delay}ms`),
    },
  );

  const vector = embedResult?.data?.[0];
  if (!vector || !Array.isArray(vector)) {
    throw new Error(
      `[candidateEmbed] embed returned no vector for candidate ${candidateId}; shape=${JSON.stringify(embedResult).slice(0, 300)}`,
    );
  }
  if (vector.length !== EXPECTED_DIM) {
    throw new Error(
      `[candidateEmbed] wrong dim for candidate ${candidateId}: got ${vector.length}, expected ${EXPECTED_DIM}`,
    );
  }
  if (vector.some((n) => !Number.isFinite(n))) {
    throw new Error(`[candidateEmbed] non-finite values for candidate ${candidateId}`);
  }

  await vectorize.upsert([
    {
      id: `candidate_${candidateId}`,
      values: vector,
      metadata: metadata ?? {},
    },
  ]);

  const embeddedAt = new Date().toISOString();

  if (db) {
    await db
      .prepare(
        `UPDATE candidate_ingestion
           SET status = 'embedded',
               profile_embedded_at = ?,
               embedding_json = ?,
               error_text = NULL,
               updated_at = ?,
               embedding_model_version = ?
         WHERE candidate_id = ?`,
      )
      .bind(embeddedAt, JSON.stringify(vector), embeddedAt, EMBEDDING_MODEL_VERSION, candidateId)
      .run();
  }

  return {
    embeddedAt,
    vectorDim: vector.length,
    vector,
    modelVersion: EMBEDDING_MODEL_VERSION,
  };
}

export interface UpsertCandidateVectorInput {
  vectorize: VectorizeIndex;
  candidateId: string;
  vector: number[];
  /** Optional metadata to attach to the vector. */
  metadata?: Record<string, string | number | boolean>;
  /** Optional D1 database for persisting the embedding. */
  db?: D1Database;
}

/**
 * Upsert a pre-computed candidate vector into CANDIDATE_INDEX.
 * Used when the aggregate embedding is computed from sub-element vectors
 * rather than generated from prose.
 */
export async function upsertCandidateVector(
  input: UpsertCandidateVectorInput,
): Promise<EmbedCandidateResult> {
  const { vectorize, candidateId, vector, metadata, db } = input;

  if (vector.length !== EXPECTED_DIM) {
    throw new Error(
      `[candidateEmbed] wrong dim for candidate ${candidateId}: got ${vector.length}, expected ${EXPECTED_DIM}`,
    );
  }
  if (vector.some((n) => !Number.isFinite(n))) {
    throw new Error(`[candidateEmbed] non-finite values for candidate ${candidateId}`);
  }

  await vectorize.upsert([
    {
      id: `candidate_${candidateId}`,
      values: vector,
      metadata: metadata ?? {},
    },
  ]);

  const embeddedAt = new Date().toISOString();

  if (db) {
    await db
      .prepare(
        `UPDATE candidate_ingestion
           SET status = 'embedded',
               profile_embedded_at = ?,
               embedding_json = ?,
               error_text = NULL,
               updated_at = ?,
               embedding_model_version = ?
         WHERE candidate_id = ?`,
      )
      .bind(embeddedAt, JSON.stringify(vector), embeddedAt, EMBEDDING_MODEL_VERSION, candidateId)
      .run();
  }

  return {
    embeddedAt,
    vectorDim: vector.length,
    vector,
    modelVersion: EMBEDDING_MODEL_VERSION,
  };
}
