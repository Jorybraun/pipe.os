-- Migration 0080: pending graph backfill compatibility
--
-- Fresh databases receive this column from 0052_candidate_nodes.sql.

CREATE INDEX IF NOT EXISTS idx_candidate_nodes_pending_backfill
  ON candidate_nodes(pending_graph_backfill) WHERE pending_graph_backfill = 1;
