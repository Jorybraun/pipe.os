-- Migration 0015: Culture AI usage tracking
--
-- Stores per-call AI cost events for the culture interview pipeline.
-- Used for cost surfacing in recruiter reports and the admin cost dashboard.
-- Linked to culture_interview_sessions via session_id FK.

CREATE TABLE IF NOT EXISTS culture_ai_usage_events (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL,
  feature          TEXT NOT NULL,  -- 'conversation' | 'scoring' | 'synthesis' | 'stt'
  model            TEXT NOT NULL,
  input_tokens     INTEGER,
  output_tokens    INTEGER,
  audio_seconds    INTEGER,
  usd_cost         REAL NOT NULL,
  created_at       TEXT NOT NULL,
  FOREIGN KEY (session_id) REFERENCES culture_interview_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_culture_usage_session ON culture_ai_usage_events(session_id);
CREATE INDEX IF NOT EXISTS idx_culture_usage_feature ON culture_ai_usage_events(session_id, feature);
