# Handoff — Dual-Layer Embedding Architecture + Unified Search Endpoints

**Date written:** 2026-04-22
**Branch:** `feat/cloudflare-migration`
**Commit:** `c82f5df`
**Status at handoff:** Implementation complete, all tests passing, docs updated, ADR-040 Accepted
**Scope of this handoff:** Everything a fresh agent needs to understand, debug, or extend the dual-layer embedding system

---

## What this job is

PIPE's matching pipeline had a critical gap: `role_candidate_cosine` was hardcoded to `null` in `orchestrate.ts`, meaning the `role_candidate` weight in `triangulateMatch` always contributed zero. The root cause was that candidate embeddings lived only in Vectorize (`CANDIDATE_INDEX`), role embeddings didn't exist at all, and there was no way to compute an exact cosine between two specific entities without trusting ANN approximations.

This work closes that gap with a **dual-layer embedding architecture**:
- **D1** stores `embedding_json` as ground truth (exact cosine computation, index rebuild source)
- **Vectorize** (`REPO_INDEX`, `CANDIDATE_INDEX`) remains the fast ANN query layer

It also ships **unified bidirectional search endpoints** (`POST /api/v1/search/candidates`, `POST /api/v1/search/repos`) that resolve query vectors from D1 embeddings and hydrate Vectorize ANN results from D1 metadata.

---

## Documentation map

| File | What it is | Read this if you need to... |
|---|---|---|
| `docs/decisions/ADR-040-meaning-based-triangulation.md` | Accepted ADR (updated) | Understand the four-signal triangulation model and weight presets |
| `docs/decisions/current/ADR-040-meaning-based-triangulation.md` | Accepted ADR with full schema | See the complete decision rationale, including dual-layer embedding |
| `workers/api/migrations/0042_embedding_json.sql` | Migration | Rebuild the schema or understand column additions |
| `workers/api/src/lib/embedding/cosine.ts` | Exact cosine helper | Compute or debug cosine similarity between two D1-stored vectors |
| `workers/api/src/routes/search.ts` | Unified search routes | Add search features or debug query vector resolution |
| `workers/api/src/lib/candidateDiscovery/orchestrate.ts` | Ingestion pipeline | Understand how `role_candidate_cosine` is computed at match time |
| `workers/api/src/lib/candidateDiscovery/embed.ts` | Candidate embedder | Understand how candidate profiles are embedded and where vectors go |
| `workers/api/src/routes/cockpit/adminRepos.ts` | Repo admin routes | Understand how repo embeddings are persisted to D1 |
| `workers/api/src/routes/discovery/roleContexts.ts` | Role discovery routes | Understand how role embeddings are built on COMPLETE |

---

## Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  role_contexts  │     │ candidate_ingest│     │repo_engineering_│
│  embedding_json │     │  embedding_json │     │  embedding_json │
│  (ground truth) │     │  (ground truth) │     │  (ground truth) │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │   lib/embedding/cosine.ts │
                    │   cosineSimilarity(a, b)  │
                    └───────────────────────────┘
                                 │
                                 ▼
                    Exact role_candidate_cosine
                    (used by triangulateMatch)

┌─────────────────┐              ┌─────────────────┐
│  CANDIDATE_INDEX│              │   REPO_INDEX    │
│  (Vectorize ANN)│              │  (Vectorize ANN)│
└────────┬────────┘              └────────┬────────┘
         │                                │
         ▼                                ▼
  POST /search/candidates          POST /search/repos
