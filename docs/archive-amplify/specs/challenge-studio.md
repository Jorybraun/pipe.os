# Technical Specification - Challenge Studio

**Date:** 2026-02-28
**Author:** Archer (Principal Architect)
**Handoff:** Devin (Staff Engineer)
**Status:** Draft

**Brief:** [docs/briefs/challenge-studio.md](../briefs/challenge-studio.md)

---

## Overview

Challenge Studio is a dedicated recruiter-side authoring environment for creating, previewing, and validating interview challenges. It replaces the minimal textareas in `ChallengeEditorPage` with a professional editor experience: Markdown for problem statements, Monaco for code, a test harness with live Piston API execution, and type-specific config panels (MCQ, short answer, code review, code implementation).

The Studio lives at `/studio` and `/studio/:challengeId` — a first-class route, not embedded in the pipeline builder. It uses the same composable Shell + Panel architecture (ADR-005) as the candidate-side `WorkspaceLayout`, but with a parallel `resolveEditorLayout()` function that maps challenge types to *editor panels* instead of *assessment panels*. Adding a new challenge type is a config change in both resolvers, not a component rewrite.

**Business problem solved:** Recruiters currently have no way to verify a challenge is correct before a candidate sees it. Test cases can't be executed, code can't be syntax-highlighted, and Markdown can't be previewed. The Studio closes that gap — if a test fails, the recruiter knows before they publish.

---

## System Architecture

### AWS Amplify Resources

| Resource | Type | Change | Description |
|----------|------|--------|-------------|
| `Challenge` model | Data | Schema migration | Add `stageId` optional, `status`, `isTemplate`, `isSystem`, `tags`, `difficulty`, `weight` |
| `CodeArtifact` model | Data | No change | Existing model; Studio may create new artifacts |
| Piston API | External REST | New (browser call) | `https://emkc.org/api/v2/piston/execute` — code execution for Test Editor |
| No new Lambda | Function | N/A | All Studio persistence is direct Amplify Data; no new Lambda for MVP |

### New Routes

| Route | Page | Auth |
|-------|------|------|
| `/studio` | `ChallengeStudioPage` (new challenge) | Cognito (recruiter) |
| `/studio/:challengeId` | `ChallengeStudioPage` (edit existing) | Cognito (recruiter) |
| `/challenges` | `ChallengeManagementPage` | Cognito (recruiter) |

### Component Hierarchy

```
src/
├── pages/
│   ├── ChallengeStudioPage.tsx           # CS-001 — /studio and /studio/:challengeId
│   └── ChallengeManagementPage.tsx       # CS-002 — /challenges (library browse)
│
├── components/
│   └── Studio/
│       ├── StudioShell.tsx               # CS-001 — outer layout + toolbar + tabs
│       ├── StudioToolbar.tsx             # Save, Discard, Preview toggle, Status badge
│       ├── ChallengeMetaPanel.tsx        # Title, type selector, status selector
│       │
│       └── panels/
│           ├── MarkdownEditorPanel.tsx   # CS-003 — Edit/Preview toggle, GFM
│           ├── CodeEditorPanel.tsx       # CS-004 — Monaco, language selector
│           ├── MCQEditorPanel.tsx        # CS-005 — question, 2–5 options, correct radio
│           ├── ShortAnswerEditorPanel.tsx # CS-006 — question, placeholder, rubric
│           ├── TestEditorPanel.tsx       # CS-007 — test cases, Run Tests, Piston results
│           └── ScoringRubricPanel.tsx    # CS-008 — weight slider, rubric text
│
├── hooks/
│   ├── useChallenge.ts                   # Load/save Challenge + CodeArtifact from Amplify
│   ├── usePistonExecutor.ts              # Piston API call, result parsing
│   └── useChallengeValidation.ts        # Per-type validation before save/promote
│
├── lib/
│   └── challenge/
│       ├── resolveLayout.ts              # Existing — candidate-side panel resolver
│       ├── resolveEditorLayout.ts        # NEW — editor-side panel resolver (CS-001)
│       ├── validateChallenge.ts          # Per-type validation logic
│       ├── pistonExecutor.ts             # Piston HTTP client
│       └── types.ts                     # All challenge config types (extend existing)
│
└── content/
    └── challengeLibrary.ts               # Existing static library (65 templates)
```

