# Test Coverage Gap Analysis

> Generated for branch `feat/cloudflare-migration`  
> Scope: vector-native matching, search routes, embedding pipeline  
> Method: line-by-line production code audit mapped against every test in `workers/api/src/**/__tests__/*.test.ts`

---

## File: `workers/api/src/lib/match/matchVectorNative.ts`

| Line Range | Code Path | Tested? | Test File | Gap Notes |
|------------|-----------|---------|-----------|-----------|
| 86–93 | `resolveQueryVector` — `queryVector` provided, valid dim | ✅ (indirect) | vectorNativeMatching.e2e.test.ts | All e2e match* calls pass `queryVector` |
| 88–92 | `resolveQueryVector` — dim mismatch throws | ❌ | — | No test passes wrong-dim vector |
| 96–98 | `resolveQueryVector` — neither `queryVector` nor `queryText` throws | ❌ | — | No negative-input test |
| 99–101 | `resolveQueryVector` — `queryText` without `ai` throws | ❌ | — | No negative-input test |
| 103–112 | `resolveQueryVector` — live embed via `ai.run` | ✅ (indirect) | vectorNativeMatching.e2e.test.ts | `matchReposForCandidate` e2e passes `queryText` |
| 109–111 | `resolveQueryVector` — embed wrong dim / missing throws | ❌ | — | Only tested indirectly via `matchReposForCandidate` wrong-dim test, which mocks `matchReposVectorNative` rather than hitting this path |
| 119–123 | `queryVectorIndex` — `topK` default to 20 | ❌ | — | No assertion on default |
| 125–128 | `queryVectorIndex` — metadata filters applied | ✅ | vectorNativeMatching.e2e.test.ts | `matchReposVectorNative` test uses `disqualified: 0` filter |
| 125–128 | `queryVectorIndex` — no metadata filters | ✅ | vectorNativeMatching.e2e.test.ts | `matchRolesVectorNative` / `matchCandidatesVectorNative` omit filters |
| 130–143 | `queryVectorIndex` — matches returned & stripped | ✅ | vectorNativeMatching.e2e.test.ts | End-to-end assertions on match count and IDs |
| 132–135 | `queryVectorIndex` — empty `result.matches` | ✅ (indirect) | vectorNativeMatching.e2e.test.ts | Empty index in e2e yields `[]` via `?? []` |
| 151–155 | `matchReposVectorNative` — happy path | ✅ | vectorNativeMatching.e2e.test.ts | Hydrated repo returned with correct fields |
| 156 | `matchReposVectorNative` — early return `[]` when no matches | ❌ | — | No direct test for empty ANN before hydration |
| 158–203 | `matchReposVectorNative` — D1 hydration + row-map join | ✅ | vectorNativeMatching.e2e.test.ts | Asserts on `fullName`, `stars`, etc. |
| 170 | `matchReposVectorNative` — `disqualified = 0` SQL guard | ✅ | vectorNativeMatching.e2e.test.ts | Repo 102 has `disqualified=0` in fixture |
| 187–203 | `matchReposVectorNative` — row missing → `null` → filtered out | ❌ | — | No fixture omits a matched row |
| 209–214 | `matchCandidatesVectorNative` — happy path with `ownerId` | ✅ | vectorNativeMatching.e2e.test.ts | `ownerId: 'user-001'` scoped |
| 214 | `matchCandidatesVectorNative` — early return `[]` when no matches | ❌ | — | No direct test |
| 229–232 | `matchCandidatesVectorNative` — `ownerId` SQL append | ✅ | vectorNativeMatching.e2e.test.ts | `ownerId` passed in e2e |
| 229–232 | `matchCandidatesVectorNative` — omitted `ownerId` | ❌ | — | All tests pass `ownerId` |
| 247–262 | `matchCandidatesVectorNative` — row missing → `null` → filtered | ❌ | — | All candidate IDs in fixture hydrate successfully |
| 268–273 | `matchRolesVectorNative` — happy path | ✅ | vectorNativeMatching.e2e.test.ts | Asserts on `roleTitle`, `pipelineId` |
| 273 | `matchRolesVectorNative` — early return `[]` when no matches | ❌ | — | No direct test |
| 298–311 | `matchRolesVectorNative` — row missing → `null` → filtered | ❌ | — | All role IDs in fixture hydrate successfully |
| 316–324 | `stripPrefix` — `candidate_`, `repo_`, `role_` prefixes | ✅ (indirect) | vectorNativeMatching.e2e.test.ts | Prefixes used in index IDs throughout e2e |
| 327 | `stripPrefix` — fallback returns id as-is | ❌ | — | No test with unprefixed ID |

