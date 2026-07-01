-- Migration 0112: Repair legacy D1 candidates.pipeline_id nullability.
--
-- Fresh databases already create candidates.pipeline_id as nullable. Older D1
-- databases still carry the pre-standalone-assessment NOT NULL constraint, which
-- prevents CODE_REVIEW assessment invites from creating pipeline-free candidates.

PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS candidates__pipeline_nullable;

CREATE TABLE candidates__pipeline_nullable (
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
  phone_number        TEXT,
  github_handle       TEXT,
  linkedin_url        TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO candidates__pipeline_nullable (
  id,
  pipeline_id,
  owner_id,
  name,
  email,
  invite_token,
  status,
  current_stage_id,
  skills,
  years_of_experience,
  current_role,
  education,
  resume_s3_key,
  phone_number,
  github_handle,
  linkedin_url,
  created_at,
  updated_at
)
SELECT
  id,
  pipeline_id,
  owner_id,
  name,
  email,
  invite_token,
  status,
  current_stage_id,
  skills,
  years_of_experience,
  current_role,
  education,
  resume_s3_key,
  phone_number,
  github_handle,
  linkedin_url,
  created_at,
  updated_at
FROM candidates;

DROP TABLE candidates;
ALTER TABLE candidates__pipeline_nullable RENAME TO candidates;

CREATE INDEX IF NOT EXISTS idx_candidates_pipeline ON candidates(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_candidates_invite_token ON candidates(invite_token);
CREATE INDEX IF NOT EXISTS idx_candidates_owner ON candidates(owner_id);
CREATE INDEX IF NOT EXISTS idx_candidates_owner_email ON candidates(owner_id, email);
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_pipeline_email ON candidates(pipeline_id, email);

PRAGMA foreign_keys = ON;