### Integration Points

- **`ChallengeRegistry`** (existing): Uses `resolveLayout` for candidates. Studio uses parallel `resolveEditorLayout`. Both live in `src/lib/challenge/`.
- **`ChallengePicker`** (existing): Reads from `challengeLibrary.ts` (static). After CS-010, it will also query DynamoDB for `isTemplate: true` records.
- **Pipeline Builder** (existing): "Edit in Studio →" button on `ChallengeCard` navigates to `/studio/:challengeId`.
- **`ChallengeEditorPage`** (existing): Remains functional as fallback during transition. Not deleted until Studio is verified.

---

## Data Model

### Schema Changes — `amplify/data/resource.ts`

**Current `Challenge` model (relevant fields):**
```typescript
Challenge: a.model({
  stageId: a.id().required(),   // BLOCKING — must become optional
  // ... existing fields
})
```

**Required additions to `Challenge`:**

```typescript
Challenge: a.model({
  // CHANGE: stageId becomes optional (template challenges have no stage)
  stageId: a.id(),             // was: a.id().required()
  stage: a.belongsTo('Stage', 'stageId'),

  // Existing fields — no change
  type: a.enum(['CODE_REVIEW', 'CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER']),
  order: a.integer(),
  title: a.string().required(),
  instructions: a.string(),
  config: a.json(),
  serverConfig: a.json(),
  codeArtifactId: a.id(),
  codeArtifact: a.belongsTo('CodeArtifact', 'codeArtifactId'),
  assessments: a.hasMany('Assessment', 'challengeId'),

  // NEW FIELDS (ADR-010 migration)
  status: a.enum(['draft', 'ready', 'archived']),         // lifecycle state
  isTemplate: a.boolean().default(false),                   // belongs to library
  isSystem: a.boolean().default(false),                     // read-only system seed
  tags: a.string().array(),                                 // search/filter tags
  difficulty: a.enum(['beginner', 'intermediate', 'advanced']),
  weight: a.integer().default(1),                           // 1–5 scoring weight
})
.authorization((allow) => [
  allow.owner(),
  allow.publicApiKey().to(['read']),
])
```

**No changes to `CodeArtifact`, `Stage`, `Assessment`, `Pipeline`.**

### TypeScript Config Types

These live in `src/lib/challenge/types.ts` (extend or replace the existing type definitions):

```typescript
// Challenge lifecycle
export type ChallengeStatus = 'draft' | 'ready' | 'archived';
export type ChallengeDifficulty = 'beginner' | 'intermediate' | 'advanced';
export type ChallengeWeight = 1 | 2 | 3 | 4 | 5;

// Supported languages for code editor
export type CodeLanguage = 'javascript' | 'typescript' | 'python' | 'go';

// CODE_REVIEW config (stored in Challenge.config)
export interface CodeReviewConfig {
  code: string;           // Required — the buggy code candidate annotates
  language: CodeLanguage;
  bugCount?: number;      // Optional hint
}

// CODE_IMPLEMENTATION config
export type CodeImplementationSubtype =
  | 'WRITE_FUNCTION'      // Piston execution
  | 'REFACTOR_FUNCTION'   // Piston execution
  | 'BUILD_COMPONENT';    // Sandpack (deferred)

export interface ExecutableTestCase {
  id: string;             // client-generated UUID
  description: string;
  setupCode?: string;     // runs before candidate function
  assertionCode: string;  // the assertion expression
  isVisible: boolean;     // post-MVP: hidden tests; MVP: always true
}

export interface CodeImplementationConfig {
  subtype: CodeImplementationSubtype;
  language: CodeLanguage;
  starterCode?: string;   // optional starter function signature
  solutionCode?: string;  // answer key (not sent to candidate — stored here for recruiter reference only)
  testCases: ExecutableTestCase[];
}

// QUIZ_MCQ config
export interface MCQOption {
  id: string;             // 'A' | 'B' | 'C' | 'D' | 'E'
  label: string;          // display text
}

export interface QuizMCQConfig {
  question: string;
  options: MCQOption[];   // min 2, max 5
  correctOptionId: string;
  explanation?: string;   // Markdown — recruiter only, never shown to candidate
}

// QUIZ_SHORT_ANSWER config
export interface QuizShortAnswerConfig {
  question: string;
  placeholder?: string;   // hint text for candidate
  maxLength?: number;     // 0 = unlimited
  rubric?: string;        // Markdown rubric — recruiter only
}

// Discriminated union for all configs
export type ChallengeConfig =
  | { type: 'CODE_REVIEW'; config: CodeReviewConfig }
  | { type: 'CODE_IMPLEMENTATION'; config: CodeImplementationConfig }
  | { type: 'QUIZ_MCQ'; config: QuizMCQConfig }
  | { type: 'QUIZ_SHORT_ANSWER'; config: QuizShortAnswerConfig };
```

