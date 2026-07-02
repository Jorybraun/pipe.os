-- 0114_assessment_list_projection_indexes.sql
--
-- Keep recruiter interview list/detail assessment projections bounded as the
-- append-only assessment event tables grow. The scheduling list fetches only a
-- page of interviews, then asks these tables for latest session, event, commit,
-- evaluation, and human-decision summaries for that page.

CREATE INDEX IF NOT EXISTS idx_assessment_sessions_interview_updated
  ON assessment_sessions(interview_id, updated_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_evidence_events_session_kind
  ON assessment_evidence_events(session_id, kind);

CREATE INDEX IF NOT EXISTS idx_assessment_evidence_events_session_latest
  ON assessment_evidence_events(session_id, sequence DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_evidence_events_session_kind_latest
  ON assessment_evidence_events(session_id, kind, sequence DESC, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_event_source_refs_event_lookup
  ON assessment_event_source_refs(event_id, source_ref_type, evidence_role, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_assessment_evaluation_reports_session_latest
  ON assessment_evaluation_reports(session_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_candidate_challenge_assignment_candidate_stage_latest
  ON candidate_challenge_assignment(candidate_id, stage_id, assigned_at DESC, id DESC);
