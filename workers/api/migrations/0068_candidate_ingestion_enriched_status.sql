-- Migration 0068: Add enriched status + screener/profile columns to candidate_ingestion
--
-- 1. Expands status CHECK to include 'enriching' and 'enriched' for the
--    post-screener enrichment pipeline (Mode-1 Profile Builder).
-- 2. Adds screener_completed_at: ISO-8601 timestamp when candidate finishes Mode-1.
-- 3. Adds candidate_profile_json: rich synthesized profile from transcript
--    (career timeline, skills, projects, working style, motivation, context).
-- 4. Adds enriched_embedding_json: mean-pooled vector after screener nodes
--    are embedded and combined with resume embeddings.
--
-- SQLite does not support ALTER TABLE DROP CONSTRAINT, so we recreate.

CREATE TABLE IF NOT EXISTS candidate_ingestion_new (
  candidate_id              TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  status                    TEXT NOT NULL CHECK (status IN ('pending','profile_generated','embedded','enriching','enriched','matched','failed')) DEFAULT 'pending',
  candidate_searchable_profile TEXT,
  key_concepts_json         TEXT,
  profile_version           TEXT,
  model_used                TEXT,
  matched_repo_id           INTEGER REFERENCES qualified_repos(id) ON DELETE SET NULL,
  profile_generated_at      TEXT,
  profile_embedded_at       TEXT,
  matched_at                TEXT,
  error_text                TEXT,
  created_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at                TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  -- columns added by 0039_candidate_rich_profile.sql
  career_context_json       TEXT,
  situation_signature_json  TEXT,
  key_situations_json       TEXT,
  role_candidate_cosine     REAL,
  -- columns added by 0041_ingestion_triangulated_scores.sql
  triangulated_score        REAL,
  dimensions_json           TEXT,
  reasoning_json            TEXT,
  match_philosophy          TEXT CHECK (match_philosophy IN ('validate','tailored','hybrid')),
  -- columns added by 0042_embedding_json.sql
  embedding_json            TEXT,
  -- columns added by 0043_embedding_model_version.sql
  embedding_model_version   TEXT,
  -- columns added by 0054_candidate_ingestion_enrichment_columns.sql
  last_enriched_at          INTEGER,
  github_url                TEXT,
  -- columns added by 0059_candidate_ingestion_decomposition_version.sql
  decomposition_version     TEXT,
  -- columns added by 0060_candidate_ingestion_github_calendar.sql
  github_calendar_json      TEXT,
  -- columns added by 0061_candidate_ingestion_profile_sections.sql
  profile_sections_json     TEXT,
  -- columns added by 0062_intake_challenge_and_resume_enrichment.sql
  linkedin_url              TEXT,
  -- columns added by 0066_candidate_ingestion_telemetry.sql
  current_step              TEXT,
  estimated_completion_at   TEXT,
  -- NEW: columns added by 0068
  screener_completed_at     TEXT,
  candidate_profile_json    TEXT,
  enriched_embedding_json   TEXT
);

INSERT INTO candidate_ingestion_new (
  candidate_id, status, candidate_searchable_profile, key_concepts_json,
  profile_version, model_used, matched_repo_id, profile_generated_at,
  profile_embedded_at, matched_at, error_text, created_at, updated_at,
  career_context_json, situation_signature_json, key_situations_json,
  role_candidate_cosine, triangulated_score, dimensions_json, reasoning_json,
  match_philosophy, embedding_json, embedding_model_version, last_enriched_at,
  github_url, decomposition_version, github_calendar_json, profile_sections_json,
  linkedin_url, current_step, estimated_completion_at
)
SELECT
  candidate_id, status, candidate_searchable_profile, key_concepts_json,
  profile_version, model_used, matched_repo_id, profile_generated_at,
  profile_embedded_at, matched_at, error_text, created_at, updated_at,
  career_context_json, situation_signature_json, key_situations_json,
  role_candidate_cosine, triangulated_score, dimensions_json, reasoning_json,
  match_philosophy, embedding_json, embedding_model_version, last_enriched_at,
  github_url, decomposition_version, github_calendar_json, profile_sections_json,
  linkedin_url, current_step, estimated_completion_at
FROM candidate_ingestion;

PRAGMA foreign_keys = OFF;
DROP TABLE candidate_ingestion;
ALTER TABLE candidate_ingestion_new RENAME TO candidate_ingestion;
PRAGMA foreign_keys = ON;

CREATE INDEX idx_candidate_ingestion_status ON candidate_ingestion(status);
CREATE INDEX idx_candidate_ingestion_matched_repo ON candidate_ingestion(matched_repo_id);
