-- 0077_meeting_participants.sql
-- Join table linking meetings to contacts with role tracking.

CREATE TABLE IF NOT EXISTS meeting_participants (
  id TEXT PRIMARY KEY,
  meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'ATTENDEE' CHECK (role IN ('HOST', 'ATTENDEE', 'OBSERVER')),
  invite_sent_at TEXT,
  joined_at TEXT,
  left_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_meeting_participants_meeting ON meeting_participants(meeting_id);
CREATE INDEX idx_meeting_participants_contact ON meeting_participants(contact_id);
CREATE UNIQUE INDEX idx_meeting_participants_unique ON meeting_participants(meeting_id, contact_id);
