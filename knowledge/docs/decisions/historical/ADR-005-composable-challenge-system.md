# ADR-005: Composable Challenge System (Shell + Panel Architecture)

**Date:** 2026-02-27
**Status:** Accepted
**Deciders:** Gemini (AI Agent), Hans (Project Owner)

---

## Context

The Phase 7 architecture migration introduced multiple challenge types (CODE_REVIEW, CODE_IMPLEMENTATION, QUIZ_MCQ, QUIZ_SHORT_ANSWER). Each type requires a specific layout (e.g., code editor + preview vs. question + options). Additionally, behavioral requirements like Timers, Recording, and Auto-save need to be applicable across all challenge types.

Building monolithic components for every combination (e.g., `TimedMonacoChallenge`, `MonacoChallengeWithRecording`) would lead to significant code duplication and a maintenance nightmare.

---

## Decision

We will implement a **composable shell + panel architecture**.

1.  **Shells** are behavioral wrappers (Higher-Order Components or Render Props) that add capabilities (e.g., `TimerShell`).
2.  **Panels** are stateless content display components (e.g., `MonacoPanel`, `ProblemPanel`).
3.  **Layout** is a responsive grid (`WorkspaceLayout`) that positions panels.
4.  **Resolvers** (`resolveLayout`, `resolveShells`) act as the single source of truth, mapping a challenge's type and configuration to the set of shells and panels required.

---

## Alternatives Considered

### Option A — Shell + Panel Composition (Chosen)
- **Pros:** Maximum flexibility; behavioral logic is decoupled from content; easy to add new panels or shells; responsive by design.
- **Cons:** Requires a registry/resolver layer; slightly more initial setup.

### Option B — Monolithic Components
- **Pros:** Simple to understand initially; no resolver logic.
- **Cons:** High code duplication (timer logic repeated in every component); hard to maintain; "prop drilling" behavioral settings through unrelated layers.

### Option C — Plugin Architecture
- **Pros:** Highly extensible.
- **Cons:** Significant over-engineering for an MVP; harder to debug.

---

## Rationale

Composition over specialization is the core principle. By decoupling *what* is displayed (Panels) from *how* it behaves (Shells) and *where* it sits (WorkspaceLayout), we ensure that adding a new capability (like Screen Recording) only requires building one shell that automatically works for every challenge type.

---

## Consequences

### Positive
- **Maintainability**: Behavioral logic (Timer) is written once.
- **Flexibility**: Different layouts for different subtypes (e.g., `BUILD_COMPONENT` vs. `WRITE_FUNCTION`) are trivial to implement.
- **Consistency**: All challenges share the same brutalist glassmorphic workspace aesthetic.

### Negative / Trade-offs
- **Complexity**: The `ChallengeRegistry` becomes an assembly engine rather than a simple router.
- **State Flow**: Values (like code updates) must be carefully managed as they flow through the composed layers.

### Risks
- **Performance**: Deep nesting of shells could lead to unnecessary re-renders if not optimized (memoization will be used).

---

## Follow-up

- Implements Step 4 of Phase 7 in `TASKS.md`.
- Requires implementation of `resolveLayout.ts` and `resolveShells.ts`.
- Requires installation of `@monaco-editor/react` and `react-markdown`.
