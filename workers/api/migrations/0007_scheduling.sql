-- 0007_scheduling.sql
-- Scheduling system: OAuth connections + scheduled interviews

CREATE TABLE IF NOT EXISTS scheduling_connections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('CALENDLY', 'CAL_COM')),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry TEXT,
  account_email TEXT,
  account_name TEXT,
  webhook_secret TEXT,
  webhook_id TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  connected_at TEXT NOT NULL,
  last_sync_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_scheduling_connections_owner ON scheduling_connections(owner_id);
CREATE INDEX idx_scheduling_connections_status ON scheduling_connections(owner_id, status);

CREATE TABLE IF NOT EXISTS scheduled_interviews (
  id TEXT PRIMARY KEY,
  candidate_id TEXT NOT NULL REFERENCES candidates(id),
  pipeline_id TEXT NOT NULL REFERENCES pipelines(id),
  stage_id TEXT NOT NULL REFERENCES stages(id),
  owner_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW')),
  scheduled_at TEXT,
  meeting_url TEXT,
  scheduling_provider TEXT CHECK (scheduling_provider IN ('CALENDLY', 'CAL_COM', 'MANUAL')),
  scheduling_url TEXT,
  external_event_id TEXT,
  recruiter_notes TEXT,
  sync_source TEXT CHECK (sync_source IN ('MANUAL', 'WEBHOOK')),
  last_synced_at TEXT,
  invite_link_sent_at TEXT,
  email_sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_scheduled_interviews_candidate ON scheduled_interviews(candidate_id);
CREATE INDEX idx_scheduled_interviews_pipeline ON scheduled_interviews(pipeline_id);
CREATE INDEX idx_scheduled_interviews_external ON scheduled_interviews(external_event_id);
CREATE INDEX idx_scheduled_interviews_owner_status ON scheduled_interviews(owner_id, status);
