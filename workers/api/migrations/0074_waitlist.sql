-- Waitlist signups from the marketing site
CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT    NOT NULL,
  name       TEXT,
  company    TEXT,
  role       TEXT,
  team_size  TEXT,
  pain_point TEXT,
  message    TEXT,
  created_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(email)
);
