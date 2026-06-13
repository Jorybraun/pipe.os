-- 0081_meeting_rooms.sql
-- Meeting-scoped video rooms and opaque host/guest access tokens.

CREATE TABLE IF NOT EXISTS meeting_rooms (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'WAITING'
    CHECK (status IN ('WAITING', 'CALLING', 'ACTIVE', 'ENDED')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meeting_room_tokens (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES meeting_rooms(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL CHECK (role IN ('HOST', 'GUEST')),
  participant_id TEXT REFERENCES meeting_participants(id) ON DELETE SET NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meeting_room_tokens_room
  ON meeting_room_tokens(room_id);

CREATE INDEX IF NOT EXISTS idx_meeting_room_tokens_expiry
  ON meeting_room_tokens(expires_at);

ALTER TABLE meetings ADD COLUMN transcript_analysis_json TEXT;
ALTER TABLE meetings ADD COLUMN transcript_error TEXT;
