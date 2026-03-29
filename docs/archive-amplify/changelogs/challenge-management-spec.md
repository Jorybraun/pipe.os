# Detailed Log — Challenge Management & Template System Specification

**ID**: `challenge-management-spec`
**Date**: 2026-02-27
**Author**: Gemini (AI Agent)

---

## 1. Research & Analysis
- **Problem Discovery**: Identified that the current "Challenge Library" (65+ templates) is hard-coded in `src/content/challengeLibrary.ts`, preventing recruiters from authoring or managing reusable content through the UI.
- **Dependency Audit**: Verified that `ChallengeEditorPage.tsx` and `ChallengeRegistry.tsx` already contain the core logic for editing and rendering challenges, providing a strong foundation for the new management system.
- **Constraint Mapping**: The current `Challenge` model requires a `stageId`, which blocks the creation of "Global" templates.

## 2. Strategy & Architecture
- **Decision (ADR-010)**: Adopt a **Unified Table** approach. Instead of creating new models for templates, we modify the existing `Challenge` model to make `stageId` optional and add metadata for discovery (`isTemplate`, `isSystem`, `tags`, `difficulty`).
- **GSI Optimization**: Proposed two new GSIs (`isTemplate-type-difficulty` and `topic`) to ensure the library can be searched and filtered efficiently in DynamoDB.
- **Component Reuse**: Strategized the use of `ChallengeRegistry` for "Mini-Previews" in the management list, ensuring UI consistency across the platform.

## 3. Implementation Plan
- **Phase 1: Schema Transition**: Update `amplify/data/resource.ts` to allow standalone challenges.
- **Phase 2: Data Liberation**: Seed the 65+ hard-coded templates into DynamoDB via a migration script.
- **Phase 3: Management UI**: Build the `/challenges` hub for discovery.
- **Phase 4: Unified Editor**: Generalize the editor to handle both library templates and pipeline instances.
- **Phase 5: Dynamic Picker**: Update the `ChallengePicker` modal to fetch real-time content from the database.

## 4. Key Artifacts Created
- `docs/decisions/ADR-010-database-driven-challenge-library.md`
- `docs/specs/challenge-management-system.md`
- `docs/design/challenge-management-technical-design.md`

## 5. Verification Checklist
- [x] ADR-010 reviewed and documented.
- [x] Product Specification for Challenge Management Page drafted.
- [x] Technical Design for Unified Table and GSIs complete.
- [x] `TASKS.md` updated with the new Epic and sub-tasks.
- [x] `npx tsc --noEmit` passed.
