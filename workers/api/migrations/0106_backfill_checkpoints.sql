-- 0106_backfill_checkpoints.sql
--
-- Idempotent backfill tracking. Each task records its progress so that
-- restarts resume from the last committed checkpoint rather than re-processing
-- the entire dataset. The ingestion_key column lets the living context store
-- deduplicate checkpoint rows across parallel workers.

CREATE TABLE IF NOT EXISTS backfill_checkpoints (
  id            TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  task_key      TEXT NOT NULL,
  cursor        TEXT,
  status        TEXT NOT NULL DEFAULT 'pending',
  total_items   INTEGER,
  processed     INTEGER NOT NULL DEFAULT 0,
  failed        INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  started_at    TEXT,
  completed_at  TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_backfill_checkpoints_task
  ON backfill_checkpoints(task_key, status);
