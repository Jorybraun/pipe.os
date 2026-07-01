# Repo Matching and CODE_REVIEW Feature Test Matrix

**Status:** active reliability and product-value checklist  
**Date:** 2026-06-29  
**Scope:** candidate decomposition, repo matching, CODE_REVIEW, open-source repo tasks, recruiter decision surfaces, person rollups

## Product Bar

PIPE is viable only when a hiring manager can trust the loop:

1. the candidate gives evidence,
2. PIPE decomposes that evidence into source-backed capability signals,
3. PIPE selects or requests a concrete repo challenge,
4. the candidate completes a real review or repo task,
5. scoring is clearly valid, partial, blocked, or unavailable,
6. the interview and person profile explain the recommendation without merging unrelated evidence.

Every feature below needs a candidate proof and a hiring-manager proof.

## Feature Inventory

| Feature | Candidate value | Hiring-manager value | Must prove |
| --- | --- | --- | --- |
| Invite/link lifecycle | Link opens without sign-in and is only claimed when assessment starts. | Recruiter knows whether a link is not sent, delivered, opened, started, claimed, stale, submitted, or needs resend. | `resolve-token` does not claim; `start-assessment` claims; stale/cross-candidate browser sessions do not leak. |
| Candidate intake and decomposition | Resume/profile input turns into useful matching context instead of a dead wait. | Manager sees what evidence was learned and what is missing before trusting a match. | Intake creates source-backed evidence; waiting state shows active step and diagnostics; no infinite spinner. |
| Repo matching | Candidate receives a challenge that fits their evidence and role context. | Manager sees why this repo/PR was selected, what alternatives were rejected, and whether confidence is high enough. | Match uses candidate evidence + repo facts + role context; low evidence produces a gap/CTA, not fake certainty. |
| Manual open-source task | Candidate can work from a real repo and exact base commit even without a PR. | Manager can assign a source-backed task packet when automatic matching is not ready. | Repo URL + base commit + task + success criteria are persisted and exposed; workspace launches to that commit. |
| Candidate code review | Candidate can inspect a diff, comment, push back, and submit a verdict. | Manager sees review quality, reasoning, pushback, and evidence trail. | Diff renders; comments persist; AI author responses are sourced; final verdict is submitted once. |
| Workspace-backed repo task | Candidate can launch a real code workspace and produce commit/test evidence. | Manager sees task progress and can distinguish workspace failure from candidate performance. | Room workspace reaches READY; repo cloned; task packet visible; failure diagnostics are actionable. |
| Scoring and validity | Candidate gets a clear submitted/completed state. | Manager knows whether the score is source-backed, partial, unavailable, or unsafe. | Submission completes without requiring scorer availability; invalid score never masquerades as final recommendation. |
| Interview detail | Candidate interaction remains scoped to one interview. | Manager quickly sees recommendation, score validity, invite state, match proof, this-interview evidence, and next action. | Related meetings are labelled as context, not merged evidence; no raw noisy dumps by default. |
| Person profile rollup | Candidate history can improve future assessments. | Manager sees current recommendation, uncertainty, missing context, related meetings, and what changed. | Rollup separates person-level understanding from meeting-level source evidence. |

## Trust Model

Use these states consistently across candidate, interview, and person surfaces:

- `Matched`: source-backed candidate evidence aligns with source-backed repo demand and role context.
- `Manual task`: recruiter supplied a source-backed task packet; useful but not a candidate-fit proof.
- `Needs evidence`: candidate evidence is too thin; recommend a context call or intake question.
- `No safe challenge`: repo/PR packet coverage or quality gate failed.
- `Score unavailable`: submission exists but scorer/evaluator did not produce a valid score.
- `Score partial`: evidence exists but coverage, confidence, or source completeness is insufficient.
- `Score valid`: source-backed review/task evidence supports the score and recommendation.

## Browser Smoke Matrix

Run these in real browser automation whenever repo matching or CODE_REVIEW changes.