### Authorization Strategy

| Model | Owner | publicApiKey | Notes |
|-------|-------|--------------|-------|
| `Challenge` | CRUD | Read | Owner = recruiter. Candidates read via publicApiKey (never sees `serverConfig`) |
| `CodeArtifact` | CRUD | Read | Same as Challenge; linked code artifacts |
| `Assessment` | CRUD | Create + Read | Candidate writes via publicApiKey; recruiter reads as owner |

**Answer key security (interim):** `serverConfig` on `Challenge` and `CodeArtifact` contains answer keys and test cases. Field-level auth is NOT yet enforced (ADR-007 Proposed). For MVP, the Studio clearly labels these fields as "Answer Key — not shown to candidate." Server-side enforcement via `scoringAgent` is post-MVP.

### Indexes and Query Patterns

| Query Pattern | Index | Fields | Use Case |
|---------------|-------|--------|----------|
| List templates by recruiter | GSI (auto) | owner + isTemplate | `ChallengeManagementPage` |
| List challenges by stage | GSI (auto) | stageId | Pipeline builder stage editor |
| List by type and difficulty | Client filter | type + difficulty | Library browse filter |
| List system templates | Client filter | isSystem | Seed data display |

---

## API Design

### `resolveEditorLayout(type)` — New Function

```typescript
// src/lib/challenge/resolveEditorLayout.ts

export type EditorPanel =
  | 'MarkdownEditorPanel'
  | 'CodeEditorPanel'
  | 'TestEditorPanel'
  | 'MCQEditorPanel'
  | 'ShortAnswerEditorPanel'
  | 'ScoringRubricPanel';

export interface EditorLayout {
  leftPanels: EditorPanel[];   // Primary left column (problem statement + type-specific)
  rightPanels: EditorPanel[];  // Right column (code/test editor)
  bottomPanels: EditorPanel[]; // Always: ScoringRubricPanel
}

export function resolveEditorLayout(type: ChallengeType): EditorLayout {
  switch (type) {
    case 'CODE_REVIEW':
      return {
        leftPanels: ['MarkdownEditorPanel'],
        rightPanels: ['CodeEditorPanel'],
        bottomPanels: ['ScoringRubricPanel'],
      };
    case 'CODE_IMPLEMENTATION':
      return {
        leftPanels: ['MarkdownEditorPanel'],
        rightPanels: ['CodeEditorPanel', 'TestEditorPanel'],
        bottomPanels: ['ScoringRubricPanel'],
      };
    case 'QUIZ_MCQ':
      return {
        leftPanels: ['MarkdownEditorPanel', 'MCQEditorPanel'],
        rightPanels: [],
        bottomPanels: ['ScoringRubricPanel'],
      };
    case 'QUIZ_SHORT_ANSWER':
      return {
        leftPanels: ['MarkdownEditorPanel', 'ShortAnswerEditorPanel'],
        rightPanels: [],
        bottomPanels: ['ScoringRubricPanel'],
      };
  }
}
```

### Amplify Data Queries

| Query | Description | Auth | Used In |
|-------|-------------|------|---------|
| `Challenge.get({ id })` | Load challenge for editing | Owner | `ChallengeStudioPage` |
| `Challenge.list({ filter: { isTemplate: { eq: true } } })` | Library templates | Owner | `ChallengeManagementPage` |
| `Challenge.list({ filter: { stageId: { eq: id } } })` | Stage challenges | Owner | Pipeline builder |
| `CodeArtifact.get({ id })` | Load linked code artifact | Owner | `ChallengeStudioPage` |

### Amplify Data Mutations

