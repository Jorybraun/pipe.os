# Challenge Architecture & UI Redesign

**Date:** 2026-02-27
**Status:** Draft — For Review Before Implementation
**Scope:** Full rethink of the Stage → Challenge model, recruiter pipeline builder UI, and candidate assessment experience

---

## 1. The Problem with the Current Architecture

### What we built

Right now a Stage maps 1:1 to a challenge type. `Stage.type = 'CODE_REVIEW'` means the entire stage is one code review session. `Stage.type = 'QUIZ'` means the entire stage is one quiz.

This creates three pain points:

**1. Artificial rigidity.** A recruiter who wants "review this function, then explain how you'd refactor it, then answer two follow-up questions" has to create three separate stages, each with its own invite flow and navigation step. The challenge content is inseparable from the pipeline structure.

**2. Lost context across challenges.** If you show a buggy authentication function in Stage 1, then ask "how would you rewrite this?" in Stage 2, the candidate has no idea the two are related. The code artifact is the thread — but today that thread gets cut between stages.

**3. A stage library that can't grow.** Adding a new challenge type (Monaco editor, system design diagram, API design question) currently requires adding a new StageType enum value and wiring a completely new top-level stage. Every new type multiplies complexity.

### What we want

```
Pipeline
  └── Stage (a timed session with a name and instructions)
        └── Challenge[] (ordered list of atomic problem units)
              ├── ChallengeType: CODE_REVIEW  → DiffReviewCanvas
              ├── ChallengeType: CODE_IMPLEMENTATION → Monaco editor
              ├── ChallengeType: QUIZ_MCQ  → Multi-choice question
              ├── ChallengeType: QUIZ_SHORT_ANSWER  → Free text
              └── ChallengeType: SYSTEM_DESIGN  → Diagram canvas (post-MVP)
```

A stage is the *when*. It has a name ("Technical Screen"), a time limit, and an intro message. It holds an ordered list of challenges.

A challenge is the *what*. It has a type that drives its renderer, plus its own payload (code snippet, questions array, problem statement). Multiple challenges can share the same code artifact as a "source" — so you can ask "find the bugs", then "now refactor it", then "what tests would you write" — all from the same function.

---

## 2. Core Concepts

### 2.1 The Stage

A stage is a container. It does not care what types of challenges it holds.

```typescript
interface Stage {
  id: string;
  pipelineId: string;
  name: string;               // "Technical Screen", "Take-Home Exercise"
  description?: string;       // Shown to candidate as intro text
  order: number;
  timeLimit?: number;         // Minutes. null = untimed.
  challenges: Challenge[];    // Ordered. Candidate progresses through these.
}
```

### 2.2 The Challenge

A challenge is an atomic problem unit. It knows its type, and its type determines which renderer handles it.

```typescript
type ChallengeType =
  | 'CODE_REVIEW'         // Diff view + annotation canvas
  | 'CODE_IMPLEMENTATION' // Monaco editor, write from scratch or modify
  | 'QUIZ_MCQ'            // Multiple choice question
  | 'QUIZ_SHORT_ANSWER'   // Free-form text response
  | 'SYSTEM_DESIGN';      // (post-MVP) Diagramming canvas

interface Challenge {
  id: string;
  stageId: string;
  type: ChallengeType;
  order: number;
  title: string;            // e.g. "Find the bugs in this auth function"
  instructions?: string;    // Markdown. Shown above the challenge.

  // Type-specific payload — stored as JSON in DynamoDB
  config: CodeReviewConfig | CodeImplementationConfig | QuizMCQConfig | QuizShortAnswerConfig;

  // Optional: link to a shared code artifact
  codeArtifactId?: string;  // If set, this challenge references shared source code
}
```

### 2.3 The Code Artifact

This is the key unlocking linked challenges. A `CodeArtifact` is a reusable code object stored once and referenced by multiple challenges.

```typescript
interface CodeArtifact {
  id: string;
  pipelineId: string;
  title: string;           // "AuthMiddleware v1"
  language: string;        // 'javascript', 'typescript', 'python'
  code: string;            // The source code
  groundTruth?: Bug[];     // Optional: answer key for CODE_REVIEW challenges
}
```

