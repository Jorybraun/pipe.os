# Candidate Profile View — Candidate-Facing Graph Display

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 347–349)
**Phase:** 2
**Status:** NEEDS-REFINEMENT
**Estimate:** 2 weeks

## Source quote
> Candidate-facing profile view showing what's been captured, with ability to correct or add. This is product UI work — candidates should see their graph and participate in its accuracy.

## Why
Without a visible profile, candidates are flying blind through the screening and enrichment process. Transparency about what's been captured builds trust, drives screening completion (candidates see their profile growing), and enables corrections that improve matching accuracy. The strategy explicitly frames Mode 1 screening as profile-building rather than hiring evaluation — the profile view is what makes that framing tangible.

## Subtasks (delegable)

### Subtask 1 — Candidate profile read API
**Files:**
- `workers/api/src/routes/rpc/candidateProfile.ts`

**Spec:**
`GET /rpc/candidate/profile` — authenticated with candidate session JWT. Returns `CandidateProfileResponse`: `{ nodes: CandidateNodeSummary[], coverage: CandidateCoverage, lastUpdated: number }`. `CandidateNodeSummary` strips `embedding_json` (never send embeddings to client), includes `id`, `node_type`, `narrative_text`, `source_type`, `captured_at`, `confidence`, `superseded_at`. Filter: only non-superseded nodes. Order: by `node_type` then `captured_at` desc. Paginate: max 100 nodes per request (`?cursor=<last_id>`).

**Status:** ⏳ PENDING

---

### Subtask 2 — Candidate profile page (React)
**Files:**
- `src/pages/CandidateProfile.tsx`

**Spec:**
Page component rendered on the candidate portal (protected by candidate session JWT). Groups nodes by type: "Experience", "Skills", "Projects", etc. Each group renders a collapsible section. Each node card shows: narrative_text, source badge (`resume` / `GitHub` / `screener`), confidence indicator (low < 0.6, medium 0.6–0.8, high > 0.8), captured_at formatted as relative time. Coverage bar at top: 5 dimension progress bars using `candidate_coverage` values. "Add missing information" CTA — links to screening entry (Mode 1) if screener_status is not complete. No styling outside the existing design system (`LiquidMetalCard`, existing badge components).

**Status:** ⏳ PENDING

---

### Subtask 3 — Candidate correction endpoint
**Files:**
- `workers/api/src/routes/rpc/candidateProfile.ts`

**Spec:**
`POST /rpc/candidate/profile/nodes/:nodeId/correct` — authenticated with candidate session JWT. Body: `{ corrected_narrative: string, correction_note: string }`. Creates a new `candidate_nodes` row with `source_type='recruiter_note'` (closest available — mark NEEDS-REFINEMENT: a `candidate_correction` source type may need adding), `supersedes=nodeId`. The correction note stored in `extracted_properties_json.correction_note`. Candidate owns their corrections. Validation: `corrected_narrative` max 1000 chars, `correction_note` max 300 chars. Returns the new node. Does not allow correcting nodes that are already superseded.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `candidate-nodes-schema.md`, `github-enrichment-intake.md` (enrichment nodes flowing to make profile interesting), `screener-answer-decomposition.md` (screener nodes)
- Blocks: nothing (end-user feature)

## Acceptance criteria
- [ ] Profile API returns only non-superseded nodes
- [ ] Profile API paginates correctly at node 100
- [ ] Profile page renders with no visible JS errors for a candidate with 0 nodes and a candidate with 15+ nodes
- [ ] Coverage bars reflect actual `candidate_coverage` values
- [ ] Correction creates a new node that supersedes the original (original excluded from next profile fetch)
- [ ] `npx tsc --noEmit` clean
