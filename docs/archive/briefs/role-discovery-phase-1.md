# Product Brief - Role Discovery (Phase 1)

**Date:** 2025-12-28
**Author:** Paige (Product Owner)
**Handoff:** Archer (Principal Architect)
**Status:** Draft

---

## Goal / Problem

**Problem:** Hiring managers cannot design effective AI-native interviews without structured role context. Generic interview templates fail to assess role-specific AI collaboration skills, problem-solving approaches, and team dynamics.

**Goal:** Enable hiring managers to build rich role context through a guided two-part process that gathers both structured baseline information and dynamic contextual insights. The agent should collect enough context to design interview stages and questions without requiring follow-up clarifications.

**Why Now:** Pipe differentiates by evaluating how developers work with AI tools in real-world scenarios. This requires deeply contextualized interviews, not one-size-fits-all assessments.

---

## Target User

- **Primary:** Hiring managers creating new interview pipelines for technical roles
- **Secondary:** Recruiters setting up interviews on behalf of hiring teams

**User Journey:**
1. Click "Create New Role" from dashboard → navigate to `/pipeline/new`
2. Complete **Part 1: Structured Baseline** (7 required fields)
3. Engage with **Part 2: Dynamic Agent Exploration** (conversational Q&A)
4. Agent determines readiness (qualitative assessment)
5. Proceed to Phase 2 (Pipeline Builder)

---

## Non-Negotiables / Constraints

### Flow Structure
- **Two-part flow is mandatory:** Structured baseline must be completed before agent exploration begins
- **7 required baseline fields:** Job Title, Level, Department, Work Model, Team Size, Reports To, Tech Stack
- **Dynamic context schema:** Context keys emerge from conversation (NOT a fixed schema)

### Agent Behavior
- **One question at a time:** Agent must not ask multiple questions in a single prompt
- **First-person voice:** Agent uses "I" ("I'm exploring...", "I need to understand...")
- **Status-first communication:** Agent explains what it's doing and why
- **Qualitative readiness:** Agent uses judgment, not percentage-based completion

### Technical
- Must work within AWS Amplify Gen 2 + React architecture
- Uses existing design system (Liquid Metal glassmorphism, Space Mono font)
- Route: `/pipeline/new`

---

## Out of Scope

- **Job description generation** - This is NOT a JD writer
- **Exhaustive HR metadata** - Focus on interview design context only
- **Fixed question sequences** - Agent adapts dynamically
- **Percentage-based completion** - Uses qualitative "readiness" assessment
- **Recruiter intake replacement** - Complements, doesn't replace human conversation
- **Backend persistence** - Phase 1 uses client-side state only (dummy data)

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| **Primary Success Criterion** | Agent has enough context to design interviews without follow-up questions | Qualitative assessment during Phase 2 (do we need to ask clarifying questions?) |
| **Completion Rate** | ≥70% of users who start Phase 1 reach "ready" status | Analytics: (users reaching ready) / (users who started) |
| **Time to Complete** | ≤10 minutes median | Analytics: Time from page load to "Continue to Phase 2" click |
| **Context Richness** | ≥3 dynamic context areas explored | Analytics: Count of non-empty context keys |
| **User Confidence** | ≥4/5 rating on "I felt understood" | Post-Phase 1 survey (optional) |

---

## Business Context / Rationale

**Strategic Value:**
- **Differentiation:** Competitors use static job descriptions → generic assessments. Pipe uses dynamic role modeling → personalized interviews.
- **Platform Moat:** Accumulated role models become proprietary data that improves interview quality over time
- **Time-to-Value:** Reduces time from "create role" to "invite candidate" from hours to minutes

**Market Opportunity:**
- Enterprise customers specifically request role-specific interview customization
- High-volume hiring teams (50+ roles/quarter) benefit most
- Positions Pipe as "AI-powered interview designer" not just "assessment platform"

**Risk if Not Built:**
- Users default to generic interview stages → poor candidate experience
- Fail to deliver on "AI-native interview platform" value proposition
- Lose competitive advantage as assessment platforms commoditize

---

## Timeline / Deadline

**Target Delivery:** End of Q1 2025 (January 31, 2025)

**Key Milestones:**
- **Phase 1A (Weeks 1-2):** Layout implementation with dummy data (UI components, routing, no LLM)
- **Phase 1B (Weeks 3-4):** Agent integration (LLM-powered question generation and context extraction)
- **Phase 1C (Week 5):** Internal testing and refinement (5 hiring managers, qualitative feedback)

**Dependencies:**
- LLM provider selection (OpenAI vs Anthropic Claude)
- Backend schema design for role context storage (blocks transition to Phase 2)

---

## Notes

### Key Design Decisions

1. **Two-part flow rationale:** Structured baseline provides scaffolding for agent exploration. Prevents agent from asking basic questions like "What's the job title?"

2. **Dynamic context schema:** Keys emerge from conversation because different roles surface different signals (e.g., startup vs enterprise contexts differ significantly)

3. **Qualitative readiness:** Percentage-based completion incentivizes "checkbox filling." Qualitative judgment ensures meaningful context.

4. **Agent voice (first-person):** Builds trust and transparency. Users understand what the agent is doing and why.

### Open Questions for Architect

- **LLM Integration:** Which provider? Cost per session estimate?
- **Context Persistence:** Where do we store accumulated context between Part 1 and Part 2?
- **Agent Prompt Engineering:** How do we ensure consistent voice and quality?
- **Retry Logic:** What happens if agent asks a question user can't answer?

### Edge Cases to Handle

- User pastes entire job description text → Agent extracts and pre-fills baseline
- User gives very short answers → Agent probes deeper with follow-ups
- User contradicts earlier info → Agent flags conflict, asks for clarification

---

## References

- **Requirements Document:** Phase 1: Role Discovery — Requirements Document v3.0
- **Prototype:** `/prototypes/role-discovery-stage.jsx`
- **Design System:** Pipe UI guidelines (Liquid Metal cards, Space Mono typography)
- **Data Model:** See Requirements Doc Section 4 for TypeScript interface definitions
