# Monaco Challenge Architecture — Composable Challenge System

**Date:** 2026-02-27
**Status:** Draft — Ready for implementation
**Scope:** 3-panel Monaco challenge design + composable challenge shell architecture + code execution strategy

---

## 1. The Core Insight: Challenges Are Composed, Not Monolithic

Every challenge type can be decomposed into independent building blocks:

- **Shells** — outer wrappers that add behavioral capabilities (timer, screen recording, auto-save)
- **Panels** — content areas that fill the workspace (problem description, editor, preview, test results, annotations)

The challenge's `type` + `config` fields drive which shells and panels are assembled. This is **composition over specialization** — we never build a "MonacoChallenge with a timer" as a single component. We compose `<TimerShell>` + `<MonacoPanel>` from primitives.

### The Composition Model

```tsx
// How challenges assemble from shells and panels:
<TimerShell timeLimit={challenge.timeLimit}>          {/* ← shell: behavioral wrapper */}
  <RecordingShell enabled={challenge.config.recording}>  {/* ← shell: behavioral wrapper */}
    <WorkspaceLayout panels={resolvedPanels} />        {/* ← panels: content areas */}
  </RecordingShell>
</TimerShell>
```

The resolver maps a challenge's type + config → which shells and panels to use:

```
CODE_REVIEW              → [ProblemPanel] + [DiffAnnotationPanel]
CODE_IMPL/BUILD_COMPONENT → [ProblemPanel] + [MonacoPanel] + [PreviewPanel]
CODE_IMPL/WRITE_FUNCTION  → [ProblemPanel] + [MonacoPanel] + [TestPanel]
CODE_IMPL/REFACTOR       → [ProblemPanel] + [MonacoPanel] + [TestPanel + DiffPanel]
QUIZ_MCQ                 → [QuestionPanel] + [OptionsPanel]
QUIZ_SHORT_ANSWER        → [QuestionPanel] + [TextareaPanel]
```

Each of these can optionally be wrapped with `<TimerShell>`, `<RecordingShell>`, or any future shell — without touching the panel components.

---

## 2. Shell Components (Behavioral Wrappers)

Shells are pure wrappers. They add capability without modifying the content inside.

### 2.1 TimerShell

```tsx
// src/components/Shells/TimerShell.tsx
interface TimerShellProps {
  timeLimit: number | null;     // Minutes. null = untimed.
  onExpire?: () => void;        // Called when time runs out
  warningThreshold?: number;    // Seconds remaining to show warning (default: 90)
  children: ReactNode;
}

export function TimerShell({ timeLimit, onExpire, warningThreshold = 90, children }: TimerShellProps) {
  // Manages countdown state, fires onExpire, shows visual warning
  // Renders children + a timer display in the StageShell header slot
  // If timeLimit is null, renders children with no timer behavior
}
```

### 2.2 RecordingShell (post-MVP)

```tsx
// src/components/Shells/RecordingShell.tsx
interface RecordingShellProps {
  enabled: boolean;
  onComplete?: (recording: Blob) => void;
  children: ReactNode;
}

export function RecordingShell({ enabled, children }: RecordingShellProps) {
  // If not enabled, renders children as-is (no-op shell)
  // If enabled: starts screen capture, shows recording indicator
  // Captures via MediaDevices API, uploads to S3 on completion
}
```

### 2.3 AutoSaveShell (post-MVP)

```tsx
// src/components/Shells/AutoSaveShell.tsx
interface AutoSaveShellProps {
  interval?: number;    // Milliseconds between saves (default: 30000)
  onSave: (state: unknown) => Promise<void>;
  children: ReactNode;
}
```

### 2.4 Shell Composition

Shells stack from outer → inner. The challenge config resolves which shells apply:

```typescript
// src/lib/challenge/resolveShells.ts

export interface ResolvedShells {
  timer: { enabled: boolean; timeLimit: number | null };
  recording: { enabled: boolean };
  // Future shells added here
}

export function resolveShells(challenge: ChallengeWithConfig): ResolvedShells {
  return {
    timer: {
      enabled: !!challenge.stageTimeLimit || !!challenge.config.timeLimit,
      timeLimit: challenge.config.timeLimit ?? challenge.stageTimeLimit ?? null,
    },
    recording: {
      enabled: challenge.config.recording === true,
    },
  };
}
```

