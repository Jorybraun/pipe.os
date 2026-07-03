-- 0114_scheduled_interview_copy.sql
--
-- Store recruiter-facing copy on scheduled interviews so repeated candidate
-- meetings and open-source assessment tasks are legible in list/detail views.

ALTER TABLE scheduled_interviews ADD COLUMN title TEXT;
ALTER TABLE scheduled_interviews ADD COLUMN description TEXT;
