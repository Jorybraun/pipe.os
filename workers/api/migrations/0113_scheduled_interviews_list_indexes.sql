-- 0113_scheduled_interviews_list_indexes.sql
--
-- Speed up the recruiter /api/v1/scheduling/interviews first page. The list is
-- always scoped by owner, ordered newest-created first, and enriches each row
-- with the latest meeting, guest presence, and latest workspace session.

CREATE INDEX IF NOT EXISTS idx_scheduled_interviews_owner_created
  ON scheduled_interviews(owner_id, created_at DESC, id ASC);

CREATE INDEX IF NOT EXISTS idx_meetings_owner_interview_created
  ON meetings(owner_id, scheduled_interview_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_presence
  ON meeting_participants(meeting_id, role, joined_at, left_at);

CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_meeting_updated
  ON dev_container_sessions(meeting_id, updated_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dev_container_sessions_room_updated
  ON dev_container_sessions(meeting_room_id, updated_at DESC, created_at DESC);
