-- 0107_rollout_gates.sql
--
-- D1-backed feature rollout gates for the living context graph system.
-- Each gate tracks a feature through staged rollout: disabled → internal_only → canary → GA.
-- Prerequisites enforce ordering so downstream features cannot advance past their dependencies.

CREATE TABLE IF NOT EXISTS rollout_gates (
  id              TEXT PRIMARY KEY,
  gate_key        TEXT NOT NULL UNIQUE,
  stage           TEXT NOT NULL DEFAULT 'disabled',
  prerequisite_of TEXT,
  description     TEXT,
  updated_by      TEXT,
  metadata_json   TEXT NOT NULL DEFAULT '{}',
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rollout_gates_stage
  ON rollout_gates(stage);