**Example linked challenge set anchored to one artifact:**

```
CodeArtifact: "Buggy Auth Middleware"
  ├── Challenge 1 (CODE_REVIEW):        "Find all bugs in this function"
  ├── Challenge 2 (QUIZ_SHORT_ANSWER):   "How would you fix the JWT issue on line 11?"
  ├── Challenge 3 (CODE_IMPLEMENTATION): "Rewrite this function correctly"
  └── Challenge 4 (QUIZ_MCQ):            "Which of these statements about JWT is true?"
```

All four challenges are in the same stage. The candidate sees them in order without ever losing context.

---

## 3. Challenge Type Specs

### 3.1 CODE_REVIEW

The candidate sees code in a diff-style viewer and annotates bugs by clicking line numbers.

```typescript
interface CodeReviewConfig {
  codeArtifactId?: string;  // Link to shared artifact, OR
  code?: string;            // Inline code if not shared
  language: string;
  title: string;
  groundTruth?: Bug[];      // Answer key (server-side only, not sent to client)
}
```

**Renderer:** `DiffReviewCanvas` (already built). Candidate clicks a line → opens annotation panel with severity selector + comment textarea. Submit fires `Assessment.create` with the annotation map.

**Scoring:** `scoreCodeReview` (already built). ±1 line tolerance, false positive penalty.

---

### 3.2 CODE_IMPLEMENTATION

The candidate writes or edits code in a Monaco editor. Recruiter can provide starter code and a problem description.

```typescript
interface CodeImplementationConfig {
  codeArtifactId?: string;  // Optional: pre-load the buggy code to fix
  starterCode?: string;     // Shown in editor on load
  language: string;
  problemStatement: string; // Markdown, shown in left pane
  examples?: Array<{
    input: string;
    output: string;
    explanation?: string;
  }>;
  constraints?: string[];   // e.g. ["O(n log n) time complexity", "O(1) extra space"]
  // Post-MVP: testCases for auto-grading
}
```

**Renderer:** Split-pane layout. Left: problem statement (markdown rendered), right: Monaco editor. Submit captures the candidate's code as a string. Recruiter reads it manually at MVP. No test runner at MVP.

**Scoring at MVP:** Manual. Recruiter scores 0–100 with rubric dimensions.

---

### 3.3 QUIZ_MCQ

Single multiple-choice question with 2–5 options. One correct answer.

```typescript
interface QuizMCQConfig {
  question: string;
  options: Array<{
    id: string;
    text: string;
  }>;
  correctOptionId: string;   // Answer key — NOT sent to client
  explanation?: string;      // Shown to recruiter after submission
}
```

**Renderer:** Question text, then option buttons (radio-style). One tap selects. Submit locks the answer.

**Scoring:** Automatic. 100 if correct, 0 if wrong. Can be weighted in stage config.

---

### 3.4 QUIZ_SHORT_ANSWER

Open-ended question with a text response. Manual scoring only at MVP.

```typescript
interface QuizShortAnswerConfig {
  question: string;
  placeholder?: string;      // Hint text in textarea
  maxLength?: number;        // Character cap
  rubric?: string;           // Shown to recruiter when reviewing, NOT to candidate
}
```

**Renderer:** Question text above a large textarea. No time pressure beyond the stage time limit.

**Scoring:** Manual.

---

### 3.5 SYSTEM_DESIGN (post-MVP)

Diagramming canvas. Deferred.

---

## 4. Screen-by-Screen UI Design

### 4.1 Pipeline Builder — Stages Tab

**Current state:** Stage cards in a vertical list. Each card shows stage type (CODE_REVIEW, QUIZ) as a badge.

**Target state:** Stage cards are containers. Inside each stage card is a mini challenge list. The stage card header shows the stage name, time limit, and challenge count. The challenge list inside shows challenge tiles.

