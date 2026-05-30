-- Migration: 0073_participant_domain_state
-- Persist domain-driven interview state (column-by-column tracking) to DB.
-- Without this, a page refresh loses domain progress and regenerates questions non-deterministically.

ALTER TABLE role_context_participants ADD COLUMN domain_state TEXT;
