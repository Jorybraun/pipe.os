# Candidate Ingestion — Handoff (2026-04-22)

**Branch:** `feat/cloudflare-migration`
**STRATEGY.md authority:** Decision Log entry 2026-04-21 (line 1031) — override of ADR-039 Implementation sequencing. Read that first.
**ADR:** ADR-039 (bi-directional vectorization + 3-station interview). Implementation items (1) role ingest, (4) `ADR_REVIEW`, (6) session runner remain explicitly deferred.

---

## What shipped

Four commits implement the backend of the per-candidate Ingestion pre-stage.

| Commit | Summary | Key files |
|---|---|---|
| `bcdb6bc` | Gate auto-build on `match_philosophy === 'validate'` + `candidate_ingestion` / `candidate_challenge_assignment` tables + STRATEGY override entry | `workers/api/migrations/0038_candidate_ingestion.sql`, `workers/api/src/routes/cockpit/pipelinesAutoBuild.ts`, `knowledge/STRATEGY.md` |
| `5e53c61` | Candidate Discovery agent (Gemma 4 26B, Vertex primary / Workers AI fallback) | `workers/api/src/lib/candidateDiscovery/{prompts,agent,persist}.ts`, `workers/api/src/lib/llm/createProvider.ts` (`createCandidateAgentProvider`) |
| `e3c9132` | `CANDIDATE_INDEX` Vectorize index created remotely + binding + `embedAndUpsertCandidate` helper | `workers/api/wrangler.jsonc`, `workers/api/src/types.ts`, `workers/api/src/lib/candidateDiscovery/embed.ts` |
| `6f643b3` | `matchReposForCandidate` resolver (graph filter + optional BGE cosine rerank) + `markIngestionMatched` + `upsertCandidateChallengeAssignment` | `workers/api/src/lib/match/matchReposForCandidate.ts`, `workers/api/src/lib/match/autoStageBuilder.ts` (exported `pickReviewPr` / `pickImplementationIssue`) |

**Test status:**
- 7 Discovery tests, 6 embed tests, 7 match tests — all pass.
- 11 existing `autoStageBuilder` tests still pass after the pick-helper exports.
- No new `tsc --noEmit` errors.

**Gate behaviour:** `pipelinesAutoBuild.ts` only calls `autoStageBuilder` when `match_philosophy === 'validate'`. `tailored` / `hybrid` produce 2 stages + 2 challenges with NULL repo/PR/issue and placeholder titles; the ingestion layer backfills them per candidate.

---

## What's left

### #7 — Resume-upload orchestration hook

**Trigger:** resume upload only. No session-start fallback (per override).
**Endpoint:** the existing resume-upload route under `POST /api/v1/candidates/:candidateId/resume` (find via grep on `cvParser` usage).

**Sequence (all idempotent — re-upload must re-ingest cleanly):**

1. `upsertPendingIngestion(db, candidateId)` — status `pending`.
2. Parse resume text via existing `cvParser` (already invoked by the current hook).
3. Call `discoverCandidateProfile({ provider, parsed, resumeText })`. On throw → `markIngestionFailed` with the error and **return the upload as success** (ingestion is best-effort; upload must not fail).
4. `persistCandidateProfile(db, candidateId, result)` → status `profile_generated`.
5. `embedAndUpsertCandidate({ ai, vectorize: env.CANDIDATE_INDEX, candidateId, profile: result.candidateSearchableProfile, metadata: { seniority, primary_language } })`. On throw → `markIngestionFailed`, return success.
6. `markIngestionEmbedded(db, candidateId, embeddedAt)` → status `embedded`.
7. For each stage in the candidate's pipeline that has a placeholder challenge (repo_id NULL):
   - Call `matchReposForCandidate({ db, ai, vectorize: env.REPO_INDEX, candidateProfile, keyConcepts })`.
   - Write one `upsertCandidateChallengeAssignment` row per stage (unique on `candidate_id + stage_id`).
8. `markIngestionMatched(db, candidateId, matchedRepoId)` → status `matched`.

**Provider:** `createCandidateAgentProvider(env)`. If `null` (MOCK_AI or missing config), short-circuit to `markIngestionFailed('provider unavailable')` and return upload success.

**What to wire:** find the existing resume-upload route first. Grep for `unpdf` or `cvParser` under `workers/api/src/routes`. Add the ingestion call AFTER the existing upload + parse, wrapped in its own try/catch so upload success is preserved.

### #8 — `/rpc/get-challenge` per-candidate override

In `workers/api/src/routes/rpc.ts` (~line 428 per pre-compaction notes), LEFT JOIN `candidate_challenge_assignment` on `(candidate_id, stage_id)`. When the row exists, override `github_repo_url`, `github_pr_number`, `issue_number` from the assignment row. When it doesn't, fall back to the pipeline-level `challenges` row (this is the `validate`-mode path).

