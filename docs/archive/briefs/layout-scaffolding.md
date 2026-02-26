# Product Brief - Layout Scaffolding

**Date:** 2025-12-26
**Author:** Paige (Product Owner)
**Handoff:** Archer (Principal Architect)
**Status:** Completed

---

## Goal / Problem

The existing prototypes contain significant code duplication and need to be refactored into a proper component architecture. We need to:

1. **Eliminate duplication** by breaking prototypes into shared, reusable components
2. **Set up navigation/routing** to connect all prototype screens
3. **Create end-to-end user flow** to validate the complete application experience
4. **Establish component boundaries** before implementing backend integration

This scaffolding work transforms isolated prototypes into a cohesive, navigable application foundation.

## Target User

- **Primary:** Developers on the Pipe platform team

This is infrastructure work that provides developers with:
- Clean, presentational components
- Clear navigation structure
- Component isolation for easier development
- Foundation for future feature implementation

## Non-Negotiables / Constraints

### Prototype Navigation Flow

The following navigation structure must be implemented:

1. **List Page** (`list-page.jsx`) - Main entry point
2. **Overview** (`overview-prototype.jsx`) - Accessed by clicking an item in the listing page
3. **Pipeline/Stage Builder** (`pipeline-builder.jsx` + `screening-stage-builder.jsx`) - Accessed by clicking "New" in the listing page (combined view with sub-routes)
4. **Candidate Profile** (`profile-example.jsx`) - Accessed by clicking a candidate in the overview
5. **Candidate Screening** (`candidate-screening.jsx`) - Accessed by clicking the preview button

### Component Architecture

- **All components from COMPONENT-AUDIT must be assessed and split up**
- Components should be **presentational/stateless** - no data fetching or complex state management
- Minimal state is acceptable **only for navigation** (e.g., modal open/close, route changes)
- Use mock/static data for all displays

### Technical Requirements

- Must use React Router (or equivalent) for navigation
- Must follow existing design patterns and principles
- Must maintain consistency with prototype designs

## Out of Scope

- Backend integration (AWS Amplify Data)
- Authentication/authorization
- Real data/API calls
- State management integration (Redux, Zustand, Context, etc.)
- Data fetching logic
- Business logic implementation

This iteration focuses **purely on UI scaffolding and navigation**.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Prototype visibility | 100% of prototypes accessible | User can navigate to all 5 prototype screens |
| Application stability | Zero breaking errors | Application runs without crashes or console errors |
| Navigation flow | Complete user journey | User can navigate through entire flow: List → Overview → Builder/Profile/Screening |

**Functional Requirements for Success:**
- ✅ User can view all prototype screens through navigation
- ✅ Application doesn't break (no errors, stable routing)
- ✅ All prototype flows are accessible and functional
- ✅ Components are properly split and reusable

## Business Context / Rationale

This scaffolding work is **foundational infrastructure** that enables:

### 1. Feature Breakdown
- Establishes clear component boundaries
- Allows work to be divided into discrete features
- Makes future development more parallel and efficient

### 2. Component Management
- Components are visible and testable in isolation
- Easier to manage before adding complexity
- Enables Storybook integration and component documentation

### 3. Informed Architecture Decisions
- **Defers state management decisions** until component structure is clear
- Allows team to choose the right solution (Context, Redux, Zustand) based on actual needs
- Prevents premature optimization or over-engineering

### 4. Development Velocity
- Unblocks all feature development work
- Provides stable foundation for backend integration
- Reduces refactoring risk later

**This is the critical first step** before implementing features, backend integration, or state management.

## Timeline / Deadline

- **Target Delivery:** No hard deadline - foundational work
- **Priority:** High - blocks other development work

---

## Notes

### Prototype Files to Migrate
- `/prototypes/list-page.jsx`
- `/prototypes/overview-prototype.jsx`
- `/prototypes/pipeline-builder.jsx`
- `/prototypes/screening-stage-builder.jsx`
- `/prototypes/profile-example.tsx`
- `/prototypes/candidate-screening.jsx`

### Component Audit
- Review COMPONENT-AUDIT document for full component breakdown
- Identify shared components (buttons, cards, forms, etc.)
- Create component hierarchy and organization structure

### Future Phases
After this scaffolding is complete:
- **Phase 2:** Backend integration with Amplify Data
- **Phase 3:** State management implementation
- **Phase 4:** Authentication/authorization
- **Phase 5:** Feature-specific business logic

## References

- Prototypes directory: `/prototypes/`
- Component audit: `COMPONENT-AUDIT` (location TBD)
- Design standards: `.claude/rules/ui-ux.md`
- Component patterns: `.claude/rules/react-components.md`
- Architecture guidelines: `.claude/rules/architecture.md`
