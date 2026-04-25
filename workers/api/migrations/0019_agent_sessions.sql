-- Migration 0019: Agent Sessions for the Global Copilot Drawer
--
-- Stores multi-turn conversation sessions between the recruiter and
-- the copilot agent. One active session per (owner_id, pipeline_id).
-- Sessions persist across page navigations and browser refreshes.

CREATE TABLE agent_sessions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  owner_id TEXT NOT NULL,
  pipeline_id TEXT REFERENCES pipelines(id) ON DELETE SET NULL,

  -- Current skill mode determines system prompt + tool set
  skill_mode TEXT NOT NULL DEFAULT 'general' CHECK (skill_mode IN (
    'general', 'challenge_design', 'score_explain', 'pipeline_advisor'
  )),

  -- Full message history: JSON array of {role, content, toolCalls?, toolResults?}
  messages TEXT NOT NULL DEFAULT '[]',

  -- Pipeline context snapshot (title, level, stack, persona, stages)
  -- Built on session creation, avoids re-fetching every turn
  context_snapshot TEXT,

  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  -- One active session per owner per pipeline
  UNIQUE(owner_id, pipeline_id, status)
);

CREATE INDEX idx_agent_sessions_owner ON agent_sessions(owner_id);
CREATE INDEX idx_agent_sessions_pipeline ON agent_sessions(pipeline_id);
CREATE INDEX idx_agent_sessions_status ON agent_sessions(status);
