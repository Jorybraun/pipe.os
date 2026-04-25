-- Migration 0029: Repo Issues for CODE_IMPLEMENTATION Challenges
--
-- Adds issue ingestion pipeline tables for the crawler (RD-P6).
-- PRs are immutable once merged (already in repo_sample_prs).
-- Issues are volatile — can close any time — so we store a snapshot
-- and verify state at runtime before challenge assignment.
--
-- Two tables:
--   repo_issues             — raw issue snapshot from GitHub (weekly crawl)
--   issue_challenge_signals — AI-scored challenge suitability (Gemma 4 26B)
--
-- Design decisions (2026-04-15):
--   - Weekly cron refresh (not on-demand per pipeline)
--   - Skip issues with merged PRs for CODE_IMPLEMENTATION (has_merged_pr flag)
--   - Cloudflare Worker cron (not local script)
--   - Runtime state verification before assignment (issueStateVerifier.ts)

-- ─── repo_issues ────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS repo_issues (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  repo_id             INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,

  -- GitHub identifiers
  github_issue_id     INTEGER NOT NULL,     -- GitHub's global issue ID
  issue_number        INTEGER NOT NULL,     -- Issue number within repo (e.g., #42)

  -- Content snapshot (refreshed on each crawl)
  title               TEXT    NOT NULL,
  body                TEXT,                 -- Markdown, can be null (title-only issues)
  author_login        TEXT    NOT NULL,

  -- Metadata at crawl time
  labels_json         TEXT,                 -- JSON array of label strings
  comment_count       INTEGER NOT NULL DEFAULT 0,
  reactions_total     INTEGER DEFAULT 0,    -- Sum of all reactions (proxy for community interest)

  -- Timestamps from GitHub
  github_created_at   TEXT    NOT NULL,     -- ISO8601
  github_updated_at   TEXT    NOT NULL,     -- ISO8601

  -- Crawl metadata
  crawled_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  state_at_crawl      TEXT    NOT NULL,     -- 'open' | 'closed' — snapshot, NOT authoritative

  -- PR linkage (for filtering CODE_IMPLEMENTATION candidates)
  has_merged_pr       INTEGER NOT NULL DEFAULT 0,  -- 1 if a merged PR resolves this issue

  UNIQUE(repo_id, issue_number)
);

-- Index for lookups by repo
CREATE INDEX IF NOT EXISTS idx_repo_issues_repo
  ON repo_issues(repo_id);

-- Index for finding issues by state (for batch processing)
CREATE INDEX IF NOT EXISTS idx_repo_issues_state
  ON repo_issues(state_at_crawl);

-- Index for filtering out already-implemented issues
CREATE INDEX IF NOT EXISTS idx_repo_issues_pr_linked
  ON repo_issues(has_merged_pr)
  WHERE has_merged_pr = 0;

-- Index for stale issue detection (crawled_at older than threshold)
CREATE INDEX IF NOT EXISTS idx_repo_issues_crawl_freshness
  ON repo_issues(crawled_at);

-- ─── issue_challenge_signals ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS issue_challenge_signals (
  id                      INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_id                INTEGER NOT NULL REFERENCES repo_issues(id) ON DELETE CASCADE,

  -- AI-generated scores (0.0 - 1.0)
  implementability_score  REAL,     -- Can someone unfamiliar implement this?
  clarity_score           REAL,     -- Is the problem statement clear?
  scope_score             REAL,     -- Right-sized? (not too big, not trivial)
  isolation_score         REAL,     -- Can be done without touching half the codebase?

  -- Derived difficulty band
  difficulty_band         TEXT CHECK (difficulty_band IN ('junior', 'mid', 'senior') OR difficulty_band IS NULL),

  -- AI rationale (for debugging + recruiter transparency)
  assessment_narrative    TEXT,     -- 2-3 sentence explanation

  -- Disqualification
  disqualified            INTEGER NOT NULL DEFAULT 0,
  disqualified_reason     TEXT,     -- 'too_vague' | 'too_large' | 'requires_maintainer' | 'staff_level' | etc.

  -- Provenance
  signals_version         INTEGER NOT NULL DEFAULT 1,
  model_used              TEXT    NOT NULL,   -- e.g., '@cf/google/gemma-4-26b-a4b-it'
  generated_at            TEXT    NOT NULL DEFAULT (datetime('now')),

  -- One assessment per issue (re-run replaces)
  UNIQUE(issue_id)
);

-- Index for filtering qualified issues by difficulty
CREATE INDEX IF NOT EXISTS idx_issue_signals_difficulty
  ON issue_challenge_signals(difficulty_band)
  WHERE disqualified = 0;

-- Note: Finding unscored issues is done via LEFT JOIN in the scorer query,
-- not via a partial index (SQLite doesn't allow subqueries in WHERE clauses).

-- ─── crawler_state (for resumable batch operations) ─────────────────────────

CREATE TABLE IF NOT EXISTS crawler_state (
  key         TEXT PRIMARY KEY,
  value_json  TEXT NOT NULL,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Seed the issue crawler state
INSERT OR IGNORE INTO crawler_state (key, value_json) VALUES
  ('issue_crawler_cursor', '{"last_repo_id": 0}'),
  ('issue_scorer_cursor', '{"last_issue_id": 0}');