```
┌─────────────────────────────────────────────────────────┐
│  STAGE 1 · TECHNICAL SCREEN · 45 MIN                    │
│  ─────────────────────────────────────────────────────  │
│  ┌─────────────────────────────────────────────────┐   │
│  │  1  CODE_REVIEW  "Find the bugs in AuthMiddleware"│  │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  2  SHORT_ANSWER  "How would you fix the JWT..."  │  │
│  └─────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────┐   │
│  │  3  CODE_IMPL    "Rewrite it correctly"           │  │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [ + ADD CHALLENGE ]                                    │
└─────────────────────────────────────────────────────────┘
```

The challenge tile should look like the old question cards from `screening-stage-builder.jsx`:
- Numbered square on the left (drag handle behind it for reordering)
- Type badge (COLOR-CODED: `CODE_REVIEW` = blue, `CODE_IMPL` = purple, `QUIZ_MCQ` = green, `SHORT_ANSWER` = amber)
- Title text
- Metadata row: time limit (if set), required indicator, linked artifact indicator
- Action icons on the right: edit, duplicate, delete

**Adding a challenge:** Clicking `+ ADD CHALLENGE` opens a bottom-sheet or modal called the Challenge Picker.

---

### 4.2 Challenge Picker (Modal)

A searchable grid of challenge types and pre-built templates. Inspired by the GFE75 challenge library.

```
┌──────────────────────────────────────────────────────────────┐
│  ADD_CHALLENGE                                                │
│  Search challenges...                              [×]        │
│  ─────────────────────────────────────────────────────────   │
│  CHALLENGE TYPES                                              │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐         │
│  │  CODE REVIEW  │ │  CODE IMPL   │ │  QUIZ: MCQ   │         │
│  │  Find bugs   │ │  Write code  │ │  Single choice│         │
│  └──────────────┘ └──────────────┘ └──────────────┘         │
│  ┌──────────────┐                                             │
│  │  SHORT ANSWER │                                            │
│  │  Free text   │                                             │
│  └──────────────┘                                             │
│  ─────────────────────────────────────────────────────────   │
│  BUILT-IN TEMPLATES (from challenge library)                  │
│  ┌──────────────────────────────────────────────────┐        │
│  │  🔒  JWT Auth Bug Hunt          CODE REVIEW  JS  │        │
│  │  ⚡  O(n²) Performance Audit    CODE REVIEW  TS  │        │
│  │  💉  SQL Injection Rewrite      CODE IMPL    JS  │        │
│  │  📝  Explain async/await        SHORT ANSWER     │        │
│  └──────────────────────────────────────────────────┘        │
└──────────────────────────────────────────────────────────────┘
```

Selecting a type opens the Challenge Editor pre-filled with defaults. Selecting a template pre-fills everything including the code artifact.

---

### 4.3 Challenge Editor

A full-page editor (or large modal) for configuring a challenge. Tabbed layout matching `question-detail-refactored.jsx`.

**Tabs:**
- `CHALLENGE` — type, title, instructions
- `CONTENT` — type-specific payload (code editor for CODE_REVIEW/CODE_IMPL, question + options for QUIZ)
- `SCORING` — ground truth / rubric / weights
- `PREVIEW` — what the candidate will see

**Code content tab (CODE_REVIEW):**

Left column: code editor (Monaco, read-only with syntax highlighting). Right column: ground truth bug list — line number, severity, explanation. The recruiter clicks a line in the code editor to add a ground truth bug, same UX as the candidate's annotation experience but inverted (recruiter is defining the answer key).

**Quiz content tab (QUIZ_MCQ):**

Question text input, then 4 option inputs (A/B/C/D), radio to mark the correct one. Optional explanation field.

---

### 4.4 Code Artifact Manager

A panel within the Challenge Editor (accessible from both CODE_REVIEW and CODE_IMPLEMENTATION challenges) that lets recruiters manage reusable code snippets.

When a challenge has `codeArtifactId` set, a banner appears at the top of the CONTENT tab: **"Linked to: AuthMiddleware v1 · [Unlink] [Edit Artifact]"**

The artifact manager shows all artifacts in the pipeline with their reference count:

```
CODE ARTIFACTS
┌──────────────────────────────────────────────────────┐
│  AuthMiddleware v1     JS     Referenced by 3 challenges│
│  processItems.ts       TS     Referenced by 2 challenges│
│  registerUser.js       JS     Referenced by 4 challenges│
└──────────────────────────────────────────────────────┘
[ + NEW ARTIFACT ]
```

