# Epic: Pipeline Creation

## Overview

Enable hiring managers to create customized interview pipelines for any role through a conversational, AI-assisted interface. The system auto-generates interview content (questions, code challenges, rubrics) based on role requirements, reducing setup time from hours to minutes.

---

## Goals

1. **Reduce pipeline setup time** from hours of manual configuration to minutes of conversation
2. **Generate high-quality interview content** tailored to specific roles and requirements
3. **Enable non-technical users** to create effective technical interview pipelines
4. **Maintain flexibility** for power users to customize every detail

---

## User Personas

### Hiring Manager (Primary)
- Needs to hire for technical roles but may not be deeply technical themselves
- Wants to create a fair, consistent interview process quickly
- Values guidance on best practices

### Technical Recruiter
- Creates pipelines on behalf of hiring managers
- Handles high volume of roles across different teams
- Needs templates and quick duplication

### Engineering Lead (Secondary)
- Defines technical requirements for the role
- Reviews and approves interview content
- May want to customize specific questions or challenges

---

## User Journey

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         PIPELINE CREATION FLOW                          │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────┐ │
│   │              │    │              │    │                          │ │
│   │  CREATE ROLE │───▶│ BUILD        │───▶│  CONFIGURE STAGES        │ │
│   │              │    │ PIPELINE     │    │  (one at a time)         │ │
│   └──────────────┘    └──────────────┘    └──────────────────────────┘ │
│         │                    │                        │                │
│         ▼                    ▼                        ▼                │
│   • Job title           • AI suggests          • Click stage to edit  │
│   • Department            stages               • Agent helps configure│
│   • Requirements        • Add/remove/          • Auto-generates       │
│   • Skills needed         reorder stages         content              │
│   • Seniority           • Set pass             • Preview & save       │
│                           thresholds                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Features

### 1. Role Creation
Create a new job role with requirements that drive content generation.

**Components:**
- Job details form (title, department, location)
- Requirements builder
- Skills/qualifications input
- Seniority level selector

### 2. Pipeline Builder
Assemble interview stages into a complete pipeline.

**Components:**
- Conversational AI assistant
- Stage palette (available stage types)
- Pipeline canvas (arranged stages)
- Stage quick-config cards

### 3. Interview Stages (Individual Configuration)
Each stage type has its own configuration interface:

| Stage | Purpose | Key Configuration |
|-------|---------|-------------------|
| AI Screening | Automated phone screen | Questions, duration, pass criteria |
| AI Collaboration | Evaluate AI tool usage | Task description, evaluation rubric |
| Code Review | Find bugs in code | Code challenges, bug definitions |
| Feature Planning | Architecture skills | Requirements doc, evaluation criteria |
| Voice Interview | Technical discussion | Questions, follow-ups, rubric |
| Human Panel | Team interview | Interview guide, feedback form |

---

## Key Principles

### 1. Stages Are Modular
- Each stage is independent
- Order is user-defined, not prescribed
- Stages can be added, removed, or duplicated
- Some pipelines may skip stages entirely

### 2. Content Is Generated, Not Created
- AI generates questions, code, rubrics from role requirements
- User refines rather than writes from scratch
- Quality baseline is always high

### 3. Progressive Disclosure
- Start simple (just enter role title)
- Reveal complexity as user engages
- Power features available but not required

### 4. Context Preservation
- Role requirements flow to all stages
- Changes to role update stage suggestions
- Consistent experience across pipeline

---

## Success Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Pipeline creation time | < 15 minutes | From role entry to first publish |
| Stages configured | 3-5 per pipeline | Average stages selected |
| Content acceptance rate | > 80% | Generated content kept vs edited |
| User satisfaction | > 4.5/5 | Post-creation survey |

---

## Out of Scope (This Epic)

- Candidate-facing assessment UI
- Scoring and evaluation engine
- Pipeline analytics and reporting
- Team collaboration features
- Template library management

---

## Dependencies

| Depends On | For |
|------------|-----|
| Design System | Shared components, tokens |
| AI Service | Content generation API |
| Role/Position API | Persisting role data |

| Depended On By | For |
|----------------|-----|
| Candidate Experience | Pipeline defines their journey |
| Evaluation Engine | Rubrics define scoring |
| Analytics | Pipeline structure for reporting |

---

## Feature Breakdown

```
Epic: Pipeline Creation
│
├── Feature: Role Creation
│   └── Component: Role Details Form
│   └── Component: Requirements Builder
│   └── Component: Skills Input
│
├── Feature: Pipeline Builder
│   └── Component: Pipeline AI Assistant
│   └── Component: Stage Palette
│   └── Component: Pipeline Canvas
│   └── Component: Stage Card (Overview)
│
└── Feature: Interview Stages
    ├── Component: AI Screening Config
    ├── Component: AI Collaboration Config
    ├── Component: Code Review Config
    ├── Component: Feature Planning Config
    ├── Component: Voice Interview Config
    └── Component: Human Panel Config
```

---

## Timeline (Design Phase)

| Week | Focus |
|------|-------|
| 1 | Role Creation + Pipeline Builder prototypes |
| 2 | Code Review + Voice Interview stage prototypes |
| 3 | AI Collaboration + AI Screening stage prototypes |
| 4 | Feature Planning + Human Panel stage prototypes |
| 5 | Integration prototype + design review |
