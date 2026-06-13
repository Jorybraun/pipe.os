-- Make the legacy candidate_nodes compatibility projection replay-safe.
ALTER TABLE candidate_nodes ADD COLUMN ingestion_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_nodes_ingestion_key
  ON candidate_nodes(ingestion_key)
  WHERE ingestion_key IS NOT NULL;
