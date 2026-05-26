/**
 * Integration smoke test: verify the new policy-driven Cypher works on real Neo4j.
 */
import neo4j from 'neo4j-driver';

const driver = neo4j.driver('bolt://localhost:7687', neo4j.auth.basic('neo4j', 'pipe-local-dev'));

async function test() {
  const session = driver.session();
  try {
    // 1. Create a Role with policy properties
    await session.run(`
      MERGE (r:Role {role_context_id: 'test_role_policy'})
      SET r.similarity_threshold = 0.55,
          r.confidence_threshold = 0.55,
          r.dealbreaker_threshold = 0.70,
          r.evidence_cap = 2,
          r.result_limit = 10,
          r.match_philosophy = 'hybrid',
          r.hybrid_mix_ratio = 0.6
    `);

    // 2. Create a Requirement
    await session.run(`
      MATCH (r:Role {role_context_id: 'test_role_policy'})
      MERGE (req:Requirement {id: 'req_1'})
      SET req.embedding = [1.0, 0.0, 0.0],
          req.weight = 1.0,
          req.narrative_text = 'React'
      MERGE (r)-[:HAS_REQUIREMENT]->(req)
    `);

    // 3. Create a Candidate with a matching node
    await session.run(`
      MERGE (c:Candidate {candidate_id: 'cand_test'})
      MERGE (n:CandidateNode {id: 'node_1'})
      SET n.embedding = [0.9, 0.1, 0.0],
          n.confidence = 0.8,
          n.node_type = 'Skill',
          n.narrative_text = 'React expert',
          n.superseded_at = null
      MERGE (c)-[:HAS]->(n)
    `);

    // 4. Run the actual policy-driven query
    const result = await session.run(`
      MATCH (role:Role {role_context_id: $role_id})
      WITH role
      MATCH (role)-[:HAS_REQUIREMENT]->(req:Requirement)
      MATCH (cand:Candidate)-[:HAS]->(node:CandidateNode)
      WHERE node.superseded_at IS NULL
        AND node.confidence >= role.confidence_threshold
      WITH role, req, cand, node,
           vector.similarity.cosine(req.embedding, node.embedding) AS sim
      WHERE sim >= role.similarity_threshold
      WITH role, req, cand,
           avg(sim) * log(1 + count(node)) AS per_req_score,
           collect({node_id: node.id, sim: sim, type: node.node_type})[0..role.evidence_cap] AS top_evidence
      WITH role, cand, req, per_req_score, top_evidence,
           CASE role.match_philosophy
             WHEN 'tailored' THEN req.weight * 1.2
             WHEN 'hybrid' THEN req.weight * role.hybrid_mix_ratio
             ELSE req.weight
           END AS effective_weight
      WITH role, cand,
           collect({
             requirement_id: req.id,
             score: per_req_score,
             evidence: top_evidence,
             weight: effective_weight
           }) AS requirement_matches,
           sum(per_req_score * effective_weight) / sum(effective_weight) AS overall_score
      WHERE overall_score > 0
      WITH role, cand, requirement_matches, overall_score
      ORDER BY overall_score DESC
      WITH role, collect({
        candidate_id: cand.candidate_id,
        overall_score: overall_score,
        requirement_matches: requirement_matches
      }) AS all_results
      UNWIND all_results[0..role.result_limit] AS result
      RETURN result.candidate_id AS candidate_id,
             result.overall_score AS overall_score,
             result.requirement_matches AS requirement_matches
    `, { role_id: 'test_role_policy' });

    console.log('Records returned:', result.records.length);
    for (const r of result.records) {
      console.log('candidate_id:', r.get('candidate_id'));
      console.log('overall_score:', r.get('overall_score'));
    }

    // 5. Test dynamic list slicing specifically
    const sliceResult = await session.run(`
      WITH [1, 2, 3, 4, 5] AS list, 2 AS cap
      RETURN list[0..cap] AS sliced
    `);
    console.log('Dynamic slice test:', sliceResult.records[0].get('sliced'));

    // Cleanup
    await session.run(`
      MATCH (r:Role {role_context_id: 'test_role_policy'})
      OPTIONAL MATCH (r)-[:HAS_REQUIREMENT]->(req)
      OPTIONAL MATCH (r)-[:HAS_DEALBREAKER]->(db)
      DETACH DELETE r, req, db
    `);
    await session.run(`
      MATCH (c:Candidate {candidate_id: 'cand_test'})
      OPTIONAL MATCH (c)-[:HAS]->(n)
      DETACH DELETE c, n
    `);

    console.log('✅ All integration tests passed');
  } catch (err) {
    console.error('❌ Integration test failed:', err.message);
    process.exit(1);
  } finally {
    await session.close();
    await driver.close();
  }
}

test();
