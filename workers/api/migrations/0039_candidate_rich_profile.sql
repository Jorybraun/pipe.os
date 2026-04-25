-- Migration 0039: Rich candidate profile + situation signature
--
-- Expands candidate_ingestion with structured career context and situation
-- signatures extracted by the Discovery agent. These JSON columns power the
-- meaning-based candidate→repo matching (candidateSituationFit) and the
-- triangulated scorer.
--
-- See ADR-040 Meaning-Based Candidate-Repo-Role Triangulation.

ALTER TABLE candidate_ingestion ADD COLUMN career_context_json TEXT;
ALTER TABLE candidate_ingestion ADD COLUMN situation_signature_json TEXT;
ALTER TABLE candidate_ingestion ADD COLUMN key_situations_json TEXT;

-- Role→Candidate cosine pre-computed at ingestion time (avoids re-embedding
-- the role profile on every candidate upload).
ALTER TABLE candidate_ingestion ADD COLUMN role_candidate_cosine REAL;
