# ADR-012: Challenge Studio Editor Architecture (`resolveEditorLayout`)

**Date:** 2026-02-28
**Status:** Accepted
**Deciders:** Claude (AI Agent), Hans (Project Owner)

---

## Context

The Challenge Studio (CS-001–CS-010) introduces a recruiter-facing authoring environment for creating and validating interview challenges. The candidate-side challenge renderer already uses a composable Shell + Panel architecture with `resolveLayout(type)` as the single source of truth (ADR-005). The Studio requires a parallel system on the editor side: multiple challenge types (CODE_REVIEW, CODE_IMPLEMENTATION, QUIZ_MCQ, QUIZ_SHORT_ANSWER) each need a distinct set of editor panels, and a fifth type could be added in the future.

The existing `ChallengeEditorPage` used a flat if/else tree with per-type textarea groups hardcoded into a single component. It worked for a prototype but would not scale — adding one new challenge type required modifying the editor component itself, and all types shared the same form layout with fields conditionally hidden.

Two additional constraints shaped this decision:
1. The Studio shell (toolbar, save/discard buttons, preview toggle) must know *nothing* about which editors are mounted inside it. The shell is reused across all types.
2. The editor panels (Markdown, Monaco, MCQ, Test) must each be independently testable and importable — not coupled to the shell via prop drilling.

---

## Decision

We will implement a **`resolveEditorLayout(type)` function** in `src/lib/challenge/resolveEditorLayout.ts` that maps a challenge type to a declarative list of editor panels: `{ leftPanels, rightPanels, bottomPanels }`.

This is the exact same structural pattern as `resolveLayout(type)` (ADR-005, candidate-side). The Studio shell reads the resolved layout and renders each panel by name via a panel registry — it does not import any specific editor panel directly.

The two resolvers co-exist in `src/lib/challenge/` and must be updated together whenever a new challenge type is added.

---

## Alternatives Considered

### Option A — Parallel resolver `resolveEditorLayout` (Chosen)

The Studio shell calls `resolveEditorLayout(challenge.type)` and receives `{ leftPanels, rightPanels, bottomPanels }`. The shell iterates these arrays and renders each panel from a registry (`EDITOR_PANEL_REGISTRY`). The shell has no `if/switch` on challenge type.

- **Pros:** Zero per-type logic in the shell. Adding a new challenge type = one entry in `resolveEditorLayout` + the new panel component. Consistent with the existing `resolveLayout` contract that the rest of the codebase already understands. Each panel is independently testable (pure component receiving config props).
- **Cons:** Requires a registry object and a resolver function as indirection. Developers need to update two resolver files (`resolveLayout` + `resolveEditorLayout`) for each new type.

### Option B — Per-type monolithic editor components

Each challenge type gets its own editor page component: `CodeReviewEditor.tsx`, `CodeImplementationEditor.tsx`, `MCQEditor.tsx`, `ShortAnswerEditor.tsx`. The Studio route switches on `challenge.type` to mount the correct one.

- **Pros:** Trivial to understand; no resolver indirection; each type is self-contained.
- **Cons:** The Studio toolbar and save/publish logic would need to be duplicated or extracted into a shared hook and imported by each. Behavioral shells (future: `AutoSaveShell`, `ValidationShell`) would need to wrap each per-type component separately. Directly contradicts the composition principle established in ADR-005.

### Option C — Single editor component with conditional sections

One `UniversalChallengeEditor.tsx` renders all possible editor panels and conditionally hides/shows them based on `challenge.type` via CSS or boolean props.

- **Pros:** Only one file to change for any type. Simple mental model.
- **Cons:** Loads Monaco, `react-markdown`, Piston executor, MCQ logic, and short answer logic for every challenge type — even types that don't need them. Monaco alone is 3MB+ uncompressed. Lazy loading becomes impossible because all panels are statically imported. Has exactly the same maintenance problem as Option B for business logic: the file grows to accommodate every type's edge cases.

---

## Rationale

Option A was chosen because it maintains the architectural invariant established in ADR-005: the shell does not know what it contains. This invariant is what makes the Studio shell composable with future behavioral wrappers (`AutoSaveShell`, `ValidationShell`) without modification.

The key tipping factor over Option B was **lazy loading**: with a registry-based approach, Monaco (`CodeEditorPanel`) is only imported when `resolveEditorLayout` returns it in the layout — QUIZ_MCQ and QUIZ_SHORT_ANSWER challenge editors never load Monaco at all. This keeps the initial bundle size within budget.

Option C was rejected primarily for the bundle size reason. A single component that imports everything cannot selectively code-split.

The cost of the "must update two resolvers" rule is low — there are only 4 challenge types at MVP and each resolver change is a 4-line addition. The benefit (the shell staying agnostic) is permanent.

---

## Consequences

### Positive

- **Shell isolation**: `StudioShell` has zero `if/switch` on `challenge.type`. Adding a fifth challenge type does not touch the shell.
- **Lazy-loading**: Monaco (`CodeEditorPanel`) is loaded on demand only for code challenge types. QUIZ types never incur the Monaco bundle cost.
- **Parallel with candidate side**: Developers already understand `resolveLayout`; `resolveEditorLayout` is the same contract on the editor side. No new mental model.
- **Independent panel testing**: Each editor panel (MarkdownEditorPanel, CodeEditorPanel, etc.) is a pure component receiving config props. Storybook stories require no Studio shell context.
- **Inversion of control**: The Studio shell is the composition root — panels are injected into it, not imported by it. Post-MVP behavioral wrappers (AutoSave, Validation) wrap the shell, not individual panels.

### Negative / Trade-offs

- **Two resolver files must stay in sync**: `resolveLayout` maps types to *assessment* panels; `resolveEditorLayout` maps types to *editor* panels. Both must be updated when a new type is added. If they diverge (e.g., a new type is added to `resolveLayout` but not `resolveEditorLayout`), the Studio will silently render nothing for that type.
- **Registry indirection**: `EDITOR_PANEL_REGISTRY` is a runtime map of panel name → component. TypeScript can enforce that all names in the layout are valid registry keys, but it requires careful typing.

### Risks

- **Resolver drift**: The most likely failure mode is a developer adding a new challenge type to `resolveLayout` (candidate side) without updating `resolveEditorLayout` (editor side). Mitigation: co-locate both resolvers in `src/lib/challenge/` and add a comment at the top of each pointing to the other. A TypeScript exhaustive switch (`_: never` default) on both resolvers will surface missing cases at compile time.
- **Preview mode mismatch**: The Studio's Preview tab renders the full `WorkspaceLayout` using `resolveLayout`. If `resolveLayout` and `resolveEditorLayout` return logically inconsistent layouts for a given type, the recruiter's editor experience will not match the candidate's assessment experience. Mitigated by the fact that both resolvers use the same `ChallengeType` enum as their discriminant.

---

## Follow-up

- Implements CS-001 (Studio shell + `resolveEditorLayout`) in `docs/specs/challenge-studio.md`
- Requires: `src/lib/challenge/resolveEditorLayout.ts` (new file)
- Requires: `EDITOR_PANEL_REGISTRY` in `StudioShell.tsx` mapping panel names to lazy-imported components
- Each resolver should use a TypeScript exhaustive `switch` — add `default: { const _: never = type; return _; }` to surface missing types at compile time
- Ref: ADR-005 (composable Shell + Panel — candidate side)
- Ref: ADR-004 (static challenge library — will migrate to DB per ADR-010, but resolver is unaffected)
