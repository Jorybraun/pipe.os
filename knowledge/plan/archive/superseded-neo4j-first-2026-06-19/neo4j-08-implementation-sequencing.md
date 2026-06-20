# Implementation Sequencing — Week-by-Week Execution Plan

---

## Week 1: Foundation (Dead Code + Write Path)

### Day 1 — Phase 1: Dead Code Removal
- [ ] Delete `shadowRead.ts`
- [ ] Delete `neo4jParity.ts`
- [ ] Remove `DUAL_WRITE_NEO4J` and `SHADOW_READ_NEO4J` from `wrangler.jsonc`
- [ ] Remove same from Env type definition
- [ ] Remove gated blocks from `orchestrate.ts`, `decomposeRcd.ts`, `persist.ts`
- [ ] Remove Vectorize `.upsert()` calls from ingestion pipeline
- [ ] Run TypeScript check: `npx tsc --noEmit`
- [ ] Run tests: `npm test -- --run`
- **Deliverable:** Clean build, all tests pass, no dead env var references

### Day 2 — Phase 1 Wrap-up + Phase 2 Start
- [ ] Add deprecation comments to D1 `candidate_nodes` / `role_sub_elements` schema
- [ ] Begin `writeCandidateGraph.ts` updates (type-specific properties, dual-labels)
- [ ] Begin `writeRoleGraph.ts` updates
- **Deliverable:** Updated write functions with new signatures

### Day 3 — Phase 2: Write Path Migration
- [ ] Complete `writeCandidateGraph.ts` with Experience/Skill/TechnicalDemonstration/CulturalSignal support
- [ ] Complete `writeRoleGraph.ts` with Requirement/Dealbreaker/Conflict support
- [ ] Update `writeRepoGraph.ts` with dual-label pattern
- [ ] Update `orchestrate.ts` caller — make Neo4j write unconditional
- [ ] Update `decomposeRcd.ts` caller — make Neo4j write unconditional
- **Deliverable:** All writes go to Neo4j only; D1 tables receive no new rows

### Day 4 — Phase 2: Validation
- [ ] Ingest test candidate, verify in Neo4j Browser
- [ ] Ingest test role, verify in Neo4j Browser
- [ ] Verify D1 tables unchanged
- [ ] Run full test suite
- **Deliverable:** Validated write path, green tests

### Day 5 — Buffer / Schema Migration
- [ ] Apply schema DDL from `02-schema-design.md` to Neo4j
- [ ] Add B-tree indexes (`candidate_id`, `role_context_id`, `superseded_at`)
- [ ] Run repo label migration Cypher
- [ ] Document any issues for Week 2
- **Deliverable:** Complete Neo4j schema, all indexes in place

---

## Week 2: Matching Pipeline (Cypher + UX)

### Day 6 — Phase 3: Core Matching Query
- [ ] Write `matchCandidatesForRole` Cypher query
- [ ] Write `scoreCandidateAgainstRole` Cypher query
- [ ] Write `checkDealbreakersForCandidate` Cypher query
- [ ] Add TypeScript interfaces in `matchingQueries.ts`
- [ ] Test queries in Neo4j Browser with real data
- **Deliverable:** Working Cypher queries returning per-requirement evidence

### Day 7 — Phase 3: Router Integration
- [ ] Update `matchRouter.ts` — add `matchViaNeo4j` path
- [ ] Add `Math.tanh()` normalization
- [ ] Add D1 hydration for candidate metadata
- [ ] Test both `PRIMARY_MATCH_STORE=d1` and `=neo4j` paths
- **Deliverable:** Router switches between D1 and Neo4j based on env var

### Day 8 — Phase 3: Validation
- [ ] Side-by-side comparison: Cypher scores vs `triangulateMatch` scores
- [ ] Investigate discrepancies > 0.1
- [ ] Tune thresholds (`confidence_threshold`, `similarity_threshold`)
- [ ] Document score mapping
- **Deliverable:** Validated parity between old and new matching

### Day 9 — Phase 4: UX Components (Start)
- [ ] Create `RequirementMatchCard` component
- [ ] Create `EvidenceNodeBadge` component
- [ ] Create `DealbreakerAlert` component
- [ ] Storybook stories for each
- **Deliverable:** Component library ready

### Day 10 — Phase 4: UX Integration
- [ ] Create `RequirementMatchList` component
- [ ] Replace `MatchSnapshot` in `CandidateOverviewTab.tsx`
- [ ] Update `MatchScoreSection` with new data shape
- [ ] Add fallback for legacy match data
- **Deliverable:** Frontend renders per-requirement evidence

