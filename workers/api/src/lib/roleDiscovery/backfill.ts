import { embedAndUpsertRole } from './embedRole';
import { buildRoleSearchableProfile } from './buildRoleProfile';

export interface BackfillRoleContextRow {
  id: string;
  role_searchable_profile: string | null;
  job_description_md: string | null;
  persona_json: string | null;
  pipeline_id: string | null;
  rcd_json: string | null;
}

export interface BackfillEnv {
  DB: D1Database;
  AI: Ai;
  ROLE_INDEX: VectorizeIndex;
}

export interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
}

function now(): string {
  return new Date().toISOString();
}

export async function runBackfill(
  env: BackfillEnv | null,
  rows: BackfillRoleContextRow[],
  options: BackfillOptions,
): Promise<{ processed: number; succeeded: number; skipped: number; failed: number }> {
  const { dryRun, batchSize } = options;

  console.log(`[backfill] Starting role embedding backfill${dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`[backfill] Found ${rows.length} rows needing embedding`);

  let processed = 0;
  let succeeded = 0;
  let skipped = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);

    await Promise.all(
      batch.map(async (row) => {
        try {
          // Build or reuse profile
          let profile = row.role_searchable_profile;
          let persona: unknown = null;

          if (!profile) {
            if (row.persona_json) {
              try {
                persona = JSON.parse(row.persona_json);
              } catch {
                // ignore parse errors
              }
            }
            profile = buildRoleSearchableProfile(row.job_description_md ?? '', persona);
          }

          if (!profile || profile.trim().length < 50) {
            console.warn(`[backfill] skipping ${row.id}: profile too short`);
            skipped++;
            return;
          }

          if (dryRun) {
            console.log(`[backfill] would embed ${row.id} (${profile.slice(0, 60)}...)`);
            return;
          }

          // Persist role_searchable_profile if we just built it
          if (!row.role_searchable_profile) {
            await env!.DB.prepare(
              `UPDATE role_contexts SET role_searchable_profile = ?, updated_at = ? WHERE id = ?`,
            ).bind(profile, now(), row.id).run();
          }

          // Build metadata (only non-null values)
          const metadata: Record<string, string | number | boolean> = {};
          if (row.pipeline_id) metadata.pipeline_id = row.pipeline_id;
          if (row.rcd_json) {
            try {
              const rcd = JSON.parse(row.rcd_json) as {
                technical_context?: { seniority_band?: string };
              };
              if (rcd.technical_context?.seniority_band) {
                metadata.seniority_band = rcd.technical_context.seniority_band;
              }
            } catch {
              // ignore parse errors
            }
          }

          const result = await embedAndUpsertRole({
            ai: env!.AI,
            vectorize: env!.ROLE_INDEX,
            roleContextId: row.id,
            profile,
            metadata,
          });

          await env!.DB.prepare(
            `UPDATE role_contexts SET embedding_json = ?, updated_at = ? WHERE id = ?`,
          ).bind(JSON.stringify(result.vector), now(), row.id).run();

          succeeded++;
          console.log(`[backfill] embedded ${row.id} (dim=${result.vectorDim})`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[backfill] failed ${row.id}: ${msg}`);
          failed++;
        } finally {
          processed++;
        }
      }),
    );

    console.log(
      `[backfill] Progress: ${processed}/${rows.length} (succeeded=${succeeded}, skipped=${skipped}, failed=${failed})`,
    );
  }

  console.log(
    `[backfill] Done. processed=${processed}, succeeded=${succeeded}, skipped=${skipped}, failed=${failed}`,
  );

  return { processed, succeeded, skipped, failed };
}
