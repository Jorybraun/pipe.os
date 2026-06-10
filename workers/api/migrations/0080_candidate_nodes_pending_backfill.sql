-- Migration 0080: Add pending_graph_backfill column to candidate_nodes for Neo4j backfill
ALTER TABLE candidate_nodes ADD COLUMN pending_graph_backfill INTEGER DEFAULT 0 CHECK(pending_graph_backfill IN (0, 1));
CREATE INDEX IF NOT EXISTS idx_candidate_nodes_pending_backfill ON candidate_nodes(pending_graph_backfill) WHERE pending_graph_backfill = 1;
