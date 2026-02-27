# Technical Spec: Candidate Flow

**Priority:** 1 — core flow is complete. This spec now reflects the Phase 7 target state.
**Status:** Phase 1–5 implementation is done. Phase 7 updates described below.
**Last updated:** 2026-02-27

---

## Goal

A candidate receives a link, opens it without signing in, works through an ordered set of challenges (code review, code implementation, MCQ, free text), submits, and sees a confirmation screen. The recruiter sees a per-challenge breakdown with scores.

---

## User journey (target state after Phase 7)

1. Recruiter creates a pipeline and adds a candidate (name + email)
2. System generates a UUID `inviteToken` stored on `Candidate.inviteToken`
3. Recruiter copies the invite URL from the pipeline overview page
4. Recruiter sends the link to the candidate (manually for MVP — email automation is post-MVP)
5. Candidate opens `/assess/:inviteToken` in a browser — no sign-in prompt
6. App loads: candidate name, pipeline title, and the first stage with its challenges
7. `StageShell` renders: stage name, time limit countdown, challenge progress dots
8. Candidate works through challenges in order — each has its own renderer
9. After each challenge, candidate clicks NEXT CHALLENGE (or submits final)
10. Each challenge submission creates one `Assessment` record (unauthenticated write, `authMode: 'apiKey'`)
11. After the final challenge: `Candidate.status` → `COMPLETED`, confirmation screen shown
12. Recruiter logs in, sees per-challenge scores on `CandidateProfilePage`

---

## Data loading sequence (Phase 7)

```typescript
// useAssessment.ts loads:
// 1. Candidate by inviteToken (guest query)
// 2. Pipeline stages with challenges via selectionSet
const { data: stages } = await client.models.Stage.list({
  filter: { pipelineId: { eq: candidate.pipelineId } },
  selectionSet: ['id', 'name', 'order', 'timeLimit', 'challenges.*'],
  authMode: 'apiKey',
});
// Sort stages by order, sort challenges within each stage by order
// 3. Existing Assessments (to resume if candidate returns mid-session)
```

---

## Hook: `src/hooks/useAssessment.ts`

### Phase 1–5 state (current)

```typescript
interface UseAssessmentResult {
  candidate: Schema['Candidate']['type'] | null;
  stages: Schema['Stage']['type'][];
  currentStageIndex: number;
  isLoading: boolean;
  error: Error | null;
  isSubmitted: boolean;
  submitStage: (submission: StageSubmission) => Promise<void>;
  nextStage: () => void;
}
```

### Phase 7 target state

```typescript
interface UseAssessmentResult {
  candidate: Schema['Candidate']['type'] | null;
  stages: StageWithChallenges[];
  currentStageIndex: number;
  currentChallengeIndex: number;
  isLoading: boolean;
  error: Error | null;
  isSubmitted: boolean;
  completedChallengeIds: Set<string>;
  submitChallenge: (challengeId: string, submission: ChallengeSubmission) => Promise<void>;
  nextChallenge: () => void;
}

interface StageWithChallenges {
  id: string;
  name: string;
  order: number;
  timeLimit: number | null;
  challenges: Schema['Challenge']['type'][];
}
```

**Logic changes in Phase 7:**
1. Load `challenges` as nested data via `selectionSet` on `Stage.list`
2. Track current challenge index (separate from stage index)
3. `submitChallenge(challengeId, submission)`: compute score for auto-scored types (CODE_REVIEW, QUIZ_MCQ), create `Assessment` with `challengeId` (not `stageId`), advance to next challenge
4. `nextChallenge()`: when challenges are exhausted in current stage, advance to next stage
5. Strip `correctOptionId` from `QUIZ_MCQ` config before returning from hook (never expose to rendering layer)

**Auth:** Use `generateClient({ authMode: 'apiKey' })` initialized once at module level — not per-call.

**Error codes:**
- `INVALID_TOKEN` — candidate not found → "This link is invalid or has expired"
- `ALREADY_COMPLETED` — `candidate.status === 'COMPLETED'` → "You have already submitted"
- `NETWORK_ERROR` — retry button
- `SUBMIT_FAILED` — do not advance; show inline error

**Logging prefix:** `[useAssessment]`

---

## Page: `src/pages/CandidateAssessmentPage.tsx`

**Route:** `/assess/:token` — outside `<Authenticator>`. Never import or reference `<Authenticator>` here.

**Renders one of:**
1. **Loading state** — skeleton while hook fetches
2. **Error state** — friendly message (`INVALID_TOKEN`, `ALREADY_COMPLETED`, `NETWORK_ERROR`)
3. **Stage view** — `StageShell` wrapping current challenge via `ChallengeRegistry`
4. **Confirmation screen** — shown after final challenge submitted

**Page structure (Phase 7):**
```
<StageShell
  stage={currentStage}
  currentChallengeIndex={currentChallengeIndex}
  completedChallengeIds={completedChallengeIds}
>
  <ChallengeRegistry
    challenge={currentChallenge}
    onSubmit={(submission) => submitChallenge(currentChallenge.id, submission)}
  />
</StageShell>
```

---

## Component: `StageShell` (Phase 7 — new)

**Location:** `src/components/Assessment/StageShell.tsx`

**Props:**
```typescript
interface StageShellProps {
  stage: StageWithChallenges;
  currentChallengeIndex: number;
  completedChallengeIds: Set<string>;
  children: ReactNode;
  onNextChallenge: () => void;
}
```

