# Screener — Recruiter UI for "Invite to Screening" Action

**Source:** knowledge/plan/pipe-strategy-v2-part4-candidate-ingestion.md (lines 191, 351–353)
**Phase:** 3
**Status:** PENDING
**Estimate:** 1 week

## Source quote
> Add the mode-2 entry point to the recruiter UI — "invite candidate to screening" as an action separate from "invite candidate to assessment." The existing invite token and candidate JWT infrastructure works for this.
>
> Recruiter UI for "invite candidate to screening" as distinct from "invite candidate to assessment."

## Why
Without a distinct recruiter UI action, Mode 1 screening has no trigger. Recruiters currently invite candidates to assessments (role-specific). The screening invite is a new action in the candidate management flow that happens earlier in the funnel — after ingestion, before assessment invitation.

## Subtasks (delegable)

### Subtask 1 — Screening invitation API endpoint
**Files:**
- `workers/api/src/routes/cockpit/candidateActions.ts`

**Spec:**
`POST /api/v1/candidates/:candidateId/invite-screening` — Clerk-authed, recruiter role. Body: `{ mode: 'profile_builder' | 'role_fit', roleContextId?: string }`. For `profile_builder`: creates a new `culture_interview_sessions` row (or a new `screening_sessions` table if session schema differences require it — validate before implementing) with `screener_mode='profile_builder'`. Generates a candidate invite token via existing token infrastructure. Sends invite email via Resend with subject "Complete your profile" (not "Interview invitation" — Mode 1 framing). Returns `{ token, expiresAt }`. Guards: candidate must have a `candidate_profile_state` row (i.e. be ingested). Cannot invite to screening if already has an active Mode-1 session.

**Status:** ⏳ PENDING

---

### Subtask 2 — "Invite to screening" button in candidate card
**Files:**
- `src/components/CandidateCard.tsx` (or closest equivalent — verify path)

**Spec:**
Add "Invite to screening" button to the candidate card actions. Visible when: candidate has no active or completed Mode-1 screening session. Hidden/disabled when: Mode-1 session exists (show status instead: "Screening in progress" or "Screening complete"). Button calls `POST /api/v1/candidates/:id/invite-screening` with `mode='profile_builder'`. Show confirmation toast on success. Show error toast on failure. Do not modify the existing "Invite to assessment" button — these are two distinct actions that can coexist.

**Status:** ⏳ PENDING

---

### Subtask 3 — Screening status display in candidate pipeline view
**Files:**
- `src/components/CandidatePipelineRow.tsx` (or closest equivalent — verify path)

**Spec:**
Add a "Screening" column to the candidate pipeline table (between "Ingested" and "Assessment"). Values: "—" (not invited), "Invited" (token sent, not started), "In progress" (session active), "Complete" (coverage adequate or session terminated). Status derived from `candidate_coverage` + session state. Recruiter can click "Complete" to view the candidate's graph profile (links to a read-only recruiter view of the candidate's nodes).

**Status:** ⏳ PENDING

## Dependencies
- Depends on: `screener-mode-generalization.md` (session type must exist), `candidate-profile-state-schema.md`
- Blocks: nothing (UI feature, end of screener chain)

## Acceptance criteria
- [ ] `POST /api/v1/candidates/:id/invite-screening` returns 409 if active session exists
- [ ] Mode-1 invite email subject does not say "Interview" — says "Complete your profile" or equivalent
- [ ] "Invite to screening" button absent for candidates with active sessions
- [ ] Screening status column reflects actual session state
- [ ] Existing "Invite to assessment" flow unaffected
- [ ] `npx tsc --noEmit` clean
