-- 0110_meeting_agent_feature_flag.sql
-- Enables real AI-agent room affordances without tying the schema to a UI mascot.

ALTER TABLE meetings ADD COLUMN agent_enabled INTEGER NOT NULL DEFAULT 1;
