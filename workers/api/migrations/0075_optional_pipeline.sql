-- Migration 0075: Optional pipeline compatibility
--
-- Fresh databases receive nullable candidate and meeting context from
-- 0002_recruiter_core.sql and 0075_contact_first_meetings.sql. Existing D1
-- databases cannot safely rebuild candidates here because assessment,
-- ingestion, and session tables already reference it. Keep this migration
-- non-destructive and repair only the lookup indexes.

CREATE INDEX IF NOT EXISTS idx_candidates_pipeline ON candidates(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_candidates_invite_token ON candidates(invite_token);
CREATE INDEX IF NOT EXISTS idx_candidates_owner ON candidates(owner_id);
CREATE INDEX IF NOT EXISTS idx_candidates_owner_email ON candidates(owner_id, email);

CREATE INDEX IF NOT EXISTS idx_si_candidate ON scheduled_interviews(candidate_id);
CREATE INDEX IF NOT EXISTS idx_si_pipeline ON scheduled_interviews(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_si_external ON scheduled_interviews(external_event_id);
CREATE INDEX IF NOT EXISTS idx_si_owner_status ON scheduled_interviews(owner_id, status);
