# Handoff — Vector-Native Candidate-Repo-Role Matching

**Date:** 2026-04-22
**Context window status:** Active. Agent pivoted from coding to planning per founder directive.
**Scope:** Unified vector space architecture for direct candidate↔repo↔role correlation via Vectorize ANN.

---

## Research Conclusion

**Committed recommendation: Vector-Native Triangulation with Structured Guardrails.**

The current pipeline already has 90% of the infrastructure. The gap is architectural: vectors are used as a secondary rerank signal, not as the primary retrieval mechanism. The fix is to make the unified BGE embedding space the PRIMARY matching engine, with SQL/LLM as guardrails on the shortlist.

---

## Current State (what exists)

| Component | Status | Location |
|---|---|---|
| `REPO_INDEX` (Vectorize) | ✅ Live | `wrangler.jsonc`, populated on repo ingest |
| `CANDIDATE_INDEX` (Vectorize) | ✅ Live | `wrangler.jsonc`, populated on resume upload |
| `ROLE_INDEX` (Vectorize) | ❌ Missing | Only D1 `embedding_json` exists |
| BGE-large-en-v1.5 embeddings | ✅ Live | All three entity types use same model |
| Dual-layer ground truth (D1 JSON) | ✅ Live | Migration 0042 |
| SQL graph matcher | ✅ Live | `matchRepos.ts` — hard filters + scoring |
| LLM situational scorer | ✅ Live | `candidateSituationFit.ts` |
| LLM role-repo reranker | ✅ Live | `roleFitRerank.ts` |
| Weighted combinator | ✅ Live | `triangulateMatch.ts` — 4 signals blended |
| Search routes | ✅ Partial | `/search/candidates`, `/search/repos` — no `/search/roles` |

**Key finding from embedding validation brief:** BGE captures domain/topic discrimination strongly (React fintech ↔ React fintech role) but fails on fine-grained skill matching, situational fit, and quality ranking. Small cosine differences (<0.05) are noise. This means vector search is excellent for Stage 1 retrieval (top-50) but insufficient for final ranking without LLM rerank on the shortlist.

---

## The Plan

### Architecture: Unified Vector Space

All three entities embed into the same 1024-dim BGE space:

```
ROLE_INDEX (new) ──┐
                   ├──► Same model, same preprocessing, same vector space
CANDIDATE_INDEX ───┤    = direct cosine comparison across all three
                   │
REPO_INDEX ────────┘
```

### Four Pairwise Correlations via ANN

| Direction | Query Vector | Target Index | Use Case |
|---|---|---|---|
| Role → Candidate | `role_searchable_profile` | `CANDIDATE_INDEX` | "Show me candidates for this role" |
| Candidate → Role | `candidate_searchable_profile` | `ROLE_INDEX` | "What roles fit this candidate?" (reuse) |
| Role → Repo | `role_searchable_profile` | `REPO_INDEX` | "Which repos fit this role?" |
| Candidate → Repo | `candidate_searchable_profile` | `REPO_INDEX` | "Which repos challenge this candidate?" |

### Two-Stage Pipeline

1. **Stage 1 — Vector ANN retrieval** (<100ms): Query the appropriate index with metadata filters (language, seniority, domain). Get top-50.
2. **Stage 2 — LLM rerank** (expensive): Run `roleFitRerank` or `candidateSituationFit` on the shortlist only. Get top-5 with reasoning.

This flips the current architecture: vector is primary, SQL/LLM are guardrails.

### Implementation Phases

**Phase A: Close the vector gap (1 day)**
1. Create `ROLE_INDEX` in `wrangler.jsonc`
2. Build `embedAndUpsertRole` — mirror candidate embed pattern
3. Build `preprocessForEmbedding` utility — locks document/query prefix convention
4. Backfill existing roles into `ROLE_INDEX`

**Phase B: Vector-native matching engine (2-3 days)**
1. Build `matchVectorNative` — unified ANN matcher with metadata filtering
2. Support all four match directions with D1 hydration
3. Add metadata to all vectors (language, seniority, domain)

**Phase C: Search routes (1 day)**
1. Add `POST /api/v1/search/roles`
2. Refactor existing `/search/candidates` and `/search/repos` to use `matchVectorNative`

**Phase D: Triangulated pipeline (2 days)**
1. Rewrite `triangulateMatch` with vector-native weight presets
2. Add `vector_role_repo`, `vector_role_cand`, `vector_cand_repo` as primary signals
3. Keep LLM rerankers for Stage 2 on shortlist

