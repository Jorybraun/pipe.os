# Technical Spec: Candidate Flow

**Priority:** 1 — build this before anything else.
**Status:** Ready to implement.
**Last updated:** 2026-02-26

---

## Goal

A candidate receives a link, opens it without signing in, completes a code review and a quiz, submits, and sees a confirmation screen.

---

## User journey (step by step)

1. Recruiter creates a pipeline and adds a candidate (name + email)
2. System generates a UUID `inviteToken` and stores it on the `Candidate` record
3. Recruiter copies the invite URL from the pipeline overview page
4. Recruiter sends the link to the candidate (manually, for MVP — email automation is post-MVP)
5. Candidate opens `/assess/:inviteToken` in a browser — no sign-in prompt
6. App loads the candidate's name, pipeline title, and the first stage config
7. Candidate completes the code review, then the quiz
8. Candidate hits Submit
9. App saves an `Assessment` record per stage (unauthenticated write)
10. App shows a confirmation screen: "Submitted — thank you."
11. Recruiter logs in, sees the candidate's score on the overview page

---

## Files to create

### `src/lib/generateInviteToken.ts`

```typescript
/**
 * Generates a secure random UUID for use as a candidate invite token.
 * The token is stored on the Candidate record and embedded in the invite URL.
 */
export function generateInviteToken(): string {
  return crypto.randomUUID();
}
```

---

### `src/hooks/useAssessment.ts`

Manages all state for the candidate-facing assessment flow.

**Inputs:**
- `inviteToken: string` — from URL param

**State exposed:**
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

**Logic:**
1. On mount: query `Candidate` with `filter: { inviteToken: { eq: token } }` using guest auth
2. If candidate found: query `Stage` records for `candidate.pipelineId`, ordered by `stage.order`
3. If candidate not found or error: set `error` state
4. `submitStage(submission)`: creates an `Assessment` record (guest write), then calls `nextStage()`
5. When all stages are submitted: set `isSubmitted = true`
6. Update `Candidate.status` to `IN_PROGRESS` on first load, `COMPLETED` after final submission

**Auth note:** Use `generateClient({ authMode: 'apiKey' })` for guest queries and mutations. See Amplify Gen 2 docs for multi-auth client usage.

**Error handling:**
- Invalid / expired token → set a specific `error.code = 'INVALID_TOKEN'` so the page can show a helpful message ("This link is invalid or has expired")
- Network error → set `error.code = 'NETWORK_ERROR'` — show retry button
- Submission failed → do not advance to next stage; show error inline

**Logging prefix:** `[useAssessment]`

---

### `src/pages/CandidateAssessmentPage.tsx`

**Route:** `/assess/:token` — outside `<Authenticator>`, no sign-in required.

**Renders one of:**
1. **Loading state** — skeleton or spinner while hook fetches data
2. **Error state** — friendly message if token is invalid or network failed
3. **Stage view** — current stage content (code review or quiz)
4. **Confirmation screen** — shown after final submission

**Stage routing logic:**
- Read `currentStageIndex` from the hook
- If `stages[currentStageIndex].type === 'CODE_REVIEW'` → render `<ReviewCanvas>`
- If `stages[currentStageIndex].type === 'QUIZ'` → render `<QuizRenderer>`

**Page structure (high level):**
```
<header>
  Pipeline title + candidate name
  Stage N of M indicator
</header>

<main>
  <ReviewCanvas /> or <QuizRenderer />
</main>

<footer>
  <SubmitButton />  (calls submitStage with current answers)
</footer>
```

**Important:** This page must not import or reference `<Authenticator>`. It is explicitly a public route.

---

### `src/components/ReviewCanvas.tsx`

Displays a code snippet with line numbers and allows inline annotation.

**Props:**
```typescript
interface ReviewCanvasProps {
  snippet: {
    code: string;
  };
  onAnnotationsChange: (annotations: Annotation[]) => void;
}

interface Annotation {
  line: number;
  comment: string;
  severity: 'critical' | 'major' | 'minor';
}
```

**Interactions:**
- Clicking a line number opens an inline form: comment textarea + severity selector
- Saving the annotation attaches it to that line visually (highlighted)
- Clicking an existing annotation opens it for edit/delete
- All annotation state is local — only committed on submit

