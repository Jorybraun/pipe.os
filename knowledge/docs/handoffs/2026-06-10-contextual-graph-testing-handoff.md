# Handoff — Contextual Graph Culture Interview Testing (ADR-050)

Session: https://app.devin.ai/sessions/93c811d8246a42daa93b6dfd6ae3d9d0
Date: 2026-06-10. Testing of merged PRs #46 (ADR), #47 (implementation), #48 (constraint fix).

## State of the code
All merged to main. The contextual pipeline (answer → typed nodes → typed edges → grounded SIMILAR_TO edges into the repo graph) is **verified working live** after fix #48.

## Test environment (how to reproduce)
1. `docker start pipe-neo4j` (must be running BEFORE the interview — see Open Issue 2)
2. `cd workers/api && npx wrangler dev` (port 8787) — needs `.dev.vars` (CULTURE_AGENT_PROVIDER etc.)
3. `npm run dev` at repo root (vite :5173)
4. Test candidate: id `aaaa0610-1111-2222-3333-444455556666`, invite URL `localhost:5173/assess/cg-test-0610-token`. If link shows "Invalid Invite Link", the token was claimed and browser sessionStorage lost — reset with:
   `npx wrangler d1 execute pipe-db --local --command "UPDATE candidates SET invite_token='cg-test-0610-token' WHERE id='aaaa0610-1111-2222-3333-444455556666'"` then reload.
5. Per-turn verification:
   - api shell logs: look for `culture.contextualTurnPersisted` events (nodesWritten / contextualEdgesWritten / groundedEdgesWritten)
   - D1: `npx wrangler d1 execute pipe-db --local --command "SELECT node_type, narrative_text FROM candidate_nodes WHERE candidate_id='aaaa0610-...' AND source_type='culture_contextual'"`
   - Neo4j: `docker exec pipe-neo4j cypher-shell -u neo4j -p pipe-local-dev --format plain "MATCH (c:Candidate {candidate_id:'aaaa0610-...'})-[:HAS]->(cn:CandidateNode)-[r]->(m) RETURN cn.node_type, cn.narrative_text, type(r), m.narrative_text"`
   (Note: CandidateNode has NO candidate_id property — always traverse from the :Candidate anchor.)

## Test plan + results (test-plan-contextual-graph.md)

### T1 — typed contextual nodes (PASSED)
Dense answer ("rebuilt ingestion layer, RabbitMQ→Kafka, ordered replay, p99 40ms→9ms") produced 7 typed D1 rows (Action/Tech/Reason/Outcome, contextual phrases not bare tokens) and the Streamline turn logged `nodesWritten:7, groundedEdgesWritten:23`. A second dense answer logged `nodesWritten:6, contextualEdgesWritten:7, groundedEdgesWritten:6`. Neo4j shows typed edges, e.g.:
- (built a notebook-to-production template) -[ACHIEVED]-> (made it work)
- (built a notebook-to-production template) -[WITH]-> (Airflow), -[WITH]-> (Jupyter), -[WITH_PERSON]-> (data scientist at Streamline)
- (kept losing ordering guarantees on clickstream...) -[WITH]-> (RabbitMQ)

### T2 — probe only on generic answers (UNTESTED — env confounded)
The fluff answer was given while Neo4j was still down (post-restart), so the planner fell back to a static bank question instead of a quoting probe. Needs a clean retry with Neo4j up.

### T3 — gap-driven, anchored follow-ups (PASSED)
After the Nordica disagreement answer (whose decomposition failed — see Open Issue 1), the agent acknowledged with my own content ("you paused the review and proposed a written ADR") and probed the missing action ("What did you do in the moment to manage it?"). Anchored, not template.

### T4 — grounded SIMILAR_TO edges (PASSED)
29 grounded edges total for this candidate; min similarity 0.8404 (all ≥0.84); every edge carries a non-empty grounding token shared by both phrases (kafka, schema, registry, template, consumers); sparse (29 edges vs 1,746 matchable RepoNodes). Top edge: "redesigned the consumers around Kafka consumer groups" → "Integrates Kafka..." 0.891 grounding "kafka".

### T5 — matching via grounded traversal (NOT RUN)
Interview not completed — session handoff requested mid-test. The interview session (`ed5fd6cb0cec541006f519aaa5226edd`) is mid-flight at ~Q4.

### Regression — no 500s; turns that hit LLM JSON failures still returned 200 and the interview continued.

## Open issues found (next session should fix these first)
1. **Decomposition JSON parse failures (recurring, silent data loss).** Twice in 4 turns the decomposition LLM returned malformed/truncated JSON (`[contextualDecomposition] Failed to parse JSON ... SyntaxError`) and the turn's nodes were silently lost (no retry/repair). Likely output-token truncation on longer answers. Fix candidates: raise max output tokens, JSON-repair pass, or one retry with a "shorter phrases" instruction in cultureContextualDecomposition.ts (~line 248).
2. **Planner degrades to static bank when Neo4j is down** ("Generative planner returned no question — falling back to static bank") — and when the planner generates a duplicate. Consider: fail loudly/log metric, and make the conversation-graph walk resilient (e.g., fall back to D1 nodes instead of bank questions).
3. **persistContextualTurn fails silently when Neo4j is unreachable** (WebSocket error in waitUntil) — D1 rows written but graph edges lost for that turn; no retry/backfill.
4. **Claimed-token UX**: losing sessionStorage (new browser) bricks the assess link with "Invalid Invite Link" (resolve-token 404 for CLAIMED tokens).

## Where to resume
1. Fix Open Issue 1 (JSON robustness) — small PR.
2. Re-run T2 (fluff answer with Neo4j up → expect quoting probe + 0 new nodes).
3. Complete the interview → T5: verify matched repo equals the top multi-region grounded repo (`matchReposByGroundedEdges`, ORDER BY regions DESC, edge_count DESC) or logged cosine fallback.
