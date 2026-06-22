/**
 * Backfill checkpoint tracking for idempotent, restartable backfills.
 *
 * Each backfill operation records its progress via named checkpoints.
 * On restart, the backfill resumes from the last committed checkpoint
 * rather than reprocessing already-completed work.
 *
 * Acceptance criterion #8: deterministic, idempotent backfills.
 */

export interface BackfillCheckpoint {
  readonly backfillName: string;
  readonly lastProcessedId: string;
  readonly processedCount: number;
  readonly totalCount: number | null;
  readonly status: BackfillStatus;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
  readonly metadata: Record<string, unknown>;
}

export type BackfillStatus = 'running' | 'completed' | 'failed' | 'paused';

export async function getCheckpoint(
  db: D1Database,
  backfillName: string,
): Promise<BackfillCheckpoint | null> {
  const row = await db.prepare(
    `SELECT backfill_name, last_processed_id, processed_count, total_count,
            status, started_at, updated_at, completed_at, metadata_json
       FROM backfill_checkpoints
      WHERE backfill_name = ?1`,
  ).bind(backfillName).first<{
    backfill_name: string;
    last_processed_id: string;
    processed_count: number;
    total_count: number | null;
    status: BackfillStatus;
    started_at: string;
    updated_at: string;
    completed_at: string | null;
    metadata_json: string | null;
  }>();
  if (!row) return null;
  return {
    backfillName: row.backfill_name,
    lastProcessedId: row.last_processed_id,
    processedCount: row.processed_count,
    totalCount: row.total_count,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : {},
  };
}

export async function upsertCheckpoint(
  db: D1Database,
  backfillName: string,
  lastProcessedId: string,
  processedCount: number,
  totalCount: number | null,
  status: BackfillStatus,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const now = new Date().toISOString();
  const completedAt = status === 'completed' ? now : null;
  const metadataJson = metadata ? JSON.stringify(metadata) : null;

  await db.prepare(
    `INSERT INTO backfill_checkpoints
       (backfill_name, last_processed_id, processed_count, total_count,
        status, started_at, updated_at, completed_at, metadata_json)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8)
     ON CONFLICT (backfill_name) DO UPDATE SET
       last_processed_id = excluded.last_processed_id,
       processed_count = excluded.processed_count,
       total_count = excluded.total_count,
       status = excluded.status,
       updated_at = excluded.updated_at,
       completed_at = COALESCE(excluded.completed_at, backfill_checkpoints.completed_at),
       metadata_json = COALESCE(excluded.metadata_json, backfill_checkpoints.metadata_json)`,
  ).bind(
    backfillName,
    lastProcessedId,
    processedCount,
    totalCount,
    status,
    now,
    completedAt,
    metadataJson,
  ).run();
}

export async function resetCheckpoint(
  db: D1Database,
  backfillName: string,
): Promise<boolean> {
  const result = await db.prepare(
    `DELETE FROM backfill_checkpoints WHERE backfill_name = ?1`,
  ).bind(backfillName).run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function listCheckpoints(
  db: D1Database,
): Promise<BackfillCheckpoint[]> {
  const { results } = await db.prepare(
    `SELECT backfill_name, last_processed_id, processed_count, total_count,
            status, started_at, updated_at, completed_at, metadata_json
       FROM backfill_checkpoints
      ORDER BY updated_at DESC`,
  ).all<{
    backfill_name: string;
    last_processed_id: string;
    processed_count: number;
    total_count: number | null;
    status: BackfillStatus;
    started_at: string;
    updated_at: string;
    completed_at: string | null;
    metadata_json: string | null;
  }>();
  return (results ?? []).map((row) => ({
    backfillName: row.backfill_name,
    lastProcessedId: row.last_processed_id,
    processedCount: row.processed_count,
    totalCount: row.total_count,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : {},
  }));
}
