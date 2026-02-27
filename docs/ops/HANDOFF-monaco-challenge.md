# Handoff: Monaco Challenge — Composable Challenge System

**Date:** 2026-02-27
**Assigned to:** Gemini (or next agent)
**Tracked in:** `TASKS.md` → Phase 7 Step 4 / Composable Challenge System
**Full design:** `docs/design/monaco-challenge-architecture.md` — **READ THIS FIRST**
**Estimated time:** ~6–8 hours (Phases A + B) / ~4 hours additional (Phase C)
**Status:** Ready to execute — design complete, no open decisions.

---

## Context

Phase 7 Step 4 is partially done. `StageShell`, `ChallengeRegistry`, `useAssessment`, and `CandidateAssessmentPage` are all built. What's missing is the actual challenge renderer components.

The design has evolved beyond the original plan. Rather than building three separate monolithic components (`MonacoChallenge`, `MCQChallenge`, `ShortAnswerChallenge`), we're building a **composable shell + panel system** that works for all challenge types. This is the architecture described in `docs/design/monaco-challenge-architecture.md`.

> ⚠️ **KEY NAMING NOTE**
>
> `ChallengeTemplate` appears in two places:
> - `src/content/challengeLibrary.ts` — TypeScript interface. **DO NOT TOUCH.**
> - `amplify/data/resource.ts` — Amplify DynamoDB model. **REMOVE THIS** (see Data Cleanup handoff).
>
> These are unrelated. Always check which one you're touching.

---

## ⚠️ Pre-conditions

