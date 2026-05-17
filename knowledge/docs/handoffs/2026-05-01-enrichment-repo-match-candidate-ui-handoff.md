# Handoff: Enrichment & Repo Match Data in Candidate UI

**Date:** 2026-05-01
**Status:** Plan approved, implementation not started.
**Plan file:** `/Users/hans/.kimi/plans/domino-icon-yelena-belova.md`

---

## Goal
Display enrichment data (AI-generated profile, key concepts, GitHub enrichment status) and repo match information (matched repo, triangulated score, dimension breakdowns, reasoning) in the **Candidate Profile page** and optionally in **candidate list views** (Kanban, CandidatesTab).

---

## What Was Discovered

### Backend Data Available
- **`candidate_ingestion`** table holds all enrichment + match data:
  - `status` — `pending | profile_generated | embedded | matched | failed`
  - `candidate_searchable_profile` — AI-generated narrative
  - `key_concepts_json` — extracted skills, seniority, domain, language
  - `triangulated_score` — final blended match score
  - `dimensions_json` — `{ skill_coverage, semantic_similarity, situation_fit, role_alignment }`
  - `reasoning_json` — `{ matches: string[], mismatches: string[] }`
  - `match_philosophy`, `github_url`, `last_enriched_at`, `error_text`
- **`qualified_repos`** table — matched repo name + URL via `matched_repo_id` FK.
- **`enrichment_jobs`** table — tracks async GitHub enrichment status.

### Existing API Endpoints
- `GET /api/v1/pipelines/:pipelineId/ingestion` — **already returns** all enrichment data for every candidate in a pipeline (camelCased). This is usable as-is for list views.
- `GET /api/v1/candidates/:candidateId` — **does NOT include** ingestion data. This is what the profile page uses.

### Frontend Gaps
- No frontend types for ingestion/enrichment data in `src/lib/api/types.ts`.
- `useCandidateProfile.ts` does not expose ingestion.
- `CandidateProfilePage.tsx` has no enrichment UI.
- Candidate list components (`KanbanPage`, `CandidatesTab`, `PipelineInsightsPanel`) don't show enrichment indicators.

### Profile Page Layout
- **Main area:** stage tabs + "INTELLIGENCE" tab (gated on pipeline completion).
- **Sidebar (340px):** OVERALL_SIGNAL score, BACKGROUND (role/skills/education), TIMELINE, CALL_LOG, ACTION buttons.
- Uses `LiquidMetalCard`, `SubTitle`, Space Mono labels, `--pipe-*` CSS vars throughout.

---

## Approved Plan

### 1. Backend — Extend `GET /api/v1/candidates/:candidateId`
**File:** `workers/api/src/routes/cockpit/candidates.ts`

Add a query after the phone-calls fetch (around line 505, before the final `return c.json`):

```sql
SELECT ci.status, ci.candidate_searchable_profile, ci.key_concepts_json,
       ci.triangulated_score, ci.dimensions_json, ci.reasoning_json,
       ci.match_philosophy, ci.github_url, ci.last_enriched_at, ci.error_text,
       qr.full_name AS matched_repo_name, qr.github_url AS matched_repo_url,
       ej.status AS enrichment_job_status
FROM candidate_ingestion ci
LEFT JOIN qualified_repos qr ON qr.id = ci.matched_repo_id
LEFT JOIN enrichment_jobs ej ON ej.candidate_id = ci.candidate_id
WHERE ci.candidate_id = ?
ORDER BY ej.created_at DESC LIMIT 1
```

Parse JSON fields, camelCase dimensions (`skill_coverage` → `skillCoverage`, etc.), and add to the response as `ingestion: CandidateEnrichmentRecord | null`.

### 2. Frontend Types
**File:** `src/lib/api/types.ts`

Add:
- `CandidateMatchDimensions` — 4 numeric fields
- `CandidateMatchReasoning` — `matches: string[]`, `mismatches: string[]`
- `CandidateEnrichmentRecord` — all ingestion fields
- Extend `CandidateProfileResponse` with `ingestion: CandidateEnrichmentRecord | null`

### 3. Frontend Hook
**File:** `src/hooks/useCandidateProfile.ts`

Expose `ingestion: CandidateEnrichmentRecord | null` in `UseCandidateProfileResult`.

### 4. New Component — `CandidateEnrichmentTab`
**File:** `src/components/Candidate/CandidateEnrichmentTab.tsx` (new)

Render three sections:
- **AI Profile** — searchable profile narrative + key concepts as tag pills
- **Enrichment Status** — status badge, GitHub URL, last enriched, error text
- **Repo Match** — matched repo link, triangulated score (large + colored), 4-bar dimension breakdown, matches/mismatches tag lists

Style with existing patterns (`LiquidMetalCard`, `SubTitle`, Space Mono, `--pipe-*` vars).

### 5. Profile Page Integration
**File:** `src/pages/CandidateProfilePage.tsx`

- Add "ENRICHMENT" tab button next to "INTELLIGENCE" (unlocked when `ingestion` exists).
- Render `<CandidateEnrichmentTab ingestion={ingestion} />` when active.
- Add compact **MATCH** section in sidebar (between BACKGROUND and TIMELINE):
  - Matched repo name (truncated, linked)
  - Triangulated score (small number + mini progress bar)
  - Click selects the ENRICHMENT tab

### 6. Candidate List Indicators (optional)
**New file:** `src/hooks/usePipelineIngestion.ts`
- Calls existing `GET /api/v1/pipelines/:id/ingestion`.

**Files:** `src/pages/KanbanPage.tsx`, `src/pages/stage-tabs/CandidatesTab.tsx`
- Merge ingestion data by `candidateId`.
- Show small dot + score:
  - Gray dot = pending/enriching
  - Green dot + score = matched
  - Red dot = failed
  - No dot = no ingestion data

---

## Files to Touch
| File | Action |
|---|---|
| `workers/api/src/routes/cockpit/candidates.ts` | Add ingestion query to GET /:candidateId |
| `src/lib/api/types.ts` | Add ingestion types, extend `CandidateProfileResponse` |
| `src/hooks/useCandidateProfile.ts` | Expose `ingestion` field |
| `src/components/Candidate/CandidateEnrichmentTab.tsx` | **Create** — full enrichment display |
| `src/pages/CandidateProfilePage.tsx` | Add ENRICHMENT tab + sidebar MATCH section |
| `src/hooks/usePipelineIngestion.ts` | **Create** — pipeline-level ingestion hook |
| `src/pages/KanbanPage.tsx` | Show enrichment dots in kanban cards |
| `src/pages/stage-tabs/CandidatesTab.tsx` | Show enrichment dots in candidate rows |

---

## Key Decisions
- **Extend existing profile endpoint** rather than add a new one — avoids extra round-trip, data is intrinsically part of the profile.
- **Reuse existing `/ingestion` endpoint** for list views — avoids bloating `/overview`, client-side merge is trivial.
- **No new npm packages** — everything uses existing UI patterns.

---

## Next Steps for Pickup
1. Implement the backend query in `candidates.ts`.
2. Add frontend types in `types.ts`.
3. Update `useCandidateProfile.ts`.
4. Build `CandidateEnrichmentTab.tsx`.
5. Wire it into `CandidateProfilePage.tsx` (tab + sidebar).
6. Build `usePipelineIngestion.ts` and add dots to list views.
7. Run `npm run build` (or equivalent) to verify TypeScript compiles cleanly.
