-- 0096_room_scoped_dev_container_sessions.sql
-- Allow live interview rooms to own dev-container sessions without fabricating
-- candidate or pipeline records. Candidate sessions remain supported.

CREATE TABLE IF NOT EXISTS dev_container_sessions_next (
  id               TEXT PRIMARY KEY,
  session_id       TEXT NOT NULL UNIQUE,
  candidate_id     TEXT REFERENCES candidates(id) ON DELETE CASCADE,
  challenge_id     TEXT REFERENCES challenges(id) ON DELETE SET NULL,
  pipeline_id      TEXT REFERENCES pipelines(id) ON DELETE CASCADE,
  meeting_id       TEXT REFERENCES meetings(id) ON DELETE CASCADE,
  meeting_room_id  TEXT REFERENCES meeting_rooms(id) ON DELETE CASCADE,
  owner_id         TEXT,
  access_scope     TEXT NOT NULL DEFAULT 'candidate'
                   CHECK (access_scope IN ('candidate','meeting_room')),
  status           TEXT NOT NULL DEFAULT 'LAUNCHING'
                   CHECK (status IN ('LAUNCHING','READY','SLEEPING','ERROR','STOPPED','EXPIRED')),
  instance_type    TEXT NOT NULL DEFAULT 'standard-1',
  ttl_seconds      INTEGER NOT NULL,
  ttl_source       TEXT NOT NULL CHECK (ttl_source IN ('GLOBAL','CHALLENGE','OVERRIDE')),
  expires_at       TEXT NOT NULL,
  warned_at        TEXT,
  url              TEXT,
  repo_r2_key      TEXT,
  repo_git_url     TEXT,
  challenge_branch TEXT,
  base_branch      TEXT,
  started_at       TEXT,
  stopped_at       TEXT,
  error_message    TEXT,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (
    (access_scope = 'candidate' AND candidate_id IS NOT NULL AND pipeline_id IS NOT NULL)
    OR
    (access_scope = 'meeting_room' AND meeting_id IS NOT NULL AND meeting_room_id IS NOT NULL)
  )
);

INSERT INTO dev_container_sessions_next (
  id, session_id, candidate_id, challenge_id, pipeline_id,
  status, instance_type, ttl_seconds, ttl_source, expires_at,
  warned_at, url, repo_r2_key, repo_git_url, challenge_branch, base_branch,
  started_at, stopped_at, error_message, created_at, updated_at,
  meeting_id, meeting_room_id, owner_id, access_scope
)
SELECT
  id, session_id, candidate_id, challenge_id, pipeline_id,
  status, instance_type, ttl_seconds, ttl_source, expires_at,
  warned_at, url, repo_r2_key, repo_git_url, challenge_branch, base_branch,
  started_at, stopped_at, error_message, created_at, updated_at,
  NULL, NULL, NULL, 'candidate'
FROM dev_container_sessions;

DROP TABLE dev_container_sessions;
ALTER TABLE dev_container_sessions_next RENAME TO dev_container_sessions;

CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_candidate
  ON dev_container_sessions(candidate_id);
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_pipeline
  ON dev_container_sessions(pipeline_id);
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_status
  ON dev_container_sessions(status);
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_expires
  ON dev_container_sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_room
  ON dev_container_sessions(meeting_room_id, created_at);
CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_meeting
  ON dev_container_sessions(meeting_id, created_at);
