-- 0076_meetings.sql
-- Standalone meetings table: discovery calls, interviews, demos, etc.

CREATE TABLE IF NOT EXISTS meetings (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED')),
  scheduled_at TEXT,
  started_at TEXT,
  ended_at TEXT,
  duration_secs INTEGER,
  meeting_url TEXT,
  meeting_type TEXT NOT NULL DEFAULT 'OTHER' CHECK (meeting_type IN ('DISCOVERY', 'INTERVIEW', 'FOLLOW_UP', 'DEMO', 'OTHER')),
  transcript_status TEXT DEFAULT 'NONE' CHECK (transcript_status IN ('NONE', 'RECORDING', 'PROCESSING', 'READY', 'FAILED')),
  transcript_json TEXT,
  transcript_summary TEXT,
  recording_r2_key TEXT,
  scheduled_interview_id TEXT REFERENCES scheduled_interviews(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_meetings_owner ON meetings(owner_id);
CREATE INDEX idx_meetings_owner_status ON meetings(owner_id, status);
CREATE INDEX idx_meetings_owner_type ON meetings(owner_id, meeting_type);
CREATE INDEX idx_meetings_scheduled_at ON meetings(scheduled_at);
CREATE INDEX idx_meetings_scheduled_interview ON meetings(scheduled_interview_id);