---

## Week 3: Repo Backfill + Polish

### Day 11 — Phase 5: Repo Ingestion Update
- [ ] Update `ingestReposToNeo4j.ts` with dual-labels
- [ ] Add PR fetching + embedding generation
- [ ] Add architectural pattern detection
- [ ] Test on 10 repos
- **Deliverable:** Updated ingestion script ready for batch run

### Day 12 — Phase 5: Batch Backfill (Part 1)
- [ ] Run ingestion on repos 0-1000
- [ ] Monitor failures, fix edge cases
- [ ] Verify Neo4j node counts
- **Deliverable:** ~1,000 repos with rich sub-elements

### Day 13 — Phase 5: Batch Backfill (Part 2)
- [ ] Run ingestion on repos 1000-2251
- [ ] Monitor failures
- [ ] Write `matchReposForCandidateNeo4j` Cypher query
- **Deliverable:** All 2,251 repos backfilled

### Day 14 — Phase 5: Repo Matching Validation
- [ ] Test repo matching Cypher query
- [ ] Compare with `matchReposForCandidate.ts` output
- [ ] Update API endpoint to use Cypher path
- [ ] Update kanban/tooltip with repo match info
- **Deliverable:** Repo matching works without Vectorize

### Day 15 — Final Integration
- [ ] Set `PRIMARY_MATCH_STORE=neo4j` in `wrangler.jsonc`
- [ ] Run full E2E test suite
- [ ] Fix any regressions
- **Deliverable:** All matching via Neo4j

### Day 16-17 — Cleanup
- [ ] Delete `matchVectorNative.ts` (after 1 week validation)
- [ ] Delete `triangulateMatch.ts`
- [ ] Delete `matchReposForCandidate.ts`
- [ ] Remove `PRIMARY_MATCH_STORE` env var
- [ ] Final TypeScript check + test run
- **Deliverable:** Clean codebase, no dead matching code

---

## Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Cypher query too slow at scale | Low | High | Add HNSW index; optimize with profiling |
| Score divergence from triangulateMatch | Medium | Medium | Side-by-side validation; tune thresholds |
| Neo4j driver connection issues in Workers | Low | High | Already fixed (per-request driver + close) |
| Repo backfill takes longer than expected | Medium | Low | Parallelize; reduce batch size; skip on error |
| Frontend breaks with new data shape | Low | Medium | Keep fallback for legacy data; thorough E2E testing |
| Missing APOC plugin for dynamic labels | Medium | Medium | Fallback to TypeScript switch on node_type |
| Embedding generation API rate limits | Medium | Low | Add retry with exponential backoff |

---

## Parallel Workstreams

Two developers can work in parallel:

**Developer A (Backend):**
- Week 1: Phase 1 + Phase 2
- Week 2: Phase 3 (Cypher queries)
- Week 3: Phase 5 (repo backfill)

**Developer B (Frontend):**
- Week 1: Phase 1 (code review) + learn Cypher data shapes
- Week 2: Phase 4 (UX components) — starts after Day 8 when API shape is stable
- Week 3: Phase 4 polish + kanban updates

---

## Daily Standup Questions

1. Did you complete yesterday's checklist items?
2. Are you blocked on anything?
3. What's the biggest risk for the rest of the week?

---

## Acceptance Criteria (Final)

- [ ] All `DUAL_WRITE_NEO4J`, `SHADOW_READ_NEO4J` references removed
- [ ] `PRIMARY_MATCH_STORE` still present but defaults to `neo4j`
- [ ] All Vectorize `.upsert()` calls removed from ingestion pipeline
- [ ] `matchCandidatesForRole` Cypher query returns ranked candidates with per-requirement evidence
- [ ] `matchReposForCandidateNeo4j` Cypher query returns ranked repos with evidence
- [ ] Frontend renders requirement-level match cards instead of opaque 4-bar dimensions
- [ ] `/search/candidates`, `/search/repos`, `/search/roles` all work without `--remote`
- [ ] `npx tsc --noEmit` passes
- [ ] All existing tests pass (or updated/removed if testing deleted code)
- [ ] E2E tests pass: `candidate-matching.spec.ts`, `candidate-profile.spec.ts`
- [ ] 2,251 repos have rich sub-elements in Neo4j
- [ ] Dealbreaker gates work (strong dealbreakers exclude candidates)
- [ ] Score normalization (`Math.tanh`) produces sensible 0-1 range
