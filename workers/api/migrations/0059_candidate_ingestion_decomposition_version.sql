-- Migration 0059: Add decomposition_version to candidate_ingestion
-- Phase 1 of ADR-041: Resume Decomposition & Graph Seeding
--
-- Tracks which decomposition schema version was applied to a candidate's resume.
-- Used for backfill idempotency and migration safety.

ALTER TABLE candidate_ingestion ADD COLUMN decomposition_version TEXT;
