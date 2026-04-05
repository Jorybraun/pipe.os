-- Migration: 0011_role_contexts
-- Role Discovery Agent — AI-powered role context extraction (ADR-027).
-- Stores baseline form data, AI interview exchanges, and the Six Domains Knowledge State.

CREATE TABLE IF NOT EXISTS role_contexts (
  id               TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id      TEXT REFERENCES pipelines(id) ON DELETE CASCADE,
  owner_id         TEXT NOT NULL,

  -- Baseline (structured form data, always collected)
  baseline         TEXT,

  -- AI interview output
  knowledge_state  TEXT,           -- JSON: Six Domains output blob
  exchanges        TEXT,           -- JSON: Array of conversation turns

  -- Budget tracking
  question_budget  INTEGER NOT NULL DEFAULT 10,
  questions_asked  INTEGER NOT NULL DEFAULT 0,

  -- Status state machine: BASELINE → INTERVIEWING → COMPLETE | ABANDONED
  status           TEXT NOT NULL DEFAULT 'BASELINE'
                   CHECK (status IN ('BASELINE', 'INTERVIEWING', 'COMPLETE', 'ABANDONED')),

  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_role_contexts_owner_id ON role_contexts(owner_id);
CREATE INDEX idx_role_contexts_pipeline_id ON role_contexts(pipeline_id);