---

### 4.5 Candidate Assessment Experience

The candidate experience is a linear progression through challenges inside a stage. The stage-level shell handles progress, timer, and navigation. The challenge content fills the main area.

**Stage shell:**

```
┌─────────────────────────────────────────────────────────────────┐
│  PIPE  ·  TECHNICAL SCREEN                      TIME: 32:14  ←  │
│  ──────────────────────────────────────────────────────────────  │
│  ○●○○   CHALLENGE 2 OF 4: "How would you fix the JWT issue?"     │
└─────────────────────────────────────────────────────────────────┘
│                                                                   │
│   [  Challenge content renders here  ]                            │
│                                                                   │
└───────────────────────────────────────────[ NEXT CHALLENGE → ]───┘
```

Progress dots at the top show all challenges in the stage. The current one is filled. Completed ones are checked.

**CODE_IMPLEMENTATION layout (split pane):**

```
┌────────────────────────┬───────────────────────────────────────┐
│  PROBLEM               │  EDITOR                               │
│  ──────────────────    │  ───────────────────────────────────  │
│  Rewrite this          │  javascript                           │
│  auth middleware       │  ┌────────────────────────────────┐  │
│  to properly           │  │  async function authMiddleware  │  │
│  verify JWT            │  │    (req, res, next) {           │  │
│  signatures.           │  │    // your code here            │  │
│                        │  │  }                              │  │
│  CONSTRAINTS           │  └────────────────────────────────┘  │
│  • Must use jsonwebtoken│                                       │
│  • Handle all error    │                                       │
│    cases               │                                       │
│                        │                                       │
│  LINKED CODE           │                                       │
│  [View Original →]     │                                       │
└────────────────────────┴───────────────────────────────────────┘
```

If the challenge has `codeArtifactId`, "View Original" opens a drawer showing the source code (the buggy version they reviewed in Challenge 1). This gives the candidate the context they need.

**CODE_REVIEW layout:**

Same as current `DiffReviewCanvas` — single column, diff viewer with annotation widgets. The only addition: if there are multiple CODE_REVIEW challenges in a sequence, the challenge title changes ("Now find the PERFORMANCE bugs" vs "Find the SECURITY bugs") but the code can be the same artifact.

---

### 4.6 Recruiter Review — Candidate Profile

After a candidate completes a stage, the recruiter sees results per challenge.

```
STAGE 1: TECHNICAL SCREEN
─────────────────────────────────────────────────────────
CHALLENGE 1: CODE REVIEW — "Find the bugs"
  Score: 72/100  ·  Found 2/3 bugs  ·  1 false positive
  [View annotations →]

CHALLENGE 2: SHORT ANSWER — "Explain the JWT fix"
  Awaiting score  ·  [Score now →]
  Response: "The issue is that we're parsing the JWT payload without..."

CHALLENGE 3: CODE IMPLEMENTATION — "Rewrite correctly"
  Awaiting score  ·  [Score now →]
  [View code →]

CHALLENGE 4: QUIZ MCQ — "JWT statements"
  Score: 100/100  ·  Correct
─────────────────────────────────────────────────────────
STAGE SCORE: 57/100 (partially scored)
```

---

## 5. Data Model Changes

### 5.1 What changes in Amplify schema

The `Stage` model needs a `challenges` relationship. `Challenge` is a new model. `CodeArtifact` is a new model. The `StageType` enum on `Stage` is removed — `Stage` no longer has a type.

