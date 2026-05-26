-- Migration 0050: repo_nodes — addressable sub-element decomposition for Pass 3 repos
--
-- Phase 2 of repo decomposition strategy. Turns Pass 3's labeled blob into
-- addressable repo_nodes sub-elements, same pattern as role_nodes.
--
-- Each sub-element gets its own embedding (rich narrative with type prefix).
-- Regenerated per Pass 3 run, pointed back to the originating Pass 2 signals.

CREATE TABLE IF NOT EXISTS repo_nodes (
  id TEXT PRIMARY KEY,
  repo_id INTEGER NOT NULL REFERENCES qualified_repos(id),
  signals_version TEXT NOT NULL,
  node_type TEXT NOT NULL CHECK(node_type IN ('Feature','ArchitecturalPattern','TechnicalStack','Construct','ChallengeSurface','QualitySignal','DomainContext','PRSample','IssueCandidate')),
  narrative_text TEXT NOT NULL,
  extracted_properties_json TEXT,
  embedding_json TEXT,
  source_reference TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_repo_nodes_repo_type
  ON repo_nodes(repo_id, node_type);

CREATE INDEX IF NOT EXISTS idx_repo_nodes_repo_version
  ON repo_nodes(repo_id, signals_version);
