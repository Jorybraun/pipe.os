-- Phase 1: Core pipeline tables
-- ID strategy: lower(hex(randomblob(16))) — 32 hex chars, no auto-increment leakage.
-- Schema evolution: extend via ALTER TABLE in subsequent migrations; never redefine these tables.

CREATE TABLE IF NOT EXISTS pipelines (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  owner_id      TEXT NOT NULL,                  -- Clerk user ID
  title         TEXT NOT NULL,
  level         TEXT CHECK (level IN (
                  'Junior', 'Mid', 'Senior', 'Staff',
                  'Principal', 'Lead', 'Manager'
                )),
  stack         TEXT,                           -- JSON array: '["React","TypeScript"]'
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'DRAFT'
                CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  creation_mode TEXT DEFAULT 'BLANK'
                CHECK (creation_mode IN ('BLANK', 'PRESET', 'AI_DRIVEN')),
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_pipelines_owner_id ON pipelines(owner_id);
CREATE INDEX idx_pipelines_status   ON pipelines(status);


CREATE TABLE IF NOT EXISTS stages (
  id          TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  time_limit  INTEGER,                          -- minutes
  mode        TEXT DEFAULT 'ASYNC'
              CHECK (mode IN ('ASYNC', 'LIVE_VIDEO')),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_stages_pipeline_id ON stages(pipeline_id);


CREATE TABLE IF NOT EXISTS challenges (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  stage_id      TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN (
                  'CODE_REVIEW', 'CODE_IMPLEMENTATION',
                  'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER', 'FOLLOW_UP'
                )),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  instructions  TEXT,
  config        TEXT,                           -- JSON: public challenge config
  server_config TEXT,                           -- JSON: private answer keys (never sent to client)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_challenges_stage_id ON challenges(stage_id);
