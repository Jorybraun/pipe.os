# BRIEF: Code Review Golden Path (Task C)

## Context

Read `docs/project-brief.md` and `.claude/rules/terminology.md` first.

The backend has a multi-turn code review session engine (`review_sessions`, `/rpc/review/*`). The frontend has a code review challenge renderer. But a `CODE_REVIEW` stage does not reliably trigger the multi-turn session flow when a candidate enters it from the generic assessment queue.

## Goal

Make the end-to-end code review stage work: candidate clicks invite link → lands in code review stage → reviews a real PR → has a multi-turn conversation with an AI implementer → completes → recruiter sees transcript + score.

## Scope (strictly this — no 3 PRs, no follow-ups yet)

1. **One PR, one session**
2. **One complete candidate journey**
3. **Recruiter can see the result**

## What to build / fix

### Backend
1. When a candidate starts a `CODE_REVIEW` stage, the system must:
   - Resolve the matched repo/PR for this candidate (use existing repo matching).
   - Create a `review_session` row in state `pending`.
   - Return the session ID + PR metadata to the frontend.
2. The `/rpc/review/session/:id/message` endpoint handles candidate messages.
3. The `/rpc/review/session/:id/complete` endpoint finalizes the session and triggers scoring.
4. Scoring: produce a single score + summary (annotation quality + communication clarity). Simple rubric, not full BARS yet.

### Frontend
1. `CandidateAssessmentPage` → when stage type is `CODE_REVIEW`, render the **review session UI** (not the challenge renderer).
2. The review session UI shows:
   - PR diff
   - Chat interface with AI implementer
   - "Submit Review" button to finalize
3. After submission, candidate sees a completion screen and can advance to next stage.

### Recruiter view
1. On the candidate detail / pipeline detail page, show:
   - Code review status (pending / in_progress / complete)
   - When complete: score + transcript excerpt + link to full transcript

## Acceptance criteria

1. A real invite link for a pipeline with a `CODE_REVIEW` stage lets a candidate complete one full review session.
2. The recruiter sees the session status and final score in the dashboard.
3. `npx tsc --noEmit` passes.
4. `CHANGELOG.md` updated.

## Out of scope

- 3 PR sessions
- Follow-up questions
- Implementer persona customization
- Open Source Challenge / dev containers
- Live panel

## Key files

- `workers/api/src/reviewSessions.ts`
- `workers/api/src/routes/review.ts`
- `src/pages/CandidateAssessmentPage.tsx`
- `src/components/ReviewSessionPanel.tsx` (create if missing)
- `src/pages/PipelineDetailPage.tsx` or candidate profile view
