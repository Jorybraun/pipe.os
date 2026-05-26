---
status: in-dev
last-validated: 2026-05-16
validator: Business Requirements Agent (code archaeology)
---

## Overall Status

Code exists for Neo4j graph writes and matching queries, but end-to-end matching is not verified. Neo4j configuration is missing from local environment. Write functions fail silently (FireAndForget pattern).

## Component Breakdown

| Component | State | Evidence | Notes |
|-----------|-------|----------|-------|
| D1 `candidate_nodes` table | ✅ Working | Migration 0052, 64 rows present | 44 Skills, 14 Experiences, 2 CareerArcs, 2 Educations, 1 Project, 1 Credential |
| D1 `candidate_coverage` table | ✅ Working | Migration 0057 | FK fix applied |
| Neo4j driver | ✅ Code exists | `lib/neo4j/driver.ts` | Per-request lifecycle, no singleton |
| `writeCandidateGraph` | ✅ Code exists | `lib/neo4j/writeCandidateGraph.ts` | Called from `orchestrate.ts:165` |
| `writeRoleGraph` | ✅ Code exists | `lib/neo4j/writeRoleGraph.ts` | Called from `decomposeRcd.ts:203` |
| `writeRepoGraph` | ✅ Code exists | `lib/neo4j/writeRepoGraph.ts` | No caller found in src/ (orphan?) |
| `matchCandidatesForRole` | ✅ Code exists | `lib/neo4j/matchingQueries.ts:59` | Cypher query with vector similarity |
| `scoreCandidateAgainstRole` | ✅ Code exists | `lib/neo4j/matchingQueries.ts:192` | Cypher query |
| `checkDealbreakersForCandidate` | ✅ Code exists | `lib/neo4j/matchingQueries.ts:156` | Cypher query |
| Neo4j config | ❌ Missing | No NEO4J_URI or NEO4J_PASSWORD in .env* | Local dev cannot connect |
| Neo4j data | 🔍 Unknown | FireAndForget calls swallow errors | Cannot verify data reaches Neo4j |
| `matchRouter` | ✅ Code exists | `lib/match/matchRouter.ts` | Calls `matchCandidatesForRole` |
| End-to-end matching | ❌ Not verified | No manual test performed | Founder has not seen it work |

## Blockers

1. **Neo4j not configured locally** — No connection string or credentials in environment
2. **Silent failures** — FireAndForget pattern means write failures are logged but don't block flow
3. **No observability** — No dashboard or query to verify Neo4j has data
4. **`writeRepoGraph` may be orphaned** — Code exists but no caller found in `workers/api/src/`

## Next Step

Configure Neo4j locally and run end-to-end validation:
1. Set NEO4J_URI and NEO4J_PASSWORD in .env
2. Ingest a test candidate
3. Query Neo4j to verify nodes were written
4. Run matching query against a test role
5. Verify results return with evidence cards

## History

| Date | Status Change | Reason |
|------|---------------|--------|
| 2026-05-16 | Unknown → in-dev | Validated: code exists but not configured/verified |
