# Phase 1: Role Discovery — Business Requirements Document

**Version:** 1.0  
**Last Updated:** December 2024  
**Status:** Draft  
**Owner:** Product

---

## 1. Executive Summary

### Problem Statement

Hiring managers and recruiters struggle to translate their understanding of a role into effective interview processes. Common failures include:

- **Generic job descriptions** that don't reflect actual role needs
- **Misaligned interviews** that test skills irrelevant to the role
- **Inconsistent evaluation** because success criteria were never defined
- **Wasted cycles** when interviewers discover missing context mid-process

Current tools ask users to fill lengthy forms or write job descriptions from scratch, resulting in incomplete context that undermines downstream interview quality.

### Proposed Solution

An AI-guided role discovery experience that:

1. Collects essential role information through a structured baseline
2. Dynamically explores deeper context through intelligent follow-up questions
3. Builds a comprehensive role model sufficient for interview design
4. Generates job descriptions, candidate filters, and stage recommendations

### Business Value

| Metric | Current State | Target State |
|--------|---------------|--------------|
| Time to define role | 2-4 hours | 15-30 minutes |
| Interview alignment | ~60% relevance | >90% relevance |
| Hiring manager satisfaction | Unknown | >4.5/5 rating |
| Context gaps discovered mid-interview | Common | Rare |

---

## 2. User Personas

### Primary: Hiring Manager

**Profile:**
- Engineering manager, tech lead, or department head
- Hiring for their own team
- Deep knowledge of role requirements
- Limited time, high urgency to fill role
- May not have recruiting expertise

**Goals:**
- Quickly communicate role needs
- Ensure interviews test what actually matters
- Reduce back-and-forth with recruiters
- Hire the right person faster

**Pain Points:**
- Forms feel bureaucratic and disconnected
- Explaining the same context repeatedly
- Interviews that miss the mark
- Job descriptions that attract wrong candidates

### Secondary: Recruiter / Talent Partner

**Profile:**
- Internal recruiter or external agency
- Conducting intake on behalf of hiring manager
- Needs to understand role without deep domain expertise
- Managing multiple roles simultaneously

**Goals:**
- Efficient intake process
- Capture nuance without domain expertise
- Produce consistent, high-quality role definitions
- Enable better candidate screening

**Pain Points:**
- Hiring managers give incomplete information
- Difficulty probing on technical details
- Inconsistent intake quality across roles
- Job descriptions require heavy editing

### Tertiary: HR / People Ops

**Profile:**
- Oversees hiring process compliance
- Ensures consistency across organization
- May review job descriptions before posting

**Goals:**
- Standardized role documentation
- Compliance with hiring policies
- Audit trail of role decisions

---

## 3. User Stories

### Epic: Role Context Collection

#### US-1: Baseline Information Entry
**As a** hiring manager  
**I want to** enter essential role information in a structured form  
**So that** the system has foundational context for intelligent follow-up

**Acceptance Criteria:**
- Form includes: Job Title, Level, Department, Work Model, Team Size, Reports To, Tech Stack
- All fields have appropriate input types (text, select, tags, radio)
- Form validates required fields before submission
- User can edit baseline after submission

#### US-2: Dynamic Question Generation
**As a** hiring manager  
**I want to** answer follow-up questions tailored to my role  
**So that** I can provide relevant context without guessing what's needed

**Acceptance Criteria:**
- Questions reference information I've already provided
- Questions are specific, not generic
- I see why each question matters
- Questions adapt based on my previous answers

#### US-3: Contextual Explanation
**As a** hiring manager  
**I want to** understand why the agent is asking specific questions  
**So that** I trust the process and provide better answers

**Acceptance Criteria:**
- Agent explains its reasoning in the UI
- Explanations connect questions to interview outcomes
- User can ask "why do you need this?"

#### US-4: Progress Visibility
**As a** hiring manager  
**I want to** see how much context has been gathered and what's missing  
**So that** I know when I can proceed and what gaps remain