**Phase E: Validation (2 hours)**
1. Run synthetic sniff test from embedding-validation-brief
2. Verify role→repo and role→candidate discrimination
3. Instrument `match_feedback` UI for empirical calibration

---

## Code Touched (before founder stopped coding)

### Files Created

| File | Purpose |
|---|---|
| `workers/api/src/lib/embedding/preprocess.ts` | Locked preprocessing pipeline for BGE. Document-side = no prefix. Query-side = BGE query prefix. |
| `workers/api/src/lib/roleDiscovery/embedRole.ts` | `embedAndUpsertRole` — mirrors candidate embed, upserts to `ROLE_INDEX`. |
| `workers/api/src/lib/match/matchVectorNative.ts` | Unified ANN matcher. `queryVectorIndex`, `matchReposVectorNative`, `matchCandidatesVectorNative`, `matchRolesVectorNative`. |

### Files Modified

| File | Change |
|---|---|
| `workers/api/wrangler.jsonc` | Added `ROLE_INDEX` binding (index_name: `role-searchable-profiles`). |
| `workers/api/src/types.ts` | Added `ROLE_INDEX: VectorizeIndex` to `Env` interface. |
| `workers/api/src/lib/candidateDiscovery/embed.ts` | Refactored to use `preprocessForEmbedding` utility for consistency. |

### Files NOT Touched (still need work)

- `workers/api/src/routes/search.ts` — needs `/search/roles` endpoint + refactor to `matchVectorNative`
- `workers/api/src/lib/match/triangulateMatch.ts` — needs vector-native weight presets
- `workers/api/src/lib/match/matchReposForCandidate.ts` — needs to use `matchVectorNative` as primary
- Migration file for role embedding backfill
- Synthetic sniff test script

---

## Key Risks & Fallbacks

| Risk | Likelihood | Fallback |
|---|---|---|
 BGE role→repo discrimination weak | Medium | Keep `repo_role_alignment` LLM cache as primary role-repo signal. Use vector only for role→candidate and candidate→repo. |
| Vectorize metadata filter latency | Low | Metadata filters are index-side, not post-filter. Expected <100ms at 10k vectors. |
| Role profile changes → stale embedding | High | Fire `embedAndUpsertRole` on every `role_contexts` update. Add `embedded_at` timestamp. Alert if stale > 24h. |
| Sparse candidate profiles embed poorly | Medium | Standardize on dense `candidate_searchable_profile` as ONLY text source. Never embed raw bio. |

---

## Open Questions Requiring Founder Decision

1. **Role→repo vector signal weight:** If the synthetic sniff test shows role→repo ANN is weak, do we keep LLM-based `repo_role_alignment` as the primary role-repo signal? (Recommended: yes, with vector as secondary.)

2. **MVP scope:** Does the first real candidate test use the new vector-native pipeline, or keep the existing hybrid pipeline until validation passes?

3. **Assessment signals future:** When dev containers ship, do we add a fourth vector space for behavioral telemetry (TDD patterns, churn, AI acceptance), or keep assessment signals as structured SQL dimensions?

---

## What to Do Next

**If implementing:**
1. Read this handoff (2 min)
2. Run `npx tsc --noEmit` to verify type safety after the files modified above
3. Complete Phase A: backfill existing roles into `ROLE_INDEX`
4. Complete Phase B: finish `matchVectorNative` integration
5. Run synthetic sniff test before touching real candidate data

**If researching more:**
- The embedding-validation-brief has the full sniff test protocol
- The RND telemetry research has behavioral signals for future assessment vector space
- ADR-040 has the current triangulation weight rationale

---

## Evidence Table

| ID | Claim | Source | Strength |
|---|---|---|---|
| E1 | BGE-large captures domain/topic discrimination strongly | BEIR leaderboard, BAAI model card | Strong |
| E2 | BGE fails on fine-grained skill matching and situational fit | Inference from architecture; no direct recruiting study | Moderate |
| E3 | Small cosine differences (<0.05) in bi-encoders are typically noise | Standard IR practice | Strong |
| E4 | Unified embedding space enables candidate reuse without re-ingestion | Architectural deduction from current codebase | Strong |
| E5 | Vectorize metadata filtering supports index-side constraints | Cloudflare Vectorize docs | Strong |
