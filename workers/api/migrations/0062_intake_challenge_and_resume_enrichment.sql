-- Migration 0062: Add INTAKE challenge type and resume enrichment source
--
-- 1. INTAKE challenge type — candidate-facing self-serve profile building
--    (resume upload, GitHub handle, LinkedIn URL)
-- 2. 'resume' source_type for enrichment_jobs — queues resume parsing + ingestion

-- ── challenges table: add INTAKE to CHECK constraint ─────────────────────────
-- SQLite does not support ALTER TABLE DROP CONSTRAINT, so we recreate.
-- We must include every column that exists at this point in the migration
-- history (0001 original + 0002 additions + 0023 + 0024).

CREATE TABLE IF NOT EXISTS challenges_new (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  stage_id      TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN (
                  'CODE_REVIEW', 'CODE_IMPLEMENTATION',
                  'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER', 'FOLLOW_UP',
                  'INTAKE', 'AGENT_INTERVIEW'
                )),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  instructions  TEXT,
  config        TEXT,
  server_config TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- columns added by 0002_recruiter_core.sql
  owner_id                   TEXT,
  github_repo_url            TEXT,
  github_pr_number           INTEGER,
  github_pr_title            TEXT,
  github_pr_description      TEXT,
  cached_diff_json           TEXT,
  cached_metadata            TEXT,
  diff_cached_at             TEXT,
  ground_truth_annotations   TEXT,
  ground_truth               TEXT,
  practice_repo              TEXT,
  pr_number                  INTEGER,
  feature_branch             TEXT,
  base_branch                TEXT,
  repo_s3_key                TEXT,
  repo_version               INTEGER,
  repo_branch                TEXT,
  repo_base_branch           TEXT,
  repo_metadata_s3_key       TEXT,
  -- columns added by 0023_dev_container_sessions.sql
  dev_container_ttl_seconds  INTEGER,
  -- columns added by 0024_challenge_dev_container.sql
  dev_container_repo_url     TEXT,
  dev_container_challenge_branch TEXT
);

INSERT INTO challenges_new (
  id, stage_id, type, sort_order, title, instructions, config, server_config,
  created_at, updated_at,
  owner_id, github_repo_url, github_pr_number, github_pr_title, github_pr_description,
  cached_diff_json, cached_metadata, diff_cached_at, ground_truth_annotations,
  ground_truth, practice_repo, pr_number, feature_branch, base_branch,
  repo_s3_key, repo_version, repo_branch, repo_base_branch, repo_metadata_s3_key,
  dev_container_ttl_seconds, dev_container_repo_url, dev_container_challenge_branch
)
SELECT
  id, stage_id, type, sort_order, title, instructions, config, server_config,
  created_at, updated_at,
  owner_id, github_repo_url, github_pr_number, github_pr_title, github_pr_description,
  cached_diff_json, cached_metadata, diff_cached_at, ground_truth_annotations,
  ground_truth, practice_repo, pr_number, feature_branch, base_branch,
  repo_s3_key, repo_version, repo_branch, repo_base_branch, repo_metadata_s3_key,
  dev_container_ttl_seconds, dev_container_repo_url, dev_container_challenge_branch
FROM challenges;

PRAGMA foreign_keys = OFF;
DROP TABLE challenges;
ALTER TABLE challenges_new RENAME TO challenges;
PRAGMA foreign_keys = ON;

CREATE INDEX idx_challenges_stage_id ON challenges(stage_id);

-- ── enrichment_jobs table: add 'resume' to source_type CHECK ─────────────────

CREATE TABLE IF NOT EXISTS enrichment_jobs_new (
  id                TEXT PRIMARY KEY,
  candidate_id      TEXT NOT NULL,
  source_type       TEXT NOT NULL CHECK(source_type IN ('github', 'url_content', 'resume')),
  source_url        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'IN_PROGRESS', 'DONE', 'FAILED', 'SKIPPED')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_attempted_at INTEGER,
  completed_at      INTEGER,
  error_text        TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO enrichment_jobs_new SELECT * FROM enrichment_jobs;

DROP TABLE enrichment_jobs;
ALTER TABLE enrichment_jobs_new RENAME TO enrichment_jobs;

CREATE INDEX idx_enrichment_jobs_candidate ON enrichment_jobs(candidate_id, status);
CREATE INDEX idx_enrichment_jobs_poll ON enrichment_jobs(status, created_at);

-- ── candidate_ingestion: add linkedin_url column ─────────────────────────────
ALTER TABLE candidate_ingestion ADD COLUMN linkedin_url TEXT;
