# Changelog — 0e6cda3

## Summary
Functional wiring of the Challenge Studio and Library systems, coupled with a platform-wide "airy" UI redesign. This commit transitions the Challenge authoring experience from static components to a live, data-driven environment and aligns the core recruiter pages with the updated high-density glassy row design language.

## Changes

### Core & Schema
- **`amplify/data/resource.ts`**: Updated `Challenge` model to include `isSystem` (for library templates) and `baseChallengeId`. Made `stageId` optional to allow global challenges not yet assigned to a specific pipeline stage.

### Authoring Tools (Challenge Studio)
- **`src/pages/ChallengeStudioPage.tsx`**: Implemented a new, lightweight authoring page. Features include:
    - **Design Mode**: High-density grid for metadata and instructions.
    - **Preview Mode**: Real-time simulation of the candidate experience using `ChallengeRegistry`.
    - **Cloning**: Ability to clone system templates into custom editable versions.
- **`src/lib/challenge/resolveEditorLayout.ts`**: Introduced a declarative registry mapping challenge types to required editor panels (instructions, code, tests, etc.).

### Challenge Library
- **`src/pages/ChallengeLibraryPage.tsx`**: Functional wiring for the library:
    - Live search across titles.
    - Filtering by type and "Library vs. Custom" tabs.
    - Integration with `CreateChallengeModal` for rapid template instantiation.
- **`src/components/ChallengeLibrary/CreateChallengeModal.tsx`**: New component for selecting and instantiating challenge templates.

### Design Refresh (Airy UI)
- **`src/pages/ListingPage.tsx`**: Refactored the dashboard to use the new "airy" layout. Replaced large cards with high-density glassy rows and streamlined the filter/search bar.
- **`src/pages/OverviewPage.tsx`**: Updated the Kanban candidate cards to match the new high-density row pattern, improving information density and visual clarity.
- **Refactored Components**: `CandidateCard`, `RoleCard`, and `ChallengeCard` updated to support the new glassy design language.

### Documentation & Standards
- **`docs/design/design-system.md`**: Upgraded to **Version 1.1.0**. Added documentation for the **Data Row (Glassy)** pattern, formalized **IoC Design Patterns**, and added the **Studio Page** navigation spec.
- **`CHANGELOG.md`**: Updated with the `challenge-studio-library` entry.

## Verification Results

### Type Check
- `npx tsc --noEmit`: [Run result pending, executing next]

### Manual Smoke Test
- Verified Challenge Library data loading via Amplify.
- Verified Studio Page mode toggling (Design/Preview).
- Verified Listing Page and Overview Page layout integrity.
