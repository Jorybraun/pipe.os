-- Migration 0025: Dev-container exchange tokens for iframe auth (ADR-037 security fix).
--
-- The candidate JWT should not be embedded in iframe URLs because it leaks via
-- Referer headers and browser history. Instead, the client requests a short-lived,
-- single-use exchange token that the proxy swaps for session validation on first use.
--
-- Exchange tokens are:
--   - 30-second TTL (enough for the iframe to load)
--   - Single-use (consumed_at is set on first use, subsequent uses rejected)
--   - Scoped to a specific session_id (cannot be used for other sessions)

CREATE TABLE dev_container_exchange_tokens (
  id TEXT PRIMARY KEY,
  token TEXT NOT NULL UNIQUE,
  session_id TEXT NOT NULL,
  candidate_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_exchange_tokens_token ON dev_container_exchange_tokens(token);
CREATE INDEX idx_exchange_tokens_session ON dev_container_exchange_tokens(session_id);
CREATE INDEX idx_exchange_tokens_expires ON dev_container_exchange_tokens(expires_at);