Before starting, confirm:
1. Data Cleanup has been run (see `docs/ops/HANDOFF-data-cleanup.md`)
2. `npx tsc --noEmit` passes with no new errors (2 pre-existing in `useRoleDiscovery.ts` are OK)
3. `@monaco-editor/react` and `@codesandbox/sandpack-react` are NOT yet installed (you're installing them)

---

## Step 1 — Install Dependencies

```bash
cd /path/to/pipe-os
npm i @monaco-editor/react @codesandbox/sandpack-react react-markdown remark-gfm
```

Verify installs don't break tsc:

```bash
npx tsc --noEmit
```

If new errors appear, they'll be type definition issues. Resolve them before continuing.

---

## Step 2 — Write the ADR

Before any code, write the architectural decision record:

Create `docs/decisions/ADR-005-composable-challenge-system.md` by copying `ADR-000-template.md`.

Content summary:
- **Status:** Accepted
- **Context:** Need to add MonacoChallenge + quiz renderers. Also need future support for TimerShell, RecordingShell without coupling to challenge types.
- **Decision:** Shell + Panel composition pattern. Challenges are assembled dynamically from `resolveLayout()` + `resolveShells()` rather than built as monolithic type-specific components.
- **Consequences:** `ChallengeRegistry` becomes an assembler; resolver functions become the single source of truth.

Add to `docs/decisions/README.md` index.

---

## Step 3 — Create the Resolver Functions

### 3A — `src/lib/challenge/resolveLayout.ts`

Create this file exactly as specified in `docs/design/monaco-challenge-architecture.md` Section 5.

This function maps `challenge.type + config.subtype` → `{ leftPanel, centerPanel, rightPanel }`.

### 3B — `src/lib/challenge/resolveShells.ts`

Create as specified in Section 2.4 of the design doc.

This function maps `challenge.config` → `{ timer, recording }` capabilities.

### Type check:

```bash
npx tsc --noEmit
```

Zero new errors before proceeding.

---

## Step 4 — Build Foundation Shells

### 4A — `src/components/Shells/TimerShell.tsx`

Interface (from design doc Section 2.1):

```typescript
interface TimerShellProps {
  timeLimit: number | null;   // Minutes. null = untimed (renders children directly).
  onExpire?: () => void;
  warningThreshold?: number;  // Seconds remaining for yellow warning. Default: 90.
  children: ReactNode;
}
```

Implementation notes:
- If `timeLimit` is null, render `children` directly with no behavior (no-op)
- Display in `StageShell`'s header area — use a context or pass via prop drilling
- At `warningThreshold` seconds remaining, change the timer text to amber/yellow
- At 0, call `onExpire()` and show a "Time's up" banner

---

## Step 5 — Build Panel Components (Phase A)

Build these in order. They are independent of each other.

### 5A — `src/components/Assessment/WorkspaceLayout.tsx`

```typescript
interface WorkspaceLayoutProps {
  leftPanel: ReactNode | null;
  centerPanel: ReactNode;
  rightPanel: ReactNode | null;
}
```

CSS layout: CSS Grid with `grid-template-columns`. When `rightPanel` is set: `28% auto 25%`. When no `rightPanel`: `35% auto`. When no `leftPanel` and no `rightPanel`: `100%`.

Dark background matching `#0c0c0e`, full-height layout (fills the `StageShell` content area).

### 5B — `src/components/Panels/ProblemPanel.tsx`

Uses `react-markdown` + `remark-gfm` to render `markdown` prop.

```typescript
interface ProblemPanelProps {
  markdown: string;
  examples?: Array<{ input: string; output: string; explanation?: string }>;
  constraints?: string[];
  linkedArtifact?: { label: string; code: string; language: string };
}
```

Render order: markdown → examples section (if present) → constraints section (if present) → linked artifact button (if present, expands a code drawer).

Styling: left panel has a subtle border-right, slightly lighter background than editor area. Scrollable vertically.

### 5C — `src/components/Panels/MonacoPanel.tsx`

Thin wrapper around `@monaco-editor/react`:

```typescript
import Editor from '@monaco-editor/react';

interface MonacoPanelProps {
  language: string;
  value: string;
  onChange: (code: string) => void;
  readOnly?: boolean;
  height?: string;
}
```

Options:
- `theme: 'vs-dark'` (dark background, close to `#0c0c0e`)
- `fontSize: 14`
- `minimap: { enabled: false }` (minimap wastes space in challenge context)
- `scrollBeyondLastLine: false`
- `wordWrap: 'on'` for non-code panels (off for editor)
- `lineNumbers: 'on'`

### 5D — `src/components/Panels/OptionsPanel.tsx`

```typescript
interface OptionsPanelProps {
  question: string;          // The MCQ question text
  options: Array<{ id: string; text: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  locked?: boolean;          // After submission
}
```

Styling: full-width centered layout (no left/right panels for QUIZ_MCQ). Question text in large type. Option cards are full-width buttons with radio-style selection. Selected state: accent border. Locked state: disabled pointer events, shows selection.

### 5E — `src/components/Panels/TextareaPanel.tsx`

```typescript
interface TextareaPanelProps {
  question: string;
  placeholder?: string;
  maxLength?: number;
  value: string;
  onChange: (text: string) => void;
}
```

Shows question text above a large textarea. If `maxLength`, show `N / maxLength` character counter below.

---

## Step 6 — Update ChallengeRegistry

Replace the current `ChallengeRegistry.tsx` implementation with the composable architecture.

**Current state (simplified):** A static switch statement that returns a hardcoded component per type.

**Target state:** Uses `resolveLayout()` + `resolveShells()` to assemble `WorkspaceLayout` with the right panels, then wraps with applicable shells.

Key reference: `docs/design/monaco-challenge-architecture.md` Section 10 for the full component code.

The interface between `ChallengeRegistry` and `CandidateAssessmentPage` must stay the same:

```typescript
// This interface does NOT change
interface ChallengeRegistryProps {
  challenge: StageWithChallenges['challenges'][number];
  onSubmit: (submission: StageSubmission) => Promise<void>;
}
```

After updating, run:

```bash
npx tsc --noEmit
```

Zero new errors.

---

## Step 7 — Smoke Test Phase A

Before adding Sandpack or Piston, manually test the existing challenge types work through the new composable system:

1. Start local dev server: `npm run dev`
2. Log in as recruiter → create a pipeline with DEFAULT preset (has CODE_REVIEW challenges)
3. Copy candidate invite link → open in incognito/new profile
4. Verify: CODE_REVIEW renders correctly with `DiffAnnotationPanel` (wrapping `DiffReviewCanvas`)
5. Verify: If you have QUIZ_MCQ challenges, verify they render correctly with `OptionsPanel`
6. Submit a challenge → verify `Assessment` record created in DynamoDB via AWS Console

If any of these fail, fix before proceeding to Phase B.

---

## Step 8 — Add PreviewPanel with Sandpack (Phase B)

### 8A — `src/components/Panels/PreviewPanel.tsx`

```typescript
import { Sandpack } from '@codesandbox/sandpack-react';
import '@codesandbox/sandpack-react/dist/index.css';

interface PreviewPanelProps {
  code: string;
  template: 'react' | 'html' | 'vanilla-js';
  dependencies?: Record<string, string>;
}

export function PreviewPanel({ code, template, dependencies }: PreviewPanelProps) {
  return (
    <Sandpack
      template={template === 'vanilla-js' ? 'vanilla' : template}
      files={{ '/App.js': code }}
      customSetup={{ dependencies: dependencies ?? {} }}
      options={{
        showConsole: true,
        showNavigator: false,
        autorun: true,
        recompileDelay: 500,
        editorHeight: 0,       // Hide Sandpack's own editor — we use Monaco
        showTabs: false,
      }}
      theme="dark"
    />
  );
}
```

> **Important:** Set `editorHeight: 0` or use `SandpackPreview` (not `Sandpack`) so that Sandpack only shows the preview panel, not its built-in editor. Our Monaco editor is in the center panel.

### 8B — Extend `CodeImplementationConfig`

In `src/content/challengeLibrary.ts`, add to the existing `CodeImplementationConfig` interface:

```typescript
// ADD to existing CodeImplementationConfig interface:
subtype?: CodeImplementationSubtype;
testCases?: ExecutableTestCase[];
originalCode?: string;
previewTemplate?: 'react' | 'html' | 'vanilla-js';
previewDependencies?: Record<string, string>;
```

Add the new types above the interface:

```typescript
export type CodeImplementationSubtype =
  | 'BUILD_COMPONENT'
  | 'WRITE_FUNCTION'
  | 'REFACTOR_FUNCTION';

export interface ExecutableTestCase {
  id: string;
  description: string;
  setupCode?: string;
  assertionCode: string;
  isHidden?: boolean;
}
```

### 8C — Update `resolveLayout` for BUILD_COMPONENT

The resolver should now return `rightPanel: 'preview'` when `config.subtype === 'BUILD_COMPONENT'`.

### 8D — Type check:

```bash
npx tsc --noEmit
```

---

## Step 9 — Add TestPanel with Piston (Phase C)

### 9A — `src/lib/execution/pistonExecutor.ts`

```typescript
const PISTON_URL = 'https://emkc.org/api/v2/piston/execute';

export interface TestResult {
  testCaseId: string;
  status: 'pass' | 'fail' | 'error';
  output?: string;
  duration?: number;
}

export async function executeWithPiston(
  candidateCode: string,
  testCases: ExecutableTestCase[],
  language: string,
): Promise<TestResult[]> {
  const harness = buildHarness(candidateCode, testCases);

  const response = await fetch(PISTON_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: language === 'typescript' ? 'javascript' : language,
      version: '*',
      files: [{ name: 'solution.js', content: harness }],
      run_timeout: 5000,
    }),
  });

  if (!response.ok) {
    throw new Error(`[pistonExecutor] HTTP ${response.status}`);
  }

  const result = await response.json() as { run: { stdout: string; stderr: string; code: number } };
  return parseResults(result.run.stdout, testCases);
}

function buildHarness(code: string, testCases: ExecutableTestCase[]): string {
  const assertions = testCases.map(tc => `
try {
  ${tc.setupCode ?? ''}
  ${tc.assertionCode}
  process.stdout.write('PASS:${tc.id}\\n');
} catch(e) {
  process.stdout.write('FAIL:${tc.id}:' + e.message + '\\n');
}
`).join('');

  return `${code}\n// tests\n${assertions}`;
}

