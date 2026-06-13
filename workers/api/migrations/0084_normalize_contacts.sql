-- The conflicting 0075/0077 contact definitions now share one canonical
-- schema. Keep this migration as a guarded index repair for databases that
-- initialized contacts before the consolidation.

CREATE INDEX IF NOT EXISTS idx_contacts_owner ON contacts(owner_id);
CREATE INDEX IF NOT EXISTS idx_contacts_owner_type ON contacts(owner_id, type);
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts(owner_id, email);
