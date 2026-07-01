-- 0102_assessment_layer.sql
--
-- Source-backed assessment evidence spine. Assessment surfaces such as
-- CODE_REVIEW, OPEN_SOURCE_BUG_FIX, dev containers, and assessment rooms
-- write immutable events here; context_records remain rebuildable projections.

CREATE TABLE IF NOT EXISTS assessment_sessions (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  interview_id TEXT,
  mode TEXT NOT NULL CHECK (mode <> ''),
  state TEXT NOT NULL DEFAULT 'INTAKE'
    CHECK (state IN (
      'INTAKE',
      'IN_PROGRESS',
      'FINAL_SUBMITTED',
      'EVALUATING',
      'EVALUATION_PENDING',
      'EVALUATED',
      'DIAGNOSTIC',
      'BLOCKED',
      'CANCELLED'
    )),
  candidate_id TEXT,
  workspace_id TEXT,
  workspace_person_id TEXT,
  application_id TEXT,
  created_by TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT,
  submitted_at TEXT,
  completed_at TEXT,
  diagnostic_at TEXT,
  canceled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assessment_sessions_interview
  ON assessment_sessions(interview_id);
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_candidate
  ON assessment_sessions(candidate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_sessions_state
  ON assessment_sessions(state, updated_at DESC);

CREATE TABLE IF NOT EXISTS assessment_state_transitions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES assessment_sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL,
  from_state TEXT NOT NULL,
  to_state TEXT NOT NULL,
  reason TEXT NOT NULL,
  actor_type TEXT,
  actor_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_assessment_state_transitions_session
  ON assessment_state_transitions(session_id, sequence);

CREATE TABLE IF NOT EXISTS assessment_evidence_events (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES assessment_sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK (sequence > 0),
  kind TEXT NOT NULL CHECK (kind <> ''),
  actor_type TEXT NOT NULL CHECK (actor_type <> ''),
  actor_id TEXT,
  narrative TEXT NOT NULL CHECK (narrative <> ''),
  payload_json TEXT NOT NULL DEFAULT '{}',
  context_record_id TEXT REFERENCES context_records(id) ON DELETE SET NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assessment_evidence_events_session
  ON assessment_evidence_events(session_id, sequence);
CREATE INDEX IF NOT EXISTS idx_assessment_evidence_events_kind
  ON assessment_evidence_events(kind, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_assessment_evidence_events_sequence
  ON assessment_evidence_events(session_id, sequence);

CREATE TRIGGER IF NOT EXISTS assessment_evidence_events_no_update
BEFORE UPDATE ON assessment_evidence_events
BEGIN
  SELECT RAISE(ABORT, 'assessment_evidence_events are immutable');
END;

CREATE TRIGGER IF NOT EXISTS assessment_evidence_events_no_delete
BEFORE DELETE ON assessment_evidence_events
BEGIN
  SELECT RAISE(ABORT, 'assessment_evidence_events are immutable');
END;

CREATE TABLE IF NOT EXISTS assessment_event_source_refs (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES assessment_evidence_events(id) ON DELETE CASCADE,
  source_ref_type TEXT NOT NULL CHECK (source_ref_type <> ''),
  source_ref_id TEXT NOT NULL CHECK (source_ref_id <> ''),
  source_span_id TEXT REFERENCES source_spans(id) ON DELETE RESTRICT,
  evidence_role TEXT NOT NULL DEFAULT 'support',
  locator_json TEXT NOT NULL DEFAULT '{}',
  exact_text TEXT NOT NULL CHECK (exact_text <> ''),
  content_hash TEXT NOT NULL CHECK (content_hash <> ''),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(event_id, source_ref_type, source_ref_id, evidence_role)
);

CREATE INDEX IF NOT EXISTS idx_assessment_event_source_refs_ref
  ON assessment_event_source_refs(source_ref_type, source_ref_id);

CREATE TRIGGER IF NOT EXISTS assessment_event_source_refs_no_update
BEFORE UPDATE ON assessment_event_source_refs
BEGIN
  SELECT RAISE(ABORT, 'assessment_event_source_refs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS assessment_event_source_refs_no_delete
BEFORE DELETE ON assessment_event_source_refs
BEGIN
  SELECT RAISE(ABORT, 'assessment_event_source_refs are immutable');
END;

CREATE TABLE IF NOT EXISTS assessment_evaluation_reports (
  id TEXT PRIMARY KEY,
  ingestion_key TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL REFERENCES assessment_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL
    CHECK (status IN (
      'EVALUATED',
      'NEEDS_MORE_EVIDENCE',
      'NO_ROLE_SAFE_CHALLENGE',
      'PROVENANCE_INCOMPLETE',
      'AI_DEVELOPER_UNAVAILABLE',
      'NEEDS_HUMAN_REVIEW',
      'BLOCKED'
    )),
  summary TEXT NOT NULL,
  context_record_id TEXT REFERENCES context_records(id) ON DELETE SET NULL,
  output_json TEXT NOT NULL DEFAULT '{}',
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assessment_evaluation_reports_session
  ON assessment_evaluation_reports(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assessment_evaluation_reports_status
  ON assessment_evaluation_reports(status, updated_at DESC);

CREATE TRIGGER IF NOT EXISTS assessment_evaluation_reports_no_update
BEFORE UPDATE ON assessment_evaluation_reports
BEGIN
  SELECT RAISE(ABORT, 'assessment_evaluation_reports are immutable');
END;

CREATE TRIGGER IF NOT EXISTS assessment_evaluation_reports_no_delete
BEFORE DELETE ON assessment_evaluation_reports
BEGIN
  SELECT RAISE(ABORT, 'assessment_evaluation_reports are immutable');
END;

CREATE TABLE IF NOT EXISTS assessment_evaluation_claims (
  id TEXT PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES assessment_evaluation_reports(id) ON DELETE CASCADE,
  polarity TEXT NOT NULL CHECK (polarity IN ('positive', 'negative', 'neutral', 'diagnostic')),
  dimension TEXT NOT NULL CHECK (dimension <> ''),
  narrative TEXT NOT NULL CHECK (narrative <> ''),
  confidence REAL CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assessment_evaluation_claims_report
  ON assessment_evaluation_claims(report_id);

CREATE TRIGGER IF NOT EXISTS assessment_evaluation_claims_no_update
BEFORE UPDATE ON assessment_evaluation_claims
BEGIN
  SELECT RAISE(ABORT, 'assessment_evaluation_claims are immutable');
END;

CREATE TRIGGER IF NOT EXISTS assessment_evaluation_claims_no_delete
BEFORE DELETE ON assessment_evaluation_claims
BEGIN
  SELECT RAISE(ABORT, 'assessment_evaluation_claims are immutable');
END;

CREATE TABLE IF NOT EXISTS assessment_claim_source_refs (
  id TEXT PRIMARY KEY,
  claim_id TEXT NOT NULL REFERENCES assessment_evaluation_claims(id) ON DELETE CASCADE,
  source_ref_type TEXT NOT NULL CHECK (source_ref_type <> ''),
  source_ref_id TEXT NOT NULL CHECK (source_ref_id <> ''),
  source_span_id TEXT REFERENCES source_spans(id) ON DELETE RESTRICT,
  evidence_role TEXT NOT NULL DEFAULT 'support',
  locator_json TEXT NOT NULL DEFAULT '{}',
  exact_text TEXT NOT NULL CHECK (exact_text <> ''),
  content_hash TEXT NOT NULL CHECK (content_hash <> ''),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(claim_id, source_ref_type, source_ref_id, evidence_role)
);

CREATE INDEX IF NOT EXISTS idx_assessment_claim_source_refs_ref
  ON assessment_claim_source_refs(source_ref_type, source_ref_id);

CREATE TRIGGER IF NOT EXISTS assessment_claim_source_refs_no_update
BEFORE UPDATE ON assessment_claim_source_refs
BEGIN
  SELECT RAISE(ABORT, 'assessment_claim_source_refs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS assessment_claim_source_refs_no_delete
BEFORE DELETE ON assessment_claim_source_refs
BEGIN
  SELECT RAISE(ABORT, 'assessment_claim_source_refs are immutable');
END;

CREATE TABLE IF NOT EXISTS assessment_diagnostics (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES assessment_sessions(id) ON DELETE CASCADE,
  report_id TEXT REFERENCES assessment_evaluation_reports(id) ON DELETE CASCADE,
  event_id TEXT REFERENCES assessment_evidence_events(id) ON DELETE CASCADE,
  code TEXT NOT NULL CHECK (code <> ''),
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'error', 'blocking')),
  message TEXT NOT NULL CHECK (message <> ''),
  provider TEXT,
  retryable INTEGER NOT NULL DEFAULT 0 CHECK (retryable IN (0, 1)),
  details_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  CHECK(session_id IS NOT NULL OR report_id IS NOT NULL OR event_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_assessment_diagnostics_session
  ON assessment_diagnostics(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_assessment_diagnostics_report
  ON assessment_diagnostics(report_id);
CREATE INDEX IF NOT EXISTS idx_assessment_diagnostics_event
  ON assessment_diagnostics(event_id);

CREATE TRIGGER IF NOT EXISTS assessment_diagnostics_no_update
BEFORE UPDATE ON assessment_diagnostics
BEGIN
  SELECT RAISE(ABORT, 'assessment_diagnostics are immutable');
END;

CREATE TRIGGER IF NOT EXISTS assessment_diagnostics_no_delete
BEFORE DELETE ON assessment_diagnostics
BEGIN
  SELECT RAISE(ABORT, 'assessment_diagnostics are immutable');
END;

CREATE TABLE IF NOT EXISTS assessment_diagnostic_source_refs (
  id TEXT PRIMARY KEY,
  diagnostic_id TEXT NOT NULL REFERENCES assessment_diagnostics(id) ON DELETE CASCADE,
  source_ref_type TEXT NOT NULL CHECK (source_ref_type <> ''),
  source_ref_id TEXT NOT NULL CHECK (source_ref_id <> ''),
  source_span_id TEXT REFERENCES source_spans(id) ON DELETE RESTRICT,
  evidence_role TEXT NOT NULL DEFAULT 'support',
  locator_json TEXT NOT NULL DEFAULT '{}',
  exact_text TEXT NOT NULL CHECK (exact_text <> ''),
  content_hash TEXT NOT NULL CHECK (content_hash <> ''),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  UNIQUE(diagnostic_id, source_ref_type, source_ref_id, evidence_role)
);

CREATE INDEX IF NOT EXISTS idx_assessment_diagnostic_source_refs_ref
  ON assessment_diagnostic_source_refs(source_ref_type, source_ref_id);

CREATE TRIGGER IF NOT EXISTS assessment_diagnostic_source_refs_no_update
BEFORE UPDATE ON assessment_diagnostic_source_refs
BEGIN
  SELECT RAISE(ABORT, 'assessment_diagnostic_source_refs are immutable');
END;

CREATE TRIGGER IF NOT EXISTS assessment_diagnostic_source_refs_no_delete
BEFORE DELETE ON assessment_diagnostic_source_refs
BEGIN
  SELECT RAISE(ABORT, 'assessment_diagnostic_source_refs are immutable');
END;
