# ADR-007: Server-Side Ground Truth Sanitization

**Status:** Proposed — implement post-MVP sprint 1
**Date:** 2026-02-27
**Deciders:** Jory (founder)

---

## Context

Currently, `scoreCodeReview()` and `scoreQuiz()` run entirely in the browser. This means:

1. `CODE_REVIEW` challenge config includes `bugLocations` (the ground truth answer key)
2. `QUIZ_MCQ` challenge config includes `correctOptionId`
3. Both are loaded into browser memory and accessible via DevTools network inspection or JS bundle analysis

For MVP with a small, trusted cohort this is acceptable — the risk of adversarial candidates gaming scores is low. But any meaningful scale or customer whose candidates might be motivated to cheat makes this a platform integrity issue.

Additionally, the `groundTruth` sanitization approach is noted as a known gap in `docs/design/content-seeding-strategy.md` and `FEATURE_REQUESTS.md` (Ground Truth Sanitization entry).

The `questionAgent` Lambda pattern (`amplify/functions/questionAgent/`) provides the engineering standard for all new Lambdas.

---

## Decision

Implement a two-layer `config` model on the `Challenge` schema, separating public configuration (sent to the browser) from private configuration (server-only, never exposed to candidates). Move scoring computation to a `scoringAgent` Lambda.

### Schema change

```typescript
// amplify/data/resource.ts

Challenge: a.model({
  // ... existing fields ...

  // Public config — safe to send to candidate browser.
  // For QUIZ_MCQ: contains question text, option labels, but NOT correctOptionId.
  // For CODE_REVIEW: contains code, language, but NOT bugLocations.
  config: a.json(),

  // Private config — IAM-only. Never exposed to browser.
  // For QUIZ_MCQ: { correctOptionId: string }
  // For CODE_REVIEW: { bugLocations: BugLocation[], correctAnnotations: Annotation[] }
  // For CODE_IMPLEMENTATION: { testCases: TestCase[], expectedOutput: string[] }  // future
  serverConfig: a.json().authorization(allow => [
    allow.resource(scoringAgent),  // Lambda can read this
    allow.owner(),                  // Recruiter can read/write (for authoring)
    // candidates have NO access — guest auth cannot read serverConfig
  ]),
})
```

### scoringAgent Lambda

Follows the `questionAgent` pattern exactly:

```
amplify/functions/scoringAgent/
  handler.ts     — receives { assessmentId, challengeId, submission }
  types.ts       — ScoringRequest, ScoringResponse
  scorer.ts      — per-type scoring logic (moved from src/lib/scoring/)
  resource.ts    — defineFunction with env vars
```

**Flow:**
1. Candidate submits → `useAssessment.ts` calls `Assessment.create({ submission, score: null })`
2. DynamoDB stream or AppSync mutation resolver triggers `scoringAgent`
3. `scoringAgent` reads `Challenge.serverConfig` via IAM role
4. Scores the submission, calls `Assessment.update({ id, score })`
5. `CandidateProfilePage` shows score (already present, no UI change needed)

Alternative trigger: direct Lambda invocation from `useAssessment.ts` after creating the Assessment. This avoids DynamoDB streams (which require additional Amplify config) and is simpler for MVP.

---

## Options Considered

### Option A: Two-field schema + scoringAgent Lambda (chosen)

| Dimension | Assessment |
|---|---|
| Security | ✅ Answer keys never leave the server |
| Complexity | Medium — schema migration + new Lambda |
| Infrastructure cost | ✅ Low — Lambda invocations at this scale are negligible |
| Migration impact | Low — no existing real user data; schema change is additive |
| Extensibility | ✅ `serverConfig` can hold test cases for CODE_IMPLEMENTATION in future |

**Pros:** Clean separation between public and private config at the schema level; answer keys are never accessible to candidates regardless of client-side code changes; follows the established Lambda pattern.

**Cons:** Requires a schema migration (additive — add `serverConfig` field, set `config` to strip answer keys); requires the `scoringAgent` Lambda; requires updating the challenge authoring flow to write answer keys to `serverConfig` instead of `config`.

### Option B: Single config field + Lambda transform on read (rejected)

Store everything in `config`; have the candidate flow fetch config through a Lambda that strips answer keys before returning. Avoids schema changes but adds a Lambda cold start to every challenge load, and the config is already in the browser by the time the candidate sees the challenge. **Rejected.**

### Option C: Keep client-side scoring (MVP current state)

Acceptable for MVP with a small, known cohort. Not acceptable once the platform is used by candidates with a motivation to misrepresent their scores. The risk is not theoretical — it requires ~30 seconds in DevTools. **Not an architectural choice — this is the status quo to be replaced.**

---

## Trade-off Analysis

The schema change is additive (no existing data at risk). The Lambda follows an established pattern. The only real cost is authoring-side: the `ChallengeEditorPage` CODE_REVIEW and QUIZ_MCQ forms must write answer keys to `serverConfig` instead of `config`. This is a one-sprint effort.

The timing question: **do this before or after the first cohort?** Recommendation: after MVP ships, before onboarding paying customers. The first cohort is internal/friends-and-family where trust is high. Plan it for post-MVP sprint 1, before any customer whose candidates are motivated to cheat.

---

## Consequences

- `Challenge.config` must be sanitized before being sent to candidates (answer keys stripped). This means the authoring flow writes to two fields; the candidate flow reads only `config`.
- Existing `src/lib/scoring/codeReview.ts` and `src/lib/scoring/quiz.ts` move into `amplify/functions/scoringAgent/scorer.ts` — the client-side versions can be retained for tests but should not be used for actual scoring post-implementation.
- `Assessment.score` may be null momentarily after submission (async Lambda scoring). `CandidateProfilePage` already handles `null` score — no UI change needed.
- `ChallengeEditorPage` forms need a new section: "Answer Key (private)" for CODE_REVIEW and QUIZ_MCQ that writes to `serverConfig`.

---

## Action Items

1. [ ] **Post-MVP sprint 1:** Write ADR amendment with exact `serverConfig` JSON shape per challenge type
2. [ ] **Post-MVP sprint 1:** Schema migration — add `serverConfig: a.json()` to `Challenge` with IAM-only auth
3. [ ] **Post-MVP sprint 1:** Create `amplify/functions/scoringAgent/` following `questionAgent` pattern
4. [ ] **Post-MVP sprint 1:** Update `ChallengeEditorPage` CODE_REVIEW + QUIZ_MCQ forms to write answer keys to `serverConfig`
5. [ ] **Post-MVP sprint 1:** Update `config` sanitization — strip `correctOptionId` and `bugLocations` from the public config before it reaches the browser
6. [ ] **Post-MVP sprint 1:** Run `npx ampx sandbox`, `npx tsc --noEmit`, end-to-end smoke test

**Do not start until:** Step 5 is complete and the first recruiter cohort is onboarded.
