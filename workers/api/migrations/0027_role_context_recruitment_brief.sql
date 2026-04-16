-- RD-P5: Add recruitment_brief_json column to role_contexts.
-- Stores the RecruitmentBrief artifact emitted at synthesis time (recruiter outreach artifact,
-- distinct from the RoleContextDocument which serves the scorecard). Null until synthesis runs.
ALTER TABLE role_contexts ADD COLUMN recruitment_brief_json TEXT;