```typescript
// amplify/data/resource.ts — changes

Stage: a.model({
  pipelineId: a.id().required(),
  pipeline: a.belongsTo('Pipeline', 'pipelineId'),
  name: a.string().required(),
  description: a.string(),
  order: a.integer().required(),
  timeLimit: a.integer(),          // Minutes. null = untimed.
  challenges: a.hasMany('Challenge', 'stageId'),
  // REMOVED: type: a.enum(['CODE_REVIEW', 'QUIZ'])
})

Challenge: a.model({
  stageId: a.id().required(),
  stage: a.belongsTo('Stage', 'stageId'),
  type: a.enum(['CODE_REVIEW', 'CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER', 'SYSTEM_DESIGN']).required(),
  order: a.integer().required(),
  title: a.string().required(),
  instructions: a.string(),
  config: a.json().required(),     // Typed payload per challenge type
  codeArtifactId: a.id(),
  codeArtifact: a.belongsTo('CodeArtifact', 'codeArtifactId'),
})

CodeArtifact: a.model({
  pipelineId: a.id().required(),
  pipeline: a.belongsTo('Pipeline', 'pipelineId'),
  title: a.string().required(),
  language: a.string().required(),
  code: a.string().required(),
  groundTruth: a.json(),           // Bug[] — server-side scoring key
})

// Assessment records submissions at the Challenge level (was Stage level)
Assessment: a.model({
  candidateId: a.id().required(),
  challengeId: a.id().required(),   // Changed from stageId
  challenge: a.belongsTo('Challenge', 'challengeId'),
  submission: a.json().required(),   // Type-specific submission payload
  score: a.float(),
  maxScore: a.float(),
  scoredAt: a.datetime(),
  reviewedByRecruiter: a.boolean().default(false),
})
```

### 5.2 What stays the same

- `Pipeline`, `Candidate` models — no changes
- `Assessment` authorization rules — guest-writable stays the same
- `apiKey` auth mode for candidate flow — stays the same
- `scoreCodeReview` scoring logic — stays the same, called at Challenge level

### 5.3 Migration from old model

The existing `Stage` records with `type = 'CODE_REVIEW'` and `config.snippets[]` need to be migrated. Each snippet in `Stage.config.snippets` becomes a `CodeArtifact` + a `Challenge` of type `CODE_REVIEW` pointing to that artifact. The migration is a one-time script: for each existing stage, create a challenge from its config.

---

## 6. Component Architecture

### 6.1 ChallengeRegistry (replacing StageRegistry)

The existing `StageRegistry.tsx` pattern is right. Rename it and expand it to `ChallengeRegistry`.

```typescript
// src/components/Assessment/ChallengeRegistry.tsx

type ChallengeDefinition = {
  Component: React.ComponentType<ChallengeRendererProps>;
  getInitialSubmission: (config: unknown) => unknown;
};

const Definitions: Record<ChallengeType, ChallengeDefinition> = {
  CODE_REVIEW: {
    Component: DiffReviewCanvas,
    getInitialSubmission: () => ({}),
  },
  CODE_IMPLEMENTATION: {
    Component: MonacoChallenge,
    getInitialSubmission: (config) => ({ code: config.starterCode || '' }),
  },
  QUIZ_MCQ: {
    Component: MCQChallenge,
    getInitialSubmission: () => ({ selectedOptionId: null }),
  },
  QUIZ_SHORT_ANSWER: {
    Component: ShortAnswerChallenge,
    getInitialSubmission: () => ({ text: '' }),
  },
};

export function ChallengeRegistry({ challenge, onSubmit }) {
  const definition = Definitions[challenge.type];
  const config = JSON.parse(challenge.config);
  const [submission, setSubmission] = useState(definition.getInitialSubmission(config));

  return (
    <definition.Component
      config={config}
      submission={submission}
      onSubmissionChange={setSubmission}
      onSubmit={() => onSubmit(submission)}
    />
  );
}
```

### 6.2 StagePage (replacing CandidateAssessmentPage)

The page that runs a stage iterates over `stage.challenges` in order. The stage shell renders the progress bar, timer, and navigation. `ChallengeRegistry` handles what's inside.

### 6.3 New components to build

| Component | Where | Notes |
|-----------|-------|-------|
| `MonacoChallenge` | `src/components/Assessment/CodeImpl/` | Split-pane: problem statement + Monaco editor |
| `MCQChallenge` | `src/components/Assessment/Quiz/` | Single-choice question |
| `ShortAnswerChallenge` | `src/components/Assessment/Quiz/` | Textarea + submit |
| `ChallengePicker` | `src/components/Pipeline/` | Modal for adding challenges to a stage |
| `ChallengeCard` | `src/components/Pipeline/` | Drag-and-drop tile in pipeline builder |
| `ChallengeEditor` | `src/pages/` | Tabbed editor: CHALLENGE, CONTENT, SCORING, PREVIEW |
| `CodeArtifactManager` | `src/components/Pipeline/` | Manage reusable code snippets |
| `StageShell` | `src/components/Assessment/` | Timer, progress dots, navigation wrapper |

