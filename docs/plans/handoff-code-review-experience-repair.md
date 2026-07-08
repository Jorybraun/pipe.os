# Cloud Handoff — CODE_REVIEW Experience Repair (G3.1 + B3/B4)

Owner: Fusion (cloud session)
Dispatched: 2026-07-07 by local Fable session (see `docs/plans/agent-coordination-log.md`)
Binding brief: `docs/plans/brief-code-review-experience-repair.md` (in this branch; hard rules there win on any conflict)
Tracking: mvp-master-plan tasks G3.1 (recruiter report), B3/B4 (candidate comprehension)
Policy: BDD-first, merge-fast, 48-hour merge-or-kill. No scope creep.

## Mission

Fix the **experience and comprehension** of the CODE_REVIEW assessment, from
invite → task → review → submit → recruiter report. Backend matching, scoring,
security, and E2E infrastructure stay with Hans.

Acceptance:
- A first-time candidate knows exactly what to do in under 30 seconds.
- A recruiter knows whether to advance the candidate in under 60 seconds.

## Hard rules (verbatim from the binding brief — non-negotiable)

1. Internal labels (`MATCH_REASON`, `ASSESSMENT_FIT`, `WAITING_FOR_MATCH`, ...)
   are never **displayed**; state codes stay in code — do not rename API values.
2. No internal IDs, no hidden solution PR data, no source ref IDs, no rubric
   internals shown to candidates. All candidate-facing packet data flows
   through `workers/api/src/lib/assessmentCandidateSafety.ts`.
3. Evidence/audit detail is expandable, never the first thing shown.
4. Never rename a `data-testid` or asserted copy string without updating the
   spec in the same change. Affected: `e2e/code-review-golden-path.spec.ts`,
   `e2e/code-review-assess-smoke.unauth.spec.ts`,
   `e2e/standalone-code-review-mvp.spec.ts`,
   `e2e/code-review-recruiter-detail-smoke.spec.ts`,
   `scripts/smoke-code-review-assess-dev.mjs`.
5. Backend carve-out: copy-only edits to candidate-safe display strings in
   `rpc.ts` projections are allowed. No logic, matching, gate, or security changes.
6. BDD-first: failing Playwright assertion before each UX change; specs updated
   in lockstep. `npx tsc --noEmit` (bare, never piped) must pass; `CHANGELOG.md`
   updated in every commit that touches source files.

Out of scope: packet supply, matching thresholds, deployment, scoring models,
dev-container assessment surfaces, billing.

## State at handoff

- Branch `fable/code-review-experience-repair` (from `origin/main`) carries:
  - This handoff, the binding brief, and a **drafted, unwired** report component:
    `src/components/Assessment/CodeReviewAssessmentReport.tsx` (612 lines, compiles standalone).
  - Nothing else. No spec changes, no page wiring, no candidate-surface changes yet.
- Do NOT touch these files (separate in-flight backend WIP, owned by Hans):
  `workers/api/src/lib/repoTaskAssessmentEvaluator.ts`,
  `workers/api/src/lib/__tests__/repoTaskAssessmentEvaluator.integration.test.ts`,
  `workers/api/src/routes/cockpit/scheduling.ts`,
  `workers/api/src/routes/cockpit/__tests__/scheduling.rest.test.ts`.
- If you cannot see the branch, rebuild the component from the contract in
  Pass 1 below; the design is fully specified here.

## Verified data map (explored and code-verified this session)

Recruiter detail page: `src/pages/InterviewDetailPage.tsx` (~8,330 lines, FROZEN
for inline feature work — new UI goes in components).