**Acceptance Criteria:**
- Status indicator shows current phase (exploring, almost ready, ready)
- Gaps are listed clearly
- User understands what determines "ready"

#### US-5: Skip to Completion
**As a** hiring manager  
**I want to** proceed to job description generation before the agent says "ready"  
**So that** I can move faster if I'm satisfied with current context

**Acceptance Criteria:**
- "Continue anyway" option available after baseline
- System warns about remaining gaps
- Generated outputs note limited context areas

### Epic: Output Generation

#### US-6: Job Description Generation
**As a** hiring manager  
**I want to** receive a job description based on my inputs  
**So that** I have a ready-to-post role description without manual writing

**Acceptance Criteria:**
- JD reflects specific context from conversation
- Includes: summary, responsibilities, requirements, team context
- Distinguishes required vs preferred qualifications
- Output is editable before finalizing

#### US-7: Candidate Filters
**As a** hiring manager  
**I want to** receive screening criteria derived from role context  
**So that** I can filter candidates before interviews begin

**Acceptance Criteria:**
- Filters categorized: experience, skills, traits, logistics
- Each filter marked required or preferred
- Filters traceable to conversation context

#### US-8: Stage Recommendations
**As a** hiring manager  
**I want to** receive interview stage recommendations  
**So that** I have a starting point for pipeline design

**Acceptance Criteria:**
- Stages match role type and level
- Each stage has rationale and focus areas
- Suggested duration provided
- Recommendations are suggestions, not mandatory

---

## 4. Functional Requirements

### 4.1 Baseline Collection (Part 1)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | System SHALL collect Job Title as free text | Must |
| FR-1.2 | System SHALL collect Level from predefined options (Junior through Manager) | Must |
| FR-1.3 | System SHALL collect Department as free text | Must |
| FR-1.4 | System SHALL collect Work Model as radio selection (Remote/Hybrid/Onsite) | Must |
| FR-1.5 | System SHALL collect Team Size as free text | Must |
| FR-1.6 | System SHALL collect Reports To as free text | Must |
| FR-1.7 | System SHALL collect Tech Stack as tag input (multiple values) | Must |
| FR-1.8 | System SHALL validate all required fields before allowing submission | Must |
| FR-1.9 | System SHOULD allow editing baseline after submission | Should |

### 4.2 Dynamic Exploration (Part 2)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | System SHALL generate follow-up questions based on baseline + accumulated context | Must |
| FR-2.2 | System SHALL extract facts and signals from user responses | Must |
| FR-2.3 | System SHALL accumulate context with dynamic keys (not fixed schema) | Must |
| FR-2.4 | System SHALL assess readiness through qualitative judgment | Must |
| FR-2.5 | System SHALL NOT ask duplicate or redundant questions | Must |
| FR-2.6 | System SHALL reference user's context in generated questions | Must |
| FR-2.7 | System SHALL support multiple input types (text, textarea, tags, select, radio) | Must |
| FR-2.8 | System SHALL display agent reasoning/status to user | Should |
| FR-2.9 | System SHALL allow user to ask meta-questions ("Why do you need this?") | Should |
| FR-2.10 | System SHOULD detect and flag contradictions in user responses | Should |

### 4.3 Quality Assurance

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | System SHALL validate question quality before presenting to user | Must |
| FR-3.2 | Quality criteria SHALL include: specificity, non-redundancy, clarity, appropriate type | Must |
| FR-3.3 | System SHALL retry question generation if quality check fails (max 3 attempts) | Must |
| FR-3.4 | System SHALL return best-effort questions if max retries exceeded | Must |