The assembly happens in `ChallengeRegistry`:

```tsx
// src/components/Assessment/ChallengeRegistry.tsx (updated)
export function ChallengeRegistry({ challenge, onSubmit }) {
  const shells = resolveShells(challenge);
  const layout = resolveLayout(challenge);       // → which panels

  let content = (
    <WorkspaceLayout
      leftPanel={layout.leftPanel}
      centerPanel={layout.centerPanel}
      rightPanel={layout.rightPanel}
    />
  );

  // Compose shells inside-out (innermost shell listed last)
  if (shells.recording.enabled) {
    content = <RecordingShell enabled>{content}</RecordingShell>;
  }
  if (shells.timer.enabled) {
    content = <TimerShell timeLimit={shells.timer.timeLimit}>{content}</TimerShell>;
  }

  return content;
}
```

---

## 3. Panel Components (Content Areas)

Panels are stateless display + interaction components. They receive their config via props and communicate up via callbacks.

### 3.1 ProblemPanel

```tsx
// src/components/Panels/ProblemPanel.tsx
interface ProblemPanelProps {
  markdown: string;          // Rendered as Markdown
  examples?: Example[];      // Input/output examples
  constraints?: string[];    // Bullet list of constraints
  linkedArtifact?: {
    label: string;           // "View original code →"
    code: string;
    language: string;
  };
}
```

Renders: problem description, examples, constraints. Optionally shows an expandable drawer with the linked code artifact (for REFACTOR_FUNCTION — "here's what you're improving").

### 3.2 MonacoPanel

```tsx
// src/components/Panels/MonacoPanel.tsx
interface MonacoPanelProps {
  language: string;
  starterCode: string;
  value: string;             // Controlled — current code state
  onChange: (code: string) => void;
  readOnly?: boolean;
  height?: string;           // '100%' by default
}
```

