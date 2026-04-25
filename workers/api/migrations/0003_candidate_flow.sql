-- Phase 3: Candidate Flow — Assessments + Challenge Submissions
-- Tracks candidate progress through pipeline stages and individual challenge responses.

-- ── Assessments table ───────────────────────────────────────────────────────
-- One assessment per candidate per stage. Tracks overall stage progress.
CREATE TABLE IF NOT EXISTS assessments (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage_id        TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  owner_id        TEXT,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'SCORED')),
  score           REAL,
  started_at      TEXT,
  completed_at    TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(candidate_id, stage_id)
);

CREATE INDEX IF NOT EXISTS idx_assessments_candidate ON assessments(candidate_id);
CREATE INDEX IF NOT EXISTS idx_assessments_stage ON assessments(stage_id);

-- ── Challenge Submissions table ─────────────────────────────────────────────
-- One submission per candidate per challenge. Stores response + score.
CREATE TABLE IF NOT EXISTS challenge_submissions (
  id              TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  assessment_id   TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  challenge_id    TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  response_json   TEXT,
  score           REAL,
  feedback        TEXT,
  submitted_at    TEXT,
  scored_at       TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(assessment_id, challenge_id)
);

CREATE INDEX IF NOT EXISTS idx_submissions_assessment ON challenge_submissions(assessment_id);
CREATE INDEX IF NOT EXISTS idx_submissions_candidate ON challenge_submissions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_submissions_challenge ON challenge_submissions(challenge_id);
