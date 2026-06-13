-- Migration 0052: candidate_nodes — addressable sub-element store for the living candidate graph
CREATE TABLE IF NOT EXISTS candidate_nodes (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  narrative_text TEXT NOT NULL,
  extracted_properties_json TEXT,
  embedding_json TEXT,
  source_type TEXT NOT NULL,
  source_reference TEXT,
  captured_at INTEGER NOT NULL,
  confidence REAL CHECK(confidence BETWEEN 0 AND 1),
  supersedes TEXT REFERENCES candidate_nodes(id),
  superseded_at INTEGER,
  decomposition_version TEXT,
  pending_graph_backfill INTEGER DEFAULT 0 CHECK(pending_graph_backfill IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_candidate_nodes_candidate ON candidate_nodes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_type ON candidate_nodes(candidate_id, node_type);
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_active ON candidate_nodes(candidate_id, superseded_at) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_source ON candidate_nodes(candidate_id, source_type);
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_captured ON candidate_nodes(candidate_id, captured_at);
