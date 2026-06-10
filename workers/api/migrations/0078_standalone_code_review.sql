-- Migration 0078: Standalone code review interviews
--
-- Enables inviting a candidate to a code review session from the scheduling
-- page without a pipeline. The candidate uploads a CV (intake), the graph is
-- built from CV ingestion alone, and they are matched to a repo + PR which is
-- recorded directly on the scheduled_interviews row (no pipeline/stage/
-- challenge rows exist for standalone sessions, so FK-bound tables like
-- assessments and candidate_challenge_assignment cannot be used).
--
-- Changes:
--   • interview_type CHECK gains 'CODE_REVIEW'
--   • matched_repo_id / github_repo_url / github_pr_number — repo match cache
--   • submission_json / completed_at — candidate's review submission
--
-- D1/SQLite does not support ALTER COLUMN, so we recreate the table.

CREATE TABLE scheduled_interviews_new (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  pipeline_id TEXT REFERENCES pipelines(id),
  stage_id TEXT REFERENCES stages(id),
  owner_id TEXT NOT NULL,
  interview_type TEXT DEFAULT 'VIDEO'
    CHECK (interview_type IN ('VIDEO', 'TECHNICAL', 'SCREENING', 'CODE_REVIEW')),
  status TEXT NOT NULL DEFAULT 'INVITED'
    CHECK (status IN ('INVITED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
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
  matched_repo_id INTEGER REFERENCES qualified_repos(id) ON DELETE SET NULL,
  github_repo_url TEXT,
  github_pr_number INTEGER,
  submission_json TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO scheduled_interviews_new
  SELECT id, candidate_id, pipeline_id, stage_id, owner_id,
         interview_type, status, scheduled_at, meeting_url,
         scheduling_provider, scheduling_url, external_event_id,
         recruiter_notes, sync_source, last_synced_at,
         invite_link_sent_at, email_sent_at,
         NULL, NULL, NULL, NULL, NULL,
         created_at, updated_at
  FROM scheduled_interviews;

DROP TABLE scheduled_interviews;
ALTER TABLE scheduled_interviews_new RENAME TO scheduled_interviews;

CREATE INDEX idx_si_candidate ON scheduled_interviews(candidate_id);
CREATE INDEX idx_si_pipeline ON scheduled_interviews(pipeline_id);
CREATE INDEX idx_si_external ON scheduled_interviews(external_event_id);
CREATE INDEX idx_si_owner_status ON scheduled_interviews(owner_id, status);
