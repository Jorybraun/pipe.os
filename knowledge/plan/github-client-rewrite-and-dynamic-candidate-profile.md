# GitHub Client Rewrite + Dynamic Candidate Profile

**Date:** 2026-05-01
**Status:** ✅ Complete / Correct
**Author:** Agent implementation

---

## Summary

Rewrote the GitHub enrichment client to remove deprecated code, added GraphQL contribution calendar support, and replaced the hardcoded 4-card candidate profile with a dynamic, data-driven section renderer.

---

## Part 1: GitHub Client Rewrite

### 1.1 Removed Deprecated Code
- **File:** `workers/api/src/lib/enrichment/githubClient.ts`
  - Removed `getContributedRepos()` method
  - Removed `GitHubContribution` interface
  - Removed the `@deprecated` JSDoc

- **File:** `workers/api/src/lib/enrichment/__tests__/githubClient.test.ts`
  - Removed test for `getContributedRepos`
  - Added tests for `getOwnedReposAll`, `getMergedPullRequests`, `getUserOrgs`
  - Added tests for `getContributionCalendar` and GraphQL error handling

### 1.2 Added GraphQL Contribution Calendar
- **New types:**
  - `ContributionDay { date: string; count: number }`
  - `ContributionCalendar { totalContributions: number; weeks: Array<{ contributionDays: ContributionDay[] }> }`
- **New method:** `getContributionCalendar(handle)`
  - Queries GitHub GraphQL API (`https://api.github.com/graphql`)
  - Returns 52+ weeks of daily commit counts
  - Uses same Bearer token auth as REST calls
  - Error handling: throws `GitHubRateLimitError` on 403, surface other errors as typed exceptions

### 1.3 Updated `githubEnrich.ts`
- Fetches contribution calendar after PRs/orgs (best-effort, requires token)
- Stores calendar data in `CulturalSignal.extracted_properties_json`:
  ```json
  {
    "contribution_calendar": {
      "total_contributions": 1247,
      "daily_counts": ["2025-04-01", 5, "2025-04-02", 0, ...]
    }
  }
  ```
- Persists raw calendar JSON to `candidate_ingestion.github_calendar_json`

### 1.4 Database Migrations
- **Migration 0060:** `ALTER TABLE candidate_ingestion ADD COLUMN github_calendar_json TEXT;`
- **Migration 0061:** `ALTER TABLE candidate_ingestion ADD COLUMN profile_sections_json TEXT;`
- Updated `persist.ts` `upsertPendingIngestion` to reset both new columns on re-ingestion

### 1.5 API Exposure
- `GET /api/v1/candidates/:id` now returns `ingestion.githubCalendar` in the response

### 1.6 Frontend Component
- **New:** `src/components/Candidate/ContributionCalendar.tsx`
  - Renders 52 weeks × 7 days as SVG rects
  - Color scale: 0 = transparent, 1–3 = light green, 4–6 = medium, 7–9 = bright, 10+ = intense
  - Tooltip on hover: date + count

---

## Part 2: Dynamic Candidate Profile Architecture

### 2.1 Assembler (`buildProfileSections.ts`)
- **Location:** `workers/api/src/lib/candidateDiscovery/buildProfileSections.ts`
- Deterministic rules (no LLM call):
  1. Hero (every candidate)
  2. Narrative (if searchable profile exists)
  3. GitHub Activity (if calendar has >0 contributions)
  4. Experience Timeline (if 2+ experiences)
  5. Project Showcase (if projects exist)
  6. Skill Landscape (if skills exist)
  7. Career Arc (if available)
  8. Education (if available)
  9. Situation Signature (if available)
  10. Career Context (if available)
  11. Match Score (if matched)
  12. Enrichment Status (always last)

### 2.2 Types
- **Backend:** `ProfileSection { type: string; props: Record<string, unknown> }`
- **Frontend:** Same shape mirrored in `src/lib/api/types.ts`
- `CandidateProfileResponse` now includes `profileSections: ProfileSection[]`

### 2.3 Backend Integration
- `orchestrate.ts` persists `profile_sections_json` after match completion
- `candidates.ts` returns `profileSections` — reads from DB if available, otherwise computes on-the-fly from ingestion data

### 2.4 Frontend Component Registry
- **Rewrote:** `src/components/Candidate/CandidateEnrichmentTab.tsx`
  - Replaced hardcoded 4-card layout with registry + loop
  - Registry maps `type` string → React component
  - Falls back to `console.warn` for unknown section types

### 2.5 Section Components
All located in `src/components/Candidate/profile-sections/`:

| Component | Props | Visual |
|-----------|-------|--------|
| `HeroSection` | name, seniority, primaryLanguage, yearsExperience, domain | Big name + badge row |
| `NarrativeSection` | text, keyConcepts | Prose + concept tag pills |
| `ExperienceTimelineSection` | experiences | Vertical timeline cards |
| `ProjectShowcaseSection` | projects | Cards with links + skills |
| `SkillLandscapeSection` | skills | Horizontal proficiency bars |
| `CareerArcSection` | narrative, growth_velocity, transitions | Velocity badge + transition arrows |
| `EducationSection` | education | Institution + degree cards |
| `SituationSignatureSection` | Record<string, unknown> | Tag grids per category |
| `CareerContextSection` | Record<string, unknown> | Key-value pairs + tag pills |
| `MatchScoreSection` | score, dimensions, reasoning, philosophy, repoName, repoUrl | Big score + dimension bars + match/mismatch tags |
| `EnrichmentStatusSection` | status, modelUsed, timestamps, errorText, githubUrl | Status badge + metadata rows |
| `GithubActivitySection` | calendar | Contribution grid + total count |

### 2.6 Page Wiring
- `src/pages/CandidateProfilePage.tsx` now passes `profileSections` instead of `ingestion` to `CandidateEnrichmentTab`
- `src/hooks/useCandidateProfile.ts` exposes `profileSections` from the API response

---

## Acceptance Criteria

| Criterion | Status |
|-----------|--------|
| `getContributedRepos` removed entirely | ✅ |
| `getContributionCalendar` fetches 52+ weeks of data | ✅ |
| `githubClient.test.ts` covers all active methods | ✅ |
| Contribution calendar renders as SVG grid in frontend | ✅ |
| `buildProfileSections` returns correct sections for full data | ✅ |
| `buildProfileSections` returns minimal sections for no enrichment | ✅ |
| Frontend registry renders all section types without errors | ✅ |
| Each section component has typed props | ✅ |
| Old hardcoded sections removed from `CandidateEnrichmentTab` | ✅ |
| Backend `npx tsc --noEmit` clean | ✅ |
| Frontend `npx tsc --noEmit` clean | ✅ |

---

## Tests

- `workers/api/src/lib/enrichment/__tests__/githubClient.test.ts` — 11 tests
- `workers/api/src/lib/candidateDiscovery/__tests__/buildProfileSections.test.ts` — 4 tests

---

## Migration Strategy (Zero-Downtime)

1. ✅ Phase 1: Add `profile_sections_json` column to `candidate_ingestion`
2. ✅ Phase 2: Backend `buildProfileSections()` + API response (compute on-the-fly)
3. ✅ Phase 3: Frontend section components + registry + rewrite `CandidateEnrichmentTab`
4. ⏳ Phase 4: Backend persists `profile_sections_json` during ingestion (done in `orchestrate.ts`)
5. ⏳ Phase 5: Remove old hardcoded `CandidateEnrichmentTab` code entirely (done — fully replaced)
