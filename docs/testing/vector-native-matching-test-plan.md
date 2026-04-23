# Vector-Native Matching Test Plan

**Date:** 2026-04-22  
**Status:** Active  
**Scope:** Unified BGE embedding space (candidate ↔ repo ↔ role) with ANN-primary retrieval, SQL fallback, and vector-aware triangulation.

---

## 1. Scope

### In Scope
- **Embedding layer:** `preprocessForEmbedding`, `embedAndUpsertRole`, `embedAndUpsertCandidate`, D1 dual-layer ground truth
- **ANN retrieval layer:** `queryVectorIndex`, `matchReposVectorNative`, `matchCandidatesVectorNative`, `matchRolesVectorNative`
- **Search routes:** `POST /api/v1/search/candidates`, `POST /api/v1/search/repos`, `POST /api/v1/search/roles`
- **Matching pipeline:** `matchReposForCandidate` (ANN-primary + SQL fallback blending)
- **Triangulation:** `triangulateMatch`, `triangulateShortlist` with vector-native weight presets
- **Guardrails:** `checkGuardrails` integration with match config validation
- **Backfill:** `scripts/backfillRoleEmbeddings.ts`

### Out of Scope
- LLM-based scorers (`roleFitRerank`, `candidateSituationFit`) — tested separately in their own units
- Repo ingestion embedding (`vectorizeAndMark` in admin routes) — covered by repo discovery tests
- Candidate Discovery v2 agent output quality — tested in `candidateDiscovery` suite
- Production A/B weight calibration — requires recruiter feedback data (N≥100), tracked as ongoing research

---

## 2. Test Levels

| Level | Definition | Tooling | Environment |
|---|---|---|---|
| **Unit** | Single function/class, fully stubbed dependencies | Vitest | Node.js (local) |
| **Integration** | Route handler + stubbed DB/Vectorize/Ai bindings | Vitest + Hono test harness | Node.js (local) |
| **E2E (Worker)** | Full pipeline with mocked Cloudflare bindings (D1 stub, Vectorize in-memory, AI mock) | Vitest | Node.js (local) |
| **Manual** | Human validation against staging / production data | cURL, Playwright, Cloudflare dashboard | Staging / Production |

---

## 3. Test Inventory

### 3.1 Written Tests

