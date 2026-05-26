// Additional lookup indexes from unified plan
CREATE INDEX candidate_profile_state IF NOT EXISTS
  FOR (c:Candidate) ON (c.profile_state);

CREATE INDEX repo_admin_status IF NOT EXISTS
  FOR (repo:Repo) ON (repo.admin_status);
