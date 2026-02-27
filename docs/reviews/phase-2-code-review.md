# Phase 2 Code Review
**Date:** 2026-02-27
**Reviewer:** Claude
**Scope:** Unstaged changes covering Phase 2 (Candidate Assessment Flow) and Phase 4 (Recruiter Dashboard wiring)

---

## Files Reviewed

| File | Change Type |
|---|---|
| `src/hooks/useAssessment.ts` | Modified — apiKey auth + scoring wired |
| `src/components/ReviewCanvas.tsx` | Modified — multi-snippet + annotation UI |
| `src/components/Assessment/StageRegistry.tsx` | **New** — inversion-of-control stage engine |
| `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` | **New** — diff-view based annotation canvas |
| `src/components/Assessment/CodeReview/diffUtils.ts` | **New** — diff formatter util |
| `src/pages/CandidateAssessmentPage.tsx` | Modified — uses StageRegistry |
| `src/lib/scoring/codeReview.ts` | **New** — ground-truth scoring logic |
| `src/lib/scoring/codeReview.test.ts` | **New** — scorer unit tests |
| `src/content/codeReviewSnippets.ts` | **New** — 3 challenge snippets with ground truth |
| `src/hooks/usePipelineCreate.ts` | Modified — auto-creates CODE_REVIEW stage |
| `src/pages/ListingPage.tsx` | Modified — live data replaces mocks |
| `src/pages/OverviewPage.tsx` | Modified — live data + seed/clear dev tools |
| `src/pages/CandidateProfilePage.tsx` | Modified — live data replaces mocks |
| `src/pages/PipelineDetailPage.tsx` | Modified — live stage fetch |
| `src/App.tsx` | Modified — SubHeader wired to live data, seed hook removed |

---

## What Landed Well ✅

**StageRegistry / inversion-of-control pattern** is the highlight of this diff. Adding a new stage type is now a single object in `Definitions` — no touch needed to `CandidateAssessmentPage`. This is the right abstraction for an expanding assessment platform.

**`DiffReviewCanvas`** solves the annotation positioning bug from `ReviewCanvas` properly. Using `react-diff-view`'s `widgets` API to inject annotation UI directly into the diff tree means position is always correct — no pixel-math required. This is the right component to use.

**`scoreCodeReview` with `±1 line` tolerance** is a thoughtful UX decision. Strict line matching would penalise candidates who annotate the line above or below a bug, which is unfair. Unit tests cover perfect score, false positive penalty, and empty submission.

**`apiKey` auth consolidated at the `generateClient` call** in `useAssessment.ts` rather than passed per-call. Cleaner and less error-prone.

**`seedSmokeTest` removed from `window`** — right call to remove the global debug hook from `App.tsx`.

---

## Bugs 🐛

### P0 — Avg score in `ListingPage` will always be null

`Candidate` has no `score` field in the schema. `Assessment` does. The enrichment logic in `ListingPage.fetchPipelines` casts to `any` and reads `c.score` off candidates — this will always be `undefined`, so `avgScore` is always `null`.

**File:** `src/pages/ListingPage.tsx:54–57`

```ts
// BROKEN — score is on Assessment, not Candidate
const scoredCandidates = candidates.data.filter(
  c => (c as any).score !== undefined && (c as any).score !== null
);
```

**Fix options (pick one):**
1. Denormalise: write a `totalScore` field onto `Candidate` when `submitStage` runs. One extra write, fast reads everywhere.
2. Fetch assessments per pipeline in the enrichment loop (adds 1 more query per pipeline — acceptable at MVP scale).

---

### P0 — `CLEAR_STAGES` / `SEED_MVP_STAGES` buttons exposed in production UI

Both buttons render unconditionally in `OverviewPage`. A recruiter can accidentally wipe all stages for a live pipeline with one click. There is no confirmation prompt.

**File:** `src/pages/OverviewPage.tsx:520–556`

**Fix:**
```tsx
{import.meta.env.DEV && (
  <div style={{ display: 'flex', gap: 12 }}>
    <button onClick={handleClearStages}>CLEAR_STAGES</button>
    {stages.length === 0 && <button onClick={handleSeedStage}>SEED_MVP_STAGES</button>}
  </div>
)}
```

---

### P1 — `ReviewCanvas` annotation indicators use pixel-math positioning (will misalign)

`ReviewCanvas` (the non-diff variant) positions annotation icons using a hardcoded line-height constant:

```tsx
top: `${(a.line - 1) * 20.8 + 24}px`, // Rough calculation based on line height
```

With `wrapLines={true}` enabled on the `SyntaxHighlighter`, any line that wraps will cause all subsequent indicators to be offset. Since `DiffReviewCanvas` is now the default renderer for `CODE_REVIEW` stages (via the `renderer: 'DIFF_VIEW'` config), this only matters if `ReviewCanvas` is ever routed to via `renderer: 'CUSTOM'`. Consider removing the indicator overlay from `ReviewCanvas` entirely and relying on the footer annotation count instead, since the edit popup already gives clear feedback.

---

### P1 — Annotation popup in `ReviewCanvas` is `position: fixed` centred on viewport

**File:** `src/components/ReviewCanvas.tsx:214`

