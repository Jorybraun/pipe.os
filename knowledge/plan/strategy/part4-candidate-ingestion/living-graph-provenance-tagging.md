# Living Graph — Provenance Tagging and Source Registry

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 85–95)
**Phase:** 1
**Status:** PENDING
**Estimate:** 0.5 weeks

## Source quote
> Every sub-element carries four metadata fields that the graph-shaped model requires:
> - `source_type` — where this sub-element came from: `resume`, `github_enrichment`, `linkedin_enrichment`, `automated_screener`, `behavioural_interview`, `technical_interview`, `code_review_session`, `implementation_challenge`, `recruiter_note`, etc.
> - `captured_at` — when the source was processed.
> - `confidence` — 0 to 1, how strong the signal is.
> - `supersedes` — pointer to a prior sub-element that this one replaces.

## Why
Provenance tagging makes the candidate graph auditable, defensible, and debuggable. When a matching decision is challenged or a candidate queries their own profile, the system can explain exactly where each claim came from and how confident the extraction was. It also drives UI: recruiter-facing profiles can surface "this Experience node came from GitHub enrichment, not the resume."

## Subtasks (delegable)

### Subtask 1 — `CandidateNodeSource` type and registry
**Files:**
- `workers/api/src/lib/candidateDiscovery/types.ts`

**Spec:**
Export `CandidateNodeSource` as a string literal union: `'resume' | 'github_enrichment' | 'linkedin_enrichment' | 'automated_screener' | 'behavioural_interview' | 'technical_interview' | 'code_review_session' | 'implementation_challenge' | 'recruiter_note'`. Export `SOURCE_CONFIDENCE_DEFAULTS: Record<CandidateNodeSource, number>` with sensible defaults (e.g. `resume: 0.6, github_enrichment: 0.7, automated_screener: 0.8, code_review_session: 0.85, implementation_challenge: 0.85`). These defaults are used when the extraction LLM doesn't return a confidence score; the extraction LLM score overrides the default.

**Status:** ⏳ PENDING

---

### Subtask 2 — `captured_at` vs `created_at` enforcement
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`

**Spec:**
Enforce the distinction in `insertCandidateNode`: `captured_at` is a required parameter representing when the source event happened (e.g. for GitHub enrichment, the commit timestamp; for a screener turn, the turn timestamp). `created_at` is set server-side to `Date.now()` at insert time. The helper must not allow callers to set `created_at` directly. Add a runtime assertion: `if (node.captured_at > Date.now() + 60_000) throw new Error('[insertCandidateNode] captured_at is in the future')`.

**Status:** ⏳ PENDING

---

### Subtask 3 — Provenance display query
**Files:**
- `workers/api/src/lib/candidateDiscovery/candidateNodes.ts`

**Spec:**
Export `getNodesBySource(db, candidateId, sourceType: CandidateNodeSource): Promise<CandidateNode[]>`. Returns all non-superseded nodes (plus their `source_reference`) for the given source. Used by recruiter profile UI to show "what came from GitHub" vs "what came from the resume." Parameterized SQL only.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md`
- Blocks: `candidate-decomposition-prompt.md` (needs source type constants), `github-enrichment-worker.md`, `screener-answer-decomposition.md`

## Acceptance criteria
- [ ] `CandidateNodeSource` union type covers all sources listed in strategy
- [ ] `SOURCE_CONFIDENCE_DEFAULTS` has an entry for every member of the union
- [ ] `insertCandidateNode` rejects `captured_at` values > 60s in the future
- [ ] `getNodesBySource` returns correct nodes filtered by source in a unit test
- [ ] `npx tsc --noEmit` clean
