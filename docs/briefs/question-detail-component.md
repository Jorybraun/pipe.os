# Product Brief - Question Detail Component

**Date:** 2025-12-27
**Author:** Paige (Product Owner)
**Handoff:** Archer (Principal Architect)
**Status:** Completed

---

## Goal / Problem

Users need to click on a Question Card in the Pipeline Builder and see a detailed view of the question that matches the existing prototype design. The goal is to convert the prototype components into production-ready code without backend integration, enabling the team to validate the user flow and interaction model before implementing backend functionality.

## Target User

- **Primary:** Hiring managers creating and editing interview pipelines
- **Secondary:** Recruiters configuring assessments; Interviewers reviewing question details

## Non-Negotiables / Constraints

- Must use existing component library (AWS Amplify UI + components in `/src/components/`)
- Can move `/prototypes/questions` components into `/src/components/` directory, but they must be refactored to production standards
- Must work without backend integration (mock data only from `src/mocks/questions.ts`)
- Must match exact visual design from the provided screenshot
- TypeScript strict mode compliance required (per codebase standards)
- Must meet WCAG 2.1 AA accessibility standards (per codebase standards)
- Component appears as a nested route in Pipeline Builder page, replacing the questions list when a Question Card is clicked

## Out of Scope

- Backend integration / API calls
- Actual data persistence (saving changes to database)
- Any features beyond the four tabs (QUESTION, VIDEO, RUBRIC, SETTINGS)

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| TypeScript & Linting | 100% pass rate | `npm run build` and `npm run lint` with zero errors |
| Responsive Design | Works across all screen sizes | Manual testing on mobile, tablet, desktop viewports |
| Interactive Elements | All tabs, buttons, controls functional | Manual testing + Storybook interaction tests |
| Visual Accuracy | Pixel-perfect match to design | Visual QA comparison with screenshot |
| Code Quality | Meets team standards | Code review approval; documented, maintainable code |

## Business Context / Rationale

This is a frontend-first development approach to de-risk the user experience. Building and validating the UI flow before backend implementation ensures the interaction model works well and prevents costly rework. This allows the team to iterate on the UX quickly and gather feedback before investing in backend infrastructure.

## Timeline / Deadline

- **Target Delivery:** ASAP (Urgent Priority)
- **Key Milestones:**
  - Component refactored and integrated: ASAP
  - All four tabs implemented: ASAP
  - Visual QA and polish: ASAP

---

## Notes

- Missing data (e.g., video state) should be hard-coded into mock data objects, possibly associated with questions by ID
- The component should support navigation back to the questions list (via routing)
- All four tabs (QUESTION, VIDEO, RUBRIC, SETTINGS) must be created, even if they show minimal content initially

## References

- Design Screenshot: `/var/folders/wj/418sgtvs7xn5mk5l3m4gfnb40000gn/T/TemporaryItems/NSIRD_screencaptureui_GlWmpS/Screenshot 2025-12-27 at 6.08.10 AM.png`
- Prototype Component: `/prototypes/question-detail-component-prototype.jsx`
- Mock Data: `/src/mocks/questions.ts`
- Type Definitions: `/src/types/question.ts`
- Existing Question Components: `/prototypes/questions/` directory
