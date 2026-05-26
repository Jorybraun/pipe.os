# ADR-020: Follow-Up Question Agent Architecture

**Date:** 2026-03-20
**Status:** Accepted

## Context

After a candidate completes a code review challenge, Pipe needs to probe their thinking with personalised follow-up questions. Generic canned questions would add noise without signal. The questions must be grounded in what the candidate actually said during their review.

Options considered:

1. **Synchronous generation** — block `submitChallenge` until questions are ready, then advance
2. **Async generation in background** — fire mutation, show spinner, advance on completion
3. **Pre-generated library** — curate fixed follow-up bank, sample randomly
4. **No follow-ups** — skip the step entirely for MVP

## Decision

**Implement an async `codeReviewFollowUpAgent` Lambda** that is triggered non-fatally after a CODE_REVIEW submission.

- One-turn Claude call: system prompt + candidate review data → JSON
- Returns exactly 5 `SHORT_ANSWER` questions (padded if Claude returns fewer)
- Questions are saved to `Assessment.followUpQuestionsJson` (new `a.json()` field)
- UI gates on `followUpLoading` then `followUpQuestions !== null`
- If Lambda fails: `followUpQuestions` is set to `[]` → `SKIP_FOLLOW_UP` escape hatch shown
- Answers saved back to same `Assessment.followUpQuestionsJson` field on submit

### Agent follows `questionAgent` engineering standard

Separate files: `handler.ts`, `types.ts`, `prompts.ts`, `validation.ts`, `costTracker.ts`, `package.json`.

Uses `ANTHROPIC_API_KEY` secret — the codebase is already on Anthropic (`claude-sonnet-4-20250514`). No Bedrock or Mistral dependency added.

### Why 5 questions, SHORT_ANSWER only

Five questions balance depth with candidate experience. Multiple-choice would be too easy to game post-review. Free-text answers give the recruiter genuine signal about how the candidate thinks about the bugs they identified.

### Why non-fatal

The code review submission already created the Assessment record and triggered scoring. Failing to generate follow-ups should not block the submission flow or show the candidate an error. The `SKIP_FOLLOW_UP` button covers the degraded path.

## Consequences

**Positive:**
- Follow-up questions are grounded in the candidate's actual annotations and verdict
- Lambda failure degrades gracefully — candidate is never stuck
- Questions + answers stored together in a single JSON blob for easy recruiter read-back
- Follows the established `questionAgent` pattern — new agents can copy the structure

**Negative:**
- Adds ~2–5s latency between CODE_REVIEW submit and follow-up panel (spinner shown)
- Storing questions + answers in a single JSON field means no AppSync subscription on individual answers
- 5-question limit is arbitrary — may need to be configurable in a future iteration

## Alternatives Rejected

- **Synchronous generation** — blocks `submitChallenge`, candidate sees loading on submit button
- **Fixed question bank** — questions can't reference specific annotations; loses personalisation signal
- **No follow-ups** — removes a differentiating signal from the recruiter view
