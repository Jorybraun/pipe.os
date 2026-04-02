-- Migration: 0005_comprehension_mode
-- Adds mode column to review_sessions to distinguish bug-finding from comprehension reviews.
-- Comprehension mode: candidate asks questions to understand a PR (no bug-finding).

ALTER TABLE review_sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'bug_finding';

CREATE INDEX IF NOT EXISTS idx_review_sessions_mode ON review_sessions(mode);
