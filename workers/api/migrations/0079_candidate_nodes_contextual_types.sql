-- Migration 0079: contextual candidate node compatibility
--
-- Fresh databases receive the expanded node types from 0052. Avoid rebuilding
-- this self-referential table in existing D1 databases.

CREATE INDEX IF NOT EXISTS idx_candidate_nodes_candidate ON candidate_nodes(candidate_id);
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_type ON candidate_nodes(candidate_id, node_type);
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_active
  ON candidate_nodes(candidate_id, superseded_at) WHERE superseded_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_source ON candidate_nodes(candidate_id, source_type);
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_captured ON candidate_nodes(candidate_id, captured_at);
