-- Frozen expert-label corpora and deterministic matching evaluation results.

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS evaluation_corpora (
  corpus_id TEXT PRIMARY KEY,
  schema_version TEXT NOT NULL,
  corpus_hash TEXT NOT NULL UNIQUE,
  corpus_json TEXT NOT NULL,
  expert_label_count INTEGER NOT NULL CHECK(expert_label_count >= 0),
  synthetic_fixture_count INTEGER NOT NULL CHECK(synthetic_fixture_count >= 0),
  frozen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TRIGGER IF NOT EXISTS evaluation_corpora_no_update
BEFORE UPDATE ON evaluation_corpora
BEGIN
  SELECT RAISE(ABORT, 'evaluation corpora are frozen');
END;

CREATE TRIGGER IF NOT EXISTS evaluation_corpora_no_delete
BEFORE DELETE ON evaluation_corpora
BEGIN
  SELECT RAISE(ABORT, 'evaluation corpora are frozen');
END;

CREATE TABLE IF NOT EXISTS evaluation_results (
  id TEXT PRIMARY KEY,
  corpus_id TEXT NOT NULL REFERENCES evaluation_corpora(corpus_id) ON DELETE RESTRICT,
  match_run_ids_json TEXT NOT NULL,
  comparison_match_run_ids_json TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  result_json TEXT NOT NULL,
  passed INTEGER NOT NULL CHECK(passed IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_evaluation_results_corpus_created
  ON evaluation_results(corpus_id, created_at DESC);
