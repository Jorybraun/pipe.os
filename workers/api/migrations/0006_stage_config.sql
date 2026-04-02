-- Migration: 0006_stage_config
-- Adds stage_type and is_scheduled to stages table for configurable interview stages.
-- stage_type: predefined category (SCREENING, CULTURAL, TECHNICAL, CODE_REVIEW, PANEL)
-- is_scheduled: whether candidates receive a scheduling link for this stage

ALTER TABLE stages ADD COLUMN stage_type TEXT DEFAULT NULL;
ALTER TABLE stages ADD COLUMN is_scheduled INTEGER DEFAULT 0;
