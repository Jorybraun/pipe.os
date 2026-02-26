# Pipe — MVP Task List

**Updated:** 2026-02-26
**Goal:** Recruiter creates a pipeline → invites a candidate → candidate completes a code review → recruiter sees score.
**Rule:** Do tasks in order. One at a time. Don't start the next phase until the current one is done.

---

## Phase 0 — Foundation ✅ (done)

- [x] Wrap `<App>` with `<Authenticator>` — sign-in screen for recruiters
- [x] Sign-out button in `ProfileHeader`
- [x] `Pipeline` model in Amplify schema
- [x] `Stage` model in Amplify schema
- [x] `Candidate` model in Amplify schema
- [x] `Assessment` model in Amplify schema
- [x] Remove legacy `Todo` model
- [x] Fix schema auth — add guest access to Stage/Candidate/Assessment for candidate flow
- [x] **Run `npx ampx sandbox`** — confirm schema deploys cleanly. Fix any errors before continuing. ✅

---

## Phase 1 — Candidate Flow (start here) 🎯

> Goal: A candidate opens an invite link, reads the instructions, and submits a code review — no login required.
>
> This is the most important thing to build. Everything else depends on it.

### Step 1: Invite link generation ✅
- [x] **Generate `inviteToken` when creating a candidate** — UUID, stored on `Candidate.inviteToken`. Add a utility `src/lib/generateInviteToken.ts` that returns `crypto.randomUUID()`. ✅
- [x] **Recruiter copy-link button** — On `OverviewPage.tsx`, show each candidate's invite URL (`/assess/:inviteToken`). Button copies to clipboard. ✅

### Step 2: Candidate assessment hook ✅
- [x] **Create `src/hooks/useAssessment.ts`** — handles all candidate-side data:
  - Input: `inviteToken` (from URL param)
  - Load `Candidate` record by filtering on `inviteToken` field (unauthenticated / guest query)
  - Load `Stage` records for the candidate's pipeline
  - Expose `submitAssessment(stageId, submission)` — creates an `Assessment` record (unauthenticated)
  - States: `loading`, `error`, `candidate`, `stages`, `isSubmitted`
  - ~2 hours ✅

### Step 3: Candidate assessment page
- [ ] **Create `src/pages/CandidateAssessmentPage.tsx`** — no auth wrapper:
  - Reads `inviteToken` from URL param via `useParams()`
  - Uses `useAssessment` hook
  - Shows: role title + stage name + instructions
  - Code viewer with syntax highlighting and line numbers (use a lightweight lib — `react-syntax-highlighter` or similar)
  - Annotation UI: click a line → type a comment → mark severity (critical / major / minor)
  - Submit button → calls `submitAssessment()` → shows confirmation screen
  - ~4–6 hours

### Step 4: Route
- [ ] **Add `/assess/:token` route in `App.tsx`** — outside the `<Authenticator>` wrapper (no auth required). ~15 min

### Step 5: Smoke test
- [ ] **End-to-end candidate flow test** — manually: create pipeline in sandbox, add candidate with token, open `/assess/:token`, submit review, confirm `Assessment` record appears in DynamoDB. ~30 min

---

## Phase 2 — Code Review Stage Content & Scoring

> Goal: The code review has real content (buggy code) and produces a meaningful score.

### Step 1: Write code snippets
- [ ] **Write 3 code snippets with intentional bugs** — TypeScript/JavaScript. Save as JSON in `src/content/codeReviewSnippets.ts`. Each snippet needs:
  - The code string
  - Ground truth: which lines have bugs, the type of bug, severity (critical / major / minor)
  - Snippet 1: security bug + logic bug
  - Snippet 2: performance bug + edge case
  - Snippet 3: all four types
  - ~2 hours

### Step 2: Seed stage content
- [ ] **Hardcode stage config in pipeline creation** — For MVP, when a recruiter creates a pipeline, automatically create 1 Stage of type CODE_REVIEW with the 3 snippets from Step 1 loaded into `Stage.config`. No manual stage builder yet. ~1 hour

### Step 3: Scoring
- [ ] **Create `src/lib/scoring/codeReview.ts`** — pure function:
  ```
  scoreCodeReview(submission, groundTruth) → { total: number, breakdown: object }
  ```
  Rubric: bugs found (40%) + severity accuracy (25%) + false positives penalty (−10%) + fix quality (25%)
  ~2 hours
- [ ] **Unit test scoring** — `src/lib/scoring/codeReview.test.ts`. Cover: all bugs found, no bugs found, all false positives, partial. ~1 hour
- [ ] **Wire scoring on submission** — in `useAssessment.ts`, after saving the raw submission, compute the score and write it to `Assessment.score`. ~30 min

---

## Phase 3 — Quiz Stage

> Goal: A pipeline has a quiz stage. Candidates answer multiple-choice questions. Scores are stored.

