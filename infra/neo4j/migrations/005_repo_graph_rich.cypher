-- Migration 005: Rich repo graph schema
-- Run after ingesting repos with ingestReposToNeo4j.ts

-- Uniqueness constraints
CREATE CONSTRAINT repo_repo_id_unique IF NOT EXISTS
  FOR (r:Repo) REQUIRE r.repo_id IS UNIQUE;

CREATE CONSTRAINT repo_construct_name_unique IF NOT EXISTS
  FOR (c:RepoConstruct) REQUIRE c.name IS UNIQUE;

-- Vector index for repo embeddings (cosine similarity)
CREATE VECTOR INDEX repo_embedding IF NOT EXISTS
FOR (r:Repo) ON (r.embedding)
OPTIONS {indexConfig: {
  `vector.dimensions`: 1024,
  `vector.similarity_function`: 'cosine'
}};

CREATE INDEX repo_language_band IF NOT EXISTS
  FOR (r:Repo) ON (r.primary_language, r.seniority_band);

CREATE INDEX repo_element_type IF NOT EXISTS
  FOR (e:RepoElement) ON (e.node_type);

CREATE INDEX pr_repo_number IF NOT EXISTS
  FOR (p:PullRequest) ON (p.repo_id, p.pr_number);