A thin wrapper around `@monaco-editor/react`. Handles: language selection, theme (dark, matching Pipe's `#0c0c0e` background), basic editor options.

### 3.3 PreviewPanel

```tsx
// src/components/Panels/PreviewPanel.tsx
interface PreviewPanelProps {
  code: string;              // The candidate's current code
  template: 'react' | 'html' | 'vanilla-js';
  dependencies?: Record<string, string>;  // npm packages to include
}
```

Implements Sandpack for live React/HTML preview. Rerenders on code change (debounced, 500ms). Shows a loading spinner during bundle compilation.

### 3.4 TestPanel

```tsx
// src/components/Panels/TestPanel.tsx
interface TestPanelProps {
  testCases: TestCase[];
  code: string;              // Current code to test
  language: string;
  onRunTests: (code: string) => Promise<TestResult[]>;
  showOriginalDiff?: { originalCode: string };  // REFACTOR_FUNCTION only
}

interface TestCase {
  id: string;
  description: string;
  isHidden?: boolean;        // Hidden test cases (post-MVP)
}

interface TestResult {
  testCaseId: string;
  status: 'pass' | 'fail' | 'error';
  output?: string;
  expected?: string;
  duration?: number;         // ms
}
```

Shows: "Run Tests" button → list of test case results (pass ✓ / fail ✗ / error ⚠) → summary (e.g. "3/5 tests passed"). For REFACTOR_FUNCTION, shows a diff toggle button revealing a Monaco diff view.

### 3.5 DiffAnnotationPanel (CODE_REVIEW)

This is the existing `DiffReviewCanvas`. The Panel pattern just wraps it with a consistent interface.

```tsx
// src/components/Panels/DiffAnnotationPanel.tsx — wraps DiffReviewCanvas
interface DiffAnnotationPanelProps {
  code: string;
  language: string;
  annotations: AnnotationMap;  // { lineNumber: Annotation[] }
  onAnnotationChange: (annotations: AnnotationMap) => void;
}
```

### 3.6 OptionsPanel (QUIZ_MCQ)

```tsx
// src/components/Panels/OptionsPanel.tsx
interface OptionsPanelProps {
  options: Array<{ id: string; text: string }>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  locked?: boolean;            // After submission
}
```

### 3.7 TextareaPanel (QUIZ_SHORT_ANSWER)

```tsx
// src/components/Panels/TextareaPanel.tsx
interface TextareaPanelProps {
  value: string;
  onChange: (text: string) => void;
  placeholder?: string;
  maxLength?: number;
  wordCount?: boolean;         // Show live word count
}
```

---

## 4. WorkspaceLayout — The Responsive Container

```tsx
// src/components/Assessment/WorkspaceLayout.tsx
interface WorkspaceLayoutProps {
  leftPanel: ReactNode | null;    // Problem description (ProblemPanel)
  centerPanel: ReactNode;         // Main interaction area
  rightPanel: ReactNode | null;   // Preview / tests / null
  layout?: '2-col' | '3-col' | '1-col';  // Defaults to 3-col if rightPanel set
}
```

The layout automatically adapts:
- `rightPanel !== null` → 3-column: 28% | 47% | 25%
- `rightPanel === null` → 2-column: 35% | 65%
- `leftPanel === null && rightPanel === null` → full-width center

On mobile (< 768px): vertically stacked, with tabs to switch between panels.

---

## 5. The Layout Resolver

Maps `challenge.type` + `challenge.config.subtype` → which panels to render:

```typescript
// src/lib/challenge/resolveLayout.ts

export type PanelType =
  | 'problem'
  | 'monaco'
  | 'preview'
  | 'tests'
  | 'diff-annotation'
  | 'options'
  | 'textarea';

export interface ResolvedLayout {
  leftPanel: PanelType | null;
  centerPanel: PanelType;
  rightPanel: PanelType | null;
}

export function resolveLayout(challenge: ChallengeWithConfig): ResolvedLayout {
  const config = parseConfig(challenge.config);

  switch (challenge.type) {
    case 'CODE_REVIEW':
      return {
        leftPanel: 'problem',         // Instructions (if any)
        centerPanel: 'diff-annotation', // The code diff + annotation
        rightPanel: null,
      };

    case 'CODE_IMPLEMENTATION': {
      const subtype = config.subtype ?? 'WRITE_FUNCTION';
      switch (subtype) {
        case 'BUILD_COMPONENT':
          return {
            leftPanel: 'problem',
            centerPanel: 'monaco',
            rightPanel: 'preview',    // Live Sandpack preview
          };
        case 'WRITE_FUNCTION':
          return {
            leftPanel: 'problem',
            centerPanel: 'monaco',
            rightPanel: 'tests',      // Piston test runner
          };
        case 'REFACTOR_FUNCTION':
          return {
            leftPanel: 'problem',
            centerPanel: 'monaco',
            rightPanel: 'tests',      // Tests + diff toggle
          };
        default:
          return {
            leftPanel: 'problem',
            centerPanel: 'monaco',
            rightPanel: null,         // No third panel — manual review
          };
      }
    }

    case 'QUIZ_MCQ':
      return {
        leftPanel: null,
        centerPanel: 'options',       // Full-width MCQ
        rightPanel: null,
      };

    case 'QUIZ_SHORT_ANSWER':
      return {
        leftPanel: null,
        centerPanel: 'textarea',      // Full-width textarea
        rightPanel: null,
      };

    default:
      return {
        leftPanel: 'problem',
        centerPanel: 'monaco',
        rightPanel: null,
      };
  }
}
```

---

## 6. Extended CodeImplementationConfig

Extends the existing config shape in `challengeLibrary.ts`:

```typescript
// Addition to src/content/challengeLibrary.ts

export type CodeImplementationSubtype =
  | 'BUILD_COMPONENT'    // Write React/HTML — shows live preview in right panel
  | 'WRITE_FUNCTION'     // Write a function — runs test cases in right panel
  | 'REFACTOR_FUNCTION'  // Improve existing code — tests + diff vs. original

export interface CodeImplementationConfig {
  // Existing fields (keep as-is)
  starterCode?: string;
  language: string;
  problemStatement: string;
  examples?: Array<{ input: string; output: string; explanation?: string }>;
  constraints?: string[];

  // New fields
  subtype?: CodeImplementationSubtype;   // Defaults to 'WRITE_FUNCTION' if absent

  // For WRITE_FUNCTION + REFACTOR_FUNCTION
  testCases?: ExecutableTestCase[];      // Runs via Piston API

  // For REFACTOR_FUNCTION
  originalCode?: string;                 // The "before" — shown in diff and problem panel

  // For BUILD_COMPONENT
  previewTemplate?: 'react' | 'html' | 'vanilla-js';   // Default: 'react'
  previewDependencies?: Record<string, string>;          // npm deps for Sandpack

  // Future: timers, recording (resolved via shells, not config)
}

export interface ExecutableTestCase {
  id: string;
  description: string;           // "Should return sum of array"
  // The test code injected around the candidate's submission:
  setupCode?: string;            // Code before candidate function (imports, fixtures)
  assertionCode: string;         // Assertion: e.g. "assert(add(1, 2) === 3)"
  isHidden?: boolean;            // Post-MVP: hide some test cases from candidate
}
```

---

## 7. Code Execution — Three Solutions

### 7.1 Sandpack (Recommended for BUILD_COMPONENT)

**What it is:** Browser-based JavaScript/TypeScript bundler and runtime from CodeSandbox. Runs entirely in the browser via a sandboxed iframe — no server required.

**Install:** `npm i @codesandbox/sandpack-react`

**How it works for BUILD_COMPONENT:**

```tsx
import { Sandpack } from '@codesandbox/sandpack-react';

function PreviewPanel({ code, template, dependencies }) {
  return (
    <Sandpack
      template={template}           // 'react', 'vanilla', 'static'
      files={{
        '/App.js': code,            // The candidate's current code
      }}
      customSetup={{
        dependencies: dependencies ?? {},
      }}
      options={{
        showConsole: true,
        showNavigator: false,
        autorun: true,
        recompileDelay: 500,       // Debounce re-render by 500ms
      }}
      theme="dark"
    />
  );
}
```

**Pros:**
- Zero infrastructure — runs 100% in browser
- Full npm support (React, Tailwind, any library)
- 200–500ms recompile time
- MIT licensed, free to use
- 20KB gzipped

**Cons:**
- Browser-only — can't run Python, Go, etc.
- Memory-intensive for complex projects
- Requires CDN access (fetches npm packages)

**Best for:** BUILD_COMPONENT challenges — React components, HTML pages, UI widgets.

---

### 7.2 Piston API (Recommended for WRITE_FUNCTION / REFACTOR_FUNCTION)

**What it is:** An open-source polyglot code execution engine. Free hosted endpoint at `https://emkc.org/api/v2/piston`, or self-hostable on AWS.

**How it works:**

```typescript
// src/lib/execution/pistonExecutor.ts

interface PistonRequest {
  language: string;
  version: string;            // e.g. '18.15.0' for Node.js
  files: Array<{ name: string; content: string }>;
  stdin?: string;
  run_timeout?: number;       // ms (default: 3000)
}

interface PistonResult {
  run: {
    stdout: string;
    stderr: string;
    code: number;             // Exit code (0 = success)
    signal: string | null;
  };
}

export async function executeCode(
  candidateCode: string,
  testCases: ExecutableTestCase[],
  language: string,
): Promise<TestResult[]> {
  // Wrap candidate code with test runner
  const testRunner = buildTestRunner(candidateCode, testCases, language);

  const response = await fetch('https://emkc.org/api/v2/piston/execute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      language: 'javascript',       // For MVP: JS only
      version: '18.15.0',
      files: [{ name: 'solution.js', content: testRunner }],
      run_timeout: 5000,
    } satisfies PistonRequest),
  });

  const result: PistonResult = await response.json();
  return parseTestOutput(result.run.stdout, testCases);
}

// Builds the full test harness wrapping the candidate's code
function buildTestRunner(
  candidateCode: string,
  testCases: ExecutableTestCase[],
  language: string,
): string {
  const assertions = testCases.map(tc => `
try {
  ${tc.setupCode ?? ''}
  ${tc.assertionCode}
  console.log('PASS:${tc.id}');
} catch(e) {
  console.log('FAIL:${tc.id}:' + e.message);
}
`).join('\n');

  return `
${candidateCode}

// ─── Test Runner ───────────────────────────────────────
${assertions}
`;
}
```

**The Lambda Proxy (recommended for production):**

Rather than calling Piston directly from the browser, route through an Amplify Lambda to hide rate limits, add retry logic, and prevent API key exposure:

```typescript
// amplify/functions/codeExecutor/handler.ts
export const handler = async (event) => {
  // Forward to Piston, add retry on rate limit, return results
  // Validate: code length < 50KB, no require('child_process'), etc.
};
```

Wire as an Amplify mutation:
```typescript
// amplify/data/resource.ts
executeCode: a
  .mutation()
  .arguments({ code: a.string().required(), language: a.string().required(), testCases: a.json().required() })
  .returns(a.json())
  .handler(a.handler.function('codeExecutor'))
  .authorization((allow) => [allow.publicApiKey()]),  // Candidates use apiKey auth
```

**Supported languages (relevant ones):**

| Language | Version |
|---|---|
| JavaScript | 18.15.0 |
| TypeScript | 5.0.3 |
| Python | 3.10.0 |
| Go | 1.16.2 |
| Rust | 1.50.0 |

**Pros:**
- 40+ languages supported
- Free hosted instance (rate limited to ~200 req/min)
- Self-hostable on AWS EC2/ECS for full control
- ~200–400ms execution time
- Simple REST API

**Cons:**
- Network round-trip (vs. Sandpack's in-browser)
- Public hosted instance has rate limits
- No persistent filesystem between runs

**Best for:** WRITE_FUNCTION and REFACTOR_FUNCTION challenges in any language.

---

### 7.3 WebContainers (StackBlitz) — Future Upgrade Path

**What it is:** Full Node.js runtime running in the browser via WebAssembly. Can run `npm install`, `npx vitest`, real test frameworks.

**Install:** `npm i @webcontainer/api`

**Key difference from Sandpack:** WebContainers runs actual Node.js processes. The candidate can run `import fs from 'fs'`, install npm packages, and execute real test suites with Jest/Vitest.

```typescript
import { WebContainer } from '@webcontainer/api';

const wc = await WebContainer.boot();
await wc.mount({
  'solution.js': { file: { contents: candidateCode } },
  'solution.test.js': { file: { contents: testFileContent } },
  'package.json': { file: { contents: JSON.stringify({
    dependencies: { vitest: '^1.0.0' }
  })}},
});

await wc.spawn('npm', ['install']);
const result = await wc.spawn('npx', ['vitest', 'run']);
```

**Pros:**
- Real Node.js — any npm package, any framework
- No server required — 100% browser
- Can run TypeScript natively via tsx
- Real test frameworks (Jest, Vitest, Mocha)

**Cons:**
- Requires COOP + COEP HTTP headers (`Cross-Origin-Opener-Policy: same-origin`)
- Chrome/Edge only (no Firefox/Safari as of 2026)
- Heavier than Sandpack (5–10s initial boot)
- StackBlitz subscription for private projects
- Complex to set up correctly

**Best for:** Post-MVP TypeScript challenges where you need real `npm test` with complex test setups.

---

## 8. MVP Code Execution Decision

| Challenge Subtype | MVP Solution | Rationale |
|---|---|---|
| BUILD_COMPONENT | Sandpack | Zero infra, live preview, React native |
| WRITE_FUNCTION | Piston API (direct, no Lambda) | Simple JS test runner, no infra needed |
| REFACTOR_FUNCTION | Piston API (direct, no Lambda) | Same as WRITE_FUNCTION + diff view |
| No subtype (default) | No execution | Manual recruiter review |

**Add Lambda proxy in Phase 2** (after first real users) to:
- Rate-limit per candidate
- Log all executions for audit
- Add TypeScript support via transpile-before-send
- Move to self-hosted Piston for reliability

---

## 9. The Full Component Map

```
src/
├── components/
│   ├── Shells/
│   │   ├── TimerShell.tsx          ← behavioral wrapper: countdown
│   │   ├── RecordingShell.tsx      ← behavioral wrapper: screen capture (post-MVP)
│   │   └── AutoSaveShell.tsx       ← behavioral wrapper: periodic save (post-MVP)
│   │
│   ├── Panels/
│   │   ├── ProblemPanel.tsx        ← left panel: markdown description + examples
│   │   ├── MonacoPanel.tsx         ← center panel: code editor
│   │   ├── PreviewPanel.tsx        ← right panel: Sandpack live preview
│   │   ├── TestPanel.tsx           ← right panel: Piston test results
│   │   ├── DiffAnnotationPanel.tsx ← center panel: wraps DiffReviewCanvas
│   │   ├── OptionsPanel.tsx        ← center panel: MCQ radio buttons
│   │   └── TextareaPanel.tsx       ← center panel: short answer textarea
│   │
│   └── Assessment/
│       ├── WorkspaceLayout.tsx     ← responsive 1/2/3-column layout
│       ├── ChallengeRegistry.tsx   ← assembles shells + panels from resolvers
│       ├── StageShell.tsx          ← existing: stage progress bar + navigation
│       └── CodeReview/
│           └── DiffReviewCanvas.tsx ← existing: keep as-is
│
├── lib/
│   ├── challenge/
│   │   ├── resolveLayout.ts        ← maps type+config → panels
│   │   └── resolveShells.ts        ← maps config → shell capabilities
│   └── execution/
│       └── pistonExecutor.ts       ← Piston API client
```

---

## 10. How the ChallengeRegistry Assembles Everything

```tsx
// src/components/Assessment/ChallengeRegistry.tsx (updated architecture)

export function ChallengeRegistry({ challenge, stageTimeLimit, onSubmit }) {
  const layout = resolveLayout(challenge);
  const shells = resolveShells(challenge, stageTimeLimit);
  const config = parseConfig(challenge.config);

  // Panel state — submission value flows up
  const [submission, setSubmission] = useState(getInitialSubmission(challenge.type, config));
  const [testResults, setTestResults] = useState<TestResult[]>([]);

  // Assemble the panel grid
  const workspace = (
    <WorkspaceLayout
      leftPanel={layout.leftPanel && (
        <ProblemPanel
          markdown={challenge.instructions ?? ''}
          examples={config.examples}
          constraints={config.constraints}
          linkedArtifact={config.originalCode ? {
            label: 'View original code',
            code: config.originalCode,
            language: config.language,
          } : undefined}
        />
      )}
      centerPanel={renderCenterPanel(layout.centerPanel, { config, submission, setSubmission })}
      rightPanel={layout.rightPanel && renderRightPanel(layout.rightPanel, {
        config,
        submission,
        testResults,
        onRunTests: async (code) => {
          const results = await executeCode(code, config.testCases ?? [], config.language);
          setTestResults(results);
          return results;
        },
      })}
    />
  );

  // Compose shells from outside in
  let composed: ReactNode = workspace;
  if (shells.recording.enabled) {
    composed = <RecordingShell enabled>{composed}</RecordingShell>;
  }
  if (shells.timer.enabled) {
    composed = (
      <TimerShell
        timeLimit={shells.timer.timeLimit}
        onExpire={() => onSubmit(submission)}  // Auto-submit when time runs out
      >
        {composed}
      </TimerShell>
    );
  }

  return (
    <div className="challenge-container">
      {composed}
      <footer className="challenge-footer">
        <button onClick={() => onSubmit(submission)} className="submit-btn">
          SUBMIT →
        </button>
      </footer>
    </div>
  );
}
```

---

## 11. Recruiter Configuration (ChallengeEditorPage)

The recruiter creates challenges through `ChallengeEditorPage`. For CODE_IMPLEMENTATION, they now see a subtype selector and relevant fields:

```
CHALLENGE EDITOR — CODE IMPLEMENTATION
────────────────────────────────────────────────────────

Subtype: [ Build a Component ▼ ] | [ Write a Function ] | [ Refactor a Function ]

Language: [ JavaScript ▼ ]

Problem Description (Markdown):
┌──────────────────────────────────────────────────────┐
│ Write a function that takes an array of numbers...   │
└──────────────────────────────────────────────────────┘

Starter Code (optional):
┌──────────────────────────────────────────────────────┐
│ function sum(numbers) {                              │
│   // your code here                                  │
│ }                                                    │
└──────────────────────────────────────────────────────┘

[WRITE_FUNCTION / REFACTOR_FUNCTION only]
Test Cases:
  ┌─────────────────────────────────────────────────┐
  │ Test 1: "Should sum empty array to 0"           │
  │ Assertion: assert(sum([]) === 0)                │
  └─────────────────────────────────────────────────┘
  [ + Add Test Case ]

[REFACTOR_FUNCTION only]
Original Code (what the candidate is improving):
┌──────────────────────────────────────────────────────┐
│ function sum(arr) {                                  │
│   let total = 0;                                     │
│   for(let i = 0; i <= arr.length; i++) { // off-by-1│
│     total += arr[i];                                 │
│   }                                                  │
│ }                                                    │
└──────────────────────────────────────────────────────┘

[BUILD_COMPONENT only]
Preview Template: [ React ▼ ] | [ HTML/CSS ] | [ Vanilla JS ]
npm Dependencies (optional): [ + Add package ]

PREVIEW (what the candidate sees):
[ Preview tab shows live 3-panel layout with current config ]
```

---

## 12. What to Build First (Implementation Order)

### Phase A — Foundations (no infrastructure needed)

1. Create `src/components/Shells/TimerShell.tsx` — counts down, fires `onExpire`
2. Create `src/lib/challenge/resolveLayout.ts` — the switch statement + types
3. Create `src/lib/challenge/resolveShells.ts` — maps config → shell capabilities
4. Create `src/components/Assessment/WorkspaceLayout.tsx` — responsive 3-panel grid
5. Create `src/components/Panels/ProblemPanel.tsx` — markdown renderer (use `react-markdown`)
6. Create `src/components/Panels/MonacoPanel.tsx` — Monaco editor wrapper
7. Create `src/components/Panels/OptionsPanel.tsx` — MCQ radio buttons
8. Create `src/components/Panels/TextareaPanel.tsx` — short answer textarea
9. Update `ChallengeRegistry.tsx` to use `resolveLayout` + `resolveShells` + `WorkspaceLayout`

This gets CODE_REVIEW, QUIZ_MCQ, QUIZ_SHORT_ANSWER, and CODE_IMPLEMENTATION (manual) all working with the composable system.

### Phase B — MonacoChallenge with Preview (Sandpack)

10. Install `@codesandbox/sandpack-react` and `@monaco-editor/react`
11. Create `src/components/Panels/PreviewPanel.tsx` — Sandpack integration
12. Extend `CodeImplementationConfig` with `subtype` + `previewTemplate` + `previewDependencies`
13. Update `resolveLayout` for BUILD_COMPONENT → rightPanel: 'preview'

### Phase C — Test Runner (Piston)

14. Create `src/lib/execution/pistonExecutor.ts` — Piston API client + test harness builder
15. Create `src/components/Panels/TestPanel.tsx` — test results display + Run button
16. Extend `CodeImplementationConfig` with `testCases: ExecutableTestCase[]`
17. Update `resolveLayout` for WRITE_FUNCTION / REFACTOR_FUNCTION → rightPanel: 'tests'
18. For REFACTOR_FUNCTION: add diff toggle to TestPanel using Monaco diff editor

### Phase D — Recruiter Editor Updates

19. Update `ChallengeEditorPage.tsx` — subtype selector, test case editor, original code field
20. Update `challengeLibrary.ts` CODE_IMPLEMENTATION templates with subtypes + test cases

### Phase E — Lambda Proxy (when traffic warrants it)

21. Create `amplify/functions/codeExecutor/` — Lambda proxy for Piston
22. Wire as Amplify mutation with publicApiKey auth
23. Update `pistonExecutor.ts` to route through Lambda instead of direct Piston

---

## 13. What to Defer

| Feature | Reason |
|---|---|
| `RecordingShell` (screen recording) | Needs S3 + MediaDevices API + privacy consent — post-MVP |
| `AutoSaveShell` (draft saving) | Adds state complexity — manual submit is sufficient at MVP |
| WebContainers | Requires COOP/COEP headers + browser setup — use Piston first |
| Hidden test cases | Anti-cheat feature — not needed at MVP |
| TypeScript compilation before Piston | Piston supports TS natively — handled server-side |
| Multi-file challenges | Single-file is sufficient for all MVP templates |
| Answer key server-side (security) | Currently `groundTruth`/`correctOptionId` exposed client-side — acceptable at MVP |

---

## 14. Dependencies to Install

```bash
npm i @monaco-editor/react          # Monaco editor component
npm i @codesandbox/sandpack-react   # Live preview (BUILD_COMPONENT)
npm i react-markdown                # Markdown rendering in ProblemPanel
npm i remark-gfm                    # GitHub-flavored markdown support
```

None of these require backend infrastructure for MVP.

---

## 15. ADR Required

This architecture introduces a significant compositional pattern. Before implementing, write:

`docs/decisions/ADR-005-composable-challenge-system.md`

Capturing:
- Decision: composition over specialization for challenge rendering
- Context: need to support timers, recording, multiple panel layouts
- Options considered: per-type components, plugin system, shell+panel composition
- Decision: shell+panel composition via resolveLayout + resolveShells
- Consequences: resolver functions become the single source of truth for challenge behavior