### 6.4 Existing components to keep

| Component | Status |
|-----------|--------|
| `DiffReviewCanvas` | Keep as-is — used by CODE_REVIEW challenges |
| `diffUtils.ts` | Keep as-is |
| `scoreCodeReview` | Keep as-is — called at challenge submission |
| `LiquidMetalCard` | Keep — design system primitive |

---

## 7. The New Pipeline Builder UX

### 7.1 Stage creation flow

Today: create pipeline → one CODE_REVIEW stage is auto-created.

Target: create pipeline → land on builder with zero stages → click "ADD STAGE" → name it → it starts empty → add challenges to it.

The auto-seed of CODE_REVIEW stages (in `usePipelineCreate.ts`) is removed. Replacing it with a first-run empty state that guides the recruiter toward building their first stage.

### 7.2 Challenge library tab

The pipeline builder should have a second top-level tab: **CHALLENGE LIBRARY**. This is a flat list of all `CodeArtifact` and reusable challenge templates in the pipeline. Recruiters can manage their code snippets here, then link them into specific challenges.

```
PIPELINE BUILDER    [ STAGES ]  [ CHALLENGE LIBRARY ]

CHALLENGE LIBRARY
─────────────────────────────────────────────────────────
CODE ARTIFACTS
  AuthMiddleware.js       Used in 3 challenges     [Edit]
  processItems.ts         Used in 2 challenges     [Edit]
  registerUser.js         Used in 4 challenges     [Edit]

  [ + NEW ARTIFACT ]

SAVED TEMPLATES
  (No saved templates yet)
```

### 7.3 Drag and drop

Challenges within a stage should be reorderable via drag. Stages themselves should be reorderable. The existing `GripVertical` drag handle pattern from `screening-stage-builder.jsx` is the right visual — just needs to be wired to a drag library (`@dnd-kit/core` is the recommended Amplify-compatible option, or plain HTML5 drag-and-drop for MVP).

---

## 8. Visual Design — Challenge Tiles

The question card from `screening-stage-builder.jsx` (`QuestionCard` component) is the right visual model. Adapt it for challenges:

**Challenge tile anatomy:**

```
┌─────────────────────────────────────────────────────────────┐
│  ⠿  [ 01 ]  CODE_REVIEW  (blue)                    ✎  🗑   │
│             "Find the bugs in this auth function"             │
│             AuthMiddleware.js  ·  JS  ·  REQUIRED             │
└─────────────────────────────────────────────────────────────┘
```

**Type badge colors:**
- `CODE_REVIEW` → `rgba(96, 165, 250, 0.2)` / text `#60a5fa` (blue)
- `CODE_IMPLEMENTATION` → `rgba(167, 139, 250, 0.2)` / text `#a78bfa` (purple)
- `QUIZ_MCQ` → `rgba(74, 222, 128, 0.2)` / text `#4ade80` (green)
- `QUIZ_SHORT_ANSWER` → `rgba(251, 191, 36, 0.2)` / text `#fbbf24` (amber)
- `SYSTEM_DESIGN` → `rgba(249, 115, 22, 0.2)` / text `#f97316` (orange, future)

**Linked artifact indicator:** When `codeArtifactId` is set, show a small chain link icon with the artifact name. This is the visual cue that multiple challenges share context.

---

## 9. What Stays Deferred (Post-MVP)

These are explicitly out of scope until after the first real user is through the product:

