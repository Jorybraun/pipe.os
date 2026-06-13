-- Migration 0078: Standalone code review interviews
--
-- Enables inviting a candidate to a code review session from the scheduling
-- page without a pipeline. The candidate uploads a CV (intake), the graph is
-- built from CV ingestion alone, and they are matched to a repo + PR which is
-- recorded directly on the scheduled_interviews row (no pipeline/stage/
-- challenge rows exist for standalone sessions, so FK-bound tables like
-- assessments and candidate_challenge_assignment cannot be used).
--
-- Changes:
--   • interview_type CHECK gains 'CODE_REVIEW'
--   • matched_repo_id / github_repo_url / github_pr_number — repo match cache
--   • submission_json / completed_at — candidate's review submission
--
-- The table shape is created by 0075_optional_pipeline.sql. Keeping this
-- migration as a guarded compatibility step prevents a second parent-table
-- rebuild after meetings and transcript_artifacts reference it.

CREATE INDEX IF NOT EXISTS idx_si_candidate ON scheduled_interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_si_pipeline ON scheduled_interviews(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_si_external ON scheduled_interviews(external_event_id);
CREATE INDEX IF NOT EXISTS idx_si_owner_status ON scheduled_interviews(owner_id, status);
