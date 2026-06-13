-- Migration 0049: role_nodes — derivative sub-element view of RCDs
CREATE TABLE IF NOT EXISTS role_nodes (
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
  FOREIGN KEY (role_context_id) REFERENCES role_contexts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_role_nodes_role_context ON role_nodes(role_context_id);
CREATE INDEX IF NOT EXISTS idx_role_nodes_type ON role_nodes(node_type);
CREATE INDEX IF NOT EXISTS idx_role_nodes_version ON role_nodes(role_context_id, rcd_version);
CREATE INDEX IF NOT EXISTS idx_role_nodes_active ON role_nodes(role_context_id, superseded_at) WHERE superseded_at IS NULL;