function parseResults(stdout: string, testCases: ExecutableTestCase[]): TestResult[] {
  const lines = stdout.split('\n').filter(Boolean);
  return testCases.map(tc => {
    const line = lines.find(l => l.includes(':' + tc.id));
    if (!line) return { testCaseId: tc.id, status: 'error', output: 'No output' };
    if (line.startsWith('PASS:')) return { testCaseId: tc.id, status: 'pass' };
    return { testCaseId: tc.id, status: 'fail', output: line.replace(`FAIL:${tc.id}:`, '') };
  });
}
```

### 9B — `src/components/Panels/TestPanel.tsx`

```typescript
interface TestPanelProps {
  testCases: ExecutableTestCase[];
  code: string;
  language: string;
  originalCode?: string;    // For REFACTOR_FUNCTION diff toggle
}
```

UI layout:
1. "RUN TESTS" button (calls `executeWithPiston`, shows spinner while running)
2. Result list: each test case shows description + PASS ✓ / FAIL ✗ / ERROR ⚠
3. Summary: "3 / 5 tests passed"
4. For REFACTOR_FUNCTION: "SHOW DIFF" toggle button — opens Monaco diff editor showing `originalCode` vs. current `code`

### 9C — Update resolveLayout for WRITE_FUNCTION / REFACTOR_FUNCTION

Add `rightPanel: 'tests'` cases and pass `originalCode` to `TestPanel` when present.

---

## Step 10 — Update CHANGELOG.md

```markdown
### Added
- Composable challenge shell + panel system (`resolveLayout`, `resolveShells`, `WorkspaceLayout`, `TimerShell`)
- `ProblemPanel` — Markdown problem description with examples and constraints
- `MonacoPanel` — Monaco editor wrapper (`@monaco-editor/react`)
- `OptionsPanel` — MCQ radio-style options renderer
- `TextareaPanel` — Short answer textarea renderer
- `PreviewPanel` — Sandpack live preview for BUILD_COMPONENT challenges (`@codesandbox/sandpack-react`)
- `TestPanel` — Piston API test runner for WRITE_FUNCTION / REFACTOR_FUNCTION
- `CodeImplementationSubtype` + `ExecutableTestCase` types in `challengeLibrary.ts`
- `src/lib/execution/pistonExecutor.ts` — Piston API client
- ADR-005: Composable challenge system

