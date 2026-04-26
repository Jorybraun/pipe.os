CREATE TABLE situation_fit_cache (
  cache_key TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  repo_id INTEGER NOT NULL,
  profile_version TEXT,
  signals_version TEXT,
  result_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_situation_fit_lookup ON situation_fit_cache(candidate_id, repo_id);
