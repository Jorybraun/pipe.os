-- 0016_email_connections.sql
-- OAuth connections for sending email from recruiter's own Gmail/Microsoft account.

CREATE TABLE IF NOT EXISTS email_connections (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  provider_id TEXT NOT NULL CHECK (provider_id IN ('GMAIL', 'MICROSOFT')),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expiry TEXT,
  account_email TEXT NOT NULL,
  account_name TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'EXPIRED', 'REVOKED')),
  connected_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_email_connections_owner ON email_connections(owner_id);
CREATE INDEX idx_email_connections_owner_status ON email_connections(owner_id, status);
