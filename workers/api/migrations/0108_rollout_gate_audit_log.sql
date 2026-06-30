-- 0108_rollout_gate_audit_log.sql
--
-- Immutable audit trail for rollout gate transitions. Every stage change
-- is logged with the actor, previous stage, and optional reason so that
-- production promotions are always explainable.

CREATE TABLE IF NOT EXISTS rollout_gate_audit_log (
  id            TEXT PRIMARY KEY,
  gate_key      TEXT NOT NULL,
  previous_stage TEXT NOT NULL,
  new_stage     TEXT NOT NULL,
  updated_by    TEXT,
  reason        TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rollout_gate_audit_log_gate
  ON rollout_gate_audit_log(gate_key, created_at DESC);
