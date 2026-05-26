-- Migration 0053: candidate_coverage — dimensional completeness view for screener and re-engagement
CREATE TABLE IF NOT EXISTS candidate_coverage (
  candidate_id TEXT PRIMARY KEY,
  experience_coverage REAL NOT NULL DEFAULT 0.0,
  cultural_coverage REAL NOT NULL DEFAULT 0.0,
  technical_coverage REAL NOT NULL DEFAULT 0.0,
  motivation_coverage REAL NOT NULL DEFAULT 0.0,
  context_coverage REAL NOT NULL DEFAULT 0.0,
  last_probed_at INTEGER,
  next_probe_target TEXT CHECK(next_probe_target IN ('experience', 'cultural', 'technical', 'motivation', 'context')),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  FOREIGN KEY (candidate_id) REFERENCES candidate_ingestion(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_candidate_coverage_target ON candidate_coverage(next_probe_target);
