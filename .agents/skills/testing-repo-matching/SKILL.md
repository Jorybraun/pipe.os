---
name: testing-repo-matching
description: How to test candidate repo matching and standalone CODE_REVIEW interviews locally — env prerequisites (D1 seed + Neo4j backfill), candidate invite flow, and verification queries.
---

# Testing repo matching & standalone code review

## Prerequisites (matching will silently never complete without these)
1. Local D1 seeded with repos: `(cd workers/api && bash scripts/sync-repos-local.sh)` (needs CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID).
2. Neo4j running: `docker start pipe-${PRIMARY_MATCH_STORE}` (${NEO4J_URI}, user `${PRIMARY_MATCH_STORE}`, local-dev password in .dev.vars).
3. **Neo4j repo graph backfilled**: `(cd workers/api && npx tsx scripts/backfillNeo4j.ts --repos)`.
   - PITFALL: do NOT use `scripts/ingestReposToNeo4j.ts` for this — it writes ChallengeSurface/EngineeringNarrative nodes with NULL embeddings, which the matcher ignores. The matcher (`matchReposForCandidateNeo4j`) needs RepoNodes of type Feature/TechnicalStack/ArchitecturalPattern/PRSample with embeddings, which `backfillNeo4j.ts --repos` writes from D1 `repo_nodes`.
4. Servers: `(cd workers/api && npx wrangler dev --port 8787)` and `npm run dev` (web :5173).

## Test flow (standalone CODE_REVIEW)
1. Log in as recruiter at localhost:5173 (e2e test login: e2e-test@pipe.dev, password in e2e config).
2. Schedule page → INVITE CANDIDATE → name/email → select CODE_REVIEW → SEND INVITE.
3. Get the assess token: `(cd workers/api && npx wrangler d1 execute pipe-db --local --json --command "SELECT invite_token FROM candidates WHERE email='...'")`.
4. Open `localhost:5173/assess/<token>` → CV intake form appears (if no CV/graph yet) → upload a PDF CV (generate with reportlab, not fpdf — fpdf text extracts poorly).
5. Ingestion + matching take ~30–60s; refresh the page to land on the Code Review challenge.
6. NOTE: opening a different candidate's assess link in the same browser can reuse the previous candidate's session from sessionStorage — clear sessionStorage between candidates.

## Verification
- Match stored on the scheduled interview row: `SELECT matched_repo_id, github_repo_url, github_pr_number, status, submission_json FROM scheduled_interviews WHERE candidate_id='...'`.
- Raw match ranking (Neo4j): `docker exec pipe-${PRIMARY_MATCH_STORE} cypher-shell -u ${PRIMARY_MATCH_STORE} -p <pw> "MATCH (c:Candidate {candidate_id:'...'})-[:HAS]->(cn:CandidateNode) WHERE cn.superseded_at IS NULL MATCH (r:Repo)-[:HAS]->(rn:RepoNode) WHERE rn.node_type IN ['Feature','TechnicalStack','ArchitecturalPattern','PRSample'] WITH r, vector.similarity.cosine(cn.embedding, rn.embedding) AS sim WHERE sim >= 0.55 WITH r, avg(sim)*log(1+count(*)) AS score RETURN r.repo_id, r.full_name, round(score,3) ORDER BY score DESC LIMIT 5"`.
- API logs (wrangler dev shell) show `[standaloneReview]` lines, including repos skipped for lacking eligible PRs.
- Only repos with `repo_sample_prs.swe_bench_eligible = 1` rows can yield a challenge; many top-ranked repos have none, so the matcher walks the ranked list.

## Match-quality rubric (be critical)
Grade 0–2 each: skill/stack overlap (incl. the assigned PR's sub-stack, not just repo language), domain relevance, seniority/PR reviewability (real logic diff vs cosmetic), match specificity, score separation (top-5 spreads of <2% mean the matcher isn't discriminating), and a contrast test with two opposing CVs (fail if both get the same repo).
