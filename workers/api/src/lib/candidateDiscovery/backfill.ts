import { embedAndUpsertCandidate } from './embed';

export interface BackfillCandidateRow {
  candidate_id: string;
  candidate_searchable_profile: string | null;
  key_concepts_json: string | null;
  career_context_json: string | null;
  situation_signature_json: string | null;
}

export interface BackfillEnv {
  DB: D1Database;
  AI: Ai;
  CANDIDATE_INDEX: VectorizeIndex;
}

export interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
}

function now(): string {
  return new Date().toISOString();
}

/**
 * Augment an existing flat-prose profile by appending the structured JSON
 * signals that were previously stored in separate D1 columns. This produces
 * the same text shape the v3 prompt asks the LLM to generate, so the BGE
 * embedding sees structural depth without requiring an expensive LLM re-run.
 */
export function augmentProfileWithStructuredSignals(
  profile: string,
  keyConceptsJson: string | null,
  careerContextJson: string | null,
  situationSignatureJson: string | null,
): string {
  const structured: Record<string, unknown> = {};

  if (keyConceptsJson) {
    try {
      structured.key_concepts = JSON.parse(keyConceptsJson);
    } catch {
      // ignore malformed json
    }
  }
  if (careerContextJson) {
    try {
      structured.career_context = JSON.parse(careerContextJson);
    } catch {
      // ignore malformed json
    }
  }
  if (situationSignatureJson) {
    try {
      structured.situation_signature = JSON.parse(situationSignatureJson);
    } catch {
      // ignore malformed json
    }
  }

  if (Object.keys(structured).length === 0) {
    return profile;
  }

  const jsonBlock = JSON.stringify(structured, null, 2);
  return `${profile.trim()}\n\n--- structured depth ---\n\`\`\`json\n${jsonBlock}\n\`\`\``;
}

export async function runBackfill(
  env: BackfillEnv | null,
  rows: BackfillCandidateRow[],
  options: BackfillOptions,
): Promise<{ processed: number; succeeded: number; skipped: number; failed: number }> {
  const { dryRun, batchSize } = options;

  console.log(`[backfill] Starting candidate embedding backfill${dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`[backfill] Found ${rows.length} rows needing backfill`);

  let processed = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (row) => {
        try {
          const profile = row.candidate_searchable_profile;
          if (!profile || profile.trim().length < 50) {
            console.warn(`[backfill] skipping ${row.candidate_id}: profile too short`);
            skipped++;
            return;
          }

          const augmented = augmentProfileWithStructuredSignals(
            profile,
            row.key_concepts_json,
            row.career_context_json,
            row.situation_signature_json,
          );

          if (dryRun) {
            console.log(
              `[backfill] would embed ${row.candidate_id} (${augmented.slice(0, 60)}...)`
            );
            return;
          }

          // Persist augmented text so D1 ground truth matches the vector
          await env!.DB.prepare(
            `UPDATE candidate_ingestion
                SET candidate_searchable_profile = ?,
                    updated_at = ?
              WHERE candidate_id = ?`
          )
            .bind(augmented, now(), row.candidate_id)
            .run();

          const result = await embedAndUpsertCandidate({
            ai: env!.AI,
            vectorize: env!.CANDIDATE_INDEX,
            candidateId: row.candidate_id,
            profile: augmented,
            metadata: { profile_version: 'candidate-v3' },
            db: env!.DB,
          });

          // embedAndUpsertCandidate handles the D1 UPDATE (status, embedding_json,
          // profile_embedded_at, embedding_model_version) when db is passed.
          // We only need to persist the augmented text so ground truth matches.
          await env!.DB.prepare(
            `UPDATE candidate_ingestion
                SET candidate_searchable_profile = ?,
                    updated_at = ?
              WHERE candidate_id = ?`
          )
            .bind(augmented, now(), row.candidate_id)
            .run();

          succeeded++;
          console.log(
            `[backfill] embedded ${row.candidate_id} (dim=${result.vectorDim})`
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[backfill] failed ${row.candidate_id}: ${msg}`);
          failed++;
        } finally {
          processed++;
        }
      }),
    );

    console.log(
      `[backfill] Progress: ${processed}/${rows.length} (succeeded=${succeeded}, skipped=${skipped}, failed=${failed})`
    );
  }

  console.log(
    `[backfill] Done. processed=${processed}, succeeded=${succeeded}, skipped=${skipped}, failed=${failed}`
  );

  return { processed, succeeded, skipped, failed };
}
