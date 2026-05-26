-- Migration 0064: Create step_duration_samples table for observability
-- Tracks per-step execution durations with automatic retention (last 500 per step)

CREATE TABLE IF NOT EXISTS step_duration_samples (
  id           TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  step_name    TEXT NOT NULL,
  duration_ms  INTEGER NOT NULL,
  candidate_id TEXT NOT NULL,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_step_dur_step_created ON step_duration_samples(step_name, created_at DESC);

-- Retention trigger: keep only the latest 500 rows per step_name
CREATE TRIGGER IF NOT EXISTS trg_trim_step_samples
AFTER INSERT ON step_duration_samples
BEGIN
  DELETE FROM step_duration_samples
  WHERE id IN (
    SELECT id FROM step_duration_samples
    WHERE step_name = NEW.step_name
    ORDER BY created_at DESC
    LIMIT -1 OFFSET 500
  );
END;
