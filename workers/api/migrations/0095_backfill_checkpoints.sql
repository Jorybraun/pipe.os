-- Backfill checkpoint tracking for idempotent, restartable backfills.
-- Acceptance criterion #8: deterministic, idempotent backfills.

CREATE TABLE IF NOT EXISTS backfill_checkpoints (
  backfill_name     TEXT PRIMARY KEY,
  last_processed_id TEXT NOT NULL DEFAULT '',
  processed_count   INTEGER NOT NULL DEFAULT 0,
  total_count       INTEGER,
  status            TEXT NOT NULL DEFAULT 'running'
                    CHECK (status IN ('running', 'completed', 'failed', 'paused')),
  started_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
  completed_at      TEXT,
  metadata_json     TEXT
);