| Mutation | Description | Auth | Used In |
|----------|-------------|------|---------|
| `Challenge.create(...)` | Create new challenge or template | Owner | Studio save |
| `Challenge.update({ id, ...fields })` | Update challenge config | Owner | Studio save |
| `Challenge.update({ id, isTemplate: true, stageId: null })` | Promote to template | Owner | CS-010 |
| `Challenge.update({ id, status: 'ready' })` | Mark as ready | Owner | Studio publish |
| `CodeArtifact.create(...)` | Create linked code artifact | Owner | Studio — code types |
| `CodeArtifact.update({ id, code })` | Update artifact code | Owner | Studio save |

### Piston API — `pistonExecutor.ts`

```typescript
// src/lib/challenge/pistonExecutor.ts

const PISTON_URL = 'https://emkc.org/api/v2/piston/execute';

// Language runtime mapping
const PISTON_RUNTIMES: Record<CodeLanguage, { language: string; version: string }> = {
  javascript: { language: 'javascript', version: '18.15.0' },
  typescript: { language: 'typescript', version: '5.0.3' },
  python:     { language: 'python', version: '3.10.0' },
  go:         { language: 'go', version: '1.16.2' },
};

export interface PistonTestResult {
  testCaseId: string;
  passed: boolean;
  output: string;
  error?: string;
}

export interface PistonRunRequest {
  language: CodeLanguage;
  code: string;            // setupCode + candidateCode + assertionCode, composed by executor
  testCases: ExecutableTestCase[];
}

export async function runTestsViaPiston(
  req: PistonRunRequest
): Promise<PistonTestResult[]>;
```

**Test harness composition:** For each test case, the executor builds:
```
{setupCode ?? ''}
{candidateCode}    // starterCode in the editor — proves assertions syntax-valid
// --- Test assertion ---
try {
  {assertionCode}
  console.log('PASS:{testCaseId}')
} catch(e) {
  console.log('FAIL:{testCaseId}:' + e.message)
}
```

Results are parsed from stdout by matching `PASS:` and `FAIL:` prefixes.

### `useChallenge` Hook Interface

```typescript
// src/hooks/useChallenge.ts

export interface UseChallengeResult {
  challenge: ChallengeWithConfig | null;
  isLoading: boolean;
  isSaving: boolean;
  isDirty: boolean;
  error: Error | null;
  // Mutations
  updateField: (field: keyof ChallengeWithConfig, value: unknown) => void;
  updateConfig: (config: ChallengeConfig) => void;
  save: () => Promise<void>;
  discard: () => void;
  publish: () => Promise<void>;   // validates then sets status: 'ready'
  saveAsTemplate: () => Promise<void>;  // CS-010
}

export function useChallenge(challengeId?: string): UseChallengeResult;
```

### `usePistonExecutor` Hook Interface

```typescript
// src/hooks/usePistonExecutor.ts

export interface UsePistonExecutorResult {
  isRunning: boolean;
  results: PistonTestResult[];
  lastRunAt: Date | null;
  error: Error | null;
  runTests: (req: PistonRunRequest) => Promise<void>;
}

export function usePistonExecutor(): UsePistonExecutorResult;
```

---

## Validation Rules — `validateChallenge.ts`

These are enforced before any `status: 'ready'` transition. The UI surfaces errors inline per field/test case.

```typescript
export type ValidationResult =
  | { valid: true }
  | { valid: false; errors: ValidationError[] };

export interface ValidationError {
  field: string;           // which panel/field failed
  message: string;
  testCaseId?: string;     // for test case errors
}

export function validateChallenge(
  challenge: ChallengeWithConfig
): ValidationResult;
```

**Per-type validation matrix:**

| Rule | CODE_REVIEW | CODE_IMPLEMENTATION | QUIZ_MCQ | QUIZ_SHORT_ANSWER |
|------|------------|---------------------|----------|-------------------|
| `title` non-empty | ✓ | ✓ | ✓ | ✓ |
| `type` set | ✓ | ✓ | ✓ | ✓ |
| `config.code` non-empty | ✓ | — | — | — |
| `config.language` set | ✓ | ✓ | — | — |
| `config.question` non-empty | — | — | ✓ | ✓ |
| ≥2 options | — | — | ✓ | — |
| Exactly 1 correct option | — | — | ✓ | — |
| No syntax error in test assertionCode | — | ✓ (if tests exist) | — | — |

---

## StudioShell Layout Spec (CS-001)