**Renders:**
- Top bar: pipeline name + stage name + time remaining
- Progress dots: one per challenge, filled when `completedChallengeIds` contains its id
- Main: `children` (the challenge renderer)
- Bottom bar: NEXT CHALLENGE button (disabled until current challenge has a submission)

---

## Component: `ChallengeRegistry` (Phase 7 — replaces StageRegistry)

**Location:** `src/components/Assessment/ChallengeRegistry.tsx`

Routes challenge type to its renderer. Each renderer receives `config` and `onSubmit`.

```typescript
const Definitions: Record<ChallengeType, ChallengeDefinition> = {
  CODE_REVIEW: { Component: DiffReviewCanvas, ... },
  CODE_IMPLEMENTATION: { Component: MonacoChallenge, ... },
  QUIZ_MCQ: { Component: MCQChallenge, ... },
  QUIZ_SHORT_ANSWER: { Component: ShortAnswerChallenge, ... },
};
```

**Important:** `QUIZ_MCQ` config must have `correctOptionId` stripped before being passed to `MCQChallenge`. Strip it in the hook, not the registry.

---

## Challenge renderers (Phase 7 — new)

### `MonacoChallenge` (`CODE_IMPLEMENTATION`)

Split-pane layout. Left pane: problem statement (markdown rendered), examples list, constraints list. Right pane: Monaco editor with starter code pre-loaded, language set from config.

If `codeArtifactId` is set: show "View original code" button that opens a drawer showing the source code for context (e.g. the buggy version reviewed in a prior challenge).

Submit captures `{ code: string }` as submission.

### `MCQChallenge` (`QUIZ_MCQ`)

Question text, then 4 option buttons. One tap selects and immediately locks the answer. No back navigation — once selected, cannot change. Submit captures `{ selectedOptionId: string }`.

### `ShortAnswerChallenge` (`QUIZ_SHORT_ANSWER`)

Question text, resizable textarea, optional character counter. Submit captures `{ text: string }`.

---

## Scoring (called in `submitChallenge`)

Auto-scored challenge types compute score before writing `Assessment`:

```typescript
// In useAssessment.ts submitChallenge():
let score: number | null = null;

if (challenge.type === 'CODE_REVIEW') {
  const artifact = challenge.codeArtifactId
    ? await loadCodeArtifact(challenge.codeArtifactId)
    : null;
  const groundTruth = artifact?.groundTruth ?? [];
  const result = scoreCodeReview(submission as CodeReviewSubmission, groundTruth);
  score = result.total;
}

if (challenge.type === 'QUIZ_MCQ') {
  const config = challenge.config as QuizMCQConfig;
  score = (submission as QuizMCQSubmission).selectedOptionId === config.correctOptionId
    ? 100
    : 0;
}

// CODE_IMPLEMENTATION and QUIZ_SHORT_ANSWER: score = null (manual review)

await client.models.Assessment.create({
  candidateId: candidate.id,
  challengeId: challenge.id,
  submission: JSON.stringify(submission),
  score,
  maxScore: 100,
  scoredAt: score !== null ? new Date().toISOString() : null,
});
```

---

## Recruiter side: invite link (unchanged)

On `OverviewPage.tsx`, for each candidate:
```
[ Candidate Name ]  [ INVITED / IN_PROGRESS / COMPLETED ]  [ Copy Link ]
```

```typescript
const inviteUrl = `${window.location.origin}/assess/${candidate.inviteToken}`;
navigator.clipboard.writeText(inviteUrl);
```

---

## Edge cases

| Scenario | Behavior |
|---|---|
| Token not found | Show "This link is invalid or has expired" — no retry |
| Candidate already COMPLETED | Show "You have already submitted your assessment" |
| Network error on load | Show error with retry button |
| Network error on submit | Do not advance challenge; show inline error with retry |
| Challenge has no config | Show "This challenge is not yet configured" — recruiter issue, not candidate error |
| Partial completion (tab closed) | No auto-save in MVP — `completedChallengeIds` is not persisted. Auto-save is post-MVP. |
| `codeArtifactId` references missing artifact | Gracefully fall back to inline code config if present; show error if neither exists |

---

## Acceptance criteria (Phase 7)

- [ ] `/assess/:token` renders without redirecting to sign-in
- [ ] Invalid token shows a clear error message (not a crash)
- [ ] Valid token loads candidate name, pipeline title, and first stage
- [ ] `StageShell` shows progress dots, one per challenge, updating as challenges complete
- [ ] `CODE_REVIEW`: candidate can annotate lines and submit; `Assessment` created with score
- [ ] `CODE_IMPLEMENTATION`: candidate can write code in Monaco and submit; `Assessment` created with `score: null`
- [ ] `QUIZ_MCQ`: candidate selects one option; answer locked immediately; `Assessment` created with 0 or 100
- [ ] `QUIZ_SHORT_ANSWER`: candidate types response; `Assessment` created with `score: null`
- [ ] After all challenges in a stage: stage completion shown, advance to next stage (or finish)
- [ ] After final challenge: confirmation screen shown, `Candidate.status = 'COMPLETED'`
- [ ] Recruiter sees per-challenge scores on `CandidateProfilePage`
- [ ] `QUIZ_MCQ.correctOptionId` never appears in the client-side challenge config
- [ ] `npx tsc --noEmit` passes with zero errors