| Test Name | Level | Validates | File Location | Status |
|---|---|---|---|---|
| Role embedding + upsert to ROLE_INDEX | E2E | `embedAndUpsertRole` produces 1024-dim vector, lands in index with correct ID prefix | `workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts` | ✅ Written |
| Candidate embedding + upsert to CANDIDATE_INDEX | E2E | `embedAndUpsertCandidate` produces 1024-dim vector, lands in index with correct ID prefix | `workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts` | ✅ Written |
| Search roles by candidate vector | E2E | `matchRolesVectorNative` hydrates role_contexts rows, returns sorted matches | `workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts` | ✅ Written |
| Search candidates by role vector | E2E | `matchCandidatesVectorNative` hydrates candidate rows, respects owner scoping | `workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts` | ✅ Written |
| Search repos by role vector with metadata filter | E2E | `matchReposVectorNative` applies `disqualified: 0` filter, ranks same-domain higher | `workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts` | ✅ Written |
| `matchReposForCandidate` ANN-primary path | E2E | ANN results blended with graph score at `cosineWeight=0.6`, winner picked correctly | `workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts` | ✅ Written |
| `matchReposForCandidate` SQL fallback | E2E | Empty ANN index falls back to SQL graph matcher, rationale contains `[SQL fallback]` | `workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts` | ✅ Written |
| `triangulateMatch` legacy weights (no vectors) | E2E | When vector signals absent, uses `LEGACY_WEIGHTS`, `raw_signals.vector_*` are null | `workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts` | ✅ Written |
| `triangulateMatch` vector weights (with vectors) | E2E | When vector signals present, uses `VECTOR_WEIGHTS`, score differs from legacy | `workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts` | ✅ Written |
| `triangulateShortlist` with vector signals | E2E | Batch scoring returns sorted results, fit bands derived correctly | `workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts` | ✅ Written |
| Graph-only path (no ai/vectorize) | Unit | `matchReposForCandidate` returns repo + PR + issue using SQL only | `workers/api/src/lib/match/__tests__/matchReposForCandidate.test.ts` | ✅ Written |
| Cosine rerank flips winner | Unit | High cosine score on repo 102 flips winner from graph-default repo 101 | `workers/api/src/lib/match/__tests__/matchReposForCandidate.test.ts` | ✅ Written |
| Low cosine weight keeps graph winner | Unit | At `cosineWeight=0.1`, graph score dominates despite high cosine on other repo | `workers/api/src/lib/match/__tests__/matchReposForCandidate.test.ts` | ✅ Written |
| Empty must-have skills guard | Unit | Throws when `mustHaveSkills.length === 0` | `workers/api/src/lib/match/__tests__/matchReposForCandidate.test.ts` | ✅ Written |
| No repos found guard | Unit | Throws when both ANN and SQL return empty | `workers/api/src/lib/match/__tests__/matchReposForCandidate.test.ts` | ✅ Written |
| Null PR / issue handling | Unit | Returns `null` for review/implementation when repo has none, without throwing | `workers/api/src/lib/match/__tests__/matchReposForCandidate.test.ts` | ✅ Written |
| Wrong-dim vector fallback | Unit | 512-dim embed result causes cosine path to abort, falls back to graph winner | `workers/api/src/lib/match/__tests__/matchReposForCandidate.test.ts` | ✅ Written |
| ANN-primary path with mocked `matchReposVectorNative` | Unit | Mocked ANN results blended correctly, winner chosen from ANN shortlist | `workers/api/src/lib/match/__tests__/matchReposForCandidate.test.ts` | ✅ Written |
| SQL fallback when `matchReposVectorNative` returns empty | Unit | Empty mocked ANN triggers SQL graph matcher, returns graph winner | `workers/api/src/lib/match/__tests__/matchReposForCandidate.test.ts` | ✅ Written |
| Hybrid mode combinator math | Unit | Known inputs produce expected `triangulated_score` ≈ 0.683 | `workers/api/src/lib/match/__tests__/triangulateMatch.test.ts` | ✅ Written |
| Validate mode weights | Unit | High `role_repo_alignment` dominates, low candidate fit still produces moderate score | `workers/api/src/lib/match/__tests__/triangulateMatch.test.ts` | ✅ Written |
| Tailored mode ignores role-repo | Unit | `role_repo_alignment=1.0` is ignored, candidate fit drives score | `workers/api/src/lib/match/__tests__/triangulateMatch.test.ts` | ✅ Written |
| Missing alignment graceful handling | Unit | Empty `roleRepoAlignments` + null cosine → treated as 0, no crash | `workers/api/src/lib/match/__tests__/triangulateMatch.test.ts` | ✅ Written |
| Score clamping | Unit | Extreme inputs (>1, <0) are clamped to [0, 1] | `workers/api/src/lib/match/__tests__/triangulateMatch.test.ts` | ✅ Written |
| `triangulateShortlist` sorting | Unit | Batch scores sorted descending, fit bands assigned correctly | `workers/api/src/lib/match/__tests__/triangulateMatch.test.ts` | ✅ Written |
| Default guardrails allow | Unit | Default `MatchConfigInput` passes all checks | `workers/api/src/lib/match/__tests__/guardrails.test.ts` | ✅ Written |
| Hybrid null mix ratio block | Unit | `hybrid` with null `hybrid_mix_ratio` → `B-HYBRID-MIX-RATIO-REQUIRED` | `workers/api/src/lib/match/__tests__/guardrails.test.ts` | ✅ Written |
| Hybrid out-of-range mix ratio block | Unit | `hybrid_mix_ratio=1.5` → `B-HYBRID-MIX-RATIO-RANGE` | `workers/api/src/lib/match/__tests__/guardrails.test.ts` | ✅ Written |
| Tailored with mix ratio block | Unit | `tailored` with non-null mix ratio → `B-MIX-RATIO-WITHOUT-HYBRID` | `workers/api/src/lib/match/__tests__/guardrails.test.ts` | ✅ Written |
| Empty non-negotiable skills warning | Unit | Empty `non_negotiable_skills` → allowed with `W-NO-NON-NEGOTIABLE-SKILLS` | `workers/api/src/lib/match/__tests__/guardrails.test.ts` | ✅ Written |
| Deferred rules registry | Unit | All 5 ADR-039 §4 deferred rules are registered and discoverable | `workers/api/src/lib/match/__tests__/guardrails.test.ts` | ✅ Written |
| `/search/roles` free-text query | Integration | Returns hydrated roles, source type = `query`, scores preserved | `workers/api/src/routes/__tests__/search.test.ts` | ✅ Written |
| `/search/roles` roleContextId query | Integration | Resolves D1 embedding, returns hydrated roles, source type = `role` | `workers/api/src/routes/__tests__/search.test.ts` | ✅ Written |
| `/search/roles` empty matches | Integration | Empty Vectorize result → HTTP 200 with empty `roles` array | `workers/api/src/routes/__tests__/search.test.ts` | ✅ Written |
| `/search/roles` missing params | Integration | No query params → HTTP 422 `VALIDATION_ERROR` | `workers/api/src/routes/__tests__/search.test.ts` | ✅ Written |
| `/search/candidates` owner-scoped | Integration | `ownerId` injected from auth middleware, filters candidates correctly | `workers/api/src/routes/__tests__/search.test.ts` | ✅ Written |
| `/search/repos` disqualified filter | Integration | `disqualified=1` repo excluded from hydration despite Vectorize match | `workers/api/src/routes/__tests__/search.test.ts` | ✅ Written |

