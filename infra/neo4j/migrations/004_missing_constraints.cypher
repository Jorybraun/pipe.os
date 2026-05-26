// Sub-element uniqueness constraints (missing from initial 001)
// Drop regular indexes first — constraints implicitly create indexes,
// and Neo4j rejects a constraint if a regular index already exists.
DROP INDEX candidate_node_id IF EXISTS;
DROP INDEX role_node_id IF EXISTS;
DROP INDEX repo_node_id IF EXISTS;

CREATE CONSTRAINT candidate_node_id_unique IF NOT EXISTS
  FOR (n:CandidateNode) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT role_node_id_unique IF NOT EXISTS
  FOR (n:RoleNode) REQUIRE n.id IS UNIQUE;

CREATE CONSTRAINT repo_node_id_unique IF NOT EXISTS
  FOR (n:RepoNode) REQUIRE n.id IS UNIQUE;
