-- transcript_artifacts: stores video call transcripts as first-class artifacts
-- Links to scheduled_interviews for graph associations (meeting invite, recipient/person nodes)
CREATE TABLE IF NOT EXISTS transcript_artifacts (
  id TEXT PRIMARY KEY,
  scheduled_interview_id TEXT NOT NULL,  -- FK to scheduled_interviews
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
  transcript_json TEXT,  -- JSON array of { role: 'user'|'model', text: string, timestamp?: string }
  error_message TEXT,  -- actionable error message if status is FAILED
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (scheduled_interview_id) REFERENCES scheduled_interviews(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transcript_artifacts_interview ON transcript_artifacts (scheduled_interview_id);
CREATE INDEX IF NOT EXISTS idx_transcript_artifacts_status ON transcript_artifacts (status);
