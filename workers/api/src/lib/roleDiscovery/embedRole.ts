/**
 * Embeds a role_searchable_profile with bge-large-en-v1.5 and upserts
 * the vector into the ROLE_INDEX Vectorize index as `role_{id}`.
 *
 * Symmetric with embedAndUpsertCandidate and vectorizeAndMark.
 * Profile text goes in as a DOCUMENT — no query prefix at index time.
 *
 * Returns { embedded: true, embeddedAt, vector } on success. Throws on
 * unrecoverable errors (bad vector shape, upsert failure).
 */

import { preprocessForEmbedding, EMBEDDING_MODEL_VERSION } from '../embedding/preprocess';

export interface EmbedRoleInput {
  ai: Ai;
  vectorize: VectorizeIndex;
  roleContextId: string;
  profile: string;
  /** Optional metadata to attach to the vector — kept small (Vectorize metadata limits). */
  metadata?: Record<string, string | number | boolean>;
  /** Optional D1 database for persisting the embedding and model version stamp. */
  db?: D1Database;
}

export interface EmbedRoleResult {
  embeddedAt: string;
  vectorDim: number;
  /** The raw embedding vector (also persisted to D1 as ground truth). */
  vector: number[];
  /** Version stamp of the embedding model that produced this vector. */
  modelVersion: string;
}

const BGE_MODEL = '@cf/baai/bge-large-en-v1.5';
const EXPECTED_DIM = 1024;

export async function embedAndUpsertRole(
  input: EmbedRoleInput,
): Promise<EmbedRoleResult> {
  const { ai, vectorize, roleContextId, profile, metadata, db } = input;

  if (!profile || profile.trim().length === 0) {
    throw new Error(`[roleEmbed] empty profile for role ${roleContextId}`);
  }

  const normalized = preprocessForEmbedding(profile, 'document');

  const embedResult = (await ai.run(BGE_MODEL, {
    text: [normalized],
  })) as { data?: number[][] };

  const vector = embedResult?.data?.[0];
  if (!vector || !Array.isArray(vector)) {
    throw new Error(
      `[roleEmbed] embed returned no vector for role ${roleContextId}; shape=${JSON.stringify(embedResult).slice(0, 300)}`,
    );
  }
  if (vector.length !== EXPECTED_DIM) {
    throw new Error(
      `[roleEmbed] wrong dim for role ${roleContextId}: got ${vector.length}, expected ${EXPECTED_DIM}`,
    );
  }
  if (vector.some((n) => !Number.isFinite(n))) {
    throw new Error(`[roleEmbed] non-finite values for role ${roleContextId}`);
  }

  await vectorize.upsert([
    {
      id: `role_${roleContextId}`,
      values: vector,
      metadata: metadata ?? {},
    },
  ]);

  const embeddedAt = new Date().toISOString();

  if (db) {
    await db
      .prepare(
        `UPDATE role_contexts
           SET embedding_json = ?,
               updated_at = ?,
               embedding_model_version = ?
         WHERE id = ?`,
      )
      .bind(JSON.stringify(vector), embeddedAt, EMBEDDING_MODEL_VERSION, roleContextId)
      .run();
  }

  return {
    embeddedAt,
    vectorDim: vector.length,
    vector,
    modelVersion: EMBEDDING_MODEL_VERSION,
  };
}
