-- Migration: 0067_screening_input_mode
-- Adds screening_input_mode to stages table for ONLINE screening format.
-- Values: text | voice | video (validated in application layer)
-- Default: text — preserves existing behaviour.

ALTER TABLE stages ADD COLUMN screening_input_mode TEXT DEFAULT 'text';