When the page is scrolled, `position: fixed` centres relative to the viewport, which is correct. However if `ReviewCanvas` is ever rendered inside a transformed ancestor (CSS `transform`, `perspective`, etc. — which `LiquidMetalCard` might do with backdrop-filter effects), fixed positioning breaks. Prefer `position: absolute` inside a full-page overlay div rendered at the root via a portal, or gate this behind a check.

---

### P2 — Quiz answer key (`correct` field) is visible in the DOM

`StageRegistry` passes `parsed.questions` directly to `QuizRenderer`, including the `correct` field. Any candidate can read the answers from React DevTools or the serialised stage config. Since quiz scoring happens client-side at MVP, this is a known trade-off — but should be documented.

**File:** `src/components/Assessment/StageRegistry.tsx:53`

**Document it:**
```ts
// NOTE: 'correct' field is included in the client bundle for MVP.
// Server-side scoring would require a Lambda — deferred post-MVP.
// See: docs/specs/engineering-standards.md for Lambda pattern.
```

---

## Type Safety ❌

The project rules require `strict: true` with no `any`. The diff introduces several violations. `npx tsc --noEmit` passes (only pre-existing errors in `useRoleDiscovery.ts`), but the `any` usage bypasses compile-time safety.

| Location | Issue | Fix |
|---|---|---|
| `useAssessment.ts:16` | `export type StageSubmission = any` | Define as a discriminated union: `CodeReviewSubmission \| QuizSubmission` |
| `useAssessment.ts:157` | `(currentStage.config as any).snippets` | Parse config through a typed helper after fetching the stage |
| `CandidateAssessmentPage.tsx:33` | `useState<any>(null)` | `useState<StageSubmission \| null>(null)` |
| `CandidateProfilePage.tsx:46–48` | Three `useState<any>` | Use `Schema['Candidate']['type']`, `Schema['Assessment']['type'][]`, `Schema['Stage']['type'][]` |
| `ListingPage.tsx:54–56` | `c as any` to access `.score` | Fix the data model — score lives on `Assessment` |
| `StageRegistry.tsx:17,23,24,84,85` | Registry interface uses `any` throughout | Acceptable here as a plugin boundary — but document it |
| `OverviewPage.tsx:44–45` | `stage: any`, `candidates: any[]` | Use `Schema` types |
| `ReviewCanvas.tsx:183,186` | `(e: any)` mouse handlers | `MouseEvent<HTMLElement>` |
| `StageRegistry.tsx:1` | `import React from 'react'` unused | Remove — JSX transform handles it |

---

## Performance ⚠️

### N+2 Query Pattern in `ListingPage`

Current flow:
```
1x Pipeline.list()
  └── for each pipeline:
        Stage.list(filter: pipelineId)     ← +1
        Candidate.list(filter: pipelineId) ← +1
```

Total: `2N + 1` AppSync calls per page load. With 10 pipelines = 21 round-trips.

**Fix — use the `hasMany` relationship via `selectionSet`:**

The schema already declares the relationship. Amplify's generated resolvers can batch-load related records in the same AppSync operation:

```ts
const { data: pipelineData } = await client.models.Pipeline.list({
  selectionSet: [
    'id', 'title', 'status', 'level', 'createdAt',
    'stages.*',
    'candidates.*',
  ],
});

// Now: 1 round-trip total. p.stages and p.candidates are already populated.
const enrichedPipelines = pipelineData.map((p) => ({
  ...p,
  stageCount: p.stages.length,
  candidateCount: p.candidates.length,
  avgScore: null, // Fix separately — see avg score bug above
}));
```

This is the intended Amplify Gen 2 pattern for `hasMany` relationships. Drops 2N calls to 0 extra calls.

---

## Candidate Stage Placement Logic

`OverviewPage.candidatesByStage` is an approximation — candidates are bucketed by status (`INVITED`/`IN_PROGRESS` → first stage, `COMPLETED` → last stage). This will misplace candidates in a multi-stage pipeline: a candidate who has completed Stage 1 and is on Stage 2 will show as "COMPLETED" in the last column, not in the middle.

This is documented as MVP and acceptable for now. When multi-stage progression is built, the `currentStageIndex` tracked on `Candidate` (or derived from `Assessment` records) should drive this.

---

## Priority Action List

| # | Priority | Item |
|---|---|---|
| 1 | P0 | Fix avg score — query `Assessment`, not `Candidate.score` (which doesn't exist) |
| 2 | P0 | Gate `CLEAR_STAGES`/`SEED_MVP_STAGES` behind `import.meta.env.DEV` |
| 3 | P1 | Switch `ListingPage` to `selectionSet` to fix N+2 query problem |
| 4 | P1 | Replace `useState<any>` in `CandidateProfilePage` with `Schema` types |
| 5 | P1 | Add comment to `StageRegistry` documenting quiz answer key exposure |
| 6 | P2 | Define `StageSubmission` as a proper union type |
| 7 | P2 | Remove unused `import React` from `StageRegistry.tsx` |
| 8 | P2 | Remove pixel-math indicator overlay from `ReviewCanvas` or restrict to non-wrapping mode |
