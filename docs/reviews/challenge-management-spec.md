# Code Review Request: Challenge Management & Template System Specification

**ID**: `challenge-management-spec`
**Date**: 2026-02-27
**Reviewer**: Jory (Solo Founder)

---

## 1. Summary of Changes
This PR establishes the architectural and product foundation for the Challenge Management & Template System. It transitions the project from a static, hard-coded challenge library to a dynamic, database-driven system.

### Key Decisions
- **Unified Table (ADR-010)**: Challenges and Templates will share the same DynamoDB table, distinguished by flags. This simplifies the schema and allows for easy "promotion" of pipeline-specific questions to global templates.
- **Enhanced Metadata**: Added top-level fields for `tags`, `difficulty`, and `topic` to support efficient server-side discovery and filtering.
- **Component Reuse**: Reuse of `ChallengeRegistry` and `ChallengeEditorPage` to ensure UI consistency and reduce maintenance overhead.

## 2. Files to Review
| File | Impact |
|---|---|
| `docs/decisions/ADR-010-database-driven-challenge-library.md` | **Critical**: Architectural decision on unified table vs. separate template model. |
| `docs/specs/challenge-management-system.md` | **High**: Product requirements for discovery, authoring, and management. |
| `docs/design/challenge-management-technical-design.md` | **High**: Database indexing, data migration logic, and UI architecture. |
| `TASKS.md` | **Medium**: Tactical roadmap for implementation. |

## 3. Reviewer Focus
- **Unified Table vs. Separate Model**: Do you agree with the "Unified Table" approach for Templates vs Instances? It reduces schema duplication but requires careful filtering.
- **Metadata Coverage**: Are the proposed fields (`tags`, `difficulty`, `topic`, `estimatedMinutes`) sufficient for your vision of a searchable library?
- **Phased Rollout**: Does the 5-step execution plan align with your priorities?

## 4. Verification Performed
- `npx tsc --noEmit` passed.
- Consistency check between ADR-010, the Product Spec, and the Technical Design.
