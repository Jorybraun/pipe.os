-- Migration: 0012_role_context_participants
-- Multi-Stakeholder Role Discovery (ADR-028).
-- Moves per-person interview data into a separate participants table.
-- role_contexts becomes the shared state; each participant has their own exchanges + budget.

CREATE TABLE IF NOT EXISTS role_context_participants (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  role_context_id  TEXT NOT NULL REFERENCES role_contexts(id) ON DELETE CASCADE,

  -- Identity
  name             TEXT,
  email            TEXT,
  participant_role TEXT CHECK (participant_role IN ('HIRING_MANAGER', 'INTERNAL_RECRUITER', 'EXTERNAL_RECRUITER', 'TEAM_MEMBER')),

  -- Auth
  invite_token     TEXT,            -- NULL for creator (uses Clerk), hex token for invitees
  is_creator       INTEGER NOT NULL DEFAULT 0,

  -- Interview data (per-participant)
  exchanges        TEXT,            -- JSON: their conversation turns
  questions_asked  INTEGER NOT NULL DEFAULT 0,
  question_budget  INTEGER NOT NULL DEFAULT 10,

  -- Status: PENDING → INVITED → CALIBRATING → INTERVIEWING → COMPLETE
  status           TEXT NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'INVITED', 'CALIBRATING', 'INTERVIEWING', 'COMPLETE')),

  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_rcp_role_context_id ON role_context_participants(role_context_id);
CREATE UNIQUE INDEX idx_rcp_invite_token ON role_context_participants(invite_token) WHERE invite_token IS NOT NULL;
