-- Migration 0046: Add 'scorer_reprompt' to culture_compliance_audit event_type enum
--
-- SQLite does not support ALTER TABLE on CHECK constraints, so we recreate
-- the table. The audit trail is small (13 event types × N sessions) so this
-- is safe and fast.
--
-- Note: D1 runs each migration in a transaction and does not support
-- BEGIN TRANSACTION / COMMIT or PRAGMA foreign_keys in SQL.
--
-- See docs/plans/strategy-v2/part1-north-star/culture-reprompt-ungrounded-scores.md

CREATE TABLE culture_compliance_audit_new (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  session_id      TEXT NOT NULL,

  event_type      TEXT NOT NULL
                  CHECK (event_type IN (
                    'consent_shown',
                    'consent_given',
                    'consent_declined',
                    'alternative_requested',
                    'interview_started',
                    'interview_completed',
                    'scoring_complete',
                    'review_started',
                    'review_confirmed',
                    'review_overridden',
                    'review_flagged',
                    'deletion_requested',
                    'deletion_fulfilled',
                    'scorer_reprompt'
                  )),

  actor_type      TEXT NOT NULL
                  CHECK (actor_type IN ('candidate', 'recruiter', 'system')),

  actor_id        TEXT,
  metadata        TEXT,

  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  FOREIGN KEY (session_id) REFERENCES culture_interview_sessions(id)
);

INSERT INTO culture_compliance_audit_new
  SELECT * FROM culture_compliance_audit;

DROP TABLE culture_compliance_audit;

ALTER TABLE culture_compliance_audit_new RENAME TO culture_compliance_audit;

CREATE INDEX idx_culture_audit_session    ON culture_compliance_audit(session_id);
CREATE INDEX idx_culture_audit_event_type ON culture_compliance_audit(event_type);
CREATE INDEX idx_culture_audit_created    ON culture_compliance_audit(created_at);
