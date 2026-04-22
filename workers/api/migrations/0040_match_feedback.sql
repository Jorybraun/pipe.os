-- Migration 0040: Match feedback table
--
-- Empirical foundation for tuning triangulation weights and validating that
-- meaning-based matching outperforms token matching. Recruiters thumbs up/down
-- per match; the scores that produced the match are recorded for offline
-- analysis.
--
-- See ADR-040 Meaning-Based Candidate-Repo-Role Triangulation.

CREATE TABLE match_feedback (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  repo_id INTEGER REFERENCES qualified_repos(id) ON DELETE SET NULL,
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  thumb TEXT CHECK (thumb IN ('up','down')) NOT NULL,
  reason TEXT,
  -- Record the scores that produced this match for later analysis
  triangulated_score REAL,
  role_repo_alignment REAL,
  candidate_repo_fit REAL,
  role_candidate_cosine REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_match_feedback_candidate ON match_feedback(candidate_id);
CREATE INDEX idx_match_feedback_pipeline ON match_feedback(pipeline_id);
CREATE INDEX idx_match_feedback_repo ON match_feedback(repo_id);
