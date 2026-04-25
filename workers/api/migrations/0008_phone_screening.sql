-- Phone screening: add phone_number to candidates, create phone_calls table.

ALTER TABLE candidates ADD COLUMN phone_number TEXT;

CREATE TABLE IF NOT EXISTS phone_calls (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
  owner_id TEXT NOT NULL,
  direction TEXT NOT NULL DEFAULT 'OUTBOUND' CHECK (direction IN ('OUTBOUND', 'INBOUND')),
  status TEXT NOT NULL DEFAULT 'INITIATED' CHECK (status IN ('INITIATED', 'RINGING', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'NO_ANSWER', 'BUSY', 'CANCELLED')),
  from_number TEXT NOT NULL,
  to_number TEXT NOT NULL,
  twilio_call_sid TEXT UNIQUE,
  duration_seconds INTEGER,
  recording_url TEXT,
  recording_s3_key TEXT,
  transcription TEXT,
  transcription_status TEXT CHECK (transcription_status IN ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED')),
  recruiter_notes TEXT,
  started_at TEXT,
  ended_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_phone_calls_candidate ON phone_calls(candidate_id);
CREATE INDEX idx_phone_calls_owner ON phone_calls(owner_id);
CREATE INDEX idx_phone_calls_twilio_sid ON phone_calls(twilio_call_sid);
