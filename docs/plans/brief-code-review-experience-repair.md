# Task Brief — CODE_REVIEW Experience Repair (G3.1 + B3/B4)

Owner: Fable (local session)
Tracking: `docs/plans/mvp-master-plan.md` tasks G3.1, B3, B4
Mission: fix the **experience and comprehension** of the CODE_REVIEW assessment,
from invite → task → review → submit → recruiter report. Backend matching,
scoring, security, and E2E proof stay with Hans.

## Acceptance

- A first-time candidate knows exactly what to do in under 30 seconds.
- A recruiter knows whether to advance the candidate in under 60 seconds.

## Delivery order

**Pass 1 — Recruiter report (the product's "aha"):**

Build a new `CodeReviewAssessmentReport` component in `src/components/` and
render it from `InterviewDetailPage.tsx`. Do NOT assemble it inline in that
file (~7k lines, frozen for inline feature work).

The report is a **projection of the living context graph**. Build on existing
backends — do not invent data:

| Report section | Existing data source |
|----------------|---------------------|
| Recommendation | `CodeReviewDecisionProjection.recommendation` / `recommendationDetail`; labels like `strong_evidence_to_advance` (see `assessmentEvaluationRecommendationLabel`) |
| Evidence summary | evaluation claims (`interview-assessment-evaluation-claims`) + proof checklist |
| Risks / uncertainty | `uncertainty`, `missingContext`, evaluator diagnostics, `detectEvidenceConflicts` output |
| AI use | `ai_user_prompt` / `ai_user_prompt_blocked` source refs; keep the existing framing "treat AI use as unobserved, not absent" |
| Next action | `nextAction` / `nextActionDetail` + human decision form (Advance / Hold / Reject / Needs more evidence) |
| Audit trail | provenance chain + AI developer defense threads — **collapsed by default** |

Where richer data is needed, prefer `generateUnifiedMatchReport` /
`loadMatchProvenanceChain` / `computeEvidenceReadiness` from
`workers/api/src/lib/livingContext/index.ts` — read-only consumption.

**Pass 2 — Candidate comprehension:**

Surfaces: `WelcomeScreen.tsx`, `CodeReviewChallenge.tsx`, `ReviewSessionPage.tsx`,
`MatchProofPanel` (inside `ProblemPanel.tsx` — shared by both review flows, fix once),
`WaitingForMatch.tsx`, `CandidateAssessmentPage.tsx`.

Candidate must understand: what repo/PR they are reviewing; what to look for;
expected time/difficulty (review profile exists); what counts as a good review;
how AI use is handled; how to submit; what happens after submission.

Blocked/loading/error states: plain-language title + explanation + next action
+ owner for every state. Add frontend handling for `STALE_INVITE_TOKEN`
(backend emits it; frontend currently shows a generic error). De-jargonize the
waiting screen (no raw phase/step/node-count diagnostics for candidates).

## Hard rules

1. Internal labels (`MATCH_REASON`, `ASSESSMENT_FIT`, `WAITING_FOR_MATCH`, ...)
   are never **displayed**; state codes stay in code — do not rename API values.
2. No internal IDs, no hidden solution PR data, no source ref IDs, no rubric
   internals shown to candidates. All candidate-facing packet data flows
   through `assessmentCandidateSafety.ts`.
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
   in lockstep. `npx tsc --noEmit` (bare) must pass; CHANGELOG updated per commit.

## Out of scope

Packet supply, matching thresholds, deployment, scoring models, dev-container
assessment surfaces, billing.
