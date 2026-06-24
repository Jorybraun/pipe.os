-- 0097_dev_container_challenge_interview_type.sql
--
-- HAS-80: Model interviews as person-first events with optional role/challenge
-- context. Adds 'DEV_CONTAINER_CHALLENGE' to the interview_type CHECK so a
-- recruiter can create a dev-container challenge interview for any person
-- (contact, candidate, or lead) without requiring a pipeline/role.
--
-- A DEV_CONTAINER_CHALLENGE interview attaches a source-backed repo/PR task
-- via the existing matched_repo_id / github_repo_url / github_pr_number
-- columns — no new columns are needed, only the CHECK expansion.
--
-- SQLite cannot ALTER a CHECK constraint in place, so we rebuild the table
-- following the same pattern as 0062 (challenges) and 0075
-- (scheduled_interviews). Every column from the 0075 rebuild + 0078
-- standalone-code-review additions is preserved.

CREATE TABLE IF NOT EXISTS scheduled_interviews_next (
  id TEXT PRIMARY KEY,
  candidate_id TEXT REFERENCES candidates(id),
  pipeline_id TEXT REFERENCES pipelines(id),
  stage_id TEXT REFERENCES stages(id),
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED', 'SCHEDULED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  scheduled_at TEXT,
  meeting_url TEXT,
  scheduling_provider TEXT CHECK (scheduling_provider IN ('CALENDLY', 'CAL_COM', 'MANUAL')),
  scheduling_url TEXT,
  external_event_id TEXT,
  recruiter_notes TEXT,
  sync_source TEXT CHECK (sync_source IN ('MANUAL', 'WEBHOOK')),
  last_synced_at TEXT,
  invite_link_sent_at TEXT,
  email_sent_at TEXT,
  meeting_type TEXT CHECK (meeting_type IN ('DIRECT_VIDEO_CALL', 'SCREENING_INTERVIEW')),
  recipient_name TEXT,
  recipient_email TEXT,
  interview_type TEXT DEFAULT 'VIDEO'
    CHECK (interview_type IN (
      'VIDEO', 'TECHNICAL', 'SCREENING', 'CODE_REVIEW',
      'DEV_CONTAINER_CHALLENGE'
    )),
  matched_repo_id INTEGER REFERENCES qualified_repos(id) ON DELETE SET NULL,
  github_repo_url TEXT,
  github_pr_number INTEGER,
  submission_json TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Migrate existing rows. Columns added after the 0075 rebuild (matched_repo_id,
-- github_repo_url, github_pr_number, submission_json, completed_at) may not
-- exist on databases that skipped 0078; guard with a column-existence probe.
-- D1 migrations run sequentially so by this point 0078 has applied; the
-- SELECT below references all columns unconditionally.

INSERT INTO scheduled_interviews_next (
  id, candidate_id, pipeline_id, stage_id, owner_id, status, scheduled_at,
  meeting_url, scheduling_provider, scheduling_url, external_event_id,
  recruiter_notes, sync_source, last_synced_at, invite_link_sent_at,
  email_sent_at, meeting_type, recipient_name, recipient_email,
  interview_type, matched_repo_id, github_repo_url, github_pr_number,
  submission_json, completed_at, created_at, updated_at
)
SELECT
  id, candidate_id, pipeline_id, stage_id, owner_id, status, scheduled_at,
  meeting_url, scheduling_provider, scheduling_url, external_event_id,
  recruiter_notes, sync_source, last_synced_at, invite_link_sent_at,
  email_sent_at, meeting_type, recipient_name, recipient_email,
  interview_type, matched_repo_id, github_repo_url, github_pr_number,
  submission_json, completed_at, created_at, updated_at
FROM scheduled_interviews;

PRAGMA foreign_keys = OFF;
DROP TABLE scheduled_interviews;
ALTER TABLE scheduled_interviews_next RENAME TO scheduled_interviews;
PRAGMA foreign_keys = ON;

CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_candidate ON scheduled_interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_pipeline ON scheduled_interviews(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_external ON scheduled_interviews(external_event_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_owner_status ON scheduled_interviews(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_recipient_email ON scheduled_interviews(recipient_email);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_type ON scheduled_interviews(owner_id, interview_type);
