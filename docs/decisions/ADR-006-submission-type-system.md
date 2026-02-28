# ADR-006: Discriminated Union for Challenge Submission Types

**Status:** Accepted
**Date:** 2026-02-27
**Deciders:** Jory (founder)

---

## Context

During the Phase 7 Composable Challenge System implementation (commits `44191ff`, `a3e1539`), the `ChallengeRegistry` component introduced significant type regressions. The `submission` state, callback signatures (`onSubmissionChange`, `onSubmit`), `config` prop, and related state updaters are all typed as `any`. The same regression exists in `pipelinePresets.ts` (`PresetChallenge.config: any`) and `PreviewPanel.tsx` (`template as any`).

This violates the project's core TypeScript strict mode / no-`any` policy. Beyond style, it has real consequences:

- No compile-time safety when reading submission fields (e.g., `submission.annotations` vs. `submission.selectedOptionId`) in `CandidateProfilePage`'s per-challenge preview
- No type enforcement on what gets stored in `Assessment.submission` (a JSON blob in DynamoDB)
- Breaks refactoring safety — if a submission field is renamed, TypeScript can't catch call sites

Step 5 (`CandidateProfilePage` per-challenge review) requires reading submission data typed by challenge type. Without a proper type, every read requires `as any` or unsafe property access.

---

## Decision

Define a **discriminated union** `ChallengeSubmission` keyed on `type` that matches the existing four challenge types. Use it everywhere a submission is created, stored, or read.

```typescript
// src/types/submission.ts

export type CodeReviewSubmission = {
  type: 'CODE_REVIEW';
  annotations: Array<{
    lineNumber: number;
    comment: string;
    severity?: 'bug' | 'style' | 'suggestion';
  }>;
};

export type CodeImplementationSubmission = {
  type: 'CODE_IMPLEMENTATION';
  code: string;
  language: string;
};

export type QuizMCQSubmission = {
  type: 'QUIZ_MCQ';
  selectedOptionId: string;
};

export type QuizShortAnswerSubmission = {
  type: 'QUIZ_SHORT_ANSWER';
  text: string;
};

export type ChallengeSubmission =
  | CodeReviewSubmission
  | CodeImplementationSubmission
  | QuizMCQSubmission
  | QuizShortAnswerSubmission;

// Type guard helpers
export function isCodeReviewSubmission(s: ChallengeSubmission): s is CodeReviewSubmission {
  return s.type === 'CODE_REVIEW';
}
export function isCodeImplementationSubmission(s: ChallengeSubmission): s is CodeImplementationSubmission {
  return s.type === 'CODE_IMPLEMENTATION';
}
export function isQuizMCQSubmission(s: ChallengeSubmission): s is QuizMCQSubmission {
  return s.type === 'QUIZ_MCQ';
}
export function isQuizShortAnswerSubmission(s: ChallengeSubmission): s is QuizShortAnswerSubmission {
  return s.type === 'QUIZ_SHORT_ANSWER';
}
```

**Storage contract:** `Assessment.submission` stores `JSON.stringify(ChallengeSubmission)`. On read, parse and narrow by `type`.

**Sites to update (Step 5 agent task):**

| File | Change |
|---|---|
| `src/components/Assessment/ChallengeRegistry.tsx` | `submission: ChallengeSubmission \| null`, typed state setters, typed callbacks |
| `src/hooks/useAssessment.ts` | `submission: ChallengeSubmission` in state; parse stored JSON through type guard on load |
| `src/pages/CandidateProfilePage.tsx` | Parse `Assessment.submission` via type guard before rendering preview |
| `src/lib/pipelinePresets.ts` | `PresetChallenge.config` — use `ChallengeTemplate['config']` or a proper `ChallengeConfig` union |
| `src/components/Panels/PreviewPanel.tsx` | Remove `template as any`; use `SandpackPredefinedTemplate` from `@codesandbox/sandpack-react` |

---

## Options Considered

### Option A: Discriminated union (chosen)

| Dimension | Assessment |
|---|---|
| Type safety | ✅ Full — TypeScript narrows by `type` field |
| Runtime cost | ✅ Zero — union is a compile-time construct |
| Storage impact | ✅ None — stored JSON is already keyed by type |
| Refactor scope | Medium — ~5 files need updating |
| Extensibility | ✅ Adding a new challenge type = adding a new union member |

**Pros:** Exhaustive switch checking; IDE autocomplete on submission fields; type-safe reads in `CandidateProfilePage` preview logic; aligns with how reducers and `resolveLayout` already use challenge type as a discriminant.

**Cons:** Requires Step 5 agent to update multiple files before other Step 5 work can proceed cleanly.

### Option B: Generic parameter `ChallengeRegistry<T extends ChallengeSubmission>`

Would require threading the generic through `useAssessment`, `CandidateAssessmentPage`, etc. Adds complexity with no meaningful benefit over the discriminated union at this scale. **Rejected.**

### Option C: `unknown` + runtime type guard per call site

Safer than `any` but noisier than the discriminated union — every read site needs its own guard. **Rejected** — the discriminated union centralizes the guard in one type definition.

---

## Trade-off Analysis

The discriminated union is a clear win at this project's scale. The only cost is the one-time refactor across 5 files. That cost is paid in Step 5 anyway (the per-challenge preview must read submission fields by type). The choice is whether to do it with `any` hacks or with proper types — proper types is always the right call, especially for a strict-mode TypeScript project.

---

## Consequences

- `npx tsc --noEmit` will pass cleanly in affected files after Step 5 (eliminating the `any`-induced blind spots)
- Adding a fifth challenge type in the future requires: (1) adding a new union member, (2) updating `resolveLayout`, (3) updating `resolveShells`, (4) adding a panel — all changes are traceable by the compiler
- `CandidateProfilePage` Step 5 preview logic can be written as an exhaustive switch with no unsafe casts
- The `Assessment.submission` JSON blob in DynamoDB does not change — only the TypeScript layer is added

---

## Action Items

1. [ ] Create `src/types/submission.ts` with the union and type guards (Step 5 agent, first task)
2. [ ] Update `ChallengeRegistry.tsx` to use `ChallengeSubmission | null` for submission state and callbacks
3. [ ] Update `useAssessment.ts` to parse `Assessment.submission` through the union on load
4. [ ] Update `CandidateProfilePage.tsx` Step 5 preview to narrow submission by type guard
5. [ ] Type `PresetChallenge.config` in `pipelinePresets.ts` using `ChallengeTemplate['config']`
6. [ ] Fix `template as any` in `PreviewPanel.tsx` using `SandpackPredefinedTemplate`
7. [ ] Run `npx tsc --noEmit` — confirm zero new errors