| Thing | Where |
|---|---|
| Page data fetch | `GET /api/v1/scheduling/interviews/:id` → `ScheduledInterviewDetail` (`src/lib/scheduling/types.ts`) |
| `AssessmentProgressSnapshot` (evaluation, claims, diagnostics, humanDecision, sourceRefCounts, commit) | `src/lib/scheduling/types.ts` lines ~270–398 |
| Decision projection assembly (`selectedCodeReviewDecision`) | `InterviewDetailPage.tsx` ~4903–4939 (recommendation, uncertainty, missingContext, nextAction, scoreLabel, challengeLabel/Url, proofItems, basisItems) |
| `assessmentEvaluationRecommendationLabel` (strong_evidence_to_advance → "Strong evidence to advance", etc.) | `InterviewDetailPage.tsx` ~347–361 |
| Derived readouts: `codeReviewNextStep`, `codeReviewDecisionRisk`, `codeReviewAssessmentValidity`, `codeReviewSignalBasis`, `codeReviewOutcome`, `codeReviewScoreValue/Detail` | `InterviewDetailPage.tsx` ~4764–4880 |
| AI-use readout logic (source-ref counts `ai_user_prompt`, `ai_user_prompt_blocked`, `ai_agent_response`, `agent_response`, `ai_agent_diagnostic`, `agent_diagnostic`, `agent_status`; framing "treat AI use as unobserved, not absent") | `InterviewDetailPage.tsx` ~1640–1770 (`workspaceAssessmentWorkPacket`) |
| Human decision form (select advance/hold/reject/needs_more_evidence, summary input, notes textarea, `RECORD HUMAN DECISION` button; testid `interview-human-decision-form`; shown when `evaluation.status === 'EVALUATED' && !humanDecision`) | `InterviewDetailPage.tsx` ~5798–5868; POST `/api/v1/scheduling/interviews/:id/assessment/human-decision` |
| Defense threads (`CodeReviewDefenseThread`: commentId, file, line, severity, comment, exchanges[actor, round, move, content]) | `InterviewDetailPage.tsx` ~163–185, rendered ~7065–7105 |
| Decision summary section (`interview-code-review-decision-summary`) render condition `isCodeReviewInterview && (codeReviewMatch \|\| codeReviewSubmission)` | `InterviewDetailPage.tsx` ~6067 |
| Grid/order: sections live in `<main style={EVIDENCE_GRID}>`; decision section has `order: -40, gridColumn: '1 / -1'` | `InterviewDetailPage.tsx` ~7425–7455 |
| Shared recruiter styles | `src/styles/recruiterSurface.ts` |

## Pass 1 — Recruiter report (the product's "aha")

### Component contract (already drafted on the branch)

`src/components/Assessment/CodeReviewAssessmentReport.tsx`, named export
`CodeReviewAssessmentReport`. Root testid `interview-code-review-assessment-report`,
a full-width section styled to sit FIRST in the evidence grid
(`order: -50, gridColumn: '1 / -1'`). Section order and testids:

1. `assessment-report-recommendation` — "Recommendation" first, always.
   Value = `assessmentEvaluationRecommendationLabel(evaluation.recommendation)`
   when an evaluation exists, else `decision.recommendation` (= nextStep value).
   Detail = evaluation summary or `decision.recommendationDetail`. Chips:
   `Review outcome: {outcome}`, `Score: {scoreLabel}` (when scored),
   `Score validity: {assessmentValidity}`.
2. `assessment-report-evidence` — "Evidence summary": evaluation claims with
   `sourceRefCount > 0` (max 5; polarity label Strength/Risk/Diagnostic,
   sentence-cased dimension, confidence %, narrative) + "Proof checklist" from
   `basisItems` (✓/· + label — value). Empty state: "No evidence-backed claims
   yet. The evaluator report appears after the candidate submits their review."
3. `assessment-report-risks` — "Risks & uncertainty": `uncertainty` value/detail,
   "Missing context" bullets, "Evaluator cautions" from `evaluation.diagnostics`
   (max 3, severity + message).
4. `assessment-report-ai-use` — "AI use": recompute from
   `progress.sourceRefCounts` exactly like the page (values: "AI use observed" /
   "AI bridge observed" / "No AI evidence captured"); MUST preserve the framing
   sentence "No candidate AI-assistance evidence is attached; treat AI use as
   unobserved, not absent." when unobserved.
5. `assessment-report-next-action` — "Next action": nextAction value/detail,
   recorded human decision line when present, plus `decisionFormSlot` ReactNode.
6. `assessment-report-audit-trail` — `<details>` COLLAPSED by default, summary
   "Audit trail": assignment label/link, `proofItems` rows, defense threads
   (candidate comment + implementation-author exchanges). No internal IDs.

