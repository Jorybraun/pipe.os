-- 0117_enable_living_context_read.sql
--
-- Seed the living context read feature gate to GA for local dev and fresh
-- deployments so the recruiter CONTEXT tab renders the living evidence graph.

INSERT INTO rollout_gates (id, gate_key, stage, updated_by, created_at, updated_at)
VALUES (
  'rollout_gate_1bce7b47c30b37e5b4aeab4a56e346ca',
  'living_context_read',
  'GA',
  'migration',
  datetime('now'),
  datetime('now')
)
ON CONFLICT(gate_key) DO UPDATE SET
  stage = excluded.stage,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;
