-- voice_sessions: tracks live voice interview sessions (ADR-038)
-- Each session maps to a VoiceSessionDO instance.
-- Transcript is written back via internal callback on session close.
CREATE TABLE IF NOT EXISTS voice_sessions (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('role-discovery', 'culture-interview', 'agent-interview')),
  context_id  TEXT,             -- role_context_id for role-discovery, challenge_id for agent-interview
  owner_id    TEXT NOT NULL,    -- Clerk userId of session creator
  status      TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'ACTIVE', 'COMPLETE', 'ABANDONED')),
  transcript_json TEXT,         -- JSON array of { role: 'user'|'model', text: string } on completion
  created_at  TEXT NOT NULL,
  ended_at    TEXT
);

CREATE INDEX IF NOT EXISTS idx_voice_sessions_owner ON voice_sessions (owner_id);
CREATE INDEX IF NOT EXISTS idx_voice_sessions_context ON voice_sessions (context_id) WHERE context_id IS NOT NULL;
