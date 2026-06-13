-- Compatibility duplicate retained for migration history.
-- The canonical schema is defined in 0075_contacts.sql.

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  email TEXT,
  name TEXT,
  company TEXT,
  role TEXT,
  phone TEXT,
  linkedin TEXT,
  notes TEXT,
  type TEXT NOT NULL DEFAULT 'lead'
    CHECK(type IN ('lead', 'candidate', 'customer', 'hiring_manager', 'recruiter', 'other')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_type ON contacts(owner_id, type);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(owner_id, email);
