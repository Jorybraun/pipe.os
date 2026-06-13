-- Source-backed repository graph and deterministic candidate-to-PR match audit.
-- D1 is authoritative; Neo4j and vector indexes are rebuildable projections.

CREATE TABLE IF NOT EXISTS repo_snapshots (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,
  commit_sha TEXT NOT NULL,
  tree_hash TEXT,
  extractor_version TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(repo_id, commit_sha, extractor_version)
);

CREATE TABLE IF NOT EXISTS repo_source_artifacts (
  id TEXT PRIMARY KEY,
  repo_snapshot_id TEXT NOT NULL REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  artifact_type TEXT NOT NULL,
  path TEXT,
  external_reference TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(repo_snapshot_id, artifact_type, path, external_reference)
);

CREATE TABLE IF NOT EXISTS repo_artifact_versions (
  id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES repo_source_artifacts(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  storage_key TEXT,
  inline_content TEXT,
  byte_length INTEGER NOT NULL,
  media_type TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(artifact_id, content_hash)
);

CREATE TABLE IF NOT EXISTS repo_source_spans (
  id TEXT PRIMARY KEY,
  artifact_version_id TEXT NOT NULL REFERENCES repo_artifact_versions(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  path TEXT,
  byte_start INTEGER,
  byte_end INTEGER,
  line_start INTEGER,
  line_end INTEGER,
  pr_side TEXT,
  base_sha TEXT,
  head_sha TEXT,
  exact_text TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(artifact_version_id, byte_start, byte_end, pr_side)
);

CREATE TABLE IF NOT EXISTS repo_symbols (
  id TEXT PRIMARY KEY,
  repo_snapshot_id TEXT NOT NULL REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  language TEXT NOT NULL,
  qualified_name TEXT NOT NULL,
  symbol_kind TEXT NOT NULL,
  signature TEXT,
  containing_symbol_id TEXT REFERENCES repo_symbols(id),
  defining_span_id TEXT NOT NULL REFERENCES repo_source_spans(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(repo_snapshot_id, language, qualified_name, symbol_kind)
);

CREATE TABLE IF NOT EXISTS repo_structural_facts (
  id TEXT PRIMARY KEY,
  repo_snapshot_id TEXT NOT NULL REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  fact_type TEXT NOT NULL,
  subject_symbol_id TEXT REFERENCES repo_symbols(id),
  object_symbol_id TEXT REFERENCES repo_symbols(id),
  source_span_id TEXT NOT NULL REFERENCES repo_source_spans(id),
  properties_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS repo_code_episodes (
  id TEXT PRIMARY KEY,
  repo_snapshot_id TEXT NOT NULL REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  episode_type TEXT NOT NULL,
  narrative TEXT NOT NULL,
  member_ids_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS repo_semantic_assertions (
  id TEXT PRIMARY KEY,
  repo_snapshot_id TEXT NOT NULL REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  episode_id TEXT REFERENCES repo_code_episodes(id),
  subject TEXT NOT NULL,
  predicate TEXT NOT NULL,
  object TEXT,
  narrative TEXT NOT NULL,
  qualifiers_json TEXT NOT NULL DEFAULT '{}',
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  assertion_version TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS repo_assertion_source_spans (
  assertion_id TEXT NOT NULL REFERENCES repo_semantic_assertions(id) ON DELETE CASCADE,
  source_span_id TEXT NOT NULL REFERENCES repo_source_spans(id) ON DELETE CASCADE,
  PRIMARY KEY(assertion_id, source_span_id)
);

CREATE TABLE IF NOT EXISTS repo_facets (
  id TEXT PRIMARY KEY,
  family TEXT NOT NULL,
  slug TEXT NOT NULL,
  label TEXT NOT NULL,
  parent_id TEXT REFERENCES repo_facets(id),
  aliases_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(family, slug)
);

CREATE TABLE IF NOT EXISTS repo_assertion_facets (
  assertion_id TEXT NOT NULL REFERENCES repo_semantic_assertions(id) ON DELETE CASCADE,
  facet_id TEXT NOT NULL REFERENCES repo_facets(id),
  weight REAL NOT NULL DEFAULT 1 CHECK(weight >= 0 AND weight <= 1),
  PRIMARY KEY(assertion_id, facet_id)
);

CREATE TABLE IF NOT EXISTS repo_signals (
  id TEXT PRIMARY KEY,
  repo_snapshot_id TEXT NOT NULL REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  facet_id TEXT REFERENCES repo_facets(id),
  narrative TEXT NOT NULL,
  confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
  evidence_assertion_ids_json TEXT NOT NULL,
  signal_version TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(repo_snapshot_id, facet_id, signal_version)
);

CREATE TABLE IF NOT EXISTS review_challenge_packets (
  id TEXT PRIMARY KEY,
  repo_snapshot_id TEXT NOT NULL REFERENCES repo_snapshots(id) ON DELETE CASCADE,
  repo_id INTEGER NOT NULL REFERENCES qualified_repos(id) ON DELETE CASCADE,
  pr_number INTEGER NOT NULL,
  packet_version TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  language TEXT,
  production_ready INTEGER NOT NULL DEFAULT 0 CHECK(production_ready IN (0, 1)),
  quality_score REAL NOT NULL CHECK(quality_score BETWEEN 0 AND 1),
  demand_families_json TEXT NOT NULL,
  packet_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  UNIQUE(repo_snapshot_id, pr_number, packet_version)
);

CREATE INDEX IF NOT EXISTS idx_review_challenge_packets_eligible
  ON review_challenge_packets(production_ready, quality_score, repo_id);

CREATE TABLE IF NOT EXISTS match_runs (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  application_id TEXT,
  role_context_id TEXT,
  candidate_snapshot_id TEXT NOT NULL,
  role_snapshot_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  model_version TEXT,
  status TEXT NOT NULL CHECK(status IN (
    'MATCHED', 'NEEDS_MORE_EVIDENCE', 'NO_ROLE_SAFE_CHALLENGE', 'FAILED'
  )),
  query_json TEXT NOT NULL,
  recalled_packets_json TEXT NOT NULL,
  excluded_packets_json TEXT NOT NULL,
  ranked_results_json TEXT NOT NULL,
  selected_packet_id TEXT REFERENCES review_challenge_packets(id),
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_match_runs_candidate_created
  ON match_runs(candidate_id, created_at DESC);
