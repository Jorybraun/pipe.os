-- Migration 0018: Discovered Repos for Role-Matched Code Review Challenges
-- (STRATEGY.md CR-13, repo-discovery-pipeline.md)
--
-- Stores repos discovered via Libraries.io + GitHub API, quality-scored,
-- and accepted by recruiters for conversion into CODE_REVIEW challenge templates.

-- ─── discovered_repos ──────────────────────────────────────────────────────

CREATE TABLE discovered_repos (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  role_context_id TEXT REFERENCES role_contexts(id),
  owner_id TEXT NOT NULL,

  -- GitHub identity
  github_owner TEXT NOT NULL,
  github_repo TEXT NOT NULL,
  github_url TEXT NOT NULL,
  default_branch TEXT,

  -- Discovery metadata
  discovery_source TEXT NOT NULL CHECK (discovery_source IN (
    'LIBRARIES_IO', 'GITHUB_TOPICS', 'SOURCEGRAPH', 'MANUAL'
  )),
  discovery_query TEXT,

  -- GitHub quality signals (Stage 2 — in-Worker)
  stars INTEGER,
  last_pushed_at TEXT,
  license TEXT,
  is_archived INTEGER DEFAULT 0,
  is_fork INTEGER DEFAULT 0,
  has_ci INTEGER,
  primary_language TEXT,
  topics TEXT,

  -- Stack analysis (Stage 3 — offline, nullable until assessed)
  detected_stack TEXT,
  stack_match_score REAL,

  -- Complexity scoring (Stage 4 — offline, nullable until assessed)
  sloc INTEGER,
  mean_cyclomatic_complexity REAL,
  source_file_count INTEGER,
  seniority_band TEXT CHECK (seniority_band IN ('JUNIOR', 'MID', 'SENIOR', 'STAFF') OR seniority_band IS NULL),

  -- Quality composite
  quality_score REAL,
  quality_details TEXT,

  -- Workflow status
  status TEXT NOT NULL DEFAULT 'DISCOVERING' CHECK (status IN (
    'DISCOVERING', 'DISCOVERED', 'ASSESSED', 'ACCEPTED', 'REJECTED',
    'CONVERTING', 'CHALLENGE_READY', 'FAILED'
  )),
  rejection_reason TEXT,
  error_message TEXT,

  -- Link to created challenge template (after conversion)
  challenge_template_id TEXT,

  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),

  UNIQUE(pipeline_id, github_owner, github_repo)
);

CREATE INDEX idx_discovered_repos_pipeline ON discovered_repos(pipeline_id);
CREATE INDEX idx_discovered_repos_status ON discovered_repos(status);
CREATE INDEX idx_discovered_repos_quality ON discovered_repos(quality_score);
CREATE INDEX idx_discovered_repos_owner ON discovered_repos(owner_id);

-- ─── discovery_jobs ────────────────────────────────────────────────────────

CREATE TABLE discovery_jobs (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  role_context_id TEXT REFERENCES role_contexts(id),
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN (
    'PENDING', 'RUNNING', 'COMPLETED', 'FAILED'
  )),
  skills_queried TEXT,
  total_candidates INTEGER DEFAULT 0,
  total_passed INTEGER DEFAULT 0,
  total_rejected INTEGER DEFAULT 0,
  error_message TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_discovery_jobs_pipeline ON discovery_jobs(pipeline_id);
CREATE INDEX idx_discovery_jobs_status ON discovery_jobs(status);

-- ─── Extend challenge_templates to support CODE_REVIEW ─────────────────────
-- SQLite can't ALTER CHECK constraints, so we recreate the table.

CREATE TABLE challenge_templates_new (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  type TEXT NOT NULL CHECK (type IN ('CODE_REVIEW', 'CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER')),
  title TEXT NOT NULL,
  instructions TEXT,
  difficulty TEXT CHECK (difficulty IN ('JUNIOR', 'MID', 'SENIOR')),
  primary_skill TEXT,
  secondary_skills TEXT,
  bloom_level TEXT CHECK (bloom_level IN ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create')),
  estimated_minutes INTEGER,
  config TEXT,
  server_config TEXT,
  source TEXT NOT NULL DEFAULT 'USER_CREATED' CHECK (source IN ('SYSTEM', 'AI_GENERATED', 'USER_CREATED')),
  is_published INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO challenge_templates_new SELECT * FROM challenge_templates;
DROP TABLE challenge_templates;
ALTER TABLE challenge_templates_new RENAME TO challenge_templates;

CREATE INDEX idx_challenge_templates_type ON challenge_templates(type);
CREATE INDEX idx_challenge_templates_difficulty ON challenge_templates(difficulty);
CREATE INDEX idx_challenge_templates_primary_skill ON challenge_templates(primary_skill);
CREATE INDEX idx_challenge_templates_source ON challenge_templates(source);
CREATE INDEX idx_challenge_templates_published ON challenge_templates(is_published);
