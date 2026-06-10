-- Migration 0075: Make pipeline_id optional on candidates and scheduled_interviews
--
-- Enables "talent pool first" flow: candidates can be invited without
-- belonging to a pipeline. Scheduling interviews no longer requires
-- a pipeline or stage context.
--
-- D1/SQLite does not support ALTER COLUMN, so we recreate the tables.

-- ── 1. candidates: pipeline_id nullable ──────────────────────────────────────

CREATE TABLE candidates_new (
  id                  TEXT PRIMARY KEY,
  pipeline_id         TEXT REFERENCES pipelines(id) ON DELETE CASCADE,
  owner_id            TEXT NOT NULL,
  name                TEXT,
  email               TEXT,
  invite_token        TEXT NOT NULL UNIQUE,
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

INSERT INTO candidates_new
  SELECT id, pipeline_id, owner_id, name, email, invite_token, status,
         current_stage_id, skills, years_of_experience, current_role,
         education, resume_s3_key, phone_number, github_handle, linkedin_url,
         created_at, updated_at
  FROM candidates;

DROP TABLE candidates;
ALTER TABLE candidates_new RENAME TO candidates;

CREATE INDEX idx_candidates_pipeline ON candidates(pipeline_id);
CREATE INDEX idx_candidates_invite_token ON candidates(invite_token);
CREATE INDEX idx_candidates_owner ON candidates(owner_id);
CREATE INDEX idx_candidates_owner_email ON candidates(owner_id, email);

-- ── 2. scheduled_interviews: pipeline_id + stage_id nullable, add interview_type ─

CREATE TABLE scheduled_interviews_new (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  pipeline_id TEXT REFERENCES pipelines(id),
  stage_id TEXT REFERENCES stages(id),
  owner_id TEXT NOT NULL,
  interview_type TEXT DEFAULT 'VIDEO'
    CHECK (interview_type IN ('VIDEO', 'TECHNICAL', 'SCREENING')),
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT INTO scheduled_interviews_new
  SELECT id, candidate_id, pipeline_id, stage_id, owner_id,
         'VIDEO', status, scheduled_at, meeting_url,
         scheduling_provider, scheduling_url, external_event_id,
         recruiter_notes, sync_source, last_synced_at,
         invite_link_sent_at, email_sent_at, created_at, updated_at
  FROM scheduled_interviews;

DROP TABLE scheduled_interviews;
ALTER TABLE scheduled_interviews_new RENAME TO scheduled_interviews;

CREATE INDEX idx_si_candidate ON scheduled_interviews(candidate_id);
CREATE INDEX idx_si_pipeline ON scheduled_interviews(pipeline_id);
CREATE INDEX idx_si_external ON scheduled_interviews(external_event_id);
CREATE INDEX idx_si_owner_status ON scheduled_interviews(owner_id, status);
