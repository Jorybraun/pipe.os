---
name: testing-repo-matching
description: How to test candidate repo matching and standalone CODE_REVIEW interviews — current /assess boundary, ready-assignment smokes, blocked handoff proof, and local matching prerequisites.
---

# Testing repo matching & standalone code review

## Current boundary

`/assess/:token` is the CODE_REVIEW assessment runtime, not the ingestion or repo-matching app.

- If a source-backed repo/PR assignment already exists, `/assess` should render the CODE_REVIEW challenge.
- If the candidate only submitted profile/CV evidence and no assignment is ready, `/assess` should end in the candidate-safe `PROFILE_RECEIVED` handoff and the stage config should be `candidate-intake-queued`.
- A standalone CODE_REVIEW blocked handoff must never show candidate-visible `WAITING_FOR_MATCH`, "Building your personalized challenge", repo-matching diagnostics, decomposition steps, or quality gates.
- Use Talent Pool / intake work for profile capture and challenge-design queue behavior. Do not rebuild that behavior inside the CODE_REVIEW runtime.

## Prerequisites for automatic matching quality evals

1. Local D1 seeded with repos: `(cd workers/api && bash scripts/sync-repos-local.sh)` (needs CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID).
2. Neo4j running: `docker start pipe-${PRIMARY_MATCH_STORE}` (${NEO4J_URI}, user `${PRIMARY_MATCH_STORE}`, local-dev password in .dev.vars).
3. **Neo4j repo graph backfilled**: `(cd workers/api && npx tsx scripts/backfillNeo4j.ts --repos)`.
   - PITFALL: do NOT use `scripts/ingestReposToNeo4j.ts` for this — it writes ChallengeSurface/EngineeringNarrative nodes with NULL embeddings, which the matcher ignores. The matcher (`matchReposForCandidateNeo4j`) needs RepoNodes of type Feature/TechnicalStack/ArchitecturalPattern/PRSample with embeddings, which `backfillNeo4j.ts --repos` writes from D1 `repo_nodes`.
4. Servers: `(cd workers/api && npx wrangler dev --port 8787)` and `npm run dev` (web :5173).

Manual ready-assignment smokes do not require Neo4j auto-match readiness because they validate a recruiter-selected source-backed PR without claiming CV fit.

## Test flows

### Ready CODE_REVIEW assessment

Use the manual override smoke for the stable ready-assignment path:

```bash
npm run smoke:code-review-reliability-dev
npm run smoke:code-review-assess-dev
CODE_REVIEW_SMOKE_FULL_SUBMIT=1 npm run smoke:code-review-assess-dev
npm run smoke:code-review-assess-dev:role-backed-full-submit
npm run smoke:code-review-assess-dev:workers-matrix
```

Expected proof:
- reliability suite runs blocked handoff, role-backed full-submit/scoring, Workers SDK non-MUI breadth, and latest expert-labelled match-quality readiness
- delivered URL is `/assess/:token`, not a room URL
- source-backed PR is `https://github.com/mui/base-ui` PR `973` by default
- `matchMode` is `manual_override`
- `matchStatus` is `MATCHED`
- `qualityGate` is `PASSED`
- `assessmentQuality` is `USABLE`
- candidate browser renders the Pierre diff without video-room fallback
- full-submit mode persists review score and recruiter/person readout
- role-backed full-submit mode proves automatic match, source-backed PR proof, candidate submission, scoring persistence, and recruiter readout in one app-dev run
- workers matrix mode must select a source-backed non-MUI `cloudflare/workers-sdk` PR for a Workers SDK runtime profile

### Blocked/no-assignment standalone CODE_REVIEW

Use the blocked auto-match lane to prove `/assess` does not become a candidate-visible matching app:

```bash
CODE_REVIEW_SMOKE_AUTO_MATCH=1 CODE_REVIEW_EXPECT_BLOCKED_MATCH=1 npm run smoke:code-review-assess-dev
```

Expected proof:
- candidate challenge is `PROFILE_RECEIVED`
- challenge id is `profile-received`
- stage config is complete with `stageId: "candidate-intake-queued"`
- instructions include "email you when your code review is ready"
- recruiter detail opens and shows assessment progress
- no page contains `WAITING_FOR_MATCH`, "Building your personalized challenge", or "MATCHING IN PROGRESS"

### Local UI/manual flow

1. Log in as recruiter at localhost:5173 (e2e test login: e2e-test@pipe.dev, password in e2e config).
2. Schedule page → INVITE CANDIDATE → name/email → select CODE_REVIEW → SEND INVITE.
3. Get the assess token: `(cd workers/api && npx wrangler d1 execute pipe-db --local --json --command "SELECT invite_token FROM candidates WHERE email='...'")`.
4. If a source-backed assignment already exists, open `localhost:5173/assess/<token>` and expect the CODE_REVIEW challenge.
5. If the candidate only has CV/profile evidence and no assignment, open `localhost:5173/assess/<token>` and expect `Profile received`, not a matching dashboard.
6. NOTE: opening a different candidate's assess link in the same browser can reuse the previous candidate's session from sessionStorage — clear sessionStorage between candidates.

## Verification
- Match stored on the scheduled interview row: `SELECT matched_repo_id, github_repo_url, github_pr_number, status, submission_json FROM scheduled_interviews WHERE candidate_id='...'`.
- Raw match ranking (Neo4j): `docker exec pipe-${PRIMARY_MATCH_STORE} cypher-shell -u ${PRIMARY_MATCH_STORE} -p <pw> "MATCH (c:Candidate {candidate_id:'...'})-[:HAS]->(cn:CandidateNode) WHERE cn.superseded_at IS NULL MATCH (r:Repo)-[:HAS]->(rn:RepoNode) WHERE rn.node_type IN ['Feature','TechnicalStack','ArchitecturalPattern','PRSample'] WITH r, vector.similarity.cosine(cn.embedding, rn.embedding) AS sim WHERE sim >= 0.55 WITH r, avg(sim)*log(1+count(*)) AS score RETURN r.repo_id, r.full_name, round(score,3) ORDER BY score DESC LIMIT 5"`.
- API logs (wrangler dev shell) show `[standaloneReview]` lines, including repos skipped for lacking eligible PRs.
- Only repos with `repo_sample_prs.swe_bench_eligible = 1` rows can yield a challenge; many top-ranked repos have none, so the matcher walks the ranked list.
- For blocked standalone CODE_REVIEW proof, verify `PROFILE_RECEIVED` and `candidate-intake-queued` instead of polling for a ready challenge inside `/assess`.

## Match-quality rubric (be critical)
Grade 0–2 each: skill/stack overlap (incl. the assigned PR's sub-stack, not just repo language), domain relevance, seniority/PR reviewability (real logic diff vs cosmetic), match specificity, score separation (top-5 spreads of <2% mean the matcher isn't discriminating), and a contrast test with two opposing CVs (fail if both get the same repo).
