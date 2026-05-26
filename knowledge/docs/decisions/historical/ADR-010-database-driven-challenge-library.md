# ADR-010: Database-Driven Challenge Library & Template System

**Date:** 2026-02-27
**Status:** Accepted
**Deciders:** Gemini (AI Agent), Hans (Project Owner)

---

## Context

The current system relies on a hard-coded library of ~65 challenge templates located in `src/content/challengeLibrary.ts`. While this served the MVP, it introduces several limitations:
1.  **Static Dictionary:** Adding or updating a challenge requires a code change and deployment.
2.  **Rigid Data Model:** The `Challenge` model in the database currently requires a `stageId`, meaning a challenge cannot exist without being part of a specific hiring pipeline.
3.  **No Recruiter Authoring:** Recruiters cannot create their own reusable templates through the UI.
4.  **Fragmented Source of Truth:** Data exists both in code (templates) and in the database (active challenges).

---

## Decision

We will transition to a fully database-driven Challenge Library.

### 1. Schema Update
We will modify the `Challenge` model in `amplify/data/resource.ts`:
-   Make `stageId` optional (`a.id()`).
-   Add `isTemplate: a.boolean().default(false)` to distinguish library items.
-   Add `tags: a.string().array()` and `difficulty: a.enum(['beginner', 'intermediate', 'advanced'])` directly to the model for better indexing (moving them out of the JSON blob).

### 2. Data Migration & Seeding
-   A one-time seeding script will be created to read `src/content/challengeLibrary.ts` and populate the `Challenge` table.
-   The static file will be deprecated and eventually removed once the transition is verified.

### 3. Component Reuse
-   **List View:** We will create a new `ChallengeManagementPage` that lists all challenges where `isTemplate: true`.
-   **Rendering:** The `ChallengeRegistry` (ADR-005) will be used to render previews of challenges within the management list.
-   **Editing:** The `ChallengeEditorPage` logic will be generalized to handle both "Template Challenges" (no `stageId`) and "Pipeline Challenges" (with `stageId`).

### 4. Ownership & Authorization
-   **System Templates:** The original 65 templates will be marked with a `isSystem: a.boolean()` flag and made read-only for most users.
-   **User Templates:** Recruiters can create their own templates, which will be owned by them (`allow.owner()`).

---

## Alternatives Considered

### Option A: Separate `ChallengeTemplate` Table
-   **Pros:** Clean separation of concerns.
-   **Cons:** Requires duplicating the entire challenge schema and logic. Difficult to "promote" a pipeline challenge to a template.

### Option B: Unified `Challenge` Table (Chosen)
-   **Pros:** Single source of truth for "What a challenge is." Easier to implement "Save as Template" from an existing pipeline. Simplifies component logic (one model to rule them all).
-   **Cons:** Requires careful filtering to avoid showing templates in pipeline-specific views.

---

## Rationale

The Unified Table approach is more agile and fits the Amplify Gen 2 pattern of using flags and optional relationships. It allows the same UI components (Editor, Registry) to work seamlessly regardless of whether the challenge is a "Template" or an "Active" item.

---

## Consequences

### Positive
-   Recruiters can create, edit, and share challenges in real-time.
-   Centralized management of all assessment content.
-   UI consistency between the Library, Editor, and Candidate flow.

### Negative / Trade-offs
-   DynamoDB filtering on JSON blobs is still a limitation; however, moving `tags` and `difficulty` to top-level fields mitigates this for most use cases.

### Risks
-   Orphaned challenges: Making `stageId` optional requires care to ensure we don't accidentally lose track of which pipeline a challenge belongs to if it's *not* a template.

---

## Follow-up

- Update `amplify/data/resource.ts`.
- Create `scripts/seedChallengeLibrary.ts`.
- Implement `src/pages/ChallengeManagementPage.tsx`.
