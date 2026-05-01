-- Migration 0062: Add INTAKE challenge type and resume enrichment source
--
-- 1. INTAKE challenge type — candidate-facing self-serve profile building
--    (resume upload, GitHub handle, LinkedIn URL)
-- 2. 'resume' source_type for enrichment_jobs — queues resume parsing + ingestion

-- ── challenges table: add INTAKE to CHECK constraint ─────────────────────────
-- SQLite does not support ALTER TABLE DROP CONSTRAINT, so we recreate.

CREATE TABLE IF NOT EXISTS challenges_new (
  id            TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  stage_id      TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  type          TEXT NOT NULL CHECK (type IN (
                  'CODE_REVIEW', 'CODE_IMPLEMENTATION',
                  'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER', 'FOLLOW_UP',
                  'INTAKE'
                )),
  sort_order    INTEGER NOT NULL DEFAULT 0,
  title         TEXT NOT NULL,
  instructions  TEXT,
  config        TEXT,
  server_config TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

INSERT INTO challenges_new SELECT * FROM challenges;

DROP TABLE challenges;
ALTER TABLE challenges_new RENAME TO challenges;

CREATE INDEX idx_challenges_stage_id ON challenges(stage_id);

-- ── enrichment_jobs table: add 'resume' to source_type CHECK ─────────────────

CREATE TABLE IF NOT EXISTS enrichment_jobs_new (
  id                TEXT PRIMARY KEY,
  candidate_id      TEXT NOT NULL,
  source_type       TEXT NOT NULL CHECK(source_type IN ('github', 'url_content', 'resume')),
  source_url        TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'IN_PROGRESS', 'DONE', 'FAILED', 'SKIPPED')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_attempted_at INTEGER,
  completed_at      INTEGER,
  error_text        TEXT,
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
);

INSERT INTO enrichment_jobs_new SELECT * FROM enrichment_jobs;

DROP TABLE enrichment_jobs;
ALTER TABLE enrichment_jobs_new RENAME TO enrichment_jobs;

CREATE INDEX idx_enrichment_jobs_candidate ON enrichment_jobs(candidate_id, status);
CREATE INDEX idx_enrichment_jobs_poll ON enrichment_jobs(status, created_at);

-- ── candidate_ingestion: add linkedin_url column ─────────────────────────────
ALTER TABLE candidate_ingestion ADD COLUMN linkedin_url TEXT;
