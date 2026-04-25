-- Allow skills-only discovery without a pipeline reference.
-- SQLite doesn't support ALTER COLUMN, so we recreate the tables.

-- 1. discovery_jobs: make pipeline_id nullable
CREATE TABLE discovery_jobs_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id TEXT,
  role_context_id TEXT,
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED')),
  skills_queried TEXT,
  total_candidates INTEGER DEFAULT 0,
  total_passed INTEGER DEFAULT 0,
  total_rejected INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO discovery_jobs_new SELECT * FROM discovery_jobs;
DROP TABLE discovery_jobs;
ALTER TABLE discovery_jobs_new RENAME TO discovery_jobs;
CREATE INDEX idx_discovery_jobs_pipeline ON discovery_jobs(pipeline_id);
CREATE INDEX idx_discovery_jobs_owner ON discovery_jobs(owner_id);

-- 2. discovered_repos: make pipeline_id nullable
CREATE TABLE discovered_repos_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id TEXT,
  role_context_id TEXT,
  owner_id TEXT NOT NULL,
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  github_url TEXT NOT NULL,
  default_branch TEXT,
  discovery_source TEXT,
  discovery_query TEXT,
  stars INTEGER,
  last_pushed_at TEXT,
  license TEXT,
  is_archived INTEGER DEFAULT 0,
  is_fork INTEGER DEFAULT 0,
  has_ci INTEGER,
  primary_language TEXT,
  topics TEXT,
  detected_stack TEXT,
  stack_match_score REAL,
  sloc INTEGER,
  mean_cyclomatic_complexity REAL,
  source_file_count INTEGER,
  seniority_band TEXT,
  quality_score REAL,
  quality_details TEXT,
  status TEXT NOT NULL DEFAULT 'DISCOVERING',
  rejection_reason TEXT,
  error_message TEXT,
  challenge_template_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO discovered_repos_new SELECT * FROM discovered_repos;
DROP TABLE discovered_repos;
ALTER TABLE discovered_repos_new RENAME TO discovered_repos;
CREATE INDEX idx_discovered_repos_pipeline ON discovered_repos(pipeline_id);
CREATE INDEX idx_discovered_repos_owner ON discovered_repos(owner_id);
CREATE INDEX idx_discovered_repos_status ON discovered_repos(status);
