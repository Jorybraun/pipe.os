-- Migration 0041: Persist triangulated match scores + reasoning
--
-- Adds columns to candidate_ingestion so the UI can display dimension
-- breakdowns and recruiter-readable reasoning without re-computing.
--
-- See ADR-040 Meaning-Based Candidate-Repo-Role Triangulation.

ALTER TABLE candidate_ingestion ADD COLUMN triangulated_score REAL;
ALTER TABLE candidate_ingestion ADD COLUMN dimensions_json TEXT;
ALTER TABLE candidate_ingestion ADD COLUMN reasoning_json TEXT;
ALTER TABLE candidate_ingestion ADD COLUMN match_philosophy TEXT CHECK (match_philosophy IN ('validate','tailored','hybrid'));
