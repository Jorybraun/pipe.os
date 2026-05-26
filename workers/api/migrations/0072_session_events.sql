-- Migration 0072: Session events — append-only observability log for all interview types
--
-- Supports concurrent sessions across code_review, culture_interview, screening,
-- implementation, voice, and video. Query by session_id for timeline, by
-- candidate_id for cross-session history, by event_type for error aggregation.

CREATE TABLE IF NOT EXISTS session_events (
  id              TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,
  session_type    TEXT NOT NULL,  -- 'code_review', 'culture_interview', 'screening', 'implementation', 'voice', 'video'
  candidate_id    TEXT NOT NULL,
  event_type      TEXT NOT NULL,  -- 'started', 'question_asked', 'answer_submitted', 'scoring_started', 'scoring_complete', 'error', 'completed', 'stage_advanced', 'match_assigned'
  payload_json    TEXT,           -- arbitrary context per event type
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_session_events_session ON session_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_session_events_candidate ON session_events(candidate_id, created_at);
CREATE INDEX IF NOT EXISTS idx_session_events_type ON session_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_session_events_session_type ON session_events(session_type, created_at);
