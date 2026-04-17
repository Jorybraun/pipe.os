-- Migration 0032: Generic AI usage events
--
-- Replaces the culture-scoped culture_ai_usage_events as the canonical log for
-- every AI call in the system. One row per model invocation (or per voice
-- session aggregate). Feature-agnostic so role discovery, culture, voice
-- interviews, copilot, etc. all share a schema.
--
-- Completed sessions AND failed sessions both get rows — the goal is a true
-- total spend number, not just billable-on-success.

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id                   TEXT PRIMARY KEY,
  feature              TEXT NOT NULL,   -- 'role_discovery' | 'culture_interview' | 'voice_interview' | 'copilot' | ...
  ref_id               TEXT,            -- role_context_id | culture session_id | voice session_id | ...
  sub_ref_id           TEXT,            -- optional — participant_id, candidate_id, etc.
  provider             TEXT NOT NULL,   -- 'vertex-ai' | 'vertex-live' | 'cloudflare-ai' | 'mistral' | 'anthropic'
  model                TEXT NOT NULL,   -- canonical pricing key (see pricing.ts MODEL_PRICING)
  input_tokens         INTEGER,         -- text input tokens
  output_tokens        INTEGER,         -- text output tokens
  input_audio_tokens   INTEGER,         -- Live API audio input tokens
  output_audio_tokens  INTEGER,         -- Live API audio output tokens
  audio_seconds        REAL,            -- Whisper STT or approximate Live session duration
  usd_cost             REAL NOT NULL,
  success              INTEGER NOT NULL DEFAULT 1,   -- 0 when the call/session errored
  error_message        TEXT,
  created_at           TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_feature_created ON ai_usage_events(feature, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_ref             ON ai_usage_events(feature, ref_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_created         ON ai_usage_events(created_at);