### 3.2 Pending Tests

| Test Name | Level | Why Pending | Target Sprint |
|---|---|---|---|
| `preprocessForEmbedding` unit tests | Unit | No isolated test for the utility; only exercised indirectly via embed functions | Immediate |
| `embedAndUpsertRole` isolation tests | Unit | Error paths (empty profile, non-finite values, upsert failure) not directly tested | Immediate |
| `embedAndUpsertCandidate` isolation tests | Unit | Error paths not directly tested | Immediate |
| Search routes wrong-dim embedding | Integration | Route behavior when D1 `embedding_json` has wrong dimension (not 1024) | Immediate |
| Search routes missing D1 embedding + live embed failure | Integration | Returns 404 when all vector resolution paths fail | Immediate |
| `matchReposVectorNative` hydration miss | Unit | Vectorize returns ID not present in D1 → filtered out gracefully | Immediate |
| `matchCandidatesVectorNative` hydration miss | Unit | Same as above for candidates | Immediate |
| `matchRolesVectorNative` hydration miss | Unit | Same as above for roles | Immediate |
| Vectorize metadata filter edge cases | Unit | Unsupported filter keys, type mismatches, empty filter object | Next |
| `queryVectorIndex` queryText path | Unit | Live embed + query against index in one call | Next |
| Dual-layer cosine exact-match | Unit | `parseEmbeddingJson` + exact cosine computation against D1 ground truth | Next |
| `backfillRoleEmbeddings.ts` dry-run | Unit | Verify script parses args, counts rows, does not mutate in dry-run mode | Next |
| `backfillRoleEmbeddings.ts` batch processing | Unit | Batch size respected, error in one row does not abort entire batch | Next |
| Guardrail + triangulate integration | E2E | `checkGuardrails` called before `triangulateMatch` writes to `candidate_repo_match` | Next |
| Stale role embedding detection | E2E | Alert fired when `embedded_at` > 24h (requires telemetry hook) | Backlog |
| Embedding drift monitoring | Manual | Monthly re-embed of 10 historical profiles, cosine(old, new) > 0.99 check | Backlog |

