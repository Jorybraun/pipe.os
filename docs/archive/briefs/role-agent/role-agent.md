# Product Brief - Role Agent

**Date:** 2026-02-26
**Author:** Paige (Product Owner)
**Handoff:** Archer (Principal Architect)
**Status:** UI Shell Implemented

---

## Goal / Problem

Hiring stakeholders struggle to create job descriptions that give candidates authentic insight into what a role actually entails. Current job descriptions are generic and fail to answer the questions developers ask in initial interviews.

**Goal:** Build an AI-guided agent that probes hiring stakeholders for rich role context, enabling the creation of transparent, detailed job descriptions and capturing sufficient context to support future features (interview stage generation, candidate assessment).

## Target User

**Adaptive Multi-Persona Approach:**
The Role Agent adapts to whoever is filling out the role - whether that's a recruiter, hiring manager, or tech lead.

**Primary:** Any stakeholder involved in filling a role who has partial context.

## Non-Negotiables / Constraints

**Technical:**
- Must run on AWS Amplify/Lambda architecture
- AI costs per session must be < $0.50
- Must use existing Pipe authentication system
- **Route:** `/pipeline/new` (Primary Creation Flow)

**User Experience:**
- **Next-Gen Layer:** Page breaks from standard Brutalist OS rules to signal AI intelligence (rounded corners, pulsing glows).
- **Tabbed Interface:** Configuration (AI Follow-ups) lives in a dedicated "Settings" tab in the sidebar.
- Questions must dynamically build on previous answers.
- Maximum 5 questions rendered at a time.

**Performance:**
- Question generation response time < 5 seconds
- Total session completion time target < 20 minutes

## Out of Scope

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

---

## Business Context / Rationale

Role Agent is the necessary first step in the pipeline creation flow. You cannot design effective interview stages without first defining what the role entails. This is a foundational prerequisite for the core Pipe product functionality.

## Timeline / Deadline

**Target Delivery:** Active Implementation

---

## Notes

### Primary Output
The main deliverable is a **rich, detailed job description** that includes day-to-day context candidates care about.

### Context Handoff
Secondary deliverable is comprehensive role context that will be used by future features:
- Interview stage builder (next phase)
- Candidate filtering (future)
- Candidate profile templates (future)

### Question Strategy
The agent uses a conversational approach that:
1. Collects baseline role information.
2. Dynamically explores deeper context through intelligent follow-up questions.
3. References previous answers to build continuity.
4. Adapts to the user's knowledge domain.
5. Allows graceful skipping of questions the user can't answer.

## References

- [Phase 1 Business Requirements Document](/Users/hans/Code/pipe-os/docs/briefs/role-agent/PHASE1-BUSINESS-REQUIREMENTS.md)
- [Phase 1 Technical Specification](/Users/hans/Code/pipe-os/docs/specs/role-agent/PHASE1-TECHNICAL-SPEC.md)
- [Phase 1 Implementation Guide](/Users/hans/Code/pipe-os/docs/specs/role-agent/PHASE1-IMPLEMENTATION-GUIDE.md)
- [Architecture Review & Validation](/Users/hans/Code/pipe-os/docs/specs/role-agent/ARCHITECTURE-REVIEW.md)
- Pipe Design System (existing)
- `/pipeline/new` route (existing UI integration point)