**Coverage estimate:** ~55% — happy paths for all three entity types are covered, but every error branch in `resolveQueryVector`, empty-match early returns, row-missing hydration filters, and the prefix fallback are untested.

---

## File: `workers/api/src/lib/match/matchReposForCandidate.ts`

| Line Range | Code Path | Tested? | Test File | Gap Notes |
|------------|-----------|---------|-----------|-----------|
| 68–80 | `buildMatchRequestFromCandidate` | ✅ (indirect) | matchReposForCandidate.test.ts | Called in every test; output feeds `matchRepos` |
| 83–87 | `normalizeGraphScore` | ✅ (indirect) | matchReposForCandidate.test.ts, triangulateMatch.test.ts | Blending math exercised |
| 89–93 | `clamp01` — n < 0 | ❌ | — | No test with negative blended score |
| 89–93 | `clamp01` — n > 1 | ❌ | — | No test with score > 1 |
| 89–93 | `clamp01` — n in [0,1] | ✅ (indirect) | matchReposForCandidate.test.ts | Normal blending paths |
| 109–113 | Empty `mustHaveSkills` guard → throws | ✅ | matchReposForCandidate.test.ts | Explicit negative test |
| 119–163 | Stage 1: ANN primary retrieval | ✅ | vectorNativeMatching.e2e.test.ts | End-to-end ANN-primary path |
| 121–128 | Metadata filters (`primaryLanguage`, `seniorityBand`) | ✅ | vectorNativeMatching.e2e.test.ts | E2e test sets both filters |
| 139–142 | `matchReposVectorNative` throws → caught, `annMatches = []` | ✅ | matchReposForCandidate.test.ts | Wrong-dim AI vector triggers catch |
| 146–162 | Raw vector fallback when hydration yields nothing (`annScoreMap`) | ❌ | — | **Critical gap:** no test where hydration fails but raw index has scores |
| 159–161 | Raw vector query throws → caught | ❌ | — | Error boundary in fallback untested |
| 166–167 | Stage 2: SQL graph matcher (`matchRepos`) | ✅ | matchReposForCandidate.test.ts | Graph-only and blended paths |
| 169–173 | All sources empty → throws | ✅ | matchReposForCandidate.test.ts | Empty repos/PRs/issues fixture |
| 176–180 | `annMap` built from hydrated matches | ✅ | matchReposForCandidate.test.ts | Mocked `matchReposVectorNative` returns hydrated repos |
| 182–185 | `sqlMap` built from graph matches | ✅ | matchReposForCandidate.test.ts | Graph-only path exercises this |
| 187 | `allRepoIds` union (ANN + raw + SQL) | ✅ (partial) | — | `annScoreMap` keys never added in tests |
| 194 | `rawScore` from `annScoreMap` used in blend | ❌ | — | Raw-score-only branch untested |
| 198–199 | Blend: ANN + SQL both present | ✅ | matchReposForCandidate.test.ts | Mocked ANN + graph blended at `cosineWeight=0.6` |
| 201 | Blend: ANN only | ✅ | matchReposForCandidate.test.ts | `reranks with cosine` test (ANN winner flips) |
| 203 | Blend: SQL only | ✅ | matchReposForCandidate.test.ts | Graph-only path when ai/vectorize absent |
| 205 | Blend: fallback `score = 0` | ❌ | — | Theoretically unreachable but not proven in tests |
| 224–227 | Stage 4: `pickReviewPr` + `pickImplementationIssue` | ✅ | matchReposForCandidate.test.ts | PR 42 and issue 100 returned |
| 230–245 | Rationale builder | ✅ | matchReposForCandidate.test.ts, vectorNativeMatching.e2e.test.ts | SQL fallback tag and skill coverage tested |

**Coverage estimate:** ~65% — primary ANN, SQL fallback, blending, and guardrails are tested. The **raw-score fallback** (`annScoreMap` path) and several clamping edge cases are completely uncovered.

---

## File: `workers/api/src/lib/match/triangulateMatch.ts`