---

## 4. Critical Paths

### 4.1 Candidate Ingestion with ANN-Primary Matching

```
Resume Upload
  → Candidate Discovery v2 → candidate_searchable_profile + key_concepts
    → embedAndUpsertCandidate → CANDIDATE_INDEX
      → matchReposForCandidate
        → Stage 1: matchReposVectorNative (ANN primary, metadata filters)
        → Stage 2: matchRepos (SQL graph matcher guardrail)
        → Stage 3: Blend scores (cosineWeight = 0.6 default)
        → Stage 4: pickReviewPr + pickImplementationIssue
          → triangulateMatch (with vectorCandidateRepo if available)
            → Write candidate_repo_match row
```

**Validation checklist:**
- [ ] ANN returns ≥1 repo → winner chosen from blended scores
- [ ] ANN returns empty → SQL fallback triggered, rationale contains `[SQL fallback]`
- [ ] ANN throws → caught, logged, SQL runs as guardrail
- [ ] `mustHaveSkills` empty → hard error before any matching
- [ ] Wrong-dim embed (e.g., 512) → embed rejected, SQL fallback

### 4.2 Role Embedding Lifecycle

```
Role created / updated
  → Build role_searchable_profile (from JD + persona)
    → embedAndUpsertRole → ROLE_INDEX + D1 embedding_json
      → On role_contexts update: re-fire embedAndUpsertRole
```

**Validation checklist:**
- [ ] New role gets embedded and upserted to `ROLE_INDEX`
- [ ] D1 `embedding_json` updated as dual-layer ground truth
- [ ] Backfill script processes all `embedding_json IS NULL` rows
- [ ] Metadata (pipeline_id, seniority_band) attached to vector
- [ ] `embedded_at` timestamp updated on every embed

### 4.3 Search Routes

| Route | Query Vector Source | Target Index | Metadata Filters |
|---|---|---|---|
| `POST /search/candidates` | roleContextId → role embedding; or repoId → repo embedding; or candidateId → candidate embedding; or live embed query | `CANDIDATE_INDEX` | `ownerId` (auth-scoped) |
| `POST /search/repos` | roleContextId / candidateId / repoId / query | `REPO_INDEX` | `disqualified: 0` |
| `POST /search/roles` | candidateId / repoId / roleContextId / query | `ROLE_INDEX` | none |

**Validation checklist:**
- [ ] All four resolution paths (roleContextId, candidateId, repoId, query) work
- [ ] `query` path live-embeds text with BGE query prefix
- [ ] Missing embedding + failed live embed → 404 `NOT_FOUND`
- [ ] Invalid JSON body → 422 `VALIDATION_ERROR`
- [ ] No query params → 422 `VALIDATION_ERROR`
- [ ] Results hydrated from D1, scores preserved from Vectorize

### 4.4 Triangulation with Vector Signals

**Legacy path (no vectors):**
```
triangulated_score = w_role_repo * role_repo_alignment
                   + w_candidate * candidate_repo_fit
                   + w_cosine * role_candidate_cosine
                   + w_skills * skill_coverage
```

**Vector-native path (vectors present):**
```
triangulated_score = legacy_terms
                   + w_vector_role_repo * vectorRoleRepo
                   + w_vector_role_cand * vectorRoleCandidate
                   + w_vector_cand_repo * vectorCandidateRepo
```

