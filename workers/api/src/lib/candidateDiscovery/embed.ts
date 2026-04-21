/**
 * Embeds a candidate_searchable_profile with bge-large-en-v1.5 and upserts
 * the vector into the CANDIDATE_INDEX Vectorize index as `candidate_{id}`.
 *
 * Symmetric with the repo-side embedding in `routes/cockpit/adminRepos.ts`
 * (vectorizeAndMark). Profile text goes in as a DOCUMENT — the BGE query-
 * side instruction prefix is added by the consumer (matchReposForCandidate)
 * at query time, not at index time. This matches the repo index.
 *
 * Returns { embedded: true, embeddedAt } on success. Throws on unrecoverable
 * errors (bad vector shape, upsert failure) — the caller is expected to
 * wrap this in a try/catch and route failures through markIngestionFailed.
 */

export interface EmbedCandidateInput {
  ai: Ai;
  vectorize: VectorizeIndex;
  candidateId: string;
  profile: string;
  /** Optional metadata to attach to the vector — kept small (Vectorize metadata limits). */
  metadata?: Record<string, string | number | boolean>;
}

export interface EmbedCandidateResult {
  embeddedAt: string;
  vectorDim: number;
}

const BGE_MODEL = '@cf/baai/bge-large-en-v1.5';
const EXPECTED_DIM = 1024;

export async function embedAndUpsertCandidate(
  input: EmbedCandidateInput,
): Promise<EmbedCandidateResult> {
  const { ai, vectorize, candidateId, profile, metadata } = input;

  if (!profile || profile.trim().length === 0) {
    throw new Error(`[candidateEmbed] empty profile for candidate ${candidateId}`);
  }

  const embedResult = (await ai.run(BGE_MODEL, {
    text: [profile],
  })) as { data?: number[][] };

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

  return {
    embeddedAt: new Date().toISOString(),
    vectorDim: vector.length,
  };
}
