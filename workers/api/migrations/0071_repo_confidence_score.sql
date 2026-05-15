-- Migration 0071: Add confidence-score columns for auto-approval
-- Enables the cross-family confidence scorer (Qwen evaluates Gemma output)
-- to auto-approve high-confidence repos and route low-confidence ones to HITL.

ALTER TABLE repo_engineering_signals
ADD COLUMN confidence_score REAL;

ALTER TABLE repo_engineering_signals
ADD COLUMN confidence_scores_json TEXT;

ALTER TABLE repo_engineering_signals
ADD COLUMN confidence_verdict TEXT
  CHECK(confidence_verdict IN ('auto_approve','manual_review','auto_reject','not_scored'))
  DEFAULT 'not_scored';

ALTER TABLE repo_engineering_signals
ADD COLUMN confidence_scored_at INTEGER;

-- Index for backfill queries: find all repos that haven't been scored yet
CREATE INDEX IF NOT EXISTS idx_repo_signals_confidence_verdict
ON repo_engineering_signals(confidence_verdict);
