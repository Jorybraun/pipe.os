// Neo4j constraints for PIPE graph schema
// Run against a fresh Neo4j 5.11+ instance

// ─── Uniqueness constraints on root entities ──────────────────────────────────
CREATE CONSTRAINT candidate_id_unique IF NOT EXISTS
  FOR (c:Candidate) REQUIRE c.candidate_id IS UNIQUE;

CREATE CONSTRAINT role_id_unique IF NOT EXISTS
  FOR (r:Role) REQUIRE r.role_context_id IS UNIQUE;

CREATE CONSTRAINT repo_id_unique IF NOT EXISTS
  FOR (repo:Repo) REQUIRE repo.repo_id IS UNIQUE;

// NOTE: Property existence constraints require Neo4j Enterprise Edition.
// We enforce NOT NULL at the application layer instead.

// ─── Lookup indexes for common query patterns ─────────────────────────────────
CREATE INDEX candidate_last_engaged IF NOT EXISTS
  FOR (c:Candidate) ON (c.last_engaged_at);

CREATE INDEX role_pipeline_id IF NOT EXISTS
  FOR (r:Role) ON (r.pipeline_id);

CREATE INDEX repo_github_url IF NOT EXISTS
  FOR (repo:Repo) ON (repo.github_url);
