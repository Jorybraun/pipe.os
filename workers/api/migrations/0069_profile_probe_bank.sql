-- Migration 0069: profile_probe_bank — role-agnostic probes for Mode-1 Profile Builder
--
-- These probes are coverage-driven (not competency-scored) and elicit career
-- history, behavioral depth, technical signal, motivation, and context.
-- They are consumed by the screener when screener_mode = 'profile_builder'.

CREATE TABLE IF NOT EXISTS profile_probe_bank (
  id TEXT PRIMARY KEY,
  dimension TEXT NOT NULL CHECK(dimension IN ('career_history','behavioral_depth','cultural','technical','motivation','context')),
  text TEXT NOT NULL,
  expected_slots TEXT NOT NULL DEFAULT 'S,T,A,R',
  max_probes INTEGER NOT NULL DEFAULT 2,
  probe_library_json TEXT,
  tags TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_profile_probe_bank_dimension ON profile_probe_bank(dimension);
CREATE INDEX IF NOT EXISTS idx_profile_probe_bank_sort ON profile_probe_bank(dimension, sort_order);
