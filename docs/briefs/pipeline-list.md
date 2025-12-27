# Product Brief - Pipeline List

**Date:** 2025-12-26
**Author:** Paige (Product Owner)
**Handoff:** Archer (Principal Architect)
**Status:** Draft

---

## Goal / Problem

Recruiters and hiring managers need a centralized view to see and access their created pipelines/roles. This view serves as the primary navigation hub for managing interview pipelines, allowing users to quickly find, access, and manage their roles.

## Target User

- **Primary:** Recruiters and hiring managers who create and manage interview pipelines/roles

## Non-Negotiables / Constraints

- Must use AWS Amplify Data for backend integration (when implemented)
- Must follow existing design principles and prototypes if they exist
- If no prototype exists, must follow established design patterns in the codebase
- Must be responsive and accessible

## Out of Scope

- Advanced filtering options (beyond basic search)
- Bulk actions on multiple pipelines
- Advanced sorting capabilities
- Analytics and reporting on list view
- Sharing/collaboration features
- Pipeline templates or cloning
- Export functionality

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| List display | 100% of user's pipelines shown | User can view all created pipelines |
| Navigation | Users can access detail pages | Click-through functionality to detail view |
| Search | Users can find pipelines by name | Search/filter functionality implemented |
| Delete | Users can remove pipelines | Delete action available and functional |

**Functional Requirements for Success:**
- ✅ User can view a list of all their pipelines
- ✅ User can click on a pipeline item to navigate to its detail page
- ✅ User can search for pipelines
- ✅ User can delete a pipeline from the list

## Business Context / Rationale

This is foundational scaffolding work for the Pipe platform. The pipeline list view is essential infrastructure that enables users to manage their interview pipelines effectively. Without this view, users cannot navigate to existing pipelines or understand what roles they've created.

**Phased Approach:**
- **Stage 1:** Build UI with mock data for rapid prototyping and design validation
- **Stage 2:** Integrate with AWS Amplify backend for real data persistence

This staged approach allows frontend and design to move quickly while backend infrastructure is being developed in parallel.

## Timeline / Deadline

- **Target Delivery:** Flexible - no hard deadline specified
- **Key Milestones:**
  - Stage 1 (Mock Data): TBD
  - Stage 2 (Backend Integration): TBD

---

## Notes

- This is a foundational feature that will likely evolve with additional functionality (sorting, filtering, bulk actions) based on user feedback
- Consider existing prototypes in `/prototypes` directory that may inform design
- Detail page navigation is a separate feature and should be developed in parallel or sequentially

## References

- Project prototypes: `/prototypes/listing-page.jsx`
- Design standards: `.claude/rules/ui-ux.md`
- Architecture patterns: `.claude/rules/architecture.md`