The Studio uses a **two-column layout** (not the 3-column WorkspaceLayout — editor panels are wider):

```
┌─────────────────────────────────────────────────────┐
│  StudioToolbar:  [Title Field] [Type] [Status]       │
│                  [Save] [Discard] [Preview ▶]        │
├────────────────────────┬────────────────────────────┤
│  Left panels:          │  Right panels:              │
│  MarkdownEditorPanel   │  CodeEditorPanel            │
│  (+ type-specific)     │  TestEditorPanel            │
├────────────────────────┴────────────────────────────┤
│  ScoringRubricPanel (full width, collapsible)        │
└─────────────────────────────────────────────────────┘
```

**Preview mode** (CS-009): Toggles to render the full candidate-side `WorkspaceLayout` with `challenge.config` injected as mock data. Uses `ChallengeRegistry` exactly as the candidate path does — no duplication.

---

## Security Considerations

### Authentication
- Challenge Studio routes (`/studio`, `/studio/:challengeId`, `/challenges`) are recruiter-only — wrapped in the existing `<Authenticator>` boundary
- No new auth configuration required

### Authorization
- All Challenge CRUD uses `allow.owner()` — recruiters only create and edit their own challenges
- `isSystem: true` challenges: client checks this flag and disables all edit actions; the "Edit" button becomes "Fork". Owner-level write protection is not enforceable at schema level without groups — for MVP, the UI blocks it; post-MVP, an `admins` group would be the system seed author
- `publicApiKey().to(['read'])` is preserved on `Challenge` so candidates can read challenge config during assessments

### Data Protection
- `solutionCode` and `rubric` are stored in `Challenge.config` for MVP (not in `serverConfig` for now — ADR-007 is deferred). These are labeled in the UI as "Recruiter only — not visible to candidates" but are technically readable by a sophisticated candidate who inspects API responses. This is a known interim risk documented in ADR-007.
- `serverConfig` remains on the model for future server-side ground truth enforcement
- Piston API calls are browser-originated: they execute recruiter-authored test code, not candidate code. No PII is sent to Piston.

### Input Validation
- All config objects validated against the per-type schema in `validateChallenge()` before save
- `title` max length: 200 characters (client enforced)
- `instructions` max length: 50,000 characters (Markdown)
- Test case `assertionCode` max length: 2,000 characters per test
- Max 20 test cases per challenge (client enforced)

---

## Testing Plan

### Unit Tests (Vitest)

**`resolveEditorLayout.ts`**
- Returns correct panel sets for each of the 4 challenge types
- Never returns `TestEditorPanel` for non-CODE_IMPLEMENTATION types
- Always includes `ScoringRubricPanel` in `bottomPanels`

**`validateChallenge.ts`**
- Returns `valid: true` for a fully populated CODE_REVIEW challenge
- Returns error when `config.code` is empty for CODE_REVIEW
- Returns error when MCQ has < 2 options
- Returns error when MCQ has no correct option marked
- Returns `valid: true` for QUIZ_SHORT_ANSWER with only a question (no rubric required)
- Returns multiple errors when multiple fields fail

**`pistonExecutor.ts`**
- Correctly constructs test harness string for each language
- Parses `PASS:id` and `FAIL:id:message` from stdout
- Returns error result when Piston returns non-200 status

**`useChallenge` hook**
- `isDirty` becomes true after `updateField`
- `discard()` resets to original fetched values
- `save()` calls `Challenge.update` with correct payload
- `publish()` calls `validateChallenge` before updating status; does not save if validation fails
- Loading state: `isLoading: true` while fetching, `false` after

**Scoring rollup (stage score)**
- Weighted average excludes challenges with `score: null` (not treated as 0)
- `weight: 3` challenge contributes 3x more than `weight: 1` challenge
- Stage is "fully scored" only when all challenge scores are non-null

### Component Tests (Storybook)

**`MarkdownEditorPanel`**
- Default story: Edit mode, empty content
- With content: Populated markdown
- Preview mode: Renders GFM headings, bold, code blocks, lists
- Toggle: Clicking "Preview" switches mode; clicking "Edit" returns to textarea

**`MCQEditorPanel`**
- Default story: 2 empty options, no correct selected
- With data: 4 options, option B selected as correct
- Validation error state: "Select a correct answer" warning visible
- Add option button: Disabled at 5 options
- Remove option button: Disabled at 2 options

