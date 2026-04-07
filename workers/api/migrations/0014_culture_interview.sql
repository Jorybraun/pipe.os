-- Migration: 0014_culture_interview
-- Culture Fit Interview Agent (ADR-029) + compliance audit log (ADR-031).
--
-- Stores one session row per candidate culture interview, with the full
-- conversation transcript as a JSON TEXT column (mirrors review_sessions
-- from 0004). Separate append-only audit table satisfies Illinois HB 3773
-- and EU AI Act Article 14 recordkeeping obligations.

-- ─── Per-candidate interview session ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS culture_interview_sessions (
  id                       TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  challenge_id             TEXT NOT NULL,
  challenge_submission_id  TEXT,
  assessment_id            TEXT NOT NULL,
  candidate_id             TEXT NOT NULL,

  -- FSM state: consent → in_progress → scoring → complete | error
  state                    TEXT NOT NULL DEFAULT 'consent'
                           CHECK (state IN ('consent', 'in_progress', 'scoring', 'complete', 'error')),

  -- Compliance audit anchor — NULL until candidate explicitly consents.
  -- No turn may be written to transcript while consent_at IS NULL
  -- (enforced in the application layer; see cultureAgent.ts pre-write assertion).
  consent_at               TEXT,

  -- JSON shape: {"turns":[...], "scratchpad":{"dimension_coverage":{...},"probes_used_for_current_q":0,"running_themes":[]}}
  transcript               TEXT NOT NULL DEFAULT '{"turns":[],"scratchpad":{"dimension_coverage":{},"probes_used_for_current_q":0,"running_themes":[]}}',

  current_question_idx     INTEGER NOT NULL DEFAULT 0,

  -- Populated at scoring completion. JSON shape follows cultureScorer output.
  -- Stays null while state != 'complete'. Score is `pending_review` until
  -- recruiter confirms or overrides via the HITL gate (ADR-031 §2).
  score_report             TEXT,

  started_at               TEXT,
  completed_at             TEXT,

  created_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  FOREIGN KEY (challenge_id) REFERENCES challenges(id),
  FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  FOREIGN KEY (candidate_id) REFERENCES candidates(id)
);

CREATE INDEX IF NOT EXISTS idx_culture_sessions_candidate   ON culture_interview_sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_culture_sessions_assessment  ON culture_interview_sessions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_culture_sessions_challenge   ON culture_interview_sessions(challenge_id);
CREATE INDEX IF NOT EXISTS idx_culture_sessions_state       ON culture_interview_sessions(state);


-- ─── Append-only compliance audit log ──────────────────────────────────────
-- ADR-031 §4. Every gate event (consent shown/given/declined, review actions,
-- deletion requests) writes one row. Retained 7 years per EEOC recordkeeping,
-- independent of interview-content deletion.
--
-- NO update or delete route exists. Corrections are compensating entries.
CREATE TABLE IF NOT EXISTS culture_compliance_audit (
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
                    'deletion_fulfilled'
                  )),

  actor_type      TEXT NOT NULL
                  CHECK (actor_type IN ('candidate', 'recruiter', 'system')),

  actor_id        TEXT,                                     -- candidate_id or Clerk sub; NULL for system
  metadata        TEXT,                                     -- JSON: override_reason, decline_reason, etc.

  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),

  FOREIGN KEY (session_id) REFERENCES culture_interview_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_culture_audit_session     ON culture_compliance_audit(session_id);
CREATE INDEX IF NOT EXISTS idx_culture_audit_event_type  ON culture_compliance_audit(event_type);
CREATE INDEX IF NOT EXISTS idx_culture_audit_created     ON culture_compliance_audit(created_at);
