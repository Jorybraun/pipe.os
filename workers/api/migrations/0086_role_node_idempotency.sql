-- Make role decomposition authoritative in D1 and replay-safe.

ALTER TABLE role_nodes ADD COLUMN ingestion_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_role_nodes_ingestion_key
  ON role_nodes(ingestion_key)
  WHERE ingestion_key IS NOT NULL;
