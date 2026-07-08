-- 0115: Optional job description on scheduled interviews.
--
-- Recruiters can paste a job description when creating an invite
-- (docs/plans/design-recruiter-invite-creation-mvp.md §10). Stored on the
-- interview row; recruiter-facing only — never rendered into candidate
-- surfaces or invite emails (only a derived role title appears there).

ALTER TABLE scheduled_interviews ADD COLUMN job_description TEXT;
