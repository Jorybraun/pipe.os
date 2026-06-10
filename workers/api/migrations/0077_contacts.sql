-- 0077_contacts.sql
-- Unified contacts table: candidates, leads, customers, hiring managers — any person

CREATE TABLE IF NOT EXISTS contacts (
  id          TEXT PRIMARY KEY,
  owner_id    TEXT NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT,
  company     TEXT,
  role        TEXT,
  phone       TEXT,
  linkedin    TEXT,
  notes       TEXT,
  type        TEXT NOT NULL DEFAULT 'lead',  -- lead | candidate | customer | other
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_owner   ON contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_email   ON contacts(owner_id, email);