### 4.4 Output Generation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | System SHALL generate job description from completed role context | Must |
| FR-4.2 | Job description SHALL include: title, summary, responsibilities, requirements (required/preferred), success indicators, team context | Must |
| FR-4.3 | System SHALL generate candidate screening filters | Must |
| FR-4.4 | System SHALL generate interview stage recommendations | Must |
| FR-4.5 | System SHALL provide rationale for each recommended stage | Should |
| FR-4.6 | All outputs SHALL be editable by user before finalizing | Should |

### 4.5 State Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-5.1 | System SHALL maintain role context state on client side during discovery | Must |
| FR-5.2 | System SHALL persist final role context and outputs to database | Must |
| FR-5.3 | Lambdas SHALL be stateless (full context passed in each request) | Must |
| FR-5.4 | System SHOULD allow resuming incomplete discovery sessions | Should |

---

## 5. Non-Functional Requirements

### 5.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-1.1 | Question generation response time | < 5 seconds |
| NFR-1.2 | Job description generation response time | < 15 seconds |
| NFR-1.3 | UI responsiveness during loading | Immediate feedback (loading state) |

### 5.2 Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-2.1 | System availability | 99.5% uptime |
| NFR-2.2 | Graceful degradation on AI failures | Return best-effort or cached response |
| NFR-2.3 | No data loss on browser refresh | State persisted or recoverable |

### 5.3 Usability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-3.1 | Time to complete baseline | < 3 minutes |
| NFR-3.2 | Total discovery session | < 15 minutes typical |
| NFR-3.3 | Questions per round | 1-3 (not overwhelming) |
| NFR-3.4 | Discovery rounds to completion | 3-5 typical |

### 5.4 Security

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-4.1 | Authentication required | Yes (existing auth system) |
| NFR-4.2 | Role data access | Scoped to organization |
| NFR-4.3 | PII handling | Minimize collection, encrypt at rest |

---

## 6. Success Metrics

### Primary KPIs

| Metric | Definition | Target | Measurement |
|--------|------------|--------|-------------|
| Completion Rate | % of started sessions that reach "ready" | > 80% | Analytics |
| Time to Completion | Minutes from start to job description generated | < 20 min median | Analytics |
| Output Quality Score | User rating of generated JD (1-5) | > 4.2 average | In-app feedback |
| Interview Alignment | % of interview questions rated "relevant" by hiring managers | > 85% | Post-interview survey |

### Secondary KPIs

| Metric | Definition | Target |
|--------|------------|--------|
| Questions per Session | Average number of dynamic questions answered | 6-12 |
| Skip Rate | % of users who skip to generation before "ready" | < 20% |
| Edit Rate | % of generated JDs that are edited | Track (lower is better) |
| Return Rate | % of users who use Phase 1 for subsequent roles | > 60% |

### Quality Indicators

| Indicator | What It Tells Us |
|-----------|------------------|
| Question specificity | Are questions referencing context or generic? |
| Context richness | How many distinct context keys accumulated? |
| Gap closure | Are gaps shrinking across rounds? |
| Contradiction detection | Are inconsistencies being flagged? |

---

## 7. Constraints & Assumptions

### Constraints

| ID | Constraint | Impact |
|----|------------|--------|
| C-1 | Must run on AWS Amplify/Lambda | Architecture decisions |
| C-2 | AI costs per session must be < $0.50 | Prompt efficiency, model selection |
| C-3 | Must integrate with existing Pipe authentication | No standalone auth |
| C-4 | Must match existing Pipe design system | UI components |

### Assumptions

| ID | Assumption | Risk if Wrong |
|----|------------|---------------|
| A-1 | Users have basic understanding of the role they're hiring for | Agent can't fill knowledge gaps |
| A-2 | 3-5 rounds of questions sufficient for most roles | May need more for complex roles |
| A-3 | Single user completes discovery (not collaborative) | Would need real-time sync |
| A-4 | English language only for MVP | Internationalization later |

### Dependencies

