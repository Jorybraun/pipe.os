-- Migration 0045: Add vector signal columns to match_feedback
--
-- Captures the vector-native signals (vector_role_repo, vector_cand_repo,
-- vector_role_cand) that feed into the triangulated match score.
-- Enables offline calibration of vector vs. LLM signal correlation.
--
-- See ADR-040 Meaning-Based Candidate-Repo-Role Triangulation.
-- See docs/plans/phase0-subagent-execution-plan.md — Subagent H.

ALTER TABLE match_feedback ADD COLUMN vector_role_repo REAL;
ALTER TABLE match_feedback ADD COLUMN vector_cand_repo REAL;
ALTER TABLE match_feedback ADD COLUMN vector_role_cand REAL;
