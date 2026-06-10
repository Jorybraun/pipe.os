# Dogfood QA Report — Discovery Role Interview Flow

Target: http://localhost:5173/pipeline/new
Date: 2026-05-29
Scope: Authenticated discovery-domain role interview flow. Focus: question consistency, baseline-to-live-interview transition, key interactions, console/network failures, and user-facing polish.
Tester: Hermes Agent using dogfood skill and e2e credentials sourced from e2e/auth.setup.ts.

## Executive Summary

Total issues found: 2

Severity breakdown:
- Critical: 0
- High: 1
- Medium: 1
- Low: 0

Category breakdown:
- Functional / Database migration: 1
- UX / Content polish: 1

Overall assessment: partial pass. The scripted baseline question flow is coherent and mostly works, but the live interview path exposed one high-severity backend/D1 migration failure. The flow also has user-facing internal labels that should be polished before considering the discovery experience production-quality.

Logged to discovery Kanban:
/Users/hans/Code/PIPE/PIPE-OS/harness/context/discovery-team/mgmt/kanban.md

## What Was Tested

Authenticated setup:
- Credentials sourced from /Users/hans/Code/PIPE/PIPE-OS/e2e/auth.setup.ts.
- Clerk sign-in completed successfully with the documented e2e account.
- No JavaScript console errors during sign-in.

Scripted baseline flow observed:
1. What role are you hiring for?
2. What company is this for?
3. Got a company website? I'll research it before asking questions.
4. What's the comp range?
5. What technologies do they need on day one?

Baseline behavior:
- Required first question did not allow empty submission.
- SEND enabled after valid text input.
- Optional questions could be skipped and were recorded as “(skipped)”.
- Tags/technologies input worked by typing a technology and pressing Enter.
- Completion of baseline transitioned into the live Interview step.

Live interview transition observed:
- Step 1 ROLE completed.
- Step 2 INTERVIEW active.
- Step 3 REVIEW inactive.
- Progress showed 0 / 6 domains explored.
- First live question: “What’s your relationship to this role?” with options Hiring Manager, Internal Recruiter, External Recruiter, Team Member.

Question consistency assessment:
- Baseline questions are coherent and relevant.
- The first live generated role-relevant question after a successful retry was: “Tell me about a recent code review on your team that got interesting — what happened?”
- That question is appropriate for a Senior Backend Engineer flow and suggests domain-specific depth rather than generic form-style questioning.

## Issues

### Issue 1 — Live interview can fail with D1 `domain_state` schema error

Severity: High
Category: Functional / Database migration
URL: http://localhost:5173/pipeline/new

Description:
During authenticated dogfood of the discovery interview, submitting the first live interview answer caused the backend respond endpoint to return a D1 SQLite schema error:

```text
D1_ERROR: no such column: domain_state: SQLITE_ERROR
```

Observed failing request:
- POST /api/v1/role-contexts/:id/respond
- HTTP 500

Actual behavior:
- UI showed the raw D1 error.
- Interview remained stuck at 0 / 6 domains explored.
- User could not proceed in that session state.

Expected behavior:
- Submitting the first live interview answer should return 200.
- The next role-relevant interview question should appear.
- Missing/misaligned local D1 migrations should be detected before the user reaches this flow.
- If persistence fails, the UI should show a recoverable human-readable error, not raw D1 internals.

Evidence:
- Screenshot: /Users/hans/.hermes/cache/screenshots/browser_screenshot_07bcb173b5144e1499899895a7339b54.png

Likely cause:
The application code expects `role_context_participants.domain_state`. Migration `workers/api/migrations/0073_participant_domain_state.sql` exists, but at least one local D1 state database used by dev did not have the column. This points to a local dev migration/state mismatch or multiple local D1 DB locations with divergent schema.

Steps to reproduce:
1. Open http://localhost:5173/pipeline/new.
2. Sign in using e2e credentials from e2e/auth.setup.ts.
3. Complete baseline questions for a Senior Backend Engineer role.
4. Enter live interview.
5. Select Hiring Manager for “What’s your relationship to this role?”
6. Click SEND.
7. Observe `/api/v1/role-contexts/:id/respond`.

Acceptance criteria logged to Kanban:
- Fresh and resumed role-discovery sessions submit the first live interview answer without HTTP 500.
- `role_context_participants.domain_state` is present in the actual local dev D1 database used by localhost:8787.
- Local dev startup or migration docs make unapplied migration 0073 obvious.
- UI does not strand the user at 0 / 6 domains explored after backend persistence failure.
- Backend persistence failures render a recoverable human-readable error.

Chrome validation required: true

### Issue 2 — Internal/debug labels and calibration framing reduce discovery interview polish

Severity: Medium
Category: UX / Content
URL: http://localhost:5173/pipeline/new

Description:
The flow exposes internal enum-style labels and has a slightly confusing transition into live interviewing.

Observed labels/copy problems:
- BAD_ROBOT
- IMPORT_FROM_JD
- TYPE_INSTEAD
- EDIT_ANSWER
- BAR
- PROC

The relationship question appears while the UI says INTERVIEWING and 0 / 6 domains explored. It behaves like calibration/setup, not true domain exploration, so it should be visually framed that way.

Actual behavior:
- Internal labels are visible to users.
- The start of live interview can feel confusing because calibration is shown inside the domain progress state.

Expected behavior:
- All user-visible actions use human-readable labels.
- Domain abbreviations are expanded or explained via tooltip.
- Relationship/calibration question is labeled as setup/calibration if it occurs before domain progress starts.

Steps to reproduce:
1. Open http://localhost:5173/pipeline/new.
2. Sign in using e2e credentials.
3. Walk through baseline discovery questions.
4. Observe visible labels/actions across baseline and live interview transition.
5. Enter the live interview and inspect the first relationship question state.

Acceptance criteria logged to Kanban:
- BAD_ROBOT is replaced with a human-readable label such as “Report bad question”.
- IMPORT_FROM_JD, TYPE_INSTEAD, and EDIT_ANSWER render as human-friendly action labels.
- BAR and PROC have expanded labels or tooltips.
- Relationship question is visually labeled as calibration/setup if it appears before domain progress starts.
- Required/optional question behavior remains correct.

Chrome validation required: true

## Summary Table

| # | Title | Severity | Category | Status |
|---|-------|----------|----------|--------|
| 1 | Live interview can fail with D1 `domain_state` schema error | High | Functional / Database migration | Logged to discovery Kanban |
| 2 | Internal/debug labels and calibration framing reduce polish | Medium | UX / Content | Logged to discovery Kanban |

## Testing Notes

Tested:
- Clerk login using e2e credentials.
- Baseline discovery question flow.
- Required empty-submit guard.
- Optional skip behavior.
- Technology tag input.
- Baseline-to-interview transition.
- First live interview answer submission.
- Console/network behavior during the flow.

Not fully tested:
- Full 6-domain completion to REVIEW.
- BAD_ROBOT/report-feedback persistence behavior.
- Final synthesis/review output.
- Responsive/mobile layout.

Notes:
- The D1 failure was observed once, then a fresh retry after clearing/resuming state succeeded and produced the next role-relevant question. This means the happy path can work, but the migration/state mismatch is still a confirmed real failure and should be fixed defensively.
- Browser vision can be unreliable on this app’s complex visual background. Snapshot, console/network, and direct interaction evidence were treated as primary where necessary.
