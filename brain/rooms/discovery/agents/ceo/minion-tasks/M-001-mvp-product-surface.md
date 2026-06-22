# M-001: MVP Product Surface

**Status:** In progress
**Primary ADR:** ADR-053
**Supporting ADRs:** ADR-051, ADR-052, ADR-054

## Objective

Make the first-run PIPE product simple and demoable:

- Home is Interviews.
- Primary navigation is Interviews, Roles, People, Settings.
- Roles use Role/Round language.
- People unifies contacts, clients, candidates, applicants, and guests.
- Roleless interviews can be created without fabricating a role or round.

## Ownership

Frontend:

- `src/App.tsx`
- `src/components/SidebarNav.tsx`
- `src/components/Scheduling/*`
- `src/pages/ContactsPage.tsx`
- `src/pages/ListingPage.tsx`
- `src/pages/PipelineNewRoutePage.tsx`
- `src/pages/PipelineShellPage.tsx`
- `src/pages/PipelineInsightsPanel.tsx`
- `src/pages/StagePanel.tsx`

API:

- `workers/api/src/routes/cockpit/scheduling.ts`
- `workers/api/src/routes/cockpit/candidates.ts`

## Non-Goals

- Do not delete legacy pipeline/stage/candidate internals.
- Do not touch semantic graph, repo ingestion, or matcher logic.
- Do not create fake roles, rounds, seniority, or applications for roleless
  interviews.

## Acceptance Checks

- `/interviews` loads.
- `/interviews?new=1` opens the new interview modal.
- `/schedule` redirects to `/interviews`.
- `/roles` loads.
- `/roles/new` uses role/round/person language.
- `/people` loads and does not split clients into a separate primary app.
- API supports creating roleless interviews with nullable `pipelineId` and
  `stageId`.
- Frontend type check passes.
- Worker scheduling route tests pass.

## Output Required

- Changed paths.
- Browser smoke evidence.
- Type/test evidence.
- Any remaining visible compatibility terms and why they remain.
