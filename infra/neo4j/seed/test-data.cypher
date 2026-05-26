// Seed test data for Neo4j dev environment
// Creates an isolated test candidate, role, and repo for Cypher validation

// ─── Test Candidate ───────────────────────────────────────────────────────────
MERGE (c:Candidate {candidate_id: 'test-cand-001'})
SET c.profile_state = 'active',
    c.last_engaged_at = datetime().epochSeconds,
    c.created_at = datetime().epochSeconds,
    c.updated_at = datetime().epochSeconds;

// Test candidate nodes with deterministic dummy embeddings (range(0,1023) is NOT
// semantically meaningful — it's just for verifying index queries work)
MERGE (c)-[:HAS]->(s1:CandidateNode:Skill {id: 'test-cand-001_skill_react'})
SET s1.narrative_text = 'Skill: React, 5 years production experience',
    s1.embedding = range(0, 1023),
    s1.confidence = 0.92,
    s1.source_type = 'resume',
    s1.created_at = datetime().epochSeconds;

MERGE (c)-[:HAS]->(e1:CandidateNode:Experience {id: 'test-cand-001_exp_senior'})
SET e1.narrative_text = 'Experience: Senior Frontend Engineer at Stripe',
    e1.embedding = range(0, 1023),
    e1.confidence = 0.88,
    e1.source_type = 'resume',
    e1.created_at = datetime().epochSeconds;

// ─── Test Role ────────────────────────────────────────────────────────────────
MERGE (r:Role {role_context_id: 'test-role-001'})
SET r.pipeline_id = 'test-pipe-001',
    r.rcd_version = 'v1',
    r.created_at = datetime().epochSeconds,
    r.updated_at = datetime().epochSeconds;

// Test requirements
MERGE (r)-[:HAS_REQUIREMENT {weight: 1.0}]->(req1:RoleNode:Requirement {id: 'test-role-001_req_react'})
SET req1.narrative_text = 'Requirement: Strong React expertise for design system work',
    req1.embedding = range(0, 1023),
    req1.source_section = 'domain_matrix.work.hiring_manager',
    req1.created_at = datetime().epochSeconds;

MERGE (r)-[:HAS_REQUIREMENT {weight: 0.5}]->(req2:RoleNode:Requirement {id: 'test-role-001_req_typescript'})
SET req2.narrative_text = 'Requirement: TypeScript proficiency',
    req2.embedding = range(0, 1023),
    req2.source_section = 'domain_matrix.work.hiring_manager',
    req2.created_at = datetime().epochSeconds;

// Test dealbreaker
MERGE (r)-[:HAS_DEALBREAKER {strength: 'strong'}]->(db1:RoleNode:Dealbreaker {id: 'test-role-001_db_remote'})
SET db1.narrative_text = 'Dealbreaker: Must be comfortable with async remote collaboration',
    db1.embedding = range(0, 1023),
    db1.job_relatedness_strength = 'strong',
    db1.created_at = datetime().epochSeconds;

// ─── Test Repo ────────────────────────────────────────────────────────────────
MERGE (repo:Repo {repo_id: 999001})
SET repo.full_name = 'facebook/react',
    repo.admin_status = 'approved',
    repo.signals_version = 'v1',
    repo.created_at = datetime().epochSeconds,
    repo.updated_at = datetime().epochSeconds;

// Test repo nodes
MERGE (repo)-[:HAS]->(f1:RepoNode:Feature {id: 'repo-999001_feature_hooks'})
SET f1.narrative_text = 'Feature: React Hooks API for state management',
    f1.embedding = range(0, 1023),
    f1.source_reference = 'pass3-v1',
    f1.created_at = datetime().epochSeconds;
