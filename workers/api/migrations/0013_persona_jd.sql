-- Migration: 0013_persona_jd
-- Role Discovery v2: Persona + JD output artifacts.
-- The synthesis used to be an ephemeral narrative string returned only in the HTTP
-- response. Now the agent produces two structured artifacts on COMPLETE:
--   - persona_json: CandidatePersona (structured JSON) — the internal hiring truth
--   - job_description_md: Markdown JD ready to post or send to a candidate
-- Both live on role_contexts (not per-participant) because they are the merged,
-- canonical output across all stakeholders (ADR-028).

ALTER TABLE role_contexts ADD COLUMN persona_json TEXT;
ALTER TABLE role_contexts ADD COLUMN job_description_md TEXT;
