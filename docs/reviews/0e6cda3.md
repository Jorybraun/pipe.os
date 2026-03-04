# Code Review Request — 0e6cda3

## Reviewer: Quinn (QA Lead)
## Status: 🟡 PENDING

## Description
This PR implements the functional wiring for the Challenge Studio and Library, completing the transition from static prototypes to a data-driven authoring system. It also introduces a platform-wide "airy" redesign, replacing heavy UI elements with high-density glassy rows.

## Key Areas to Review

### 1. Challenge Studio Logic (`src/pages/ChallengeStudioPage.tsx`)
- Review the `handleSave` and `handleClone` logic.
- Ensure the state transition between Design and Preview modes is smooth.
- Validate that declarative field editing updates the local state correctly before persistence.

### 2. Declarative Layouts (`src/lib/challenge/resolveEditorLayout.ts`)
- Verify the mapping between `ChallengeType` and `EditorPanelType`.
- Ensure fallback logic handles unknown challenge types gracefully.

### 3. Design System Alignment (`docs/design/design-system.md`)
- Review the new **Data Row (Glassy)** CSS specification.
- Ensure the **IoC Design Patterns** accurately reflect the implementation in Challenges and Scheduling.

### 4. UI Refactor (`ListingPage.tsx`, `OverviewPage.tsx`)
- Check the responsive behavior of the new high-density rows.
- Ensure no information was lost during the removal of the old stats cards.

## Testing Performed
- **Type Safety**: `npx tsc --noEmit` passed.
- **Library Functional Wiring**: Verified search, tab switching, and template instantiation.
- **Schema Updates**: Verified `isSystem` and optional `stageId` behavior in the sandbox.

## Security Considerations
- The schema update allows global templates (`isSystem: true`) which are currently protected by owner-based auth. Ensure recruiters cannot accidentally overwrite system templates.
