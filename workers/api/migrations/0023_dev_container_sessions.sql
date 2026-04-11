-- Migration 0023: Dev Container Sessions (Phase 3b — Cloudflare Containers)
--
-- Source of truth for recruiter-visible dev container session state.
-- The DevContainerDO writes here on every state transition. Recruiters and
-- the candidate UI read from here. The DO's own ctx.storage holds live
-- config (env vars, alarms) that is opaque outside the DO instance.
--
-- TTL model (see ADR-037): ttl_seconds + ttl_source identify where the
-- effective TTL came from (GLOBAL default, per-CHALLENGE, or per-launch
-- OVERRIDE). expires_at is computed at launch; warned_at is written by the
-- DO's 60-second-before-expiry alarm so the frontend can surface a toast.
-- status='EXPIRED' distinguishes TTL auto-destroy from manual 'STOPPED'.

CREATE TABLE dev_container_sessions (
  id              TEXT PRIMARY KEY,                 -- ULID
  session_id      TEXT NOT NULL UNIQUE,             -- UUID; used as DO name and in URLs
  candidate_id    TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  challenge_id    TEXT REFERENCES challenges(id) ON DELETE SET NULL,
  pipeline_id     TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  status          TEXT NOT NULL DEFAULT 'LAUNCHING'
                  CHECK (status IN ('LAUNCHING','READY','SLEEPING','ERROR','STOPPED','EXPIRED')),
  instance_type   TEXT NOT NULL DEFAULT 'standard-1',
  ttl_seconds     INTEGER NOT NULL,
  ttl_source      TEXT NOT NULL CHECK (ttl_source IN ('GLOBAL','CHALLENGE','OVERRIDE')),
  expires_at      TEXT NOT NULL,                    -- ISO timestamp
  warned_at       TEXT,                             -- ISO timestamp when warn alarm fired
  url             TEXT,                             -- Worker proxy URL when status='READY'
  repo_r2_key     TEXT,
  challenge_branch TEXT,
  base_branch     TEXT,
  started_at      TEXT,
  stopped_at      TEXT,
  error_message   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_dev_container_sessions_candidate ON dev_container_sessions(candidate_id);
CREATE INDEX idx_dev_container_sessions_pipeline  ON dev_container_sessions(pipeline_id);
CREATE INDEX idx_dev_container_sessions_status    ON dev_container_sessions(status);
CREATE INDEX idx_dev_container_sessions_expires   ON dev_container_sessions(expires_at);

-- Per-challenge TTL override. NULL means: fall back to DEV_CONTAINER_DEFAULT_TTL_SECONDS.
ALTER TABLE challenges ADD COLUMN dev_container_ttl_seconds INTEGER;
