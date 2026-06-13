-- Role node semantic classifications are open data (ADR-043).

PRAGMA foreign_keys = OFF;

CREATE TABLE role_nodes_open_semantics (
  id TEXT PRIMARY KEY,
  role_context_id TEXT NOT NULL,
  rcd_version TEXT NOT NULL,
  node_type TEXT NOT NULL,
  narrative_text TEXT NOT NULL,
  extracted_properties_json TEXT,
  embedding_json TEXT,
  source_section TEXT,
  source_stakeholder TEXT,
  weight REAL,
  superseded_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  ingestion_key TEXT,
  FOREIGN KEY (role_context_id) REFERENCES role_contexts(id) ON DELETE CASCADE
);

INSERT INTO role_nodes_open_semantics (
  id, role_context_id, rcd_version, node_type, narrative_text,
  extracted_properties_json, embedding_json, source_section,
  source_stakeholder, weight, superseded_at, created_at, updated_at,
  ingestion_key
)
SELECT
  id, role_context_id, rcd_version, node_type, narrative_text,
  extracted_properties_json, embedding_json, source_section,
  source_stakeholder, weight, superseded_at, created_at, updated_at,
  ingestion_key
FROM role_nodes;

DROP TABLE role_nodes;
ALTER TABLE role_nodes_open_semantics RENAME TO role_nodes;

CREATE INDEX idx_role_nodes_role_context ON role_nodes(role_context_id);
CREATE INDEX idx_role_nodes_type ON role_nodes(node_type);
CREATE INDEX idx_role_nodes_version ON role_nodes(role_context_id, rcd_version);
CREATE INDEX idx_role_nodes_active
  ON role_nodes(role_context_id, superseded_at)
  WHERE superseded_at IS NULL;
CREATE UNIQUE INDEX idx_role_nodes_ingestion_key
  ON role_nodes(ingestion_key)
  WHERE ingestion_key IS NOT NULL;

PRAGMA foreign_keys = ON;
