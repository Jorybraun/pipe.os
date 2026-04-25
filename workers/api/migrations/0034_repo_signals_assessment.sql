-- Migration 0034: repo_engineering_signals AI assessment fields
--
-- Pass 3 now produces a decision-oriented assessment alongside the narrative.
-- Six new columns capture the AI's verdict on challenge-suitability, its
-- top PR picks for review material, red flags it spotted that mechanical
-- Pass 2 checks missed, its reasoning on the seniority band, and the role
-- profile the repo fits best.
--
-- Columns:
--   challenge_suitability_verdict — 'suitable' | 'hold' | 'reject' | NULL
--   challenge_suitability_reason  — 1-sentence rationale (≤ 200 chars)
--   top_pr_picks_json             — JSON array [{pr_number, why}], 1–5 entries
--   red_flags_json                — JSON array of strings, 0–6 entries
--   seniority_justification       — 2–4 sentences explaining the seniority band
--   ideal_role_match              — short role label (≤ 60 chars)
--
-- These are populated by the Pass 3 Gemma call — auto-chained after Pass 2
-- succeeds, or triggered manually via POST /repos/:id/pass3/analyze.

ALTER TABLE repo_engineering_signals ADD COLUMN challenge_suitability_verdict TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN challenge_suitability_reason  TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN top_pr_picks_json             TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN red_flags_json                TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN seniority_justification       TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN ideal_role_match              TEXT;

CREATE INDEX IF NOT EXISTS idx_signals_suitability
  ON repo_engineering_signals(challenge_suitability_verdict);
