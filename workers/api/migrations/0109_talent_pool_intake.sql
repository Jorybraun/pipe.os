-- Migration 0109: Talent Pool candidate intake surface
--
-- Candidate-facing profile intake is separate from assessment execution. This
-- stores profile receipt, phone screener consent, and the private design queue
-- created when no ready source-backed challenge can be assigned yet.

CREATE TABLE IF NOT EXISTS talent_pool_intakes (
  candidate_id                TEXT PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  status                      TEXT NOT NULL CHECK (
    status IN (
      'PROFILE_NEEDED',
      'PROFILE_RECEIVED',
      'PHONE_SCREENER_OFFERED',
      'PHONE_SCREENER_SCHEDULED',
      'CHALLENGE_PREPARING',
      'CHALLENGE_READY',
      'ASSESSMENT_IN_PROGRESS',
      'COMPLETED'
    )
  ) DEFAULT 'PROFILE_NEEDED',
  profile_r2_key              TEXT,
  profile_text_excerpt        TEXT,
  github_url                  TEXT,
  linkedin_url                TEXT,
  portfolio_url               TEXT,
  phone_screener_consent      INTEGER NOT NULL DEFAULT 0 CHECK (phone_screener_consent IN (0, 1)),
  phone_number                TEXT,
  timezone                    TEXT,
  availability                TEXT,
  submitted_at                TEXT,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_talent_pool_intakes_status
  ON talent_pool_intakes(status);

CREATE TABLE IF NOT EXISTS challenge_design_queue (
  id                          TEXT PRIMARY KEY,
  candidate_id                TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  owner_id                    TEXT NOT NULL,
  status                      TEXT NOT NULL CHECK (
    status IN ('queued', 'in_review', 'ready_to_assign', 'dismissed')
  ) DEFAULT 'queued',
  candidate_summary           TEXT NOT NULL,
  missing_signal              TEXT NOT NULL,
  inventory_failure_reason    TEXT NOT NULL,
  suggested_repo_families     TEXT NOT NULL,
  desired_assessment_signal   TEXT NOT NULL,
  proposed_challenge_type     TEXT NOT NULL,
  validation_status           TEXT NOT NULL CHECK (
    validation_status IN ('needs_design', 'validating', 'ready_to_assign', 'blocked')
  ) DEFAULT 'needs_design',
  ready_packet_id             TEXT,
  created_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_challenge_design_queue_owner_status
  ON challenge_design_queue(owner_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_challenge_design_queue_open_candidate
  ON challenge_design_queue(candidate_id)
  WHERE status IN ('queued', 'in_review');