### Changed
- `ChallengeRegistry.tsx` — refactored from static switch to dynamic shell+panel assembly
- `CodeImplementationConfig` — extended with `subtype`, `testCases`, `originalCode`, `previewTemplate`
```

---

## Step 11 — Run Final Verification

```bash
npx tsc --noEmit
```

Must pass with zero new errors (2 pre-existing in `useRoleDiscovery.ts` are still OK).

```bash
npm run dev
```

Manual test checklist:
- [ ] CODE_REVIEW challenge renders (diff view + annotations)
- [ ] QUIZ_MCQ challenge renders (question + options, submission works)
- [ ] QUIZ_SHORT_ANSWER challenge renders (textarea, submission works)
- [ ] CODE_IMPLEMENTATION (no subtype) renders: ProblemPanel + MonacoPanel, submit captures code
- [ ] CODE_IMPLEMENTATION (BUILD_COMPONENT) renders: ProblemPanel + MonacoPanel + PreviewPanel
- [ ] CODE_IMPLEMENTATION (WRITE_FUNCTION) renders: ProblemPanel + MonacoPanel + TestPanel
- [ ] "Run Tests" button calls Piston and shows results
- [ ] All challenge types submit Assessment records correctly

---

## Do Not Touch

| What | Why |
|---|---|
| `src/content/challengeLibrary.ts` ChallengeTemplate **interface** | Static template library — keep exactly as-is |
| `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` | Core CODE_REVIEW renderer — wrap in DiffAnnotationPanel, do not modify |
| `src/lib/scoring/codeReview.ts` + `quiz.ts` | Ground-truth scorers — keep as-is |
| `src/hooks/useRoleDiscovery.ts` | Post-MVP hook — 2 pre-existing tsc errors are acceptable |
| `Challenge.config` field in schema | Actively used — do not remove |

---

## Verification Checklist

Before marking Phase 7 Step 4 complete:

- [ ] `npm i @monaco-editor/react @codesandbox/sandpack-react react-markdown remark-gfm` installed
- [ ] ADR-005 written and added to `docs/decisions/README.md`
- [ ] `resolveLayout.ts` and `resolveShells.ts` created
- [ ] `TimerShell.tsx` built (null-safe when timeLimit is null)
- [ ] `WorkspaceLayout.tsx` built (responsive 3-panel grid)
- [ ] `ProblemPanel.tsx` built (react-markdown)
- [ ] `MonacoPanel.tsx` built (Monaco wrapper)
- [ ] `OptionsPanel.tsx` built (MCQ)
- [ ] `TextareaPanel.tsx` built (short answer)
- [ ] `ChallengeRegistry.tsx` updated to composable architecture
- [ ] Existing challenge types (CODE_REVIEW, QUIZ_MCQ, QUIZ_SHORT_ANSWER) still work
- [ ] `PreviewPanel.tsx` built (Sandpack)
- [ ] `TestPanel.tsx` built (Piston)
- [ ] `pistonExecutor.ts` built
- [ ] `CodeImplementationConfig` extended with subtype + testCases + originalCode
- [ ] `npx tsc --noEmit` passes with zero new errors
- [ ] Manual smoke test: all 4 challenge types render and submit correctly
- [ ] `CHANGELOG.md` updated
