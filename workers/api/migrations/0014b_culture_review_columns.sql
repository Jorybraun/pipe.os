-- Migration: 0014b_culture_review_columns
-- Adds recruiter HITL review columns to culture_interview_sessions.
-- Required by ADR-031 §2 (Human-in-the-Loop gate before report release).
--
-- These columns are separate from 0014 because the table shipped first and
-- the review gate was finalized as part of the route design iteration.

ALTER TABLE culture_interview_sessions
  ADD COLUMN reviewed_at TEXT;

ALTER TABLE culture_interview_sessions
  ADD COLUMN reviewed_by TEXT;

-- 'confirm' | 'override'
ALTER TABLE culture_interview_sessions
  ADD COLUMN review_decision TEXT;

-- Populated only when review_decision = 'override'. Mirrors the scorer's
-- recommendation enum so the downstream report can surface the correct value.
-- 'HIRE' | 'FLAG_FOR_REVIEW' | 'PASS'
ALTER TABLE culture_interview_sessions
  ADD COLUMN override_recommendation TEXT;

ALTER TABLE culture_interview_sessions
  ADD COLUMN review_notes TEXT;
