-- Migration 0058: Create candidate_profile_state table
-- Phase 1 of ADR-041: Resume Decomposition & Graph Seeding
--
-- Tracks cross-role candidate lifecycle state and decomposition progress.
-- Replaces the single-role candidates.status for graph-aware ingestion.

CREATE TABLE candidate_profile_state (
  candidate_id TEXT PRIMARY KEY,
  overall_status TEXT NOT NULL CHECK(overall_status IN ('seed', 'enriching', 'screening', 'active', 'dormant', 'archived')),
  last_intake_at INTEGER,
  last_enriched_at INTEGER,
  last_screened_at INTEGER,
  last_matched_at INTEGER,
  re_engagement_eligible_at INTEGER,
  profile_version TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Index for cron queries scanning dormant / re-engagement eligible candidates
CREATE INDEX idx_candidate_profile_state_status ON candidate_profile_state(overall_status);
CREATE INDEX idx_candidate_profile_state_re_engagement ON candidate_profile_state(re_engagement_eligible_at) WHERE re_engagement_eligible_at IS NOT NULL;