**Validation checklist:**
- [ ] `triangulateMatch` with no vector signals uses `LEGACY_WEIGHTS`
- [ ] `triangulateMatch` with any vector signal uses `VECTOR_WEIGHTS`
- [ ] All three philosophy modes (`validate`, `tailored`, `hybrid`) compute correctly
- [ ] Missing signals treated as 0, no crash
- [ ] Scores clamped to [0, 1]
- [ ] `triangulateShortlist` returns descending-sorted batch with fit bands

---

## 5. Edge Cases & Risks

| Risk | Likelihood | Impact | Mitigation in Tests |
|---|---|---|---|
| **Empty embeddings** | High | ANN query with null/empty vector fails or returns garbage | Stubbed D1 returns `embedding_json: null`; verify route returns 404 |
| **Vectorize downtime / latency** | Low | ANN primary times out or throws | `matchReposForCandidate` catches ANN errors and falls back to SQL; tested in E2E |
| **BGE model changes** | Low | New model version shifts vector space, breaking cosine comparisons | Drift test: monthly re-embed sample, alert if cosine < 0.99 |
| **Stale role embeddings** | High | Role edited but `ROLE_INDEX` has old vector | `embedded_at` timestamp + 24h alert; re-fire on every `role_contexts` update |
| **Wrong-dim vectors** | Medium | Model returns 512-dim instead of 1024-dim | `embedAndUpsertRole` / `embedAndUpsertCandidate` throw; `matchReposForCandidate` falls back to SQL |
| **Non-finite values in vectors** | Low | NaN/Inf from model corrupts index | Finite check in embed functions throws before upsert |
| **Query prefix at index time** | Medium | Developer accidentally prefixes document-side vectors, breaking shared space | `preprocessForEmbedding` locked to `side: 'document'` for all index calls; query prefix only for search |
| **Sparse candidate profiles** | Medium | Short bios embed differently than dense syntheses | Standardize on `candidate_searchable_profile` as ONLY text source; never embed raw bio |
| **Metadata filter mismatch** | Medium | Vectorize filter key typo causes silent full-table scan | Unit test for filter object shape against Vectorize API contract |
| **Hydration miss** | Medium | Vectorize ID exists but D1 row deleted/disqualified | Filtered out gracefully; verify returned count ≤ Vectorize match count |
| **SQL injection via placeholders** | Low | Dynamic `?` placeholders in hydration queries | Only numeric IDs and string UUIDs bound; no user text in SQL |

---

## 6. Manual Test Procedures

### 6.1 Run the Synthetic Sniff Test

**Purpose:** Validate that the BGE vector space discriminates same-domain vs. cross-domain pairs before touching real data.

**Prerequisites:** Node.js, `@xenova/transformers` installed locally.

**Steps:**
1. Read `knowledge/outputs/embedding-validation-brief.md` §2.2 for fixture design.
2. Create 3 roles, 5 candidates, 5 repos with orthogonal domain/stack properties.
3. Embed all fixtures with `Xenova/bge-large-en-v1.5` (document side, no prefix).
4. Compute cosine similarity matrices for all four directions:
   - Role → Candidate
   - Candidate → Role
   - Role → Repo
   - Candidate → Repo
5. Verify:
   - [ ] Same-domain margin ≥ 0.10 (e.g., fintech-react role vs. fintech-react candidate)
   - [ ] Dynamic range > 0.20 per query row
   - [ ] Inversion count < 5 per direction
6. Record results in `knowledge/outputs/vector-native-sniff-test-results.md`.

**Reference:** The 2026-04-22 run passed all criteria (see `knowledge/outputs/vector-native-sniff-test-results.md`).

### 6.2 Verify Search Endpoints

**Prerequisites:** Staging worker deployed with `ROLE_INDEX`, `CANDIDATE_INDEX`, `REPO_INDEX` bindings.

**Steps:**