**Library:** Use `react-syntax-highlighter` (already likely in package.json or easy to add) for syntax highlighting. Do not use Monaco for this — it's too heavy for a candidate-facing page.

---

### `src/components/QuizRenderer.tsx`

Displays multiple-choice questions one at a time.

**Props:**
```typescript
interface QuizRendererProps {
  questions: Array<{
    q: string;
    options: string[];
    correct: number;  // do NOT pass this to the component — strip it before passing
  }>;
  onAnswersChange: (answers: Record<number, number>) => void;
}
```

**Note:** Strip the `correct` field before passing questions to this component. The component never sees the answers.

**Interactions:**
- Shows one question at a time
- 4 option buttons (radio-style)
- Previous / Next navigation
- Selecting an option highlights it and saves to `answers` state
- Does not reveal correctness until after submission (post-MVP feature)

---

## Route change in `App.tsx`

The `/assess/:token` route must be **outside** the `<Authenticator>` wrapper:

```typescript
// Inside Authenticator (recruiter routes):
<Route path="/" element={<ListingPage />} />
<Route path="/pipeline/new" element={<PipelineCreatePage />} />
// ... other recruiter routes

// Outside Authenticator (public candidate route):
<Route path="/assess/:token" element={<CandidateAssessmentPage />} />
```

If the current `App.tsx` uses `<Authenticator>` as a top-level wrapper around all routes, refactor so the candidate route is rendered outside it.

---

## Recruiter side: invite link UI

On `OverviewPage.tsx`, for each candidate in the list:

```
[ Candidate Name ]  [ INVITED / IN_PROGRESS / COMPLETED ]  [ Copy Link ]
```

The "Copy Link" button constructs the URL:
```typescript
const inviteUrl = `${window.location.origin}/assess/${candidate.inviteToken}`;
navigator.clipboard.writeText(inviteUrl);
```

Show a brief "Copied!" toast or state change after clicking.

---

## Data writes (candidate-side)

All writes use guest auth (`authMode: 'apiKey'`).

### On first load (status update)
```typescript
await client.models.Candidate.update(
  { id: candidate.id, status: 'IN_PROGRESS' },
  { authMode: 'apiKey' }
);
```

### On stage submit (assessment creation)
```typescript
await client.models.Assessment.create(
  {
    candidateId: candidate.id,
    stageId: stage.id,
    submission: JSON.stringify(submission),
    score: computedScore,
    completedAt: new Date().toISOString(),
  },
  { authMode: 'apiKey' }
);
```

### On final submit (candidate completion)
```typescript
await client.models.Candidate.update(
  { id: candidate.id, status: 'COMPLETED' },
  { authMode: 'apiKey' }
);
```

---

## Scoring (called client-side on submit)

For MVP, scoring is computed on the client before writing the Assessment. This is acceptable for MVP — server-side scoring is post-MVP.

```typescript
import { scoreCodeReview } from '../lib/scoring/codeReview';
import { scoreQuiz } from '../lib/scoring/quiz';

// In submitStage():
const score = stage.type === 'CODE_REVIEW'
  ? scoreCodeReview(submission, stage.config.snippets)
  : scoreQuiz(submission, stage.config.questions);
```

---

## Edge cases to handle

| Scenario | Behavior |
|---|---|
| Token not found | Show "This link is invalid or has expired" — no retry |
| Candidate already COMPLETED | Show "You have already submitted your assessment" |
| Network error on load | Show error with retry button |
| Network error on submit | Do not advance stage; show error inline with retry |
| Partial submission (tab closed mid-way) | No auto-save in MVP — candidate must restart. Auto-save is post-MVP. |
| Stage has no config | Show "This stage is not yet ready" — should not happen in production |

---

## Acceptance criteria

- [ ] `/assess/:token` renders without redirecting to sign-in
- [ ] Invalid token shows a clear error message (not a crash)
- [ ] Valid token loads candidate name and pipeline title
- [ ] Code review: candidate can annotate lines and submit
- [ ] Quiz: candidate can select answers and submit
- [ ] Submitting creates `Assessment` records visible in DynamoDB
- [ ] After final submit, confirmation screen is shown
- [ ] `Candidate.status` changes to `COMPLETED` after submit
- [ ] Recruiter sees candidate score on `OverviewPage` after submission
- [ ] `npx tsc --noEmit` passes with zero errors after implementation