| Feature | Why deferred |
|---------|--------------|
| Test runner / auto-grading for CODE_IMPLEMENTATION | Requires a sandboxed Lambda execution environment (significant infrastructure). Recruiter manual review works at MVP. |
| `SYSTEM_DESIGN` challenge type | Needs a diagramming canvas library evaluation. |
| AI challenge generation | `questionAgent` pattern is ready; the challenge library should eventually be AI-populated per job description. Defer until the manual flow is stable. |
| Timed per-challenge limits | Stage-level time limit is sufficient at MVP. Per-challenge timers add complexity with limited value. |
| Candidate video recording | Preserving the video recording UI from `screening-stage-builder.jsx` for later. |
| Answer key hidden from client | Currently `groundTruth` / `correctOptionId` is sent to the client. Post-MVP, scoring moves to Lambda. Flag this in code comments but don't block MVP on it. |

---

## 10. Implementation Phases

### Phase A — Data model (schema migration)

1. Add `Challenge` and `CodeArtifact` models to `amplify/data/resource.ts`
2. Remove `StageType` enum from `Stage`
3. Move `Assessment.stageId` → `Assessment.challengeId`
4. Run `npx ampx sandbox` to deploy schema changes
5. Write one-time migration script to convert existing Stage configs into Challenge records

**Estimated complexity:** Medium. The schema change is clean; the migration script touches existing data.

### Phase B — Pipeline builder UI

1. Build `ChallengeCard` tile component
2. Build `ChallengePicker` modal
3. Build `ChallengeEditor` tabbed page (CHALLENGE, CONTENT, SCORING)
4. Update `OverviewPage` to show challenges inside stage cards
5. Add `CodeArtifactManager` component
6. Remove auto-seed of CODE_REVIEW stage in `usePipelineCreate.ts`

**Estimated complexity:** High. Most new UI work.

### Phase C — Candidate experience

1. Build `StageShell` (timer, progress dots, navigation)
2. Build `ChallengeRegistry` (replaces `StageRegistry`)
3. Build `MonacoChallenge` (split-pane CODE_IMPLEMENTATION)
4. Build `MCQChallenge` and `ShortAnswerChallenge`
5. Update `CandidateAssessmentPage` to iterate `stage.challenges`
6. Update `useAssessment` hook for Challenge-level submissions

**Estimated complexity:** High. Needs `@monaco-editor/react` dependency.

### Phase D — Recruiter review

1. Update `CandidateProfilePage` to show per-challenge results
2. Add manual scoring interface for SHORT_ANSWER and CODE_IMPLEMENTATION
3. Roll up challenge scores to stage score
4. Roll up stage scores to overall candidate score

**Estimated complexity:** Medium.

---

## 11. What to Build First (MVP Priority)

If the goal is to get a real recruiter through a real hiring cycle as fast as possible, the minimum viable version of this architecture is:

1. **Keep Stage.** Don't change the Stage model yet. A stage still holds one challenge type for now.
2. **Introduce Challenge within the current CODE_REVIEW stage.** Instead of `Stage.config.snippets = [snippet1, snippet2, snippet3]`, create a `Challenge` per snippet. This gets the data model right without touching the builder UI.
3. **Build the builder UI for Challenges.** Replace the snippet list inside a CODE_REVIEW stage config with a proper challenge list. This is the highest-value UI change.
4. **Add CODE_IMPLEMENTATION.** A Monaco editor challenge — recruiter pastes problem text and starter code, candidate types code, recruiter reads it. No test runner needed.
5. **Add QUIZ_MCQ and QUIZ_SHORT_ANSWER** to replace the current `QUIZ` stage with proper per-question records.

This gives you a fully composable challenge system without a disruptive migration of the Stage model.

---

## 12. Immediate Next Actions (Before Writing Any Code)

In priority order:

1. Review this document with the founder. Confirm the data model direction before any schema changes.
2. Decide: migrate Stage model now, or introduce Challenge within the existing model first? (Recommendation: introduce Challenge within CODE_REVIEW stage first — lower risk.)
3. Fix the P0 bugs from the Phase 2 code review before adding new architecture:
   - Gate CLEAR_STAGES/SEED_STAGES behind `import.meta.env.DEV`
   - Fix avg score bug (query Assessment, not Candidate)
   - Switch ListingPage to selectionSet pattern
4. Draft the `Challenge` and `CodeArtifact` schema additions in isolation for review.
5. Build the `ChallengeCard` tile component in Storybook first — this is the key new UI primitive.
