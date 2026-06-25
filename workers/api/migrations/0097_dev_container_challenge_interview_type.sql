-- 0097_dev_container_challenge_interview_type.sql
--
-- HAS-80: Model interviews as person-first events with optional role/challenge
-- context. Adds 'DEV_CONTAINER_CHALLENGE' to the interview_type CHECK so a
-- recruiter can create a dev-container challenge interview for any person
-- (contact, candidate, or lead) without requiring a pipeline/role.
--
-- D1 wraps migrations in an implicit transaction, so PRAGMA foreign_keys
-- cannot be toggled. We must rebuild every table in the FK chain in
-- reverse dependency order (children before parents) using
-- CREATE TABLE ... AS SELECT (which produces a constraint-free copy),
-- then recreate indexes. CHECK constraints and FKs are dropped; the app
-- layer validates via Zod and explicit queries.

CREATE TABLE IF NOT EXISTS scheduled_interviews_next (
  id TEXT PRIMARY KEY,
  candidate_id TEXT,
  pipeline_id TEXT,
  stage_id TEXT,
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
  matched_repo_id INTEGER,
  github_repo_url TEXT,
  github_pr_number INTEGER,
  submission_json TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

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

-- Rebuild child tables in reverse dependency order.
-- meeting_room_tokens → meeting_rooms, meeting_participants
CREATE TABLE meeting_room_tokens_next AS SELECT * FROM meeting_room_tokens;
DROP TABLE meeting_room_tokens;
ALTER TABLE meeting_room_tokens_next RENAME TO meeting_room_tokens;
CREATE INDEX IF NOT EXISTS idx_meeting_room_tokens_room ON meeting_room_tokens(room_id);
CREATE INDEX IF NOT EXISTS idx_meeting_room_tokens_expiry ON meeting_room_tokens(expires_at);

-- dev_container_sessions → meetings, meeting_rooms
CREATE TABLE dev_container_sessions_next AS SELECT * FROM dev_container_sessions;
DROP TABLE dev_container_sessions;
ALTER TABLE dev_container_sessions_next RENAME TO dev_container_sessions;
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_candidate ON dev_container_sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_pipeline ON dev_container_sessions(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_status ON dev_container_sessions(status);
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_expires ON dev_container_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_room ON dev_container_sessions(meeting_room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_meeting ON dev_container_sessions(meeting_id, created_at);

-- meeting_participants → meetings
CREATE TABLE meeting_participants_next AS SELECT * FROM meeting_participants;
DROP TABLE meeting_participants;
ALTER TABLE meeting_participants_next RENAME TO meeting_participants;
CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_contact ON meeting_participants(contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_participants_unique ON meeting_participants(meeting_id, contact_id);

-- meeting_rooms → meetings
CREATE TABLE meeting_rooms_next AS SELECT * FROM meeting_rooms;
DROP TABLE meeting_rooms;
ALTER TABLE meeting_rooms_next RENAME TO meeting_rooms;

-- transcript_artifacts → scheduled_interviews
CREATE TABLE transcript_artifacts_next AS SELECT * FROM transcript_artifacts;
DROP TABLE transcript_artifacts;
ALTER TABLE transcript_artifacts_next RENAME TO transcript_artifacts;
CREATE INDEX IF NOT EXISTS idx_transcript_artifacts_interview ON transcript_artifacts (scheduled_interview_id);
CREATE INDEX IF NOT EXISTS idx_transcript_artifacts_status ON transcript_artifacts (status);

-- meetings → scheduled_interviews
CREATE TABLE meetings_next AS SELECT * FROM meetings;
DROP TABLE meetings;
ALTER TABLE meetings_next RENAME TO meetings;
CREATE INDEX IF NOT EXISTS idx_meetings_owner ON meetings(owner_id);
CREATE INDEX IF NOT EXISTS idx_meetings_owner_status ON meetings(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_meetings_owner_type ON meetings(owner_id, meeting_type);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_at ON meetings(scheduled_at);
CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_interview ON meetings(scheduled_interview_id);

-- Now safe to drop and replace scheduled_interviews.
DROP TABLE scheduled_interviews;
ALTER TABLE scheduled_interviews_next RENAME TO scheduled_interviews;

CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_candidate ON scheduled_interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_pipeline ON scheduled_interviews(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_external ON scheduled_interviews(external_event_id);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_owner_status ON scheduled_interviews(owner_id, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_recipient_email ON scheduled_interviews(recipient_email);
CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_type ON scheduled_interviews(owner_id, interview_type);
