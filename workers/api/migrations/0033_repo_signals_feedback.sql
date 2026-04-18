-- Migration 0033: repo_engineering_signals admin feedback + ingest gate
--
-- Splits the current one-shot Pass 3 (summarise + vectorize) into an
-- analyze step and a gated ingest step. The admin reads the Gemma
-- narrative, records a verdict, and only then does the repo enter the
-- Vectorize REPO_INDEX.
--
-- Columns:
--   admin_verdict       — 'approved' | 'denied' | NULL (pending)
--   admin_feedback_text — optional free-text critique
--   verdict_at          — ISO-8601 timestamp the verdict was recorded
--   vectorized_at       — ISO-8601 timestamp the profile was upserted
--                         to REPO_INDEX. NULL until ingest runs.
--
-- These live on repo_engineering_signals (not a separate table) so that
-- (content_hash, raw_signal_json, admin_verdict, admin_feedback_text)
-- is trivially joinable for later RLHF-style training-data export.
--
-- Design rationale: STRATEGY.md Decision Log 2026-04-17 (new entry for
-- human-gated vectorization — fills research silence, does not override
-- an existing finding).

ALTER TABLE repo_engineering_signals ADD COLUMN admin_verdict       TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN admin_feedback_text TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN verdict_at          TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN vectorized_at       TEXT;

CREATE INDEX IF NOT EXISTS idx_signals_verdict
  ON repo_engineering_signals(admin_verdict);
