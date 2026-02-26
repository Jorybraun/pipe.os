# Phase 1: Role Discovery — Business Requirements Document

**Version:** 1.1  
**Last Updated:** February 2026  
**Status:** UI Shell Implemented
**Owner:** Product

---

## 1. Executive Summary

### Problem Statement

Hiring managers and recruiters struggle to translate their understanding of a role into effective interview processes. Common failures include:

- **Generic job descriptions** that don't reflect actual role needs
- **Misaligned interviews** that test skills irrelevant to the role
- **Inconsistent evaluation** because success criteria were never defined
- **Wasted cycles** when interviewers discover missing context mid-process

### Proposed Solution

An AI-guided role discovery experience that:

1. Collects essential role information through a guided multi-phase journey.
2. Dynamically explores deeper context through intelligent follow-up questions.
3. Uses a "Next-Gen" UI layer to signal agentic intelligence and break from Brutalist conventions.
4. Generates job descriptions, candidate filters, and stage recommendations.

---

## 2. User Personas (Unchanged)
*Refer to previous version for details on Hiring Manager, Recruiter, and HR personas.*

---

## 3. User Stories

### Epic: Role Context Collection

#### US-1: Conversational Discovery
**As a** hiring manager  
**I want to** engage in a guided, conversational journey  
**So that** I provide rich context without being overwhelmed by a single massive form.

**Acceptance Criteria:**
- 6-phase journey: Identity, Team, Tech, Success, Challenges, Culture.
- Visual "Next-Gen" styling (rounded corners, AI gradients).
- Fluid sliding transitions between phases.
- Persistent "Draft Summary" sidebar to see progress in real-time.

#### US-2: Agent Configuration
**As a** hiring manager  
**I want to** configure the AI agent's behavior (like enabling follow-ups)  
**So that** I can control the depth of the discovery process.

**Acceptance Criteria:**
- Dedicated "Settings" tab in the sidebar for configuration.
- Global toggle for AI follow-up questions.

---

## 4. Functional Requirements

### 4.1 Guided Collection (Part 1)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | System SHALL use a 6-phase guided flow for baseline collection. | Must |
| FR-1.2 | System SHALL implement a single semantic form with grid-stacked phases. | Must |
| FR-1.3 | System SHALL provide a persistent "Draft Summary" sidebar. | Must |
| FR-1.4 | System SHALL implement a tabbed sidebar (Summary/Settings). | Must |

---

## Appendix B: User Flow Diagram (Implemented UI)

```
┌─────────────────────────────────────────────────────────────────────┐
│                         PHASE 1: ROLE DISCOVERY                     │
│                            Route: /pipeline/new                     │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌───────────────────────────────────┬─────────────────────────────────┐
│  MAIN INTERFACE (Grid Stacked)    │  SIDEBAR (Tabbed Navigation)    │
│                                   │                                 │
│  Phase 1: ROLE IDENTITY           │  [SUMMARY] [SETTINGS]           │
│  ┌─────────────────────────────┐  │  ┌───────────────────────────┐  │
│  │ • Job Title: [            ] │  │  │ DRAFT_SUMMARY             │  │
│  │ • Level:     [ Mid      ▼ ] │  │  │                           │  │
│  │ • Dept:      [ Engineering] │  │  │ ROLE: SENIOR_ENGINEER     │  │
│  │ • Loc:       [○ Hybrid    ] │  │  │ LEVEL: MID                │  │
│  │                             │  │  │                           │  │
│  │ [NEXT_STEP]                 │  │  │ ■ TECH_STACK              │  │
│  └─────────────────────────────┘  │  │ [REACT] [TS]              │  │
│                                   │  └───────────────────────────┘  │
│               ║                   │                                 │
│               ▼ (Liquid Slide)    │  [SUMMARY] [SETTINGS]           │
│                                   │  ┌───────────────────────────┐  │
│  Phase 2: TEAM CONTEXT            │  │ AGENT_CONFIGURATION       │  │
│  ┌─────────────────────────────┐  │  │                           │  │
│  │ • Team Size: [            ] │  │  │ AI FOLLOW-UPS: [ON]       │  │
│  │ • Reports To: [           ] │  │  │                           │  │
│  │                             │  │  │                           │  │
│  │ [BACK] [NEXT_STEP]          │  │  │                           │  │
│  └─────────────────────────────┘  │  └───────────────────────────┘  │
└───────────────────────────────────┴─────────────────────────────────┘
                                    │
                          (repeat for 6 phases)
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  READY STATE (Post-Phase 6)                                         │
│  ✓ Context Gathered | ✓ Job Description Ready                       │
└─────────────────────────────────────────────────────────────────────┘
```