**`TestEditorPanel`**
- Default story: Empty test list, "Add Test Case" button
- With test cases: 3 test cases rendered
- Running state: Spinner visible when `isRunning: true`
- Results state: Pass/fail badges per test case after run

**`ScoringRubricPanel`**
- Default story: Weight = 1 slider, auto-scoring note visible
- Manual scoring type: Shows rubric textarea

### E2E Tests (Playwright)

**Studio — Create CODE_IMPLEMENTATION challenge**
- Navigate to `/studio` (no ID)
- Set title, select type `CODE_IMPLEMENTATION`
- Write instructions in Markdown panel
- Select language `javascript`, write starter code
- Add 2 test cases with valid assertions
- Click "Run Tests" — assert at least one result appears
- Click "Save" — assert redirected to `/studio/:id`
- Navigate to `/challenges` — assert challenge appears in list

**Studio — MCQ cannot be published without correct option**
- Create QUIZ_MCQ challenge with 2 options, no correct selected
- Click "Publish" / mark as ready
- Assert validation error visible: "Select a correct answer"
- Select correct option
- Click "Publish" again — assert status badge shows "ready"

**Studio — Preview mode**
- Open existing CODE_REVIEW challenge in Studio
- Click "Preview" toggle
- Assert `WorkspaceLayout` renders (3-column grid visible)
- Assert back button returns to editor mode

---

## Performance Budgets

| Metric | Target | Notes |
|--------|--------|-------|
| Studio initial load | < 3.5s LCP | Monaco is lazy-loaded; shell appears first |
| Monaco editor mount | < 1.5s from panel mount | Lazy import with Suspense fallback |
| Piston API round trip | < 5s (P95) | Network-dependent; show spinner immediately |
| Challenge save (Amplify mutation) | < 1s | Show optimistic save state |
| `ChallengeManagementPage` list load | < 2s | Paginate at 20 items; skeleton loading |
| Initial JS bundle delta | < +30KB gzipped | Monaco loaded on demand, not in initial chunk |

### Code Splitting Requirements

```typescript
// Monaco must be lazy-loaded — it's 3MB+ uncompressed
const MonacoEditor = lazy(() => import('@monaco-editor/react'));

// Studio pages lazy-loaded at route level
const ChallengeStudioPage = lazy(() => import('./pages/ChallengeStudioPage'));
const ChallengeManagementPage = lazy(() => import('./pages/ChallengeManagementPage'));
```

---

## Observability

### Logging

```typescript
// useChallenge.ts
console.log('[useChallenge] Loaded challenge', { challengeId, type });
console.error('[useChallenge] Save failed', { challengeId, error: err.message });

// usePistonExecutor.ts
console.log('[Piston] Running tests', { language, testCount: req.testCases.length });
console.warn('[Piston] API error', { status, body });
console.error('[Piston] Network failure', { error: err.message });

// validateChallenge.ts
// No logging — pure function; errors surfaced to UI
```

### Error Tracking
- Studio errors are caught by the existing `ErrorBoundary` at the route level
- Piston failures are non-fatal — surface inline in `TestEditorPanel`, do not crash Studio
- Amplify save failures surface inline in `StudioToolbar` ("Save failed — retry")

---

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| `stageId` migration breaks existing Challenge records | High | Low | Schema change is additive (optional field); existing `required()` records continue to work. Run `npx tsc --noEmit` after migration. |
| Piston API rate limits hit by power users | Medium | Low | Piston free tier: 100 req/min per IP. Debounce "Run Tests" button (1s). Lambda proxy is the post-MVP solution (already planned). |
| Monaco bundle size blows initial JS budget | High | Medium | Strict lazy import via `React.lazy` at the panel level. Verify with `npm run build` bundle analysis before shipping. |
| `isSystem: true` system challenges edited by recruiter (UI only gate) | Medium | Low | UI disables all edit actions. Owner-level DB protection via Cognito groups is post-MVP. Acceptable for solo-recruiter MVP. |
| Answer keys readable by API-savvy candidates | Medium | High | Known interim risk (ADR-007 Proposed). Labeled clearly in Studio UI. Post-MVP scoringAgent Lambda enforces server-side separation. |
| `resolveEditorLayout` diverges from `resolveLayout` over time | Low | Medium | Both functions live in `src/lib/challenge/`. Co-locate in same module. Document contract in JSDoc. |

