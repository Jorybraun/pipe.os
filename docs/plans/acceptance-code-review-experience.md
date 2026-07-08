# Acceptance Checklist — CODE_REVIEW Experience (Playwright)

Companion to `docs/plans/brief-code-review-experience-repair.md`.
Every acceptance criterion below maps to an executable Playwright assertion (or smoke lane).
Run lanes via `scripts/smoke-code-review-assess-dev.mjs` wrappers unless noted.

## Lanes

| Lane | Command |
|---|---|
| Ready (manual override) | `npm run smoke:code-review-assess-dev` |
| Ready + full submit | `CODE_REVIEW_SMOKE_FULL_SUBMIT=1 npm run smoke:code-review-assess-dev` |
| Blocked handoff | `CODE_REVIEW_SMOKE_AUTO_MATCH=1 CODE_REVIEW_EXPECT_BLOCKED_MATCH=1 npm run smoke:code-review-assess-dev` |
| Recruiter report | `e2e/code-review-recruiter-detail-smoke.spec.ts` (driven by the smoke, or `ASSESSMENT_RECRUITER_INTERVIEW_ID=<id> npx playwright test e2e/code-review-recruiter-detail-smoke.spec.ts --project=authenticated`) |
| Terminal states (mocked, no seed needed) | `PLAYWRIGHT_SKIP_CLERK_GLOBAL_SETUP=1 CODE_REVIEW_ASSESS_TOKEN=dummy npx playwright test e2e/code-review-assess-smoke.unauth.spec.ts --project=unauthenticated -g "terminal card"` |
| Golden path (local seed) | `e2e/code-review-golden-path.spec.ts` |

## 1. Candidate comprehension (< 30 seconds)

| Criterion | Proof (spec → assertion) |
|---|---|
| Welcome screen has a single obvious start action | `code-review-assess-smoke.unauth.spec.ts` — `getByRole('button', { name: 'START INTERVIEW' })`; testid `start-interview-btn` |
| Expected time is visible before starting | unauth smoke — `welcome-expected-time` / `code-review-review-profile` contains `Expected time` |
| Candidate sees which repo/PR they are reviewing, with links | unauth smoke — `code-review-repo-link` href matches `github.com/<owner>/<repo>`, `code-review-pr-link` href matches `/pull/<n>`; `standalone-code-review-mvp.spec.ts` asserts repo name, `#<pr>`, PR title on `code-review-challenge` |
| Candidate sees why they got this PR, in plain language | unauth smoke — `code-review-match-proof` contains `Why you got this pull request`; `code-review-match-why` contains `The match in plain language` |
| Candidate sees what the review focuses on | unauth smoke — `code-review-assessment-focus` contains `What this review focuses on` |
| Candidate sees difficulty/level expectations | unauth smoke — `code-review-review-profile` contains `WHAT TO EXPECT`, `Expected time`, `LEVEL` |
| Candidate sees what a strong review covers, near the verdict controls | unauth smoke — `code-review-good-review-checklist` contains `What makes a strong review` and `clear verdict rationale` |
| Candidate sees how AI use is handled (no detection threats) | unauth smoke — `code-review-ai-use-note` contains `AI tools` |
| Candidate can annotate the diff | unauth smoke — `pierre-diff-viewer` visible, commentable diff lines > 0, `annotation-editor-form` → `save-annotation-btn` → `annotation-badge-*` |
| Candidate knows how to submit | challenge right rail shows `READY TO SUBMIT — click SUBMIT below` once verdict+summary set (visual assert in golden path via `submit-verdict` flow); StageShell footer button reads `SUBMIT` (`candidate-assessment.spec.ts` `^SUBMIT$`) |
| Candidate knows what happens after submitting | `code-review-golden-path.spec.ts` — `review-session-completion` contains `hear back through your recruiter`; `assessment-submitted` shows `Submitted.` |

## 2. Recruiter decision (< 60 seconds)

All in `e2e/code-review-recruiter-detail-smoke.spec.ts` (`expectCodeReviewAssessmentReport`, both matched and blocked-with-decision paths):

- [ ] `interview-code-review-assessment-report` is visible and titled `Assessment report`
- [ ] First section is `assessment-report-recommendation` (recommendation always leads)
- [ ] `assessment-report-evidence` contains `Evidence summary`
- [ ] `assessment-report-risks` contains `Risks & uncertainty`
- [ ] `assessment-report-ai-use` contains `AI use` (framing: unobserved, not absent)
- [ ] `assessment-report-next-action` contains `Next action` (+ decision form / recorded decision)
- [ ] `assessment-report-audit-trail` is a `<details>` element, collapsed by default
- [ ] Report visible text does not match `HIRING_READOUT_INTERNAL_ID_PATTERN`
- [ ] Human decision can be recorded via `interview-human-decision-form` (unique on page)

## 3. Blocked / loading / error / submitted states

| State | Proof |
|---|---|
| Blocked (no assignment ready) → candidate-safe handoff | blocked lane — page shows `Profile received.` + `email you when a source-backed code review is ready`; stage config `candidate-intake-queued`; recruiter detail still opens |
| Stale invite link (rotated) | unauth smoke `-g "terminal card"` — `This link has been replaced` + recruiter-owner next action; NOT `Connection Error`, NOT `This one-use assessment link has already started` |
| Invalid invite link (404) | unauth smoke `-g "terminal card"` — `assessment-terminal-error` shows `Invalid Invite Link` + `contact your recruiter for a new link` |
| Already-started one-use link | `CandidateAssessmentPage.test.tsx` — heading `Assessment Already Started`, no retry button |
| Submission failure is not silent success | `candidate-assessment.spec.ts` — 500 on submit → error visible (`submission-error`), `Submitted.` NOT shown, retry affordance visible |
| Submitted confirmation | `assessment-submitted` → `Submitted.` (`standalone-code-review-mvp.spec.ts`, golden path) |

## 4. Hard-rule negative assertions (must stay green)

- [ ] Candidate pages never contain `WAITING_FOR_MATCH`, `MATCHING IN PROGRESS`, `Building your personalized challenge`, `Repo matching`, `Challenge needs attention`, `Upload Your CV`, `Profile & Resume` (unauth smoke + blocked lane + `smoke-code-review-assess-dev.mjs`)
- [ ] Candidate match proof never contains `MATCH_PROOF`, `PERSON_ROLE_REPO`, `CANDIDATE_REPO`, `EVIDENCE_HYPEREDGES`, or internal ref-table tokens (unauth smoke + standalone MVP spec)
- [ ] No video-room fallback on `/assess` (`video room|waiting room|camera|microphone` negative pattern)
- [ ] Recruiter hiring readout visible text never matches the internal-ID pattern (`code-review-recruiter-detail-smoke.spec.ts`)

## Verification log (2026-07-07, this change)

- `npx tsc --noEmit` — clean.
- Unit: `InterviewDetailPage.test.tsx` (53), `CandidateAssessmentPage.test.tsx` (8), `SubmissionPanel.test.tsx` (25), `DiffPanel.test.tsx`, `MatchProofPanel.test.tsx`, `ConversationPanel.test.tsx`, `WelcomeScreen.test.tsx` — all green (101 passed).
- Playwright (local, mocked): stale-link + invalid-link terminal cards — 2 passed.
- Ready/blocked/recruiter smoke lanes assert the renamed copy (`START INTERVIEW`, `WHAT TO EXPECT`, `PULL REQUEST`, `REVIEW CONVERSATION`) and must be run against an environment serving this build (app-dev after deploy, or the local runbook in `docs/plans/handoff-code-review-experience-repair.md`).
