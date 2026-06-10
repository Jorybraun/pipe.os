-- 0075_contacts.sql
-- Unified contacts table: prospects, candidates, hiring managers, recruiters, etc.

CREATE TABLE IF NOT EXISTS contacts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'OTHER' CHECK (type IN ('PROSPECT', 'CANDIDATE', 'HIRING_MANAGER', 'RECRUITER', 'OTHER')),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  company TEXT,
  title TEXT,
  notes TEXT,
  candidate_id TEXT REFERENCES candidates(id),
  tags TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX idx_contacts_owner ON contacts(owner_id);
CREATE INDEX idx_contacts_owner_type ON contacts(owner_id, type);
CREATE INDEX idx_contacts_email ON contacts(email);
CREATE INDEX idx_contacts_candidate ON contacts(candidate_id);
