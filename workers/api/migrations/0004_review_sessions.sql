-- Migration: 0004_review_sessions
-- Creates the review_sessions table for multi-turn code review conversations.
-- Each row tracks one candidate's back-and-forth conversation for a CODE_REVIEW challenge.

CREATE TABLE IF NOT EXISTS review_sessions (
  id                    TEXT PRIMARY KEY,
  challenge_submission_id TEXT,
  challenge_id          TEXT NOT NULL,
  assessment_id         TEXT NOT NULL,
  candidate_id          TEXT NOT NULL,
  implementer_persona   TEXT NOT NULL DEFAULT 'junior',
  current_round         INTEGER NOT NULL DEFAULT 1,
  max_rounds            INTEGER NOT NULL DEFAULT 4,
  status                TEXT NOT NULL DEFAULT 'in_progress',
  transcript            TEXT DEFAULT '{"rounds":[]}',
  next_comment_id       INTEGER NOT NULL DEFAULT 1,
  score_report          TEXT,
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  FOREIGN KEY (challenge_id) REFERENCES challenges(id),
  FOREIGN KEY (assessment_id) REFERENCES assessments(id),
  FOREIGN KEY (candidate_id) REFERENCES candidates(id)
);

CREATE INDEX IF NOT EXISTS idx_review_sessions_candidate   ON review_sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_review_sessions_assessment  ON review_sessions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_review_sessions_status      ON review_sessions(status);
