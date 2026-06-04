-- 0075_contact_first_meetings.sql
-- Contact-first meeting model: support direct video calls and screening interviews
-- without requiring candidate/pipeline/stage context upfront.

-- Add meeting_type column to distinguish meeting types
ALTER TABLE scheduled_interviews ADD COLUMN meeting_type TEXT 
  CHECK (meeting_type IN ('DIRECT_VIDEO_CALL', 'SCREENING_INTERVIEW'));

-- Add recipient fields for contact-first targeting
ALTER TABLE scheduled_interviews ADD COLUMN recipient_name TEXT;
ALTER TABLE scheduled_interviews ADD COLUMN recipient_email TEXT;

-- Make candidate/pipeline/stage optional for contact-first model
-- SQLite doesn't support dropping constraints directly, so we recreate the table
CREATE TABLE IF NOT EXISTS scheduled_interviews_new (
  id TEXT PRIMARY KEY,
  candidate_id TEXT,
  pipeline_id TEXT,
  stage_id TEXT,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
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
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Migrate existing data
INSERT INTO scheduled_interviews_new (
  id, candidate_id, pipeline_id, stage_id, owner_id, status, scheduled_at,
  meeting_url, scheduling_provider, scheduling_url, external_event_id,
  recruiter_notes, sync_source, last_synced_at, invite_link_sent_at,
  email_sent_at, created_at, updated_at
)
SELECT 
  id, candidate_id, pipeline_id, stage_id, owner_id, status, scheduled_at,
  meeting_url, scheduling_provider, scheduling_url, external_event_id,
  recruiter_notes, sync_source, last_synced_at, invite_link_sent_at,
  email_sent_at, created_at, updated_at
FROM scheduled_interviews;

-- Set default meeting_type for existing records (they're screening interviews)
UPDATE scheduled_interviews_new 
SET meeting_type = 'SCREENING_INTERVIEW' 
WHERE meeting_type IS NULL;

-- Drop old table and rename new one
DROP TABLE scheduled_interviews;
ALTER TABLE scheduled_interviews_new RENAME TO scheduled_interviews;

-- Recreate indexes
CREATE INDEX idx_scheduled_interviews_candidate ON scheduled_interviews(candidate_id);
CREATE INDEX idx_scheduled_interviews_pipeline ON scheduled_interviews(pipeline_id);
CREATE INDEX idx_scheduled_interviews_external ON scheduled_interviews(external_event_id);
CREATE INDEX idx_scheduled_interviews_owner_status ON scheduled_interviews(owner_id, status);
CREATE INDEX idx_scheduled_interviews_recipient_email ON scheduled_interviews(recipient_email);
