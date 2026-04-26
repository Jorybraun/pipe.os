-- Migration 0047: Adaptive culture interview — compliance audit extensions + screener mode
--
-- Adds screener_mode to culture_interview_sessions so the agent can distinguish
-- Mode-1 (profile_builder, role-agnostic graph construction) from Mode-2
-- (role_fit, culture-specific depth). Also extends the compliance audit event
-- type enum with generative-mode events: question_generated, question_source_mode,
-- answer_decomposed.

PRAGMA foreign_keys = OFF;
BEGIN TRANSACTION;

-- 1. Add screener_mode column to culture_interview_sessions
ALTER TABLE culture_interview_sessions ADD COLUMN screener_mode TEXT
  CHECK (screener_mode IN ('profile_builder', 'role_fit'));

-- 2. Recreate culture_compliance_audit with new event types
CREATE TABLE culture_compliance_audit_new (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id      TEXT NOT NULL,
  event_type      TEXT NOT NULL
                  CHECK (event_type IN (
                    'consent_shown', 'consent_given', 'consent_declined',
                    'alternative_requested', 'interview_started', 'interview_completed',
                    'scoring_complete', 'review_started', 'review_confirmed',
                    'review_overridden', 'review_flagged', 'deletion_requested',
                    'deletion_fulfilled', 'scorer_reprompt',
                    'question_generated', 'question_source_mode', 'answer_decomposed'
                  )),
  actor_type      TEXT NOT NULL
                  CHECK (actor_type IN ('candidate', 'recruiter', 'system')),
  actor_id        TEXT,
  metadata        TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (session_id) REFERENCES culture_interview_sessions(id)
);

INSERT INTO culture_compliance_audit_new SELECT * FROM culture_compliance_audit;
DROP TABLE culture_compliance_audit;
ALTER TABLE culture_compliance_audit_new RENAME TO culture_compliance_audit;

CREATE INDEX idx_culture_audit_session    ON culture_compliance_audit(session_id);
CREATE INDEX idx_culture_audit_event_type ON culture_compliance_audit(event_type);
CREATE INDEX idx_culture_audit_created    ON culture_compliance_audit(created_at);

COMMIT;
PRAGMA foreign_keys = ON;