### Step 1: Write questions
- [ ] **Write 10 multiple-choice questions** — TypeScript/JavaScript/React focused. Save as JSON in `src/content/quizQuestions.ts`. Each question: `{ q, options: string[4], correct: number }`. ~1 hour

### Step 2: Seed stage content
- [ ] **Add Quiz stage to pipeline creation** — when a recruiter creates a pipeline, automatically create 1 Stage of type QUIZ with the 10 questions in `Stage.config`. ~30 min

### Step 3: Quiz UI
- [ ] **Create `src/components/QuizRenderer.tsx`** — shows one question at a time, 4 options, next/back navigation. Builds up a `submission` object `{ [questionId]: selectedIndex }`. ~2 hours
- [ ] **Add quiz flow to `CandidateAssessmentPage.tsx`** — after code review, show quiz stage. ~1 hour

### Step 4: Scoring
- [ ] **Create `src/lib/scoring/quiz.ts`** — compare candidate answers to `correct` field. Score = (correct / total) * 100. ~30 min
- [ ] **Wire quiz scoring on submission**. ~30 min

---

## Phase 4 — Recruiter Dashboard (real data)

> Goal: Recruiter logs in, sees their pipelines, clicks into one, sees candidates ranked by score.

- [ ] **`ListingPage.tsx` — real pipelines** — replace mock data with `client.models.Pipeline.list()`. ~1 hour
- [ ] **`OverviewPage.tsx` — real candidates** — load candidates with `client.models.Candidate.list({ filter: { pipelineId: { eq: id } } })`. ~1 hour
- [ ] **`CandidateProfilePage.tsx` — real assessment** — load `Assessment` by `candidateId`, show score and submission annotations. ~1.5 hours
- [ ] **Signal label** — map score to STRONG / YES / MAYBE / NO:
  - STRONG: ≥ 85%
  - YES: 70–84%
  - MAYBE: 50–69%
  - NO: < 50%
  ~30 min
- [ ] **Sort candidates by score descending** on `OverviewPage`. ~15 min
- [ ] **Remove all remaining mock data** from all pages. ~1 hour

---

## Phase 5 — Polish & Ship

- [ ] **Error states** — all data-fetching pages show a recoverable error message with retry if the query fails. ~2 hours
- [ ] **Loading skeletons** — listing page, overview page, candidate profile. ~2 hours
- [ ] **`npx ampx pipeline-deploy`** — deploy to production. ~1 hour
- [ ] **End-to-end smoke test** — as recruiter: sign up, create pipeline, copy invite link. As candidate: open link, complete review + quiz, submit. As recruiter: view score and signal. ~1 hour
- [ ] **Send to 3 real people.** 🎉

---

## Post-MVP Backlog (do not touch until Phase 5 is done)

These are real ideas — don't discard them. Just don't start them yet.

- [ ] Agentic role discovery — wire `useRoleDiscovery` to `generateQuestions` Lambda
- [ ] `generateJobDescription` Lambda — produce job description from discovery context
- [ ] Stage builder — recruiter edits stage content instead of using hardcoded defaults
- [ ] Challenge library — curated bank of code snippets and quiz questions; recruiter picks
- [ ] Algorithm stage (code execution + test runner) — removed from MVP
- [ ] Auto-save on assessment (currently submit-only)
- [ ] Timer with warnings per stage
- [ ] Confirmation email to candidate on submission
- [ ] Real-time recruiter dashboard (subscriptions, not polling)
- [ ] Voice interview stage (WebRTC)
- [ ] S3 integration for media assets

---

## Key files quick reference

| File | What it does | Status |
|---|---|---|
| `amplify/data/resource.ts` | All data models + auth rules | ✅ Complete — guest auth added |
| `amplify/auth/resource.ts` | Cognito config + groups | ✅ Admin group added |
| `src/App.tsx` | All routes | 🟡 Missing `/assess/:token` |
| `src/pages/PipelineCreatePage.tsx` | Recruiter create form | ✅ Built |
| `src/hooks/usePipelineCreate.ts` | Create hook | ✅ Built |
| `src/pages/ListingPage.tsx` | Recruiter pipeline list | 🔴 Mock data |
| `src/pages/OverviewPage.tsx` | Pipeline detail + candidates | 🔴 Mock data |
| `src/pages/CandidateProfilePage.tsx` | Individual candidate + score | 🔴 Mock data |
| `src/pages/CandidateAssessmentPage.tsx` | Candidate-facing assessment | 🔴 Does not exist yet |
| `src/hooks/useAssessment.ts` | Candidate flow hook | 🔴 Does not exist yet |
| `src/lib/scoring/codeReview.ts` | Scoring function | 🔴 Does not exist yet |
| `src/pages/RoleDiscoveryPage.tsx` | Agentic discovery (post-MVP) | 🔒 Preserved |
| `src/hooks/useRoleDiscovery.ts` | Agentic hook (post-MVP) | 🔒 Preserved |
