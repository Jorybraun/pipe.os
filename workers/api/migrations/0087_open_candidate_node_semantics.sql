-- Candidate node semantic classifications are open data (ADR-043).
-- Rebuild the compatibility table to remove the legacy node_type whitelist.

PRAGMA foreign_keys = OFF;

CREATE TABLE candidate_nodes_open_semantics (
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
  supersedes TEXT REFERENCES candidate_nodes_open_semantics(id),
  superseded_at INTEGER,
  decomposition_version TEXT,
  pending_graph_backfill INTEGER DEFAULT 0 CHECK(pending_graph_backfill IN (0, 1)),
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ingestion_key TEXT
);

INSERT INTO candidate_nodes_open_semantics (
  id, candidate_id, node_type, narrative_text, extracted_properties_json,
  embedding_json, source_type, source_reference, captured_at, confidence,
  supersedes, superseded_at, decomposition_version, pending_graph_backfill,
  created_at, updated_at, ingestion_key
)
SELECT
  id, candidate_id, node_type, narrative_text, extracted_properties_json,
  embedding_json, source_type, source_reference, captured_at, confidence,
  supersedes, superseded_at, decomposition_version,
  COALESCE(pending_graph_backfill, 0), created_at, updated_at, ingestion_key
FROM candidate_nodes;

DROP TABLE candidate_nodes;
ALTER TABLE candidate_nodes_open_semantics RENAME TO candidate_nodes;

CREATE INDEX idx_candidate_nodes_candidate ON candidate_nodes(candidate_id);
CREATE INDEX idx_candidate_nodes_type ON candidate_nodes(candidate_id, node_type);
CREATE INDEX idx_candidate_nodes_active
  ON candidate_nodes(candidate_id, superseded_at)
  WHERE superseded_at IS NULL;
CREATE INDEX idx_candidate_nodes_source ON candidate_nodes(candidate_id, source_type);
CREATE INDEX idx_candidate_nodes_captured ON candidate_nodes(candidate_id, captured_at);
CREATE INDEX idx_candidate_nodes_pending_backfill
  ON candidate_nodes(pending_graph_backfill)
  WHERE pending_graph_backfill = 1;
CREATE UNIQUE INDEX idx_candidate_nodes_ingestion_key
  ON candidate_nodes(ingestion_key)
  WHERE ingestion_key IS NOT NULL;

PRAGMA foreign_keys = ON;
