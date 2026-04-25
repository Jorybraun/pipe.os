-- Migration 0043: Unified Agent Sessions Table
-- Phase 5 of the Unified Agent Runtime rollout.

CREATE TABLE IF NOT EXISTS agent_sessions (
  id            TEXT PRIMARY KEY,
  agent_type    TEXT NOT NULL,
  challenge_id  TEXT,
  candidate_id  TEXT,
  state         TEXT NOT NULL DEFAULT 'consent',
  consent_at    TEXT,
  transcript    TEXT NOT NULL DEFAULT '{"turns":[],"scratchpad":{}}',
  score_report  TEXT,
  eval_results  TEXT DEFAULT '[]',
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

-- Indexes for operational queries
CREATE INDEX IF NOT EXISTS idx_agent_sessions_type ON agent_sessions(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_candidate ON agent_sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_state ON agent_sessions(state);
CREATE INDEX IF NOT EXISTS idx_agent_sessions_created ON agent_sessions(created_at);
