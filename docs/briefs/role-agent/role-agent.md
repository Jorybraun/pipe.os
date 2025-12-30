# Product Brief - Role Agent

**Date:** 2025-12-29
**Author:** Paige (Product Owner)
**Handoff:** Archer (Principal Architect)
**Status:** Under Architecture Review

---

## Goal / Problem

Hiring stakeholders struggle to create job descriptions that give candidates authentic insight into what a role actually entails. Current job descriptions are generic and fail to answer the questions developers ask in initial interviews:

- What types of features does the team build?
- How does the team celebrate wins?
- How many meetings per week?
- How long is sprint planning?
- What's the average code review turnaround time?

**Goal:** Build an AI-guided agent that probes hiring stakeholders for rich role context, enabling the creation of transparent, detailed job descriptions and capturing sufficient context to support future features (interview stage generation, candidate assessment).

## Target User

**Adaptive Multi-Persona Approach:**

The Role Agent does not assume a single user type. Instead, it adapts to whoever is filling out the role - whether that's a recruiter, hiring manager, or tech lead. The agent:

- Discovers what the user knows and cares about
- Asks questions relevant to their knowledge domain
- Moves on gracefully when they can't answer something
- Builds context from whatever they can provide

**Primary:** Any stakeholder involved in filling a role who has partial context (recruiter conducting intake, hiring manager defining team needs, tech lead specifying technical requirements)

## Non-Negotiables / Constraints

**Technical:**
- Must run on AWS Amplify/Lambda architecture
- AI costs per session must be < $0.50
- Must be cheap and efficient to run
- Must integrate with existing Pipe authentication system
- Must match existing Pipe design system
- Must use existing UI at `/pipeline/new` route

**User Experience:**
- Questions must dynamically build on previous answers and develop within categories (not random/disconnected)
- Maximum 5 questions rendered at a time (avoid overwhelming users)
- Desktop-only for MVP (no mobile support)

**Performance:**
- Question generation response time < 5 seconds (from BRD)
- Total session completion time target < 20 minutes

## Out of Scope

**Not included in Role Agent MVP:**

- Resume filtering/sourcing automation
- Interview stage generation (separate future feature)
- Candidate profile generation
- Multi-user/collaborative editing
- Mobile support
- Job description templates or customization UI
- Publishing job descriptions to external job boards
- Analytics/reporting on role definitions
- Version history or post-completion editing
- ATS system integrations
- AI-suggested improvements to existing job descriptions

**Note:** Interview stage creation will be triggered by the user on a different screen after Role Agent completes. The agent hands off context but does not create the full pipeline itself.

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Context Completeness | Sufficient context captured to enable future Stage Builder feature | Qualitative assessment - can Stage Builder generate relevant interview questions from Role Agent output? |

**Note:** Success metrics may be adjusted as we learn more. The primary measure of success is whether this foundational feature captures enough context to enable downstream features effectively.

## Business Context / Rationale

Role Agent is the necessary first step in the pipeline creation flow. You cannot design effective interview stages without first defining what the role entails. This is a foundational prerequisite for the core Pipe product functionality.

Building this feature now enables:
- Authentic, transparent job descriptions that attract better-fit candidates
- Rich role context that will power interview stage generation
- A foundation for future candidate assessment and filtering capabilities

## Timeline / Deadline

**Target Delivery:** Flexible - as soon as feasible

This is foundational work that blocks other features, but there is no hard external deadline.

---

## Notes

### Primary Output
The main deliverable for Role Agent MVP is a **rich, detailed job description** that includes day-to-day context candidates care about.

### Context Handoff
Secondary deliverable is comprehensive role context that will be used by future features:
- Interview stage builder (next phase)
- Candidate filtering (future)
- Candidate profile templates (future)

### Question Strategy
The agent should use a conversational approach that:
1. Collects baseline role information (job title, level, department, work model, team size, reporting structure, tech stack)
2. Dynamically explores deeper context through intelligent follow-up questions
3. References previous answers to build continuity
4. Develops questions within logical categories
5. Adapts to the user's knowledge domain
6. Allows graceful skipping of questions the user can't answer

## References

- [Phase 1 Business Requirements Document](/Users/hans/Code/pipe-os/docs/briefs/role-agent/PHASE1-BUSINESS-REQUIREMENTS.md)
- [Phase 1 Technical Specification](/Users/hans/Code/pipe-os/docs/specs/role-agent/PHASE1-TECHNICAL-SPEC.md)
- [Phase 1 Implementation Guide](/Users/hans/Code/pipe-os/docs/specs/role-agent/PHASE1-IMPLEMENTATION-GUIDE.md)
- [Architecture Review & Validation](/Users/hans/Code/pipe-os/docs/specs/role-agent/ARCHITECTURE-REVIEW.md)
- Pipe Design System (existing)
- `/pipeline/new` route (existing UI integration point)

---

## Future Integrations (See Separate Document)

A comprehensive list of possible future integrations and features building on Role Agent will be documented separately after this brief is finalized.