```bash
# 1. Search roles by free text
curl -X POST https://staging.pipe-os.dev/api/v1/search/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query": "Senior React frontend engineer for fintech", "limit": 5}'

# Expected: HTTP 200, roles array sorted by score, source.type = "query"

# 2. Search candidates by role context ID
curl -X POST https://staging.pipe-os.dev/api/v1/search/candidates \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleContextId": "role-fintech-001", "limit": 10}'

# Expected: HTTP 200, candidates scoped to authenticated owner

# 3. Search repos by candidate ID
curl -X POST https://staging.pipe-os.dev/api/v1/search/repos \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"candidateId": "cand-001", "limit": 10}'

# Expected: HTTP 200, repos with disqualified=0 only

# 4. Invalid request
curl -X POST https://staging.pipe-os.dev/api/v1/search/roles \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"limit": 5}'

# Expected: HTTP 422, error.code = "VALIDATION_ERROR"
```

### 6.3 Check Telemetry Logs

**Purpose:** Verify ANN-primary vs. SQL-fallback distribution and latency.

**Steps:**
1. Open Cloudflare Workers dashboard → Your worker → Logs.
2. Filter for `[matchReposForCandidate]`.
3. Verify:
   - [ ] ANN primary succeeds for >90% of requests (look for absence of `[SQL fallback]`)
   - [ ] ANN errors are rare and logged with full error message
   - [ ] Latency: ANN query < 100ms, SQL graph matcher < 200ms
4. Check `match_feedback` table growth:
   ```sql
   SELECT feedback_type, COUNT(*) FROM match_feedback
   WHERE created_at > datetime('now', '-7 days')
   GROUP BY feedback_type;
   ```
   - [ ] Thumbs-up rate > 70% for `triangulated_score > 0.70`

---

## 7. Test Data

### 7.1 Synthetic Fixtures (In-Memory)

| Fixture | Location | Description |
|---|---|---|
| `ROLE_VECTOR` / `CANDIDATE_VECTOR` / `REPO_VECTOR` | `vectorNativeMatching.e2e.test.ts` | 1024-dim deterministic vectors with domain identity encoded in first 3 dimensions |
| `CROSS_VECTOR` | `vectorNativeMatching.e2e.test.ts` | Different-domain vector for negative-testing ranking |
| `DbFixture` (roleContexts, candidates, repos, etc.) | `vectorNativeMatching.e2e.test.ts` | Complete D1 stub with fintech-react vs. blockchain-rust domain split |
| `RepoFixture` / `PrFixture` / `IssueFixture` | `matchReposForCandidate.test.ts` | SQL graph matcher stubs with skill-based filtering |
| `RoleFixture` / `CandidateFixture` / `RepoFixture` | `search.test.ts` | Route-level stubs with `embedding_json` pre-populated |

### 7.2 Production-Like Data

| Data Source | Location | Use Case |
|---|---|---|
| `scripts/backfillRoleEmbeddings.ts` | Project root | Backfills existing `role_contexts` rows into `ROLE_INDEX` |
| `knowledge/outputs/vector-native-sniff-test-results.md` | Knowledge base | 5 candidates × 3 roles × 5 repos synthetic fixtures with real BGE embeddings |

---

## 8. Coverage Gaps

The following are **honestly identified** as not yet tested:

### 8.1 Unit Gaps (No Isolated Tests)
- [ ] `preprocessForEmbedding` — error paths (empty text, non-string), truncation at 8192 chars, query vs. document prefix correctness
- [ ] `embedAndUpsertRole` / `embedAndUpsertCandidate` — direct error paths: empty profile, wrong dim, non-finite values, upsert failure
- [ ] `parseEmbeddingJson` — malformed JSON, wrong dim, null input
- [ ] `stripPrefix` in `matchVectorNative` — unrecognized ID formats, fallback behavior
- [ ] `queryVectorIndex` — `queryText` path (live embed + query in one call)

### 8.2 Integration Gaps
- [ ] Search routes with wrong-dim `embedding_json` in D1
- [ ] Search routes when live embed fails (e.g., AI binding error)
- [ ] `matchReposVectorNative` / `matchCandidatesVectorNative` / `matchRolesVectorNative` when hydration returns fewer rows than Vectorize matches
- [ ] Metadata filter with unsupported keys or type mismatches

