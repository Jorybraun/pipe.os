-- Migration 0057: Fix candidate_coverage foreign key
--
-- Migration 0053 incorrectly referenced candidate_ingestion(id), but that
-- table has no `id` column — its primary key is `candidate_id`. D1 runs with
-- PRAGMA foreign_keys=OFF by default, so the broken constraint was never
-- enforced. We recreate the table with the correct reference.

CREATE TABLE candidate_coverage_new (
  candidate_id TEXT PRIMARY KEY,
  experience_coverage REAL NOT NULL DEFAULT 0.0,
  cultural_coverage REAL NOT NULL DEFAULT 0.0,
  technical_coverage REAL NOT NULL DEFAULT 0.0,
  motivation_coverage REAL NOT NULL DEFAULT 0.0,
  context_coverage REAL NOT NULL DEFAULT 0.0,
  last_probed_at INTEGER,
  next_probe_target TEXT CHECK(next_probe_target IN ('experience', 'cultural', 'technical', 'motivation', 'context')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (candidate_id) REFERENCES candidate_ingestion(candidate_id) ON DELETE CASCADE
);

INSERT INTO candidate_coverage_new SELECT * FROM candidate_coverage;

DROP TABLE candidate_coverage;
ALTER TABLE candidate_coverage_new RENAME TO candidate_coverage;

CREATE INDEX IF NOT EXISTS idx_candidate_coverage_target ON candidate_coverage(next_probe_target);