| Line Range | Code Path | Tested? | Test File | Gap Notes |
|------------|-----------|---------|-----------|-----------|
| 68–87 | `LEGACY_WEIGHTS` — validate / tailored / hybrid | ✅ | triangulateMatch.test.ts | All three philosophies exercised |
| 100–128 | `VECTOR_WEIGHTS` — validate / tailored / hybrid | ✅ (partial) | vectorNativeMatching.e2e.test.ts | Only `validate` with vectors tested directly; `tailored` and `hybrid` with vectors only in `triangulateShortlist` |
| 130–136 | `hasVectorSignals` — any signal present | ✅ (indirect) | vectorNativeMatching.e2e.test.ts | E2e sets all three vector signals |
| 130–136 | `hasVectorSignals` — only `vectorRoleRepo` | ❌ | — | No single-signal test |
| 130–136 | `hasVectorSignals` — no signals | ✅ (indirect) | triangulateMatch.test.ts | Legacy-weight tests pass no vectors |
| 140–201 | `triangulateMatch` — legacy scoring | ✅ | triangulateMatch.test.ts | `validate`, `tailored`, `hybrid` all tested |
| 140–201 | `triangulateMatch` — vector scoring | ✅ (partial) | vectorNativeMatching.e2e.test.ts | Only `validate` tested; `tailored`/`hybrid` with vectors untested |
| 156–160 | Missing signal lookups (`null` → `0`) | ✅ | triangulateMatch.test.ts | `handles missing role alignment gracefully` |
| 162–167 | Dimension building | ✅ | triangulateMatch.test.ts | Asserted in hybrid test |
| 179–185 | Vector weight addition | ✅ | vectorNativeMatching.e2e.test.ts | Asserts score changes with vectors |
| 189 | `clamp01` on final score | ✅ | triangulateMatch.test.ts | Extreme inputs clamped test |
| 206–211 | `normalizeGraphScore` — typical range [0.3, 0.9] | ✅ (indirect) | triangulateMatch.test.ts | Score 0.7 → ~0.667 |
| 206–211 | `normalizeGraphScore` — score < 0.3 | ❌ | — | No extreme low graph score |
| 206–211 | `normalizeGraphScore` — score > 0.9 | ❌ | — | No extreme high graph score |
| 227–275 | `triangulateShortlist` — hybrid + vectors | ✅ | vectorNativeMatching.e2e.test.ts | Two-repo shortlist sorted and banded |
| 227–275 | `triangulateShortlist` — no vectors | ❌ | — | All shortlist tests pass vector signals |
| 227–275 | `triangulateShortlist` — `validate` / `tailored` | ❌ | — | Only `hybrid` tested |
| 277–282 | `deriveBand` — `strong` (≥0.75) | ✅ | triangulateMatch.test.ts | Shortlist test hits this band |
| 277–282 | `deriveBand` — `moderate` (≥0.5) | ❌ | — | No test produces score 0.5–0.75 |
| 277–282 | `deriveBand` — `weak` (≥0.25) | ❌ | — | No test produces score 0.25–0.5 |
| 277–282 | `deriveBand` — `mismatch` (<0.25) | ❌ | — | No test produces score <0.25 |

**Coverage estimate:** ~70% — core scoring logic and legacy/vector toggles are well covered. Band derivation for `moderate`/`weak`/`mismatch`, `triangulateShortlist` without vectors, and vector scoring for `tailored`/`hybrid` philosophies are gaps.

---

## File: `workers/api/src/routes/search.ts`

