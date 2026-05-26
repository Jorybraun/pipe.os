-- Migration 0055: Add implementation scoring columns to challenge_submissions
ALTER TABLE challenge_submissions ADD COLUMN score_report_json TEXT;
ALTER TABLE challenge_submissions ADD COLUMN hitl_status TEXT CHECK(hitl_status IN ('PENDING_REVIEW', 'CONFIRMED', 'OVERRIDDEN'));
