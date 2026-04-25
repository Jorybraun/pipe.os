-- Migration 0038: Per-candidate ingestion + challenge assignment
--
-- Implements the 2026-04-21 Decision Log override of ADR-039 Implementation
-- sequencing: the Candidate Discovery agent and per-candidate repo matching
-- ship now as the "Ingestion" pre-stage. Fires on resume upload; populates a
-- searchable profile, embeds it, runs bi-directional cosine match against
-- REPO_INDEX, and writes one challenge assignment per stage per candidate.
--
--   candidate_ingestion — one row per candidate, tracks the ingestion pipeline.
--     status transitions: pending → profile_generated → embedded → matched.
--     'failed' is terminal until the recruiter triggers re-ingestion. The
--     candidate_searchable_profile mirrors the shape of repo_searchable_profile
--     (400–600 word narrative produced by Gemma 4 26B via Vertex AI).
--
--   candidate_challenge_assignment — per-candidate override for the shared
--     pipeline-level challenges row. /rpc/get-challenge LEFT JOINs this table
--     and replaces github_repo_url / github_pr_number / issue_number when a
--     match exists for the (candidate_id, stage_id) pair.
--
-- See STRATEGY.md Decision Log 2026-04-21 and ADR-039 §Implementation.

CREATE TABLE candidate_ingestion (
  candidate_id TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending','profile_generated','embedded','matched','failed')) DEFAULT 'pending',
  candidate_searchable_profile TEXT,
  key_concepts_json TEXT,
  profile_version TEXT,
  model_used TEXT,
  matched_repo_id INTEGER REFERENCES qualified_repos(id) ON DELETE SET NULL,
  profile_generated_at TEXT,
  profile_embedded_at TEXT,
  matched_at TEXT,
  error_text TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_candidate_ingestion_status ON candidate_ingestion(status);
CREATE INDEX idx_candidate_ingestion_matched_repo ON candidate_ingestion(matched_repo_id);

CREATE TABLE candidate_challenge_assignment (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  repo_id INTEGER REFERENCES qualified_repos(id) ON DELETE SET NULL,
  github_repo_url TEXT,
  github_pr_number INTEGER,
  issue_number INTEGER,
  assigned_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (candidate_id, stage_id)
);

CREATE INDEX idx_cca_candidate ON candidate_challenge_assignment(candidate_id);
CREATE INDEX idx_cca_stage ON candidate_challenge_assignment(stage_id);