| Line Range | Code Path | Tested? | Test File | Gap Notes |
|------------|-----------|---------|-----------|-----------|
| 65–84 | `resolveQueryVector` — `roleContextId` found | ✅ | search.test.ts | `/search/roles` with `roleContextId` |
| 65–84 | `resolveQueryVector` — `roleContextId` not found (falls through) | ❌ | — | No test for missing role_context row |
| 86–93 | `resolveQueryVector` — `candidateId` found | ❌ | — | No test uses `candidateId` as source |
| 86–93 | `resolveQueryVector` — `candidateId` not found | ❌ | — | — |
| 95–102 | `resolveQueryVector` — `repoId` found | ❌ | — | No test uses `repoId` as source |
| 95–102 | `resolveQueryVector` — `repoId` not found | ❌ | — | — |
| 104–113 | `resolveQueryVector` — `query` live embed success | ✅ | search.test.ts | Free-text query tests |
| 114–116 | `resolveQueryVector` — `query` embed throws → caught | ❌ | — | No AI failure simulation |
| 110–112 | `resolveQueryVector` — `query` embed wrong dim → skipped | ❌ | — | No malformed AI response test |
| 119 | `resolveQueryVector` — all sources exhausted → `null` | ❌ | — | No test reaches this line |
| 124–131 | POST `/candidates` — invalid JSON catch | ❌ | — | Not tested |
| 133–136 | POST `/candidates` — schema validation fail | ❌ | — | Not tested |
| 139–141 | POST `/candidates` — no source params | ❌ | — | Not tested |
| 143–151 | POST `/candidates` — `resolveQueryVector` via `roleContextId` | ✅ | search.test.ts | Returns Alice scoped to owner |
| 143–151 | POST `/candidates` — via `repoId` / `candidateId` / `query` | ❌ | — | Only `roleContextId` tested |
| 149–151 | POST `/candidates` — `source === null` → 404 | ❌ | — | — |
| 181–187 | POST `/repos` — invalid JSON catch | ❌ | — | Not tested |
| 189–192 | POST `/repos` — schema validation fail | ❌ | — | Not tested |
| 195–197 | POST `/repos` — no source params | ❌ | — | Not tested |
| 199–207 | POST `/repos` — `resolveQueryVector` via `query` | ✅ | search.test.ts | Free-text repo search |
| 199–207 | POST `/repos` — via `roleContextId` / `candidateId` / `repoId` | ❌ | — | Only `query` tested |
| 205–207 | POST `/repos` — `source === null` → 404 | ❌ | — | — |
| 239–245 | POST `/roles` — invalid JSON catch | ❌ | — | Not tested |
| 247–250 | POST `/roles` — schema validation fail | ❌ | — | Not tested |
| 252–255 | POST `/roles` — no source params | ✅ | search.test.ts | Returns 422 |
| 257–265 | POST `/roles` — `resolveQueryVector` via `query` | ✅ | search.test.ts | Free-text role search |
| 257–265 | POST `/roles` — via `roleContextId` | ✅ | search.test.ts | Uses stored embedding |
| 257–265 | POST `/roles` — via `candidateId` / `repoId` | ❌ | — | Untested source types |
| 263–265 | POST `/roles` — `source === null` → 404 | ❌ | — | — |
| 357–378 | POST `/roles` — empty Vectorize matches → `[]` | ✅ | search.test.ts | `makeRoleIndex({})` returns empty |

**Coverage estimate:** ~45% — each route has at least one happy-path test, but error handling (invalid JSON, schema failures, null source), alternative source parameters (`candidateId`, `repoId`), and AI embed failures are almost entirely untested.

---

## File: `workers/api/src/lib/embedding/preprocess.ts`

| Line Range | Code Path | Tested? | Test File | Gap Notes |
|------------|-----------|---------|-----------|-----------|
| 29–32 | Empty / non-string input → throws | ❌ | — | No direct unit test exists for `preprocessForEmbedding` |
| 35 | Whitespace collapse (`/\s+/g`) | ❌ | — | Only indirect via consumers |
| 38–40 | Truncate to `MAX_CHARS` (8192) | ❌ | — | No long-text test |
| 43–44 | `side === 'query'` → BGE prefix | ✅ (indirect) | vectorNativeMatching.e2e.test.ts, search.test.ts | `matchReposForCandidate` and search routes call with `'query'` |
| 47 | `side === 'document'` → plain text | ✅ (indirect) | embed.test.ts, vectorNativeMatching.e2e.test.ts | `embedAndUpsertCandidate` / `embedAndUpsertRole` use `'document'` |

**Coverage estimate:** ~40% — no dedicated test file; only exercised indirectly through callers. Input validation (empty text, type guard) and truncation are uncovered.

---

## File: `workers/api/src/lib/roleDiscovery/embedRole.ts`

| Line Range | Code Path | Tested? | Test File | Gap Notes |
|------------|-----------|---------|-----------|-----------|
| 33–76 | `embedAndUpsertRole` — happy path | ✅ | vectorNativeMatching.e2e.test.ts | Role embedded and queried back successfully |
| 38–40 | Empty profile → throws | ❌ | — | No negative test |
| 49–53 | AI returns no vector → throws | ❌ | — | No negative test |
| 54–58 | Wrong dimension → throws | ❌ | — | No negative test |
| 59–61 | Non-finite values → throws | ❌ | — | No negative test |
| 63–69 | `vectorize.upsert` with metadata | ✅ (indirect) | vectorNativeMatching.e2e.test.ts | Metadata passed in e2e; `upsert` stub succeeds |
| 63–69 | `vectorize.upsert` without metadata | ❌ | — | E2e always passes metadata |
| 71–75 | Return shape (`embeddedAt`, `vectorDim`, `vector`) | ✅ | vectorNativeMatching.e2e.test.ts | Asserted in e2e |

**Coverage estimate:** ~30% — only the happy path is exercised. Every guardrail throw is untested, despite the symmetric `embedAndUpsertCandidate` having full coverage.

---

## File: `workers/api/src/lib/candidateDiscovery/embed.ts`

