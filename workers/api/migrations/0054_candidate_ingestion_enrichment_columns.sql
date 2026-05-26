-- Migration 0054: Add enrichment tracking columns to candidate_ingestion
--
-- Enables Phase 3 re-engagement and GitHub enrichment worker tracking.
-- last_enriched_at: unix epoch seconds (INTEGER) for efficient date comparisons.
-- github_url: candidate's public GitHub profile URL for enrichment jobs.
--
-- NOTE on mixed timestamp styles:
--   Existing candidate_ingestion columns (created_at, updated_at, profile_generated_at,
--   matched_at) use TEXT ISO-8601. last_enriched_at intentionally uses INTEGER
--   (unix epoch seconds) to align with the Date.now() millisecond arithmetic in
--   candidateRecency.ts. Converting all columns to a single style is a future
--   backfill consideration, not required for correctness today.

ALTER TABLE candidate_ingestion ADD COLUMN last_enriched_at INTEGER;
ALTER TABLE candidate_ingestion ADD COLUMN github_url TEXT;