### #9 — Ingestion pre-stage UI

Pipeline details page — user explicitly asked for a **human icon button beside the existing house stage icons**, representing a pre-stage called "Ingestion" that is **not part of the interview**. Clicking opens a drawer that shows per-candidate ingestion status (the five states from `candidate_ingestion.status`). Non-interactive in `validate` mode. Use `LiquidMetalCard`, do not invent new primitives.

Likely entry point: `src/pages/PipelineBuilderPage.tsx` or wherever `StageStepper` renders. See `StageStepper.tsx` for the existing gate-circle pattern (the human icon button mirrors that).

### #10 — BDD (Playwright)

Covering:
- Recruiter uploads resume → ingestion fires → candidate sees the matched repo at challenge time.
- `validate` mode: upload does NOT mutate challenges (gate path).
- `hybrid` mode: upload DOES run the full pipeline.
- Ingestion failure (e.g., provider returns garbage) → upload still succeeds, `candidate_ingestion.status = 'failed'`, `error_text` populated.
- Re-ingest button — re-runs from `pending`.

### #11 — CHANGELOG final pass + ADR-040

Check `docs/decisions/README.md` convention first — decide between a fresh ADR-040 vs an amendment block inside ADR-039. The 2026-04-21 override is substantial enough that I lean toward ADR-040 (`Candidate Ingestion Pre-Stage`) that explicitly supersedes the deferral half of ADR-039's sequencing. But follow the repo convention, don't invent one.

---

## Open question the user raised — vectorization relevance strategy

The user interrupted mid-discussion with: *"how does the vectorization work, because i feel like we need a strategy for the relevance."* This is the unresolved open question. Record of current state so the next session can pick it up.

### What the code does today

- **Repo side (shipped earlier, 2026-04-14):** `repo_searchable_profile` is a 400–600 word Gemma-narrated engineering profile. Embedded with `@cf/baai/bge-large-en-v1.5` (1024-dim, cosine) into `REPO_INDEX` as **document-side** — no BGE query prefix at index time.
- **Candidate side (just shipped):** `candidate_searchable_profile` is the symmetric 400–600 word Gemma narrative from the Discovery agent. Embedded document-side into `CANDIDATE_INDEX` with identical model + dim + metric.
- **At query time** in `matchReposForCandidate`: we prepend the BGE query prefix (`"Represent this sentence for searching relevant passages: "`) to the candidate profile, embed it, and query `REPO_INDEX` for top-K.
- **Blend:** `matchReposForCandidate` first runs `matchRepos` (structured graph score: must-have skill coverage + seniority band + language filter + domain match + PR quality). It takes the top N, then reranks by `blended = graph_score * (1 - cosineWeight) + cosine * cosineWeight`. **Default `cosineWeight = 0.5`.**

### Why "relevance strategy" is an open question

1. **The two scores aren't on the same scale.** `matchRepos` graph score is `[0, ~1.1]` with a calibrated blend of six weighted terms (must 0.45, nice 0.15, domain 0.10, constructs 0.10, PR quality 0.15, 1−contamination 0.05). BGE cosine similarity sits in roughly `[0.2, 0.95]` for real text pairs. A naive linear blend at `0.5` will be dominated by whichever axis has more spread in the top-N, which is usually cosine. We have no calibration for this.

2. **Document-side embedding is conservative but opinionated.** We chose document-side at index time and query-prefix at query time, matching BGE asymmetric retrieval — but this means recruiter-side "find candidates similar to this candidate" queries against `CANDIDATE_INDEX` need the same query-prefix discipline. Document the convention before anyone else queries either index.

3. **`CANDIDATE_INDEX` is write-only right now.** Nothing queries it in the shipped code path. It exists because (a) ADR-039 is symmetric by design, (b) future recruiter-side "find candidates matching this role" needs it, (c) future candidate-cohort features need it. But if we never resolve a use-case, we're paying index + embed cost for nothing. Decide whether to: (i) gate the `CANDIDATE_INDEX` upsert behind a flag until a consumer lands, or (ii) accept the cost and document a first consumer timeline.

4. **No role-side index exists yet.** ADR-039 §Implementation item (1) — role ingest endpoint — remains deferred. "Bi-directional cosine" in the task name is therefore partially theoretical: right now we have **candidate → REPO_INDEX** only. Hybrid blending of role-side + candidate-side cosine is not possible until the role profile is stored somewhere (either indexed, or recomputed from `role_context_id` at request time).

