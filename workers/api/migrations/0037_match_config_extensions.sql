-- Migration 0037: ADR-039 wizard extensions on top of 0036
--
-- Two columns the synthesis brief named at §4.7 + §4.3 but 0036 did not include.
-- See ADR-039 §Implementation and the wizard plan at .claude/plans/polymorphic-wobbling-tiger.md.
--
--   role_contexts.non_negotiable_skills_json — TEXT (JSON array, subset of
--     persona_json.mustHaveSkills[]). Drives the "every non-negotiable skill
--     must be exercised in at least one station" coverage constraint enforced
--     by autoStageBuilder via matchRepos's existing
--     `HAVING must_hits = must_total` clause.
--
--   pipeline_match_config.hybrid_mix_ratio — REAL in [0, 1], default 0.6.
--     Role-leaning by synthesis §4.3 dual-query rerank default
--     (0.6 role / 0.4 candidate). Only consulted when match_philosophy='hybrid'.

ALTER TABLE role_contexts ADD COLUMN non_negotiable_skills_json TEXT;

ALTER TABLE pipeline_match_config ADD COLUMN hybrid_mix_ratio REAL
  CHECK (hybrid_mix_ratio IS NULL OR (hybrid_mix_ratio >= 0 AND hybrid_mix_ratio <= 1))
  DEFAULT 0.6;
