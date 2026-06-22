# PR Narrative Enrichment and Semantic Per-Candidate Assignment

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part3-repo-ingestion.md (lines 204–207)
**Phase:** 2
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> `repo_sample_prs` carries `changed_file_count`, `modifies_tests`, `swe_bench_eligible`, `construct_slugs_json`. Extend this to include a Gemma-derived `pr_narrative` (2–3 sentences describing what the PR does and what a reviewer would encounter) and embed it. Per-candidate PR selection can then be semantic: given the candidate's profile, find the PR whose narrative best matches their experience. Current selection is `ORDER BY changed_file_count ASC` — defensible as a default but missing the semantic dimension.

## Why
Per-candidate PR assignment currently uses only size ordering. A semantic dimension — matching the PR's domain and technical content to the candidate's demonstrated experience — produces more relevant code review challenges and improves assessment signal quality.

## Subtasks (delegable)

### Subtask 1 — Migration: add `pr_narrative` and `pr_narrative_embedding_json` to `repo_sample_prs`
**Files:**
- `workers/api/migrations/XXXX_repo_sample_prs_narrative.sql` (new — assign number at implementation time)

**Spec:**
- Add columns: `pr_narrative TEXT`, `pr_narrative_embedding_json TEXT`, `pr_narrative_version TEXT`.
- No NOT NULL — existing rows are null until backfilled.
**Status:** ⏳ PENDING

### Subtask 2 — Pass 2 extension: generate `pr_narrative` per sampled PR
**Files:**
- `workers/api/scripts/crawl-repos/pass2/` (locate PR sampling logic)

**Spec:**
- After the 20 eligible PRs are sampled and written to `repo_sample_prs`: for each PR, call Gemma with a lightweight prompt: "Given this PR's diff summary (changed files, constructs, size), write 2–3 sentences describing what this PR does and what a code reviewer would encounter. Be specific to the code, not generic."
- Input: `{ changedFileCount, modifiesTests, constructSlugsJson, diffSummary }` where `diffSummary` is the first N lines of the PR diff or a condensed file-change list (not the full diff — keep token count bounded).
- Write `pr_narrative` and `pr_narrative_version` to `repo_sample_prs`.
- Embed `pr_narrative` via `preprocessForEmbedding(narrative, 'document')`, store in `pr_narrative_embedding_json`.
**Status:** ⏳ PENDING

### Subtask 3 — Semantic PR selection in `autoStageBuilder`
**Files:**
- `workers/api/src/lib/match/autoStageBuilder.ts`

**Spec:**
- `pickReviewPr()`: when `pr_narrative_embedding_json` is populated for the repo's sample PRs, compute cosine similarity between each PR's narrative embedding and the candidate's profile embedding (from `candidate_ingestion.embedding_json`).
- Return the PR with highest cosine similarity above a threshold (0.6 default), falling back to the existing `ORDER BY changed_file_count ASC` if no PR clears the threshold or embeddings aren't available.
- Log which selection path was used (`'semantic'` or `'size_fallback'`) for observability.
**Status:** ⏳ PENDING

## Dependencies
- Depends on: `repo-decomposition-schema.md` (PRSample sub-elements are written to `repo_nodes`; this plan extends the underlying `repo_sample_prs` rows rather than the node layer)
- Depends on: Subagent E (preprocessing normalization — already DONE)
- Depends on: Subagent D (autoStageBuilder RCD cutover — already DONE)
- Blocks: `per-candidate-pr-override-ui.md` (richer PR metadata makes the override UI more useful)

## Acceptance criteria
- [ ] Pass 2 populates `pr_narrative` for sampled PRs on new crawls
- [ ] Backfill script (or separate run) populates `pr_narrative` for existing `repo_sample_prs` rows
- [ ] `pickReviewPr()` uses semantic selection when embeddings are available
- [ ] Fallback to size-ordering fires when cosine threshold is not cleared
- [ ] Selection path logged
- [ ] `npx tsc --noEmit` passes