### 8.3 E2E Gaps
- [ ] Full candidate ingestion flow: resume upload → Discovery → embed → match → triangulate → write `candidate_repo_match`
- [ ] Guardrail integration: `checkGuardrails` called before `candidate_repo_match` write
- [ ] Role update → re-embed → `ROLE_INDEX` updated, `embedded_at` refreshed
- [ ] `match_feedback` write + read cycle

### 8.4 Performance / Load Gaps
- [ ] ANN latency at 1k / 10k / 100k vectors in `ROLE_INDEX`
- [ ] SQL graph matcher latency with 500+ repos
- [ ] Concurrent embedding requests (batch size > 1)

### 8.5 Observability Gaps
- [ ] Embedding drift alert (monthly re-embed sample)
- [ ] Stale role embedding alert (> 24h)
- [ ] Vectorize error rate alerting threshold

### 8.6 Multi-Environment Gaps
- [ ] No Playwright E2E tests exercise the search routes through the real UI
- [ ] No integration tests against live Cloudflare Vectorize (only in-memory mocks)

---

## 9. Definition of Done

We can call vector-native matching **"tested"** when:

### Required (Blocking Launch)
- [ ] All 37 written tests in §3.1 pass (`vitest run workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts workers/api/src/lib/match/__tests__ workers/api/src/routes/__tests__/search.test.ts`)
- [ ] Synthetic sniff test passes with same-domain margin ≥ 0.10 and dynamic range > 0.20
- [ ] Staging manual validation of all three search routes succeeds (§6.2)
- [ ] `matchReposForCandidate` ANN-primary path succeeds on >90% of staging candidate uploads
- [ ] No P0/P1 bugs open against vector-native matching components

### Required (Before First Paid Candidate)
- [ ] Pending unit tests in §3.2 (rows 1–7) are written and passing
- [ ] Backfill script run successfully in production (`npx tsx scripts/backfillRoleEmbeddings.ts`)
- [ ] Telemetry dashboard shows ANN latency < 100ms p95

### Required (Within 60 Days of Launch)
- [ ] N ≥ 50 `match_feedback` rows collected
- [ ] Score-discordance rate (thumbs-down with score > 0.70) < 30%
- [ ] Embedding drift check run once, cosine > 0.99 confirmed

### Ongoing
- [ ] Quarterly weight regression on `match_feedback` labels
- [ ] Monthly embedding drift monitoring
- [ ] Re-run synthetic sniff test after any BGE model or preprocessing change

---

## Appendix A: Quick Commands

```bash
# Run all vector-native tests
npx vitest run workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts workers/api/src/lib/match/__tests__ workers/api/src/routes/__tests__/search.test.ts

# Run with coverage
npx vitest run --coverage workers/api/src/__tests__/vectorNativeMatching.e2e.test.ts workers/api/src/lib/match/__tests__ workers/api/src/routes/__tests__/search.test.ts

# Type-check the worker
npx tsc --noEmit -p workers/api/tsconfig.json

# Run backfill (dry-run)
npx tsx scripts/backfillRoleEmbeddings.ts --dry-run

# Run backfill (production)
npx tsx scripts/backfillRoleEmbeddings.ts
```

## Appendix B: Related Documents

| Document | Purpose |
|---|---|
| `knowledge/outputs/vector-native-matching-handoff.md` | Implementation handoff — what was built, what remains |
| `docs/decisions/current/ADR-040-meaning-based-triangulation.md` | Weight presets, schema, orchestration hook |
| `knowledge/outputs/embedding-validation-brief.md` | Synthetic sniff test protocol, metrics, red flags |
| `knowledge/outputs/vector-native-sniff-test-results.md` | 2026-04-22 sniff test results — PASSED |
