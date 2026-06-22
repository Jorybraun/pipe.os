# GDPR Article 22 — Candidate-Facing "Human Makes Final Decision" UI

**Source:** knowledge/plan/archive/superseded-strategy-v2-2026-06-19/pipe-strategy-v2-part6-market-research.md (line 281)
**Phase:** 4
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> GDPR Article 22 compliance surface — the right not to be subject to solely automated decisions. Pipe's HITL gates are the correct architectural response, but the candidate-facing explanation of "a human makes the final decision" needs product UI.

## Why
GDPR Article 22 grants a right not to be subject to a solely automated decision producing legal or similarly significant effects. Pipe's HITL approve/reject gates make Pipe compliant *architecturally*, but Article 22(3) also requires the candidate be informed of this fact and given a route to (a) obtain human intervention, (b) express their point of view, and (c) contest the decision. Today nothing in the candidate UX surfaces that the recruiter is the decision-maker — that's the compliance gap.

## Subtasks (delegable)

### Subtask 1 — Methodology disclosure component
**Files:**
- `app/src/components/candidate/AutomatedDecisionDisclosure.tsx`

**Spec:**
Reusable disclosure block. Renders a fixed-position info banner on candidate-facing screens (intake, screener, post-interview status). Copy: "AI assists in evaluating your application. A human recruiter makes every final hiring decision and reviews any AI-flagged concerns. [Learn more]". Link opens a modal with: methodology summary (4–6 sentences), list of dimensions evaluated, retention period, link to data export request, link to contest-decision form. Uses `LiquidMetalCard` + Space Mono per design system.

**Status:** ⏳ PENDING

---

### Subtask 2 — Contest-decision endpoint + queue
**Files:**
- `workers/api/migrations/0051_decision_contests.sql`
- `workers/api/src/routes/candidate/contestDecision.ts`

**Spec:**
Migration: `decision_contests (id TEXT PK, candidate_id TEXT, application_id TEXT, contest_text TEXT, submitted_at INTEGER, status TEXT, recruiter_response TEXT, responded_at INTEGER)`. Status one of `OPEN | UNDER_REVIEW | RESOLVED`. Endpoint `POST /rpc/candidate/contest-decision` validates candidate session, accepts `{ applicationId: string, contestText: string }`, inserts OPEN row, emits Resend email to recruiter for the role with contest text + link to recruiter-side review. SLA target 5 business days surfaced in confirmation copy.

**Status:** ⏳ PENDING

---

### Subtask 3 — Recruiter contest-review surface
**Files:**
- `app/src/pages/cockpit/ContestsInboxPage.tsx`
- `workers/api/src/routes/cockpit/contests.ts`

**Spec:**
Cockpit page at `/cockpit/contests`. Lists OPEN/UNDER_REVIEW contests for roles owned by the recruiter. Each row: candidate name, role, contest text, original decision, decision reasoning. Recruiter can mark UNDER_REVIEW, write a response, then RESOLVED. Resolution writes back to `decision_contests.recruiter_response` and emails the candidate. Worker route uses Clerk JWT auth.

**Status:** ⏳ PENDING

---

### Subtask 4 — Wire disclosure component on candidate flows
**Files:**
- `app/src/pages/candidate/CandidateIntakePage.tsx` (edit)
- `app/src/pages/candidate/ScreenerPage.tsx` (edit)
- `app/src/pages/candidate/CandidateStatusPage.tsx` (edit)

**Spec:**
Add `<AutomatedDecisionDisclosure />` to the top of each candidate-facing route. Acceptance is BDD: candidate sees disclosure on first intake page, can open the modal, can navigate to the contest form, and the contest endpoint receives the submission.

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `gdpr-deletion-ux.md` (related compliance surface — same /candidate/privacy hub)
- Blocks: nothing structural; this is a compliance gating item before EU launch

## Acceptance criteria
- [ ] `AutomatedDecisionDisclosure` component renders on three candidate routes
- [ ] Modal exposes methodology summary, retention period, and contest link
- [ ] `POST /rpc/candidate/contest-decision` writes a row and dispatches recruiter email
- [ ] Recruiter can resolve a contest from `/cockpit/contests` and the candidate receives a response email
- [ ] Playwright BDD: candidate submits contest, recruiter resolves, candidate sees response status
- [ ] `npx tsc --noEmit` clean
