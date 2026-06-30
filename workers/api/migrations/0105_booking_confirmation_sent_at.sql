-- 0105_booking_confirmation_sent_at.sql
-- Track post-booking confirmation emails separately from the original invite
-- email so provider webhooks can send exactly one room-link confirmation.

ALTER TABLE scheduled_interviews ADD COLUMN booking_confirmation_sent_at TEXT;