---

## Rollout Plan

### Phase 1 — Schema Migration (prerequisite, CS-000)
1. Modify `amplify/data/resource.ts`: make `Challenge.stageId` optional; add `status`, `isTemplate`, `isSystem`, `tags`, `difficulty`, `weight`
2. Run `npx ampx sandbox` to deploy schema to dev sandbox
3. Run `npx tsc --noEmit` — must pass
4. Run purge script if needed: `npx tsx scripts/purgeTestData.ts`

### Phase 2 — Foundation (CS-001 + CS-002, Week 1)
1. Add `/studio` and `/studio/:challengeId` routes to `App.tsx`
2. Build `StudioShell`, `StudioToolbar`, `ChallengeMetaPanel`
3. Implement `resolveEditorLayout`
4. Implement `useChallenge` hook (load/save/publish/discard)
5. Build `ChallengeManagementPage` with list + search + filter

### Phase 3 — Editor Panels (CS-003 through CS-006, Week 2)
1. `MarkdownEditorPanel` — Edit/Preview toggle, GFM via `react-markdown`
2. `CodeEditorPanel` — Monaco lazy-loaded, language selector
3. `MCQEditorPanel` — option builder, correct radio, explanation
4. `ShortAnswerEditorPanel` — question, placeholder, rubric

### Phase 4 — Test Editor + Piston (CS-007, Week 3)
1. `pistonExecutor.ts` — Piston HTTP client + test harness composition
2. `usePistonExecutor` hook
3. `TestEditorPanel` — add/edit/remove test cases, Run Tests button, per-case results
4. Wire `validateChallenge` to block "Publish" when test assertions have syntax errors

### Phase 5 — Scoring + Preview + Templates (CS-008 through CS-010, Week 4)
1. `ScoringRubricPanel` — weight slider, per-type rubric fields
2. Preview mode toggle — mount `WorkspaceLayout` with mock data
3. "Save as Template" flow — `challenge.saveAsTemplate()` mutation
4. Update `ChallengePicker` to query DynamoDB templates in addition to static library

### Verification
- `npx tsc --noEmit` passes
- `npm run lint` passes
- All new Storybook stories render without errors
- At least 1 Playwright E2E green for happy path Studio flow
- `CHANGELOG.md` updated under `[Unreleased]`
- ADR-012 written (Challenge Studio editor architecture)

---

## Agent Impact Analysis

### Architectural Pattern Changes

- **New pattern: `resolveEditorLayout(type)`** — parallel resolver to `resolveLayout(type)`. Both live in `src/lib/challenge/`. Future agent edits to challenge types must update *both* resolvers.
- **Challenge template/instance duality** — a `Challenge` without `stageId` is now a valid state (library template). Agents querying challenges must handle `stageId?: string | null`.
- **Piston API integration** — browser-originated code execution. No Lambda required. `pistonExecutor.ts` is the single point of change if the executor changes (Lambda proxy post-MVP).

### New Dependencies or Integrations

- `@monaco-editor/react` — Monaco code editor (check if already in `package.json`)
- `react-markdown` + `remark-gfm` — Markdown rendering in `MarkdownEditorPanel`
- Piston API — external, no API key required for free tier, browser-callable
- No new AWS services

### Required Agent Updates

#### Agent Personas
- **@architect**: Be aware of `resolveEditorLayout` alongside `resolveLayout`. Update challenge type additions to touch both.
- **@developer**: All Studio components go in `src/components/Studio/`. Hooks in `src/hooks/`. Types in `src/lib/challenge/types.ts`.
- **@qa**: Test Editor results are async — use `waitFor` / proper async patterns in tests.
- **@product-owner**: No changes needed.

#### Agent Rules
- **`architecture.md`**: Note that `src/components/Studio/` is the new directory for all recruiter-side authoring components.
- **`database.md`**: `Challenge.stageId` is now optional. `isTemplate: true` records are library entries; `stageId` set = pipeline instance.

**Summary**: The Studio introduces a parallel editor resolver pattern and a new `src/components/Studio/` component tree. Any future challenge type additions must update both `resolveLayout` and `resolveEditorLayout`.
