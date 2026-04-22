# ADR-040: Meaning-Based Candidate-Repo-Role Triangulation

**Date:** 2026-04-22
**Status:** Accepted
**Deciders:** Backend team (candidate discovery + matching)

---

## Context

The PIPE matching pipeline historically relied on a single signal: `matchReposForCandidate`, which blends structured skill filtering with vector cosine similarity against `REPO_INDEX`. This produces a decent shortlist, but it is one-dimensional. It cannot answer three questions a recruiter cares about:

1. **Role fit:** Does this repo align with the *role context* we built for the pipeline?
2. **Candidate fit:** Does this repo represent a challenge this *specific candidate* is prepared for?
3. **Explainability:** Why was this repo chosen? Can the recruiter audit the reasoning?

In addition, the pipeline supports three match philosophies (`validate`, `tailored`, `hybrid`) that should weight the three signals differently. A flat graph score cannot express that.

---

## Decision

We will compute a **triangulated score** for every candidate→repo match by blending four pre-computed signals through a deterministic weighted sum. The weights are philosophy-aware (validate / tailored / hybrid). The dimensions, raw signals, and recruiter reasoning are persisted to `candidate_ingestion` so the UI can display them without re-computation.

The four signals are:

| Signal | Source | Description |
|--------|--------|-------------|
| `role_repo_alignment` | `repo_role_alignment` cache (ADR-036) | Pre-scored role→repo fit at pipeline build time |
| `candidate_repo_fit` | `candidateSituationFit` LLM scorer | Per-candidate situational scoring against repo engineering signals |
| `role_candidate_cosine` | Exact cosine from D1 ground-truth vectors | Cosine similarity between role embedding and candidate embedding, computed from `embedding_json` columns in D1 (not Vectorize ANN approximations) |
| `skill_coverage` | `matchReposForCandidate` graph score | Normalized structured-filter + cosine blended score |

### Formula

```
triangulated_score =
  w_role_repo       * COALESCE(role_repo_alignment, 0) +
  w_candidate_fit   * COALESCE(candidate_repo_fit, 0) +
  w_role_candidate  * COALESCE(role_candidate_cosine, 0) +
  w_skill_coverage  * normalizeGraphScore(graph_score)
```

Where `normalizeGraphScore` min-max scales the graph score from an expected `[0.3, 0.9]` range to `[0, 1]`.

### Weight presets

| Philosophy | `role_repo` | `candidate_fit` | `role_candidate` | `skill_coverage` | Rationale |
|------------|-------------|-----------------|------------------|------------------|-----------|
| **validate** | 0.35 | 0.30 | 0.15 | 0.20 | Role alignment is primary; candidate fit personalizes it |
| **tailored** | 0.00 | 0.50 | 0.20 | 0.30 | Candidate fit drives selection; role alignment ignored |
| **hybrid** | 0.25 | 0.35 | 0.20 | 0.20 | Balanced contribution from all three meaning signals |

### Tailored mode re-ranking

In `tailored` mode the graph winner may not be the best candidate fit. After `candidateSituationFit` returns rankings, the orchestrator calls `triangulateShortlist` over the full top-5 shortlist, picks the highest triangulated repo, and fetches fresh PR/issue numbers for that repo. This ensures tailored mode is genuinely candidate-centric, not just graph-centric with zeroed role weights.

### Validate mode behavior

`validate` mode runs the full discovery + scoring pipeline so the recruiter can preview the match, but **does not write** `candidate_challenge_assignment` rows. This lets a pipeline owner test philosophy and tuning without mutating candidate state.

---

## Alternatives Considered

### Option A — Single graph score (status quo)
- **Pros:** Fast, no extra LLM calls, simple to explain.
- **Cons:** Cannot incorporate role context or candidate situational fit; not philosophy-aware; black-box to recruiters.

### Option B — End-to-end LLM re-ranker
- **Pros:** Maximum flexibility; the LLM sees all signals in one prompt.
- **Cons:** Expensive (one LLM call per candidate × repo pair); non-deterministic; hard to unit test; latency unacceptable for real-time upload.

### Option C — Deterministic weighted combinator (chosen)
- **Pros:** Deterministic, testable, fast (no LLM at scoring time), explainable per-dimension, philosophy-aware via weight presets.
- **Cons:** Requires a pre-computed `candidate_repo_fit` signal (one LLM call per candidate, amortized across the shortlist).

---

## Rationale

Option C hits the sweet spot: we pay the LLM cost once per candidate (the `candidateSituationFit` call scores up to 20 repos in a single prompt), then blend deterministically. The weights are tunable from empirical feedback (see `match_feedback` table), and the dimensions give recruiters concrete bars to look at instead of a single opaque number.

---

## Consequences

### Positive
- Recruiters see **why** a repo was chosen (dimensions + matches/mismatches).
- Philosophy switching (`validate` → `hybrid` → `tailored`) changes behavior predictably.
- Feedback loop: `match_feedback` records `thumb`, `reason`, and the four raw signals for offline weight tuning.
- Validate mode allows safe experimentation without mutating candidate challenges.

### Negative / Trade-offs
- `candidateSituationFit` adds one LLM call (~2–4s) to the ingestion pipeline.
- `role_candidate_cosine` is computed exactly from dual-layer ground-truth vectors stored in D1 (`candidate_ingestion.embedding_json` and `role_contexts.embedding_json`). If either embedding is missing (e.g., role context not yet completed), the signal falls back to `null` and its weight contributes `0`.
- The `candidate_ingestion` row grows by ~2 KB per candidate due to JSON columns.

### Risks
- If `candidateSituationFit` fails or returns degenerate JSON, the ingestion step catches the error, marks `status = 'failed'`, and the upload still succeeds. The recruiter can re-ingest.
- Tailored re-ranking may select a repo with no suitable PR/issue, producing a partial assignment. The UI shows `matchedRepoName` but the candidate may see a placeholder challenge. This is acceptable for MVP; future work can expand the PR/issue picker to run against the full shortlist.

---

## Privacy & Retention

| Data | Retention | Rationale |
|------|-----------|-----------|
| `candidate_searchable_profile` | Until candidate deleted | Required for re-ingestion and embedding |
| `career_context_json` | Until candidate deleted | Same as above |
| `situation_signature_json` | Until candidate deleted | Same as above |
| Vector embedding in `CANDIDATE_INDEX` | Until candidate deleted | Vectorize metadata does not contain PII |
| `match_feedback` | 2 years | Empirical tuning dataset |
| `triangulated_score` + `dimensions_json` | Until candidate deleted | UI display only |

---

## Follow-up

- **Weight tuning:** After 50+ feedback rows, run offline regression to calibrate weight presets against recruiter thumbs-up/down accuracy.
- **Expand PR/issue picker:** Allow `pickReviewPr` / `pickImplementationIssue` to run against any repo in the shortlist, not just the graph winner.
- **Unified search endpoints:** `POST /api/v1/search/candidates` and `POST /api/v1/search/repos` enable bidirectional semantic search (role→candidates, role→repos, candidate→repos, repo→candidates) using the same dual-layer embedding architecture.
