-- Migration: 0010_stage_config_columns
-- Adds stage_type and is_scheduled to stages table for stage config wizard.

ALTER TABLE stages ADD COLUMN stage_type TEXT DEFAULT NULL;
ALTER TABLE stages ADD COLUMN is_scheduled INTEGER DEFAULT 0;
