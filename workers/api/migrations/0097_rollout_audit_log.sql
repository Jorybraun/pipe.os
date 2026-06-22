-- Audit trail for rollout gate stage transitions.
-- Every gate change is immutable once written; ops can reconstruct
-- the full rollout history from this table.
--
-- Acceptance criterion #8: production quality — auditable staged rollout.

CREATE TABLE IF NOT EXISTS rollout_gate_audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  gate_key    TEXT    NOT NULL,
  old_stage   TEXT    NOT NULL,
  new_stage   TEXT    NOT NULL,
  changed_by  TEXT    NOT NULL,
  reason      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rollout_audit_gate_key
  ON rollout_gate_audit_log (gate_key, created_at DESC);