| Line Range | Code Path | Tested? | Test File | Gap Notes |
|------------|-----------|---------|-----------|-----------|
| 36–79 | `embedAndUpsertCandidate` — happy path | ✅ | embed.test.ts | Correct id prefix and vector length asserted |
| 38–40 | Empty profile → throws | ✅ | embed.test.ts | Explicit test |
| 49–53 | AI returns no vector → throws | ✅ | embed.test.ts | Explicit test |
| 54–58 | Wrong dimension → throws | ✅ | embed.test.ts | Explicit test |
| 59–61 | Non-finite values → throws | ✅ | embed.test.ts | Explicit test |
| 66–72 | `vectorize.upsert` with metadata | ✅ | embed.test.ts | Metadata attachment asserted |
| 66–72 | `vectorize.upsert` without metadata | ✅ (indirect) | embed.test.ts | Happy-path test has no metadata |
| 74–78 | Return shape | ✅ | embed.test.ts | Asserted |

**Coverage estimate:** ~85% — dedicated unit test covers all error branches and happy path. Missing: explicit `upsert` failure propagation (would bubble as unhandled rejection).

---

# Summary

## Coverage Percentage Estimate Per File

| File | Est. Coverage | Confidence |
|------|---------------|------------|
| `workers/api/src/lib/match/matchVectorNative.ts` | **~55%** | High |
| `workers/api/src/lib/match/matchReposForCandidate.ts` | **~65%** | High |
| `workers/api/src/lib/match/triangulateMatch.ts` | **~70%** | High |
| `workers/api/src/routes/search.ts` | **~45%** | High |
| `workers/api/src/lib/embedding/preprocess.ts` | **~40%** | High |
| `workers/api/src/lib/roleDiscovery/embedRole.ts` | **~30%** | High |
| `workers/api/src/lib/candidateDiscovery/embed.ts` | **~85%** | High |

## Top 5 Highest-Risk Untested Paths

| Rank | File | Line Range | Risk |
|------|------|------------|------|
| 1 | `matchReposForCandidate.ts` | **146–162** | **Raw vector index fallback (`annScoreMap`)** — When D1 hydration returns empty but the Vectorize index has matches, the code falls back to raw scores. This blending path is never exercised. A bug here would silently break ranking for newly-indexed or partially-synced vectors. |
| 2 | `search.ts` | **104–119** | **Query embed failure + null source handling** — If `ai.run` throws or returns a bad vector, `resolveQueryVector` catches and returns `null`. The routes then return 404/NOT_FOUND. No test validates this error contract; a regression could turn this into a 500. |
| 3 | `matchVectorNative.ts` | **86–113** | **`resolveQueryVector` error branches** — Dim mismatch, missing `ai`, missing both inputs, and embed-failure throws are all untested. These are the first line of defense against malformed requests; uncaught errors would crash the worker. |
| 4 | `search.ts` | **124–141, 181–197, 239–255** | **Invalid JSON / schema validation / missing params on `/candidates` and `/repos`** — Only `/roles` missing-params is tested. Bad input handling on the other two routes is completely unverified. |
| 5 | `embedRole.ts` | **38–61** | **All error guardrails** — Empty profile, missing vector, wrong dimension, and non-finite values are untested. Bad role embeddings could poison the `ROLE_INDEX` and corrupt downstream search results. |

## Recommended Priority Order for Filling Gaps

1. **`matchReposForCandidate.ts` raw-score fallback (lines 146–162)** — Add a test where `matchReposVectorNative` returns `[]` (hydration miss) but `queryVectorIndex` returns raw matches, then assert `annScoreMap` flows into the blended winner.
2. **`search.ts` error contract tests (lines 104–119, 124–141, etc.)** — Add tests for: (a) `ai.run` throwing on free-text query, (b) invalid JSON body → 422, (c) schema violation → 422, (d) `resolveQueryVector` returning `null` → 404.
3. **`matchVectorNative.ts` `resolveQueryVector` negative tests (lines 86–113)** — Unit-test each throw: wrong-dim `queryVector`, missing both inputs, missing `ai`, bad embed response.
4. **`embedRole.ts` guardrail tests (lines 38–61)** — Port the existing `embed.test.ts` pattern to `embedRole.ts` (empty profile, no vector, wrong dim, NaN values).
5. **`triangulateMatch.ts` band derivation + shortlist permutations (lines 227–282)** — Add tests for `deriveBand` boundary values (`moderate`, `weak`, `mismatch`) and `triangulateShortlist` with no vector signals and with `validate`/`tailored` philosophies.
