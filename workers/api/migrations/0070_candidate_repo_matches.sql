-- Migration 0070: Top-3 ranked repo matches per candidate
--
-- Stores the ranked shortlist from runMatchAndAssign so recruiters can see
-- alternative repos beyond the single winner assigned to the candidate.
-- Updated dynamically as the candidate graph grows (post-screener re-matching).

CREATE TABLE IF NOT EXISTS candidate_repo_matches (
  id              TEXT PRIMARY KEY,
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  repo_id         INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,
  rank            INTEGER NOT NULL CHECK (rank >= 1 AND rank <= 3),
  triangulated_score REAL,
  dimensions_json TEXT,
  rationale       TEXT,
  pr_number       INTEGER,
  issue_number    INTEGER,
  location_tag    TEXT,          -- candidate location used at match time
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE(candidate_id, rank)
);

CREATE INDEX IF NOT EXISTS idx_candidate_repo_matches_candidate
  ON candidate_repo_matches(candidate_id);
