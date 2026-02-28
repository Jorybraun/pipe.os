# Phase 7 Code Review — Challenge Architecture (gemini-work branch)

**Date:** 2026-02-27
**Branch:** `gemini-work`
**Reviewer:** Claude
**Status:** Do not merge. P0 bugs must be resolved first.

---

## Summary

The `gemini-work` branch contains Phase 6 bug fixes and a large portion of Phase 7 (Steps 1–4) in a single uncommitted changeset. The architecture direction is correct — `Challenge` and `CodeArtifact` models are well-designed, `StageShell` and `ChallengeRegistry` are solid new components, and the migration script logic is sound. However, three P0 bugs will break the production candidate flow the moment this is deployed. Do not commit or pipeline-deploy until those are resolved.

---

## What Was Done

### Phase 6 fixes (partial)
- Dev buttons (CLEAR_STAGES, SEED_MVP_STAGES) correctly gated behind `import.meta.env.DEV`
- `@ts-ignore` in `DiffReviewCanvas.tsx` replaced with `Hunk as any` cast — isolated and cleaner
- N+2 query in `OverviewPage` fixed via `selectionSet` (though now reads the wrong field — see P0 #2)
- `CandidateProfilePage` — `candidate` and `assessments` state now use Schema types
- Stage score now correctly averages across challenge assessments instead of reading from the wrong model

### Phase 7 — Schema (Step 1)
- `Challenge` model added: `stageId`, `type`, `order`, `title`, `instructions`, `config`, `codeArtifactId`
- `CodeArtifact` model added: `pipelineId`, `title`, `language`, `code`, `groundTruth`
- `Pipeline` updated: `creationMode` enum (`BLANK | PRESET | AI_DRIVEN`)
- `Stage` updated: `type` kept for backward compat (deprecated), `challenges hasMany` added
- `Assessment` updated: `challengeId` FK added alongside existing `stageId`
- Migration script written: `scripts/migrateStageConfigToChallenges.ts`

### Phase 7 — Pipeline creation (Step 2)
- `src/lib/pipelinePresets.ts` — DEFAULT and BLANK presets backed by `codeReviewSnippets.ts` and `quizQuestions.ts`
- `usePipelineCreate.ts` — auto-seed removed, `creationMode` wired (with a type issue — see P0 #3)

### Phase 7 — Builder UI (Step 3)
- `src/components/Pipeline/ChallengeCard.tsx` — challenge summary card
- `src/components/Pipeline/ChallengePicker.tsx` — modal for selecting challenge type
- `src/pages/ChallengeEditorPage.tsx` — editor for challenge title, instructions, content, scoring
- `src/pages/StageDetailPage.tsx` — stage detail view
- `OverviewPage.tsx` — redesigned to flat Kanban with per-stage column + ADD_STAGE button

### Phase 7 — Candidate experience (Step 4)
- `src/components/Assessment/StageShell.tsx` — progress bar, sticky header/footer, timer, breadcrumb dots
- `src/components/Assessment/ChallengeRegistry.tsx` — replaces `StageRegistry`, routes `ChallengeType` to renderer
- `useAssessment.ts` — challenge-level loading via `selectionSet`, `currentChallengeIndex` state, `submitChallenge`
- `CandidateAssessmentPage.tsx` — wired to `StageShell` + `ChallengeRenderer`

---

## Bugs — Must Fix Before Committing

### 🔴 P0-1: Schema FK conflict breaks Assessment writes and Kanban

**File:** `amplify/data/resource.ts`

The `Stage` model declares:
```typescript
assessments: a.hasMany('Assessment', 'stageId'),
```
The `Challenge` model declares:
```typescript
assessments: a.hasMany('Assessment', 'challengeId'),
```

New assessments written by the Phase 7 candidate flow only set `challengeId`. The Stage's `hasMany` relationship via `stageId` will always return empty for these new records. This is what powers the Kanban grouping in `OverviewPage` — it will break silently.

**Decision required:** Choose one of:
- **Option A (cleaner):** Remove `Stage.assessments hasMany` entirely. Stages no longer directly own assessments — they're owned by Challenges. Update Kanban to traverse Stage → Challenges → Assessments.
- **Option B (backward compat):** On every Assessment write, populate both `stageId` (derived from `challenge.stageId`) AND `challengeId`. This keeps the Stage hasMany working but adds a join step on every write.

Option A is the right long-term architecture.

---

### 🔴 P0-2: Kanban candidate placement reads the wrong field

**File:** `src/pages/OverviewPage.tsx`, line 538

```typescript
// BROKEN: stageId is null on Phase 7 assessments
const completedStageIds = new Set((c.assessments || []).map((a: any) => a.stageId));
```

The selectionSet on the Candidate query fetches `assessments.stageId`, but Phase 7 assessments set `challengeId` not `stageId`. All candidates will appear stuck in Stage 0.

**Fix:** After resolving P0-1, update this to map `assessments.challengeId` → stage via the loaded challenge list. The selectionSet on the Stage query already loads `challenges.id`, so the mapping is available.

---

### 🔴 P0-3: `usePipelineCreate` bypasses type system on Pipeline create

**File:** `src/hooks/usePipelineCreate.ts`, line 63

```typescript
} as any);
```

The Pipeline create call is cast with `as any` because `creationMode` isn't being accepted by the generated type. This indicates a mismatch between the schema definition and the generated `ClientSchema` — likely the sandbox hasn't been re-run since `creationMode` was added. Fix: run `npx ampx sandbox` first, then remove the cast. The type should resolve cleanly.

---

## Bugs — Fix Before Next Deploy

### 🟡 P1-1: `handleAddStage` not behind DEV guard

**File:** `src/pages/OverviewPage.tsx`, line 790

The ADD_STAGE button in the Kanban column is visible to all users. Clicking it creates an empty `Stage` record with `order = stages.length` and no `name`, `type`, or challenges. Until the Stage builder UI is complete and connected, this button should either be hidden in production or replaced with a modal that at minimum sets a stage name.

---

### 🟡 P1-2: `useAssessment` lost non-fatal try/catch on status update

**File:** `src/hooks/useAssessment.ts`

```typescript
// Before (intentionally non-fatal):
try {
  await client.models.Candidate.update({ id: candidate.id, status: 'IN_PROGRESS' });
} catch (updateErr) {
  console.warn('[useAssessment] Status update failed (non-fatal):', updateErr);
  // continue anyway
}

// After (fatal — will throw to outer catch and show error screen):
await client.models.Candidate.update({ id: candidate.id, status: 'IN_PROGRESS' });
```

If the status update fails (network hiccup, permission issue), the candidate now sees a hard error screen instead of their assessment. Restore the non-fatal try/catch.

---

### 🟡 P1-3: `stages: any[]` type regression in `useAssessment`

**File:** `src/hooks/useAssessment.ts`, line 29

```typescript
stages: any[]; // regressed from typed to any
```

The stage list now includes nested challenges from the selectionSet, which doesn't match `Schema['Stage']['type']` exactly. Define a local interface:

```typescript
interface StageWithChallenges {
  id: string;
  order: number | null;
  challenges: {
    id: string;
    type: string | null;
    title: string;
    instructions: string | null;
    config: unknown;
    order: number | null;
    codeArtifact: {
      id: string;
      code: string | null;
      language: string | null;
      title: string | null;
      groundTruth: unknown;
    } | null;
  }[];
}
```

---

### 🟡 P1-4: Migration script wrong import path

**File:** `scripts/migrateStageConfigToChallenges.ts`, line 2

```typescript
// Wrong:
import type { Schema } from '../src/amplify/data/resource';

// Correct:
import type { Schema } from '../amplify/data/resource';
```

Will fail at runtime. Two-minute fix.

---

## Code Quality Issues

### 🔵 P2-1: Inline component in `ChallengeRegistry` causes unmount/remount

**File:** `src/components/Assessment/ChallengeRegistry.tsx`

The `QUIZ_SHORT_ANSWER` resolver returns a new anonymous component on every call:
```typescript
resolve: (_, onDataChange) => {
  return {
    Component: ({ onSubmissionChange }: any) => ( // ← new function every time
      <div>...</div>
    ),
```

React will unmount and remount this component on every render cycle because the reference changes. Extract it as a named component at module scope:

```typescript
function ShortAnswerInput({ onSubmissionChange }: { onSubmissionChange: (data: unknown) => void }) {
  return <div>...</div>;
}
```

---

### 🔵 P2-2: Timer in `StageShell` resets if `timeLimit` prop changes

**File:** `src/components/Assessment/StageShell.tsx`

```typescript
useEffect(() => {
  if (!timeLimit) return;
  const timer = setInterval(...)
  return () => clearInterval(timer);
}, [timeLimit]); // resets countdown whenever timeLimit changes
```

Store the initial value in a ref on mount to make the timer stable:

```typescript
const initialTimeLimit = useRef(timeLimit);
useEffect(() => {
  if (!initialTimeLimit.current) return;
  // ...
}, []); // run once
```

---

### 🔵 P2-3: Timing hacks for DynamoDB eventual consistency

**File:** `src/pages/OverviewPage.tsx`

```typescript
await new Promise(resolve => setTimeout(resolve, 500)); // after clear stages
await new Promise(resolve => setTimeout(resolve, 800)); // after seed stages
```

These are fragile. 500ms may not be enough under load. Add inline comments explaining why they exist, and consider a retry-with-backoff utility if this pattern spreads.

---

### 🔵 P2-4: `canAdvance` is always true for CODE_REVIEW in CandidateAssessmentPage

**File:** `src/pages/CandidateAssessmentPage.tsx`

```typescript
canAdvance={!!currentSubmission || currentChallenge.type === 'CODE_REVIEW'}
```

Candidates can click Next on a code review without annotating a single line. The original design required at least one annotation. Either change this to `currentSubmission !== null && Object.keys(currentSubmission).length > 0`, or document the intentional UX change.

---

## What's Good

- **Architecture direction is correct.** Stage as container, Challenge as atomic unit, CodeArtifact as shared code carrier — this is the right model.
- **`StageShell` is solid.** Progress bar, sticky header/footer, timer with warning state, breadcrumb dots — well-structured and matches the design system conventions.
- **`ChallengeRegistry` IoC pattern** correctly extends `StageRegistry`'s approach and adds backward compatibility via config JSON fallback — good engineering.
- **Migration script logic is sound.** The strategy of CodeArtifact per snippet → Challenge per artifact handles the one-to-many case correctly.
- **Assessment schema has both `stageId` and `challengeId`** — this backward-compatibility approach is the right call for a live app.
- **`DiffReviewCanvas` @ts-ignore cleanly replaced** with a properly scoped `as any` cast.
- **Stage score calculation in `CandidateProfilePage`** now correctly averages across challenge assessments — this is the HAS-36 fix done right.
- **`CandidateProfilePage` candidate/assessment state** now uses `Schema['Candidate']['type']` — the type safety improvement landed.

---

## Recommended Fix Order

1. ✅ Run `npx ampx sandbox` (needed to fix P0-3 — generates correct types for `creationMode`)
2. Resolve schema FK conflict (P0-1) — decide Option A or B, update schema and Kanban logic together
3. Fix Kanban field reads (P0-2) — follows naturally from P0-1
4. Remove `as any` from `usePipelineCreate` (P0-3) — should be clean after sandbox re-run
5. Restore non-fatal try/catch (P1-2) — 10 min
6. Fix `stages: any[]` (P1-3) — 20 min
7. Fix migration script path (P1-4) — 2 min
8. Gate or wire `handleAddStage` (P1-1) — 30 min
9. Extract inline component in `ChallengeRegistry` (P2-1) — 20 min
10. Run `npx tsc --noEmit` — confirm clean (2 pre-existing errors in `useRoleDiscovery.ts` are acceptable)
11. Commit and run `npx ampx sandbox` for final schema verification

---

## Files Changed in This Branch

### Staged (in index)
- `CLAUDE.md`, `TASKS.md`, `docs/ARCHITECTURE.md` — documentation updates
- `docs/design/pricing-model.md` — new pricing model doc
- `docs/specs/candidate-flow-spec.md` — spec updates
- `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` — @ts-ignore fix + CSS
- `src/hooks/usePipelineCreate.ts` — removed auto-seed, added creationMode
- `src/pages/OverviewPage.tsx` — DEV guard, Kanban redesign, ADD_STAGE
- `src/pages/RoleDiscoveryPage.tsx` — two-panel creation flow
- `e2e/navigation.spec.ts` — e2e test updates

### Unstaged (working tree — these are the Phase 7 files)
- `amplify/data/resource.ts` — Challenge, CodeArtifact models + Assessment FK
- `src/hooks/useAssessment.ts` — challenge-level loading + submitChallenge
- `src/pages/CandidateAssessmentPage.tsx` — StageShell + ChallengeRenderer
- `src/pages/CandidateProfilePage.tsx` — challenge score grouping
- `src/pages/OverviewPage.tsx` (additional changes beyond staged)
- `src/components/QuizRenderer.tsx` — minor updates

### Untracked (new files)
- `scripts/migrateStageConfigToChallenges.ts`
- `src/components/Assessment/ChallengeRegistry.tsx`
- `src/components/Assessment/StageShell.tsx`
- `src/components/Pipeline/ChallengeCard.tsx`
- `src/components/Pipeline/ChallengePicker.tsx`
- `src/lib/pipelinePresets.ts`
- `src/pages/ChallengeEditorPage.tsx`
- `src/pages/StageDetailPage.tsx`
