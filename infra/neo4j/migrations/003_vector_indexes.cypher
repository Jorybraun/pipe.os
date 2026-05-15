// Neo4j vector indexes for semantic similarity matching
// Requires Neo4j 5.11+ for CREATE VECTOR INDEX syntax
// Dimensions: 1024 (BGE-large-en-v1.5)
// Similarity function: cosine

CREATE VECTOR INDEX candidate_node_embedding IF NOT EXISTS
  FOR (n:CandidateNode) ON (n.embedding)
  OPTIONS {
    indexConfig: {
      `vector.dimensions`: 1024,
      `vector.similarity_function`: 'cosine'
    }
  };

CREATE VECTOR INDEX role_node_embedding IF NOT EXISTS
  FOR (n:RoleNode) ON (n.embedding)
  OPTIONS {
    indexConfig: {
      `vector.dimensions`: 1024,
      `vector.similarity_function`: 'cosine'
    }
  };

CREATE VECTOR INDEX repo_node_embedding IF NOT EXISTS
  FOR (n:RepoNode) ON (n.embedding)
  OPTIONS {
    indexConfig: {
      `vector.dimensions`: 1024,
      `vector.similarity_function`: 'cosine'
    }
  };
