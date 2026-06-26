-- 0098_meeting_feature_flags.sql
-- Configurable feature flags per meeting: video, workspace, recording, clippy.

ALTER TABLE meetings ADD COLUMN video_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meetings ADD COLUMN workspace_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meetings ADD COLUMN recording_enabled INTEGER NOT NULL DEFAULT 1;
ALTER TABLE meetings ADD COLUMN clippy_enabled INTEGER NOT NULL DEFAULT 1;