Props (structural; page objects satisfy them without casts):
`decision` (subset of the page's `selectedCodeReviewDecision` projection),
`outcome: string`, `nextStepTone`, `validityTone`
(`'positive' | 'watch' | 'blocked' | 'neutral'`),
`progress: AssessmentProgressSnapshot | null`,
`defenseThreads`, `decisionFormSlot?: ReactNode`.

### BDD first — failing assertions

Add to `e2e/code-review-recruiter-detail-smoke.spec.ts` a helper and call it in
the matched path (after the `Recruiter decision` visibility assertion, ~line 591)
and in the blocked-with-decision path (~line 627 block):

```ts
async function expectCodeReviewAssessmentReport(page: Page): Promise<void> {
  const report = page.getByTestId('interview-code-review-assessment-report');
  await expect(report).toBeVisible();
  await expect(report).toContainText('Assessment report');
  const firstSection = report.locator('[data-testid^="assessment-report-"]').first();
  await expect(firstSection).toHaveAttribute('data-testid', 'assessment-report-recommendation');
  await expect(report.getByTestId('assessment-report-evidence')).toContainText('Evidence summary');
  await expect(report.getByTestId('assessment-report-risks')).toContainText('Risks & uncertainty');
  await expect(report.getByTestId('assessment-report-ai-use')).toContainText('AI use');
  await expect(report.getByTestId('assessment-report-next-action')).toContainText('Next action');
  await expectDetailsClosed(report.getByTestId('assessment-report-audit-trail'));
  await expect(report).not.toContainText(HIRING_READOUT_INTERNAL_ID_PATTERN);
}
```

Run the smoke, watch it fail on the missing report, then wire the page.

### Page wiring (minimal edits to the frozen page)

1. Import `CodeReviewAssessmentReport` in `InterviewDetailPage.tsx`.
2. Extract the existing human-decision `<form>` JSX (~5798–5868) into a
   `const humanDecisionFormNode: ReactNode = canRecordHumanAssessmentDecision ? (<form ...same JSX...>) : null;`
   defined before the page `return`. Do not change the form internals, testid,
   placeholders, or button text — the smoke records decisions through them.
3. In the assessment-progress section, render `{!selectedCodeReviewDecision && humanDecisionFormNode}`
   (keeps the form in place for workspace/open-source assessments).
4. Inside `<main style={EVIDENCE_GRID}>`, immediately before the
   "Recruiter decision" section (~line 6067), render:

```tsx
{selectedCodeReviewDecision && (
  <CodeReviewAssessmentReport
    decision={selectedCodeReviewDecision}
    outcome={codeReviewOutcome}
    nextStepTone={codeReviewNextStep.tone}
    validityTone={codeReviewAssessmentValidity.tone}
    progress={assessmentProgress}
    defenseThreads={codeReviewSubmission?.defenseThreads ?? []}
    decisionFormSlot={humanDecisionFormNode}
  />
)}
```

All existing sections stay untouched — the report is additive; the only moved
element is the human-decision form (for code-review interviews only).

### Known collision traps (verified)

- Do NOT use the visible strings "Source proof", "Review assignment",
  "Match decision" in the report — `InterviewDetailPage.test.tsx` uses
  `getByText` on them (throws on duplicates).
- The report's visible layer must not match
  `/match-run|challenge_packet|assessment_session|review-session|candidate-atom|repo-demand|source-span|sourceRefId|sourceSpanId|source_ref|source-ref|packet-[a-z0-9-]{4,}/i`
  (spec `HIRING_READOUT_INTERNAL_ID_PATTERN`). Collapsed `<details>` content is
  excluded from `innerText`, so the audit trail may carry provenance labels.
- `interview-human-decision-form` must remain unique on the page.

### Pass 1 verification

- `npx tsc --noEmit` (bare)
- `npx vitest run src/pages/InterviewDetailPage.test.tsx`
- Recruiter smoke lane (see runbook below); blocked lane
  (`smoke:code-review-assess-dev:blocked`) if the blocked path assertions were added.
- Commit with CHANGELOG entry.

## Pass 2 — Candidate comprehension

Surfaces (all verified): `src/components/Assessment/WelcomeScreen.tsx`,
`src/components/Assessment/CodeReviewChallenge.tsx`,
`src/pages/ReviewSessionPage.tsx`,
`src/components/Panels/ProblemPanel.tsx` (contains `MatchProofPanel`, shared by
both review flows — fix once),
`src/components/Assessment/WaitingForMatch.tsx`,
`src/pages/CandidateAssessmentPage.tsx`. Candidate route: `/assess/:token`
(`src/App.tsx` ~550).

### 2a. STALE_INVITE_TOKEN handling (verified trace)

- Backend emits it in `workers/api/src/routes/rpc.ts`
  (`claimCandidateInviteTokenForAssessmentStart`, ~2803–2810): HTTP 409, body
  `{ error: { code: 'STALE_INVITE_TOKEN', message: 'This invite link is no longer current.' } }`.
- Frontend gap: `src/hooks/useAssessment.ts` (~393–399) folds every 409 into
  `TOKEN_ALREADY_CLAIMED`; `STALE_INVITE_TOKEN` falls through to the generic
  "Connection Error" in `CandidateAssessmentPage.tsx` (~321–376).
- Fix: detect the `STALE_INVITE_TOKEN` code before the generic 409 branch in
  the hook; add a terminal error card in `CandidateAssessmentPage.tsx` with
  plain-language title ("This link has been replaced"), explanation, next
  action, and owner ("Ask your recruiter for the latest invite link — a newer
  link for this assessment was issued after this one.").
- BDD: extend `e2e/code-review-assess-smoke.unauth.spec.ts` (or a focused new
  unauth spec) to resend/rotate the invite and assert the stale-link copy.

### 2b. De-jargonize the waiting screen

`WaitingForMatch.tsx` currently shows raw diagnostics: `PHASE` / `STATUS` /
`STEP` / `EVIDENCE ("N MATCHABLE / N RAW")` / node counts. Candidates must never
see these (hard rule 1 adjacent; recruiter-facing diagnostics are fine, but this
is a candidate surface):
- Replace the diagnostic grid with plain-language progress ("Analyzing your
  background" → "Finding a real project that fits" → "Preparing your review"),
  driven by the existing `diagnostics.pipeline[].label/status` fields.
- Keep the existing candidate-safe blocked copy and refresh button behavior
  (`CHECK STATUS NOW`, failure message) — asserted in smokes.
- `estimatedCompletionAt` and `staleAfterSeconds` exist in
  `useAssessment.ts` diagnostics and are unused — optional ETA/"taking longer
  than expected" copy.
- MUST NOT introduce candidate-visible `WAITING_FOR_MATCH`, "MATCHING IN
  PROGRESS", "Building your personalized challenge", "Repo matching",
  "Challenge needs attention", "Upload Your CV", "Profile & Resume" — negative
  assertions in `code-review-assess-smoke.unauth.spec.ts` line ~66 and the
  recruiter smoke enforce this. Note `standaloneWaitingChallenge()` in `rpc.ts`
  (~519–545) supplies title/instructions "Building your personalized challenge" /
  "Challenge needs attention" — replacing those display strings is allowed
  under the copy-only carve-out (rule 5), but update every asserting spec in
  the same commit.

### 2c. Fix jargon leaks in candidate panels

`ProblemPanel.tsx` / `MatchProofPanel` (candidate-facing, verbatim today):
`MATCH_PROOF`, `WHY_THIS_PR`, `MATCH_REASON`, `ASSESSMENT_FOCUS`,
`SOURCE_TOPICS`, `ASSESSMENT_QUALITY`, `VALIDATOR_AGENT`, `EVIDENCE_HYPEREDGES`,
`PERSON_ROLE_REPO` / `CANDIDATE_REPO` badges, Score/Person/Repo/Role count
grid. Rewrite headings to plain language ("Why you got this pull request",
"What this review focuses on", "How this assignment was checked"), keep the
readable match reason (`buildReadableMatchReason` output is already good), hide
graph-internal counts and mode badges from candidates.

`CodeReviewChallenge.tsx`: `TASK_PACKET` / `PACKET_INCOMPLETE` /
`SUCCESS_CRITERIA` / `EXPECTED_EVIDENCE` / `MISSING_FIELDS` /
`PULL_REQUEST_NOT_YET_ASSIGNED` / `DIFF_UNAVAILABLE` → human labels
("Your task", "What a strong review covers", "What to include",
"Your pull request is still being prepared", "Diff unavailable — contact your
recruiter"). Keep testids `code-review-challenge`, `code-review-repo-link`,
`code-review-pr-link`, `code-review-challenge-packet`,
`code-review-review-profile` intact.

### 2d. Close the comprehension gaps (data already exists)

- Expected time/difficulty: `reviewProfile.expectedTimeMinutes` +
  `difficultyBand` exist (`ReviewProfileCard`) but time is not labeled — show
  "Expected time: ~N minutes" on the challenge and welcome surfaces.
- What counts as a good review: add a short checklist near the verdict/summary
  controls (correctness, risk-based severity, actionable comments, clear
  verdict rationale) — copy only, no new data.
- How AI use is handled: candidates currently get nothing. One sentence on the
  challenge surface: transparent capture, unobserved-not-absent framing. Do
  not promise or threaten detection.
- What happens after submission: extend `ReviewSessionPage` completion and
  `assessment-submitted` copy with the actual pipeline (review is scored from
  evidence; the team reviews the report; you'll hear back through the
  recruiter). Preserve asserted strings "Profile received." and "email you
  when a source-backed code review is ready" (or update spec + copy in
  lockstep).

### Pass 2 verification

- `npx tsc --noEmit`; targeted vitest suites for touched components.
- `npm run smoke:code-review-assess-dev` (ready lane) and
  `npm run smoke:code-review-assess-dev:blocked` (handoff lane) — both green.
- Every changed testid/copy string updated in the specs listed in hard rule 4
  within the same commit.

## Environment runbook (all three pitfalls hit and fixed this session)

App-dev (default for the smokes; recommended for cloud):
`npm run smoke:code-review-assess-dev` with repo-standard app-dev env
(`PIPE_APP_DEV_BASIC_AUTH_*`, Clerk e2e creds in `.env.local`) — packets and
auth already exist there.

Local (if running the full loop on a workstation):
1. Start servers: `(cd workers/api && npx wrangler dev --port 8787 --enable-containers=false)`
   and `npm run dev -- --port 5173` (Playwright also auto-starts them plus the
   video room on 5175).
2. Apply local D1 migrations or interview creation 500s with
   "no column named title": `(cd workers/api && npx wrangler d1 migrations apply pipe-db --local)`.
3. Seed repos: `(cd workers/api && bash scripts/sync-repos-local.sh)`.
4. Build the source-backed packet or the manual lane falls back to
   "Profile received":
   `(cd workers/api && npx tsx scripts/backfillReviewChallengePackets.ts --local --repo mui/base-ui --pr 973)`
   (verified: persists `production_ready=1`, quality 0.9).
5. Clerk auth state must match the target host. A stale
   `playwright/.auth/user.json` from app-dev silently leaves the recruiter spec
   on the sign-in gate. Regenerate by running WITHOUT
   `PLAYWRIGHT_SKIP_CLERK_GLOBAL_SETUP=1`; only set that flag to reuse a
   known-good state for the same host.
6. Full loop:
   `APP_BASE=http://localhost:5173 API_BASE=http://localhost:8787 VIDEO_ROOM_BASE=http://localhost:5175 npm run smoke:code-review-assess-dev`.
   The script seeds the interview, runs the candidate unauth spec, then the
   recruiter detail spec with `CODE_REVIEW_RECRUITER_INTERVIEW_ID` injected.
   Iterate the recruiter spec directly by exporting
   `ASSESSMENT_RECRUITER_INTERVIEW_ID=<id from smoke output>` and running
   `npx playwright test e2e/code-review-recruiter-detail-smoke.spec.ts --project=authenticated`.

## Definition of done

1. Pass 1 merged: report renders first on code-review interview detail,
   recruiter smoke (ready + blocked lanes) green with the new report
   assertions, page unit tests green, tsc clean.
2. Pass 2 merged: candidate surfaces de-jargonized, STALE_INVITE_TOKEN has a
   plain-language terminal state, waiting screen shows no raw diagnostics,
   comprehension gaps closed; candidate smokes green with lockstep spec updates.
3. CHANGELOG updated per commit; every commit message notes which spec proves it.
4. 48 hours after dispatch: merged or killed — no zombie branches.