```

**Ground truth writes happen at embed time:**
- Candidate: `embedAndUpsertCandidate` → upserts to `CANDIDATE_INDEX`, then orchestrator persists `embedding_json` to D1 via `markIngestionEmbedded`
- Repo: `vectorizeAndMark` → upserts to `REPO_INDEX`, then updates `repo_engineering_signals.embedding_json`
- Role: `buildAndStoreRoleEmbedding` → embeds `role_searchable_profile`, updates `role_contexts` (fires best-effort on COMPLETE)

**Ground truth reads happen at match/search time:**
- `orchestrate.ts` loads both embeddings from D1 and calls `cosineSimilarity()` for exact `role_candidate_cosine`
- `routes/search.ts` loads embeddings from D1 to build query vectors for ANN search

---

## Key implementation decisions

**D1 + Vectorize, not a separate vector DB.** Pinecone/Weaviate/etc. were rejected because:
- Extra vendor, extra bill, extra sync complexity
- Egress latency (~50–200ms) hurts when doing multiple vector ops per request
- At PIPE scale (hundreds to thousands of candidates/repos), D1 + Vectorize is more than sufficient
- Migration path to dedicated vector DB later is trivial: `SELECT embedding_json FROM ...` → bulk import

**Optional `embedding_json` in TypeScript types.** `RepoEngineeringSignalsRow.embedding_json` and `RoleContextRow.embedding_json` are optional (`?`) so that test fixtures and partial row constructions don't break. In production they are always populated after the embed step succeeds.

**Best-effort role embedding.** Role contexts embed on `COMPLETE` via `buildAndStoreRoleEmbedding`, which is fire-and-forget. If embedding fails (AI binding down, bad vector shape), the role context is still `COMPLETE` and `role_candidate_cosine` simply falls back to `null` for that role until the embedding is retried. No blocking.

**Re-ingest clears `embedding_json`.** `POST /:pipelineId/ingestion/:candidateId/reingest` resets `embedding_json = NULL` so the pipeline re-embeds from scratch.

---

## Test coverage

| Test file | Count | What it covers |
|---|---|---|
| `lib/embedding/__tests__/cosine.test.ts` | 11 | Exact cosine math, parseEmbeddingJson edge cases |
| `lib/candidateDiscovery/__tests__/embed.test.ts` | 6 | Vector returned, upsert shape, error paths |
| `lib/match/__tests__/triangulateMatch.test.ts` | 6 | Weighted combinator with all four signals |
| `lib/match/__tests__/matchReposForCandidate.test.ts` | 7 | Graph + cosine rerank paths |
| `lib/candidateDiscovery/__tests__/situationFit.test.ts` | 7 | Situational scorer integration |
| `lib/match/__tests__/autoStageBuilder.test.ts` | 11 | PR/issue picker, stage assignment |

**Total: 67 tests passing.**

---

## API surface

### Search candidates
```
POST /api/v1/search/candidates
Body: { roleContextId?, repoId?, candidateId?, query?, limit? }
```
Resolves query vector from first available source (role → repo → candidate → text query), queries `CANDIDATE_INDEX`, hydrates from `candidates` + `candidate_ingestion` + `pipelines` (ownership-checked).

### Search repos
```
POST /api/v1/search/repos
Body: { roleContextId?, candidateId?, repoId?, query?, limit? }
```
Same pattern, queries `REPO_INDEX` with `disqualified: 0` filter, hydrates from `qualified_repos` + `repo_engineering_signals`.

---

## Guardrails you must not drop

**Never delete `embedding_json` without a migration plan.** These columns are the ground truth. If Vectorize loses an index, the only rebuild source is D1. If you drop the column, you must re-embed every entity from scratch (~$0.001 per embed × N entities).

**Vectorize upserts and D1 writes are not atomic.** The pipeline upserts to Vectorize first, then writes to D1. If the Worker crashes between the two, Vectorize has the vector and D1 does not. The next read from D1 will get `null` and fall back to ANN or skip the signal. This is acceptable — the alternative (D1 first, Vectorize second) has the same split-brain risk. For critical paths, both are retried independently.

**BGE model is pinned to `@cf/baai/bge-large-en-v1.5`.** All three entity types (role, candidate, repo) must use the same model and the same indexing convention (document-side = no query prefix, query-side = `Represent this sentence for searching relevant passages: ` prefix). Mixing models or conventions breaks the shared vector space.

**Role embedding is lazy.** A role context that reaches `COMPLETE` before this code ships will have `embedding_json = NULL`. The next candidate ingested against that role will get `role_candidate_cosine = null`. This is fine — triangulation falls back to `skill_coverage`. If you need to backfill role embeddings, run a script that calls `buildAndStoreRoleEmbedding` for all `COMPLETE` roles.

---

## How to resume cold

1. Read this handoff (5 min)
2. Read `docs/decisions/ADR-040-meaning-based-triangulation.md` (10 min)
3. Skim `workers/api/src/lib/embedding/cosine.ts` and `workers/api/src/routes/search.ts` (5 min)
4. Run tests: `cd workers/api && npx vitest run src/lib/embedding/__tests__/ src/lib/match/__tests__/ src/lib/candidateDiscovery/__tests__/` (should pass)

---

## One-paragraph TL;DR for a cold agent

PIPE now stores BGE-large-en-v1.5 embedding vectors in D1 (`embedding_json` on `candidate_ingestion`, `repo_engineering_signals`, and `role_contexts`) as ground truth, while Vectorize (`REPO_INDEX`, `CANDIDATE_INDEX`) remains the fast ANN layer. Candidate embeddings are persisted at ingestion time, repo embeddings at admin ingest time, and role embeddings best-effort when role discovery completes. `orchestrate.ts` loads both role and candidate embeddings from D1 and computes exact `role_candidate_cosine` via `cosineSimilarity()`. Two new search endpoints (`POST /api/v1/search/candidates`, `POST /api/v1/search/repos`) enable bidirectional semantic search by resolving query vectors from D1 embeddings and hydrating Vectorize ANN results. All 67 relevant tests pass. ADR-040 is Accepted.
