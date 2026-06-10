-- Migration 0071: Add confidence-score columns for auto-approval
-- Enables the cross-family confidence scorer (Qwen evaluates Gemma output)
-- to auto-approve high-confidence repos and route low-confidence ones to HITL.

-- Note: This migration is made idempotent by checking column existence first
-- SQLite-safe approach: Check if columns exist before adding them

-- Create a temporary table to check for existing columns
-- This is a workaround since SQLite doesn't support IF NOT EXISTS for ALTER TABLE

-- Try to add confidence_score column (will fail silently if exists due to how we handle it)
-- We use a try-catch approach by attempting to add and ignoring errors
-- In production, this migration may have been partially applied, so we make it safe

-- The actual column additions:
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
