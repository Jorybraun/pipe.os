-- Sourcing pool: lightweight cache of discovered people per workspace.
-- Ephemeral — expires after 30 days of no interaction. Promoted to the living
-- context graph on first Call, Email, or Invite.

CREATE TABLE IF NOT EXISTS sourcing_pool (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  pdl_id TEXT,                              -- PDL person ID (if from PDL)
  query_hash TEXT NOT NULL,                 -- hash of search params that found them
  data_json TEXT NOT NULL,                -- full PDL profile snapshot
  status TEXT DEFAULT 'discovered' NOT NULL,
  -- 'discovered' | 'flagged' | 'dismissed' | 'contacted' | 'converted'
  person_id TEXT,                           -- FK to people.id once promoted
  interaction_count INTEGER DEFAULT 0,      -- how many times we reached out
  last_interacted_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  expires_at TEXT NOT NULL                  -- auto-cull after 30 days
);

CREATE INDEX IF NOT EXISTS idx_sourcing_pool_workspace_query
  ON sourcing_pool(workspace_id, query_hash, status);
CREATE INDEX IF NOT EXISTS idx_sourcing_pool_workspace_status
  ON sourcing_pool(workspace_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sourcing_pool_expires
  ON sourcing_pool(expires_at)
  WHERE status IN ('discovered', 'flagged');
CREATE UNIQUE INDEX IF NOT EXISTS idx_sourcing_pool_unique_pdl
  ON sourcing_pool(workspace_id, pdl_id) WHERE pdl_id IS NOT NULL;
