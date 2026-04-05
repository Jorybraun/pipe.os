-- Migration: 0009_screening_format
-- Adds screening_format to stages table.
-- Values: PHONE_CALL, VIDEO_CALL, ONLINE (validated in application layer)

ALTER TABLE stages ADD COLUMN screening_format TEXT DEFAULT NULL;