1. Recruiter creates a `CODE_REVIEW` or `OPEN_SOURCE_BUG_FIX` interview.
2. Recruiter verifies the assessment invite panel shows recipient, status, validity, next action, and setup trust state.
3. Candidate opens `/assess/:token`; link is not marked used until explicit start.
4. Candidate starts assessment; opening the raw link in a clean session now shows the correct claimed/started state.
5. Candidate submits intake evidence; waiting state shows concrete decomposition/matching phase, not a generic spinner.
6. Automatic match either exposes a source-backed code review or fails closed with a missing-evidence/actionable diagnostic.
7. Manual task exposes repo URL, exact base commit, task, success criteria, and expected evidence.
8. Workspace launch reaches `READY` and opens a real proxy path for the selected repo/base commit.
9. Candidate completes review or repo-task submission.
10. Recruiter interview detail shows verdict, annotations or task evidence, score validity, match trust state, and next action.
11. Person profile rollup updates only from source-backed completed evidence and keeps related meetings separate.

## Current Proven Checks

- `npx tsc --noEmit`
- `(cd workers/api && npm run type-check)`
- `npm test -- --run infra/containers/code-server/entrypoint.test.js`
- `(cd workers/api && npm test -- --run src/__tests__/DevContainerDO.test.ts -t "internet access")`
- `(cd workers/api && npm test -- --run src/routes/__tests__/meetingRooms.rest.test.ts -t "launches a live workspace|without an agent")`
- `npm run smoke:code-review-assess-dev` proves the deployed ready CODE_REVIEW path delivers `/assess`, renders the source-backed PR diff, opens recruiter detail, and keeps the person profile pending instead of overclaiming before submission.
- `npm run smoke:code-review-assess-dev:role-backed` proves the deployed role-backed CODE_REVIEW path creates role context but, without a ready source-backed PR assignment, still returns the safe `PROFILE_RECEIVED` / `candidate-intake-queued` handoff instead of exposing internal matching.
- `WORKSPACE_SMOKE_INTERVIEW_TYPE=OPEN_SOURCE_BUG_FIX ... npm run smoke:code-review-workspace-dev`
- `npx vitest run src/pages/PersonProfilePage.test.tsx -t "does not blend a newer related match-only interview"` proves the person rollup binds score, transcript, and match proof by shared session/interaction before using a CODE_REVIEW result as the current recommendation.
- `npm run smoke:assess-session-isolation` proves opening token B in a browser with stale token A sessionStorage resolves token B, stores candidate B, uses token B for stage config, and never fetches a challenge from candidate A.
- `npm run smoke:assess-token-lifecycle-dev` creates two real app-dev CODE_REVIEW assessment links, opens token A then token B in one browser, and proves token B resolves/stores candidate B before claim without a used-link or matching-loop fallback. Ready challenge start/render remains covered by `npm run smoke:code-review-assess-dev`.
- `npm run smoke:code-review-assess-dev:blocked` proves the deployed standalone CODE_REVIEW blocked path returns `PROFILE_RECEIVED` / `candidate-intake-queued`, opens recruiter detail, and rejects candidate-visible matching-loop copy.

## Immediate Gaps

1. WebBridge is currently unavailable because the daemon reports `extension_connected:false`; browser proof must use Playwright or in-app browser until the extension reconnects.
2. Candidate link lifecycle has mocked-RPC and real app-dev same-browser token A/token B proof; keep extending it only when the invite lifecycle adds new states such as regenerated or expired links.
3. The waiting/matching state now has a named deployed no-spinner proof for the standalone CODE_REVIEW blocked path; add a dedicated repo-catalog prerequisite fixture if challenge-packet coverage changes.
4. Interview detail needs a manager-facing trust model display: matched/manual/needs evidence/no safe challenge/score unavailable/score valid.
5. Person rollup still needs a deployed browser E2E where two related interviews exist, but the component regression now proves that only session/interaction-bound completed CODE_REVIEW evidence affects the current recommendation.