| ID | Dependency | Owner | Status |
|----|------------|-------|--------|
| D-1 | Anthropic API access | Engineering | Available |
| D-2 | Amplify Gen 2 Lambda support | AWS | Available |
| D-3 | Existing auth integration | Engineering | Available |
| D-4 | Design system components | Design | In progress |

---

## 8. Scope

### In Scope (MVP)

- Baseline form collection (7 fields)
- Dynamic question generation with quality loop
- Context accumulation and gap tracking
- Readiness assessment
- Job description generation
- Candidate filter generation
- Interview stage recommendations
- Single-user workflow
- Client-side state management
- Final persistence to database

### Out of Scope (MVP)

| Item | Rationale | Future Phase |
|------|-----------|--------------|
| Collaborative editing | Complexity | Phase 2 |
| Job description templates | Custom generation preferred | Phase 2 |
| Integration with ATS | Separate integration project | Phase 3 |
| Multi-language support | English first | Phase 3 |
| Bulk role import | Manual entry first | Phase 3 |
| Role comparison/analytics | Need data first | Phase 3 |
| Interview question generation | Separate Phase 2 feature | Phase 2 |

---

## 9. Risks & Mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| AI generates generic questions | Medium | High | Quality review loop, specificity criteria |
| Users abandon long sessions | Medium | High | Progress indicators, skip option, session resume |
| Generated JD doesn't match expectations | Medium | Medium | User editing, feedback loop for improvement |
| AI costs exceed budget | Low | Medium | Monitor usage, optimize prompts, caching |
| Response latency frustrates users | Medium | Medium | Loading states, streaming responses |
| Context model insufficient for complex roles | Low | Medium | Allow more rounds, manual context addition |

---

## 10. Release Criteria

### MVP Launch Criteria

- [ ] All "Must" functional requirements implemented
- [ ] Performance targets met (< 5s question generation)
- [ ] Completion rate > 70% in internal testing
- [ ] Output quality score > 4.0 in internal testing
- [ ] No critical bugs in core flow
- [ ] Security review passed
- [ ] Design review approved

### Success Criteria (30 days post-launch)

- [ ] Completion rate > 80%
- [ ] Time to completion < 20 min median
- [ ] Output quality score > 4.2
- [ ] < 5% of sessions require support intervention
- [ ] Positive qualitative feedback from 10+ users

---

## Appendix A: Competitive Analysis

| Product | Approach | Strengths | Weaknesses |
|---------|----------|-----------|------------|
| Lever | Form-based intake | Structured, ATS-integrated | Generic, no intelligence |
| Greenhouse | Template library | Quick start | One-size-fits-all |
| LinkedIn Recruiter | AI-assisted JD | Large data set | Not interview-focused |
| Metaview | Interview intelligence | Good analysis | No role definition |
| **Pipe (this)** | AI-guided discovery | Contextual, interview-focused | New, unproven |

### Differentiation

1. **Interview-first focus** — Context gathered specifically to design better interviews, not just post a job
2. **Dynamic exploration** — Questions adapt to what's been said, not fixed forms
3. **Quality assurance** — Internal review loop ensures question relevance
4. **End-to-end value** — From role understanding to interview stages in one flow

---