5. **No relevance evaluation harness.** `/calibrate` covers the scorer, not the matcher. We have zero ground-truth pairs for "did this candidate get a good repo match?" — no golden set, no recruiter thumb-up/down table, no offline eval. A minimum viable harness: a D1 table `match_feedback (candidate_id, repo_id, thumb TEXT CHECK IN ('up','down'), reason TEXT, created_at)` plus a recruiter-side "was this a good match?" affordance on the candidate detail page. Without this, every tuning decision on `cosineWeight` or the graph-score weights is blind.

### Shape of the strategy we need to write

A short doc (probably a fresh ADR — "Candidate-Repo Relevance Strategy") or an amendment to ADR-039 that resolves, minimally:

- **Score normalization.** Do we z-score the graph score over the candidate shortlist before blending? Do we min-max cosine over the top-K? Pick one.
- **Default weight.** What `cosineWeight` ships, and what's the path to tune it (OQ-W1 from the 2026-04-19 brief — tolerance band → cosine threshold mapping — sits here).
- **Hybrid vs tailored weight split.** `tolerance = strict | moderate | lenient` should probably map to three `cosineWeight` values; document the mapping even if it's just a working default.
- **`CANDIDATE_INDEX` consumer plan.** First consumer + date, or gate behind a flag.
- **Relevance evaluation harness.** Ship the `match_feedback` table + UI affordance as part of #9 or as a sibling task. Without it we cannot close any of the above decisions empirically.
- **Role-side handling under hybrid.** Either accept that `hybrid` behaves identically to `tailored` until ADR-039 item (1) ships (document this explicitly in the UI), or synthesize role-side text at request time from the existing `role_searchable_profile` precursors in the RCD (narrative + stack tokens) and embed-on-the-fly for the query.
- **Privacy.** OQ-V5 candidate privacy — retention + deletion rules for embedded candidate profiles — is called out in the 2026-04-21 override as unresolved. A `DELETE /api/v1/candidates/:id/ingestion` that drops D1 rows AND deletes the Vectorize vector is the minimum; confirm Vectorize supports deletion by id (it does, via `deleteByIds`).

Writing this doc is probably the right *next* thing once #7 and #8 are functional — before #9, so the UI doesn't ship with a hardcoded weight that gets inherited as canon.

---

## Key file map

```
workers/api/
├── migrations/0038_candidate_ingestion.sql                 # schema
├── src/lib/candidateDiscovery/
│   ├── prompts.ts                                          # system prompt + user message builder
│   ├── agent.ts                                            # discoverCandidateProfile
│   ├── embed.ts                                            # embedAndUpsertCandidate (bge-large, 1024-dim)
│   ├── persist.ts                                          # upsertPendingIngestion / persistCandidateProfile /
│   │                                                       #   markIngestionEmbedded / markIngestionMatched /
│   │                                                       #   markIngestionFailed / upsertCandidateChallengeAssignment
│   └── __tests__/*.test.ts
├── src/lib/match/
│   ├── matchReposForCandidate.ts                           # graph + optional cosine rerank
│   ├── autoStageBuilder.ts                                 # role-side (validate mode) — also exports pickReviewPr / pickImplementationIssue
│   └── __tests__/*.test.ts
├── src/lib/llm/createProvider.ts                           # createCandidateAgentProvider factory
├── src/types.ts                                            # Env.CANDIDATE_INDEX
└── wrangler.jsonc                                          # CANDIDATE_INDEX binding, remote: true
```

---

## Gotchas

- **Upload must not fail if ingestion fails.** Every ingestion step in #7 needs its own try/catch that writes `markIngestionFailed` and returns the upload as success. The recruiter surfaces the failure via the Ingestion tile in #9; the candidate falls back to the `validate`-mode pipeline-level challenge.
- **`CANDIDATE_INDEX` vectors are document-side.** Don't prepend the BGE query prefix when upserting. Only when querying.
- **Re-ingest must be idempotent.** All persist helpers are `ON CONFLICT DO UPDATE`. `candidate_challenge_assignment` is UNIQUE on `(candidate_id, stage_id)`. Vectorize upsert replaces the vector by id.
- **Seniority band enum mismatch.** `issue_challenge_signals.difficulty_band` is `junior | mid | senior` only. `autoStageBuilder.pickImplementationIssue` rolls `staff → senior`. `matchReposForCandidate` reuses this helper so the roll-up is automatic.
- **Pre-existing `tsc` errors.** ~17 unrelated TS errors existed before this work (challenges.ts, rpc.ts, video.ts, etc). Do not claim clean tsc — filter for candidateDiscovery / match / createProvider / types.ts to verify no new errors.
- **Local D1 migration applied; prod D1 has NOT been migrated** with 0038. `./node_modules/.bin/wrangler d1 migrations apply pipe-db --remote` before any prod deploy.
