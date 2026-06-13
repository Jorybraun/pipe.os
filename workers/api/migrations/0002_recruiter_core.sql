-- Phase 2: Recruiter Core — Stage + Challenge extensions
-- Adds columns to existing tables and creates new tables.
-- SQLite only supports ADD COLUMN in ALTER TABLE; no DROP/RENAME.
-- Idempotent: every statement uses IF NOT EXISTS where possible.

-- ── Extend stages table ──────────────────────────────────────────────────────
-- Use a single-column approach; SQLite requires one ADD COLUMN per statement.

ALTER TABLE stages ADD COLUMN owner_id TEXT;
ALTER TABLE stages ADD COLUMN notification_templates TEXT;
ALTER TABLE stages ADD COLUMN video_config TEXT;
ALTER TABLE stages ADD COLUMN scheduling_event_type_id TEXT;

-- Backfill owner_id from the owning pipeline.
UPDATE stages
SET owner_id = (
  SELECT owner_id FROM pipelines WHERE pipelines.id = stages.pipeline_id
)
WHERE owner_id IS NULL;

-- ── Extend challenges table ──────────────────────────────────────────────────
ALTER TABLE challenges ADD COLUMN owner_id TEXT;
ALTER TABLE challenges ADD COLUMN github_repo_url TEXT;
ALTER TABLE challenges ADD COLUMN github_pr_number INTEGER;
ALTER TABLE challenges ADD COLUMN github_pr_title TEXT;
ALTER TABLE challenges ADD COLUMN github_pr_description TEXT;
ALTER TABLE challenges ADD COLUMN cached_diff_json TEXT;
ALTER TABLE challenges ADD COLUMN cached_metadata TEXT;
ALTER TABLE challenges ADD COLUMN diff_cached_at TEXT;
ALTER TABLE challenges ADD COLUMN ground_truth_annotations TEXT;
ALTER TABLE challenges ADD COLUMN ground_truth TEXT;
ALTER TABLE challenges ADD COLUMN practice_repo TEXT;
ALTER TABLE challenges ADD COLUMN pr_number INTEGER;
ALTER TABLE challenges ADD COLUMN feature_branch TEXT;
ALTER TABLE challenges ADD COLUMN base_branch TEXT;
ALTER TABLE challenges ADD COLUMN repo_s3_key TEXT;
ALTER TABLE challenges ADD COLUMN repo_version INTEGER;
ALTER TABLE challenges ADD COLUMN repo_branch TEXT;
ALTER TABLE challenges ADD COLUMN repo_base_branch TEXT;
ALTER TABLE challenges ADD COLUMN repo_metadata_s3_key TEXT;

-- Backfill owner_id for challenges via their stage → pipeline chain.
UPDATE challenges
SET owner_id = (
  SELECT p.owner_id
  FROM stages s
  JOIN pipelines p ON p.id = s.pipeline_id
  WHERE s.id = challenges.stage_id
)
WHERE owner_id IS NULL;

-- ── Candidates table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS candidates (
  id                  TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id         TEXT REFERENCES pipelines(id) ON DELETE CASCADE,
  owner_id            TEXT NOT NULL,
  name                TEXT,
  email               TEXT,
  invite_token        TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
  status              TEXT NOT NULL DEFAULT 'INVITED'
                      CHECK (status IN ('INVITED', 'IN_PROGRESS', 'COMPLETED')),
  current_stage_id    TEXT REFERENCES stages(id) ON DELETE SET NULL,
  skills              TEXT,
  years_of_experience INTEGER,
  current_role        TEXT,
  education           TEXT,
  resume_s3_key       TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_candidates_pipeline ON candidates(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_candidates_invite_token ON candidates(invite_token);

-- ── Indexes ──────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_stages_pipeline_order ON stages(pipeline_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_challenges_stage_order ON challenges(stage_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_challenges_practice_repo ON challenges(practice_repo, pr_number);