## Appendix B: User Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PHASE 1: ROLE DISCOVERY                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PART 1: BASELINE                                                   │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  • Job Title: [________________]                            │   │
│  │  • Level: [Junior ▼]                                        │   │
│  │  • Department: [________________]                           │   │
│  │  • Work Model: ○ Remote  ○ Hybrid  ○ Onsite                │   │
│  │  • Team Size: [________________]                            │   │
│  │  • Reports To: [________________]                           │   │
│  │  • Tech Stack: [tag] [tag] [+ add]                         │   │
│  │                                                             │   │
│  │                              [SUBMIT BASELINE]              │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  PART 2: DYNAMIC EXPLORATION                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  Agent: "I see you're hiring a Senior Backend Engineer for  │   │
│  │  a 5-person Platform team. Let me understand what success   │   │
│  │  looks like."                                               │   │
│  │                                                             │   │
│  │  ■ SUCCESS_CRITERIA                                         │   │
│  │  ┌─────────────────────────────────────────────────────┐   │   │
│  │  │ What would this person need to accomplish in their  │   │   │
│  │  │ first 90 days to be considered successful?          │   │   │
│  │  │ [                                                 ] │   │   │
│  │  │ [                                                 ] │   │   │
│  │  └─────────────────────────────────────────────────────┘   │   │
│  │                                                             │   │
│  │  Status: EXPLORING | Gaps: 4 remaining                      │   │
│  │                              [CONTINUE]  [SKIP TO GENERATE] │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┐   │
│    AGENT PANEL                                                  │   │
│  │ ┌─────────────────────────────────────────────────────────┐ │   │
│    │ Phase 1 | 33% | IN PROGRESS              ■ 3 GAPS      │   │   │
│  │ ├─────────────────────────────────────────────────────────┤ │   │
│    │ [AGENT] [CONTEXT]                                       │   │   │
│  │ ├─────────────────────────────────────────────────────────┤ │   │
│    │ ■ AGENT_STATUS                                          │   │   │
│  │ │ I have strong technical context but need to understand  │ │   │
│    │ what success looks like and how the team collaborates.  │   │   │
│  │ │                                                         │ │   │
│    │ [GATHERING] [2/6 SECTIONS]                              │   │   │
│  │ └─────────────────────────────────────────────────────────┘ │   │
│  └ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                          (repeat 3-5 rounds)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  READY STATE                                                        │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  ✓ READY TO GENERATE                                        │   │
│  │                                                             │   │
│  │  I have enough context to create your job description and  │   │
│  │  design interview stages.                                   │   │
│  │                                                             │   │
│  │  Context gathered:                                          │   │
│  │  • Role scope and responsibilities                          │   │
│  │  • Success criteria (90-day, 1-year)                        │   │
│  │  • Key challenges and complexity                            │   │
│  │  • Team dynamics and collaboration                          │   │
│  │  • Culture fit signals                                      │   │
│  │  • Technical requirements                                   │   │
│  │                                                             │   │
│  │                        [GENERATE JOB DESCRIPTION]           │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  OUTPUT: JOB DESCRIPTION + FILTERS + STAGES                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  # Senior Backend Engineer — Platform Team                  │   │
│  │                                                             │   │
│  │  ## Summary                                                 │   │
│  │  Join our Platform team to lead the migration from...      │   │
│  │                                                             │   │
│  │  ## Responsibilities                                        │   │
│  │  • Design and implement microservices architecture...       │   │
│  │                                                             │   │
│  │  [Edit] [Copy] [Export]                                     │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐   │
│  │ CANDIDATE FILTERS    │  │ SUGGESTED STAGES                 │   │
│  │ ☑ 5+ years backend  │  │ 1. Technical Screen (45 min)    │   │
│  │ ☑ Distributed sys   │  │ 2. System Design (60 min)       │   │
│  │ ☐ AWS experience    │  │ 3. Behavioral (45 min)          │   │
│  │ ☐ Team lead exp     │  │ 4. Hiring Manager (30 min)      │   │
│  └──────────────────────┘  └──────────────────────────────────┘   │
│                                                                     │
│                              [CONTINUE TO PHASE 2 →]               │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Appendix C: Glossary

| Term | Definition |
|------|------------|
| Baseline | Fixed-schema essential role information (Part 1) |
| Dynamic Context | Flexible key-value store of accumulated understanding |
| Exchange | Single question-response pair with extracted facts |
| Gap | Area of understanding the agent still needs to explore |
| Quality Loop | Internal review cycle ensuring question relevance |
| Readiness | Agent's judgment that sufficient context exists |
| Role Context | Complete state object including baseline, exchanges, and context |

---

*Document prepared for Pipe Phase 1 development*
