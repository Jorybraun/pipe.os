-- Migration 0028: Repo Understanding Contract v2.0.0
--
-- Closes drift between code and canonical Repo Understanding Contract schema
-- (knowledge/outputs/role-discovery-data-contract.md §2.1–§2.4) + adds the
-- extensions approved in STRATEGY.md Decision Log 2026-04-14:
--
--   Canonical alignment:
--     - architecture_style enum migrated: 'modular_monolith' → 'layered_service',
--       'serverless' → 'microservice'. New canonical values 'library' and
--       'layered_service' are now expected in fresh Pass 3 output. Without
--       'library' in the enum, the hard contamination filter could not be
--       expressed; that's why this migration exists now.
--     - test_style (canonical RUC field) added to repo_engineering_signals.
--       Deterministic classifier-computed enum, not LLM-generated.
--
--   Extensions beyond RUC §2.3 (override recorded in Decision Log):
--     - repo_engineering_signals.challenge_surfaces (JSON: 10 *_potential
--       scores mapped 1:1 to the ADR-032:131 bug template list).
--     - repo_engineering_signals.repo_searchable_profile (400–600 word
--       Gemma-narrated profile, embedded into Vectorize REPO_INDEX).
--     - qualified_repos.open_pr_count / open_feature_issue_count — Pass 1
--       GitHub Search API; drives the "challenge-ready" hard filter in
--       matchRepos.
--     - qualified_repos.business_logic_ratio / cross_module_change_rate —
--       deterministic Pass 2 aggregates from changed_file_paths_json.
--     - repo_sample_prs.changed_file_paths_json — per-sampled-PR path list
--       for the Pass 2 path classifier.
--
-- No data loss: the enum re-map preserves every row and maps to the closest
-- canonical value. 'modular_monolith' → 'layered_service' because both describe
-- single-deploy systems with clear internal layering. 'serverless' → 'microservice'
-- because function-as-a-service topology is the closest canonical analogue.

-- ─── qualified_repos: open-work counts + Pass-2 aggregates ──────────────────

ALTER TABLE qualified_repos ADD COLUMN open_pr_count            INTEGER;
ALTER TABLE qualified_repos ADD COLUMN open_feature_issue_count INTEGER;
ALTER TABLE qualified_repos ADD COLUMN business_logic_ratio     REAL;
ALTER TABLE qualified_repos ADD COLUMN cross_module_change_rate REAL;

-- ─── repo_sample_prs: per-PR changed file paths ─────────────────────────────

ALTER TABLE repo_sample_prs ADD COLUMN changed_file_paths_json TEXT;

-- ─── repo_engineering_signals: canonical + extension fields ─────────────────

ALTER TABLE repo_engineering_signals ADD COLUMN test_style              TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN challenge_surfaces      TEXT;
ALTER TABLE repo_engineering_signals ADD COLUMN repo_searchable_profile TEXT;

-- ─── Enum re-map to canonical RUC values ────────────────────────────────────

UPDATE repo_engineering_signals
   SET architecture_style = 'layered_service'
 WHERE architecture_style = 'modular_monolith';

UPDATE repo_engineering_signals
   SET architecture_style = 'microservice'
 WHERE architecture_style = 'serverless';

-- ─── Indexes to support the hard filter + hybrid recall ─────────────────────

CREATE INDEX IF NOT EXISTS idx_repos_open_work
  ON qualified_repos(open_pr_count, open_feature_issue_count)
  WHERE disqualified = 0;

CREATE INDEX IF NOT EXISTS idx_signals_architecture
  ON repo_engineering_signals(architecture_style);
