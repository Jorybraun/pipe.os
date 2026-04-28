-- Migration 0056: Enrichment jobs queue for GitHub enrichment worker
--
-- Phase 2 candidate enrichment. Jobs are enqueued at intake when a candidate
-- provides a GitHub handle. The worker polls every 2 hours, processes up to 5
-- pending jobs per invocation, and marks them DONE or FAILED.

CREATE TABLE IF NOT EXISTS enrichment_jobs (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK(source_type IN ('github', 'url_content')),
  source_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'IN_PROGRESS', 'DONE', 'FAILED', 'SKIPPED')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempted_at INTEGER,
  completed_at INTEGER,
  error_text TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_candidate ON enrichment_jobs(candidate_id, status);
CREATE INDEX IF NOT EXISTS idx_enrichment_jobs_poll ON enrichment_jobs(status, created_at);
