CREATE TABLE IF NOT EXISTS candidate_session_handles (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  pipeline_id TEXT,
  invite_token TEXT,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_candidate_session_handles_candidate
  ON candidate_session_handles(candidate_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_candidate_session_handles_expires
  ON candidate_session_handles(expires_at);
