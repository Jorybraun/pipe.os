-- Migration 0036: role-personalized match configuration (dual-home schema)
--
-- Operationalizes ADR-039 (Bi-directional Vectorization + 3-Station Interview
-- Trajectory). Canonical DDL sourced from
-- knowledge/interview/repo-personalized-interview-config.md §4.7 lines 213–232.
--
-- Dual-home split:
--   role_contexts       — role-level defaults (match_philosophy, tolerance)
--   pipeline_match_config — per-pipeline overrides + stage linkage + automation
--
-- NULL columns on pipeline_match_config inherit from role_contexts. The audit
-- blob captures recruiter overrides so that ADR-031 retention / deletion rules
-- can be applied uniformly.
--
-- Four orthogonal config axes (ADR-039 §2):
--   match_philosophy:        tailored | hybrid | validate        (default hybrid)
--   tolerance:               strict   | moderate | lenient       (default moderate)
--   stage_linkage:           shared-repo | per-stage             (default shared-repo)
--   automation_granularity:  per-pipeline | per-candidate |
--                            per-stage | recruiter-override      (default per-candidate)
--
-- Guardrail enforcement (3 BLOCK + 2 WARN) is implemented in
-- workers/api/src/lib/match/guardrails.ts and called at config-write and
-- match-time — schema-level CHECK constraints only enforce value domains.

-- Role-level defaults on role_contexts
ALTER TABLE role_contexts ADD COLUMN match_philosophy TEXT
  CHECK (match_philosophy IN ('tailored','hybrid','validate'))
  DEFAULT 'hybrid';

ALTER TABLE role_contexts ADD COLUMN tolerance TEXT
  CHECK (tolerance IN ('strict','moderate','lenient'))
  DEFAULT 'moderate';

-- Per-pipeline overrides (NULL columns inherit role-level defaults)
CREATE TABLE IF NOT EXISTS pipeline_match_config (
  pipeline_id             TEXT PRIMARY KEY REFERENCES pipelines(id) ON DELETE CASCADE,
  match_philosophy        TEXT CHECK (match_philosophy IN ('tailored','hybrid','validate')),
  tolerance               TEXT CHECK (tolerance IN ('strict','moderate','lenient')),
  stage_linkage           TEXT CHECK (stage_linkage IN ('shared-repo','per-stage'))
                            DEFAULT 'shared-repo',
  automation_granularity  TEXT CHECK (automation_granularity IN
                            ('per-pipeline','per-candidate','per-stage','recruiter-override'))
                            DEFAULT 'per-candidate',
  recruiter_override_audit_json TEXT,
  updated_at              INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pipeline_match_config_philosophy
  ON pipeline_match_config(match_philosophy);
