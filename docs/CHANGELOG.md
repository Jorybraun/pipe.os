# Pipe — Pipeline Creation Epic

## Project Structure

```
pipe-design/
├── CHANGELOG.md                    # Master changelog (this file)
├── README.md                       # Project overview
│
├── epics/
│   └── pipeline-creation/
│       ├── EPIC.md                 # Epic overview and goals
│       │
│       ├── role-creation/
│       │   ├── REQUIREMENTS.md     # Feature requirements
│       │   ├── CHANGELOG.md        # Feature changelog
│       │   └── prototype.jsx       # UI prototype
│       │
│       ├── pipeline-builder/
│       │   ├── REQUIREMENTS.md
│       │   ├── CHANGELOG.md
│       │   └── prototype.jsx
│       │
│       └── interview-stages/
│           ├── REQUIREMENTS.md     # Shared stage requirements
│           │
│           ├── ai-screening/
│           │   ├── REQUIREMENTS.md
│           │   ├── CHANGELOG.md
│           │   └── prototype.jsx
│           │
│           ├── code-review/
│           │   ├── REQUIREMENTS.md
│           │   ├── CHANGELOG.md
│           │   └── prototype.jsx
│           │
│           ├── voice-interview/
│           │   ├── REQUIREMENTS.md
│           │   ├── CHANGELOG.md
│           │   └── prototype.jsx
│           │
│           └── human-panel/
│               ├── REQUIREMENTS.md
│               ├── CHANGELOG.md
│               └── prototype.jsx
│
└── design-system/
    ├── TOKENS.md                   # Colors, spacing, typography
    └── COMPONENTS.md               # Shared component patterns
```

---

## Master Changelog

All changes across the project are logged here with references to feature-specific changelogs.

### [Unreleased]

#### 2024-12-19 — Technical Specifications

**Added**

- Created main technical specification (`TECH-SPEC.md`) covering:
  - AWS architecture (Amplify assessment, recommended stack)
  - DynamoDB vs PostgreSQL analysis (chose DynamoDB for MVP)
  - Single-table design pattern
  - AI architecture with Bedrock
  - Security and authorization model
  - Cost estimation
- Created Code Review stage technical spec:
  - Full data models (Stage, Challenge, Bug, File, Rubric)
  - Multi-file challenge support
  - Rubric system with versioning
  - Comment quality evaluation criteria
  - AI agent system prompt and tools
  - API contracts
  - Implementation phases

**Architecture Decisions**

- AWS Amplify for MVP with CDK ejection path
- DynamoDB (serverless, flexible schema, cost-effective)
- Amazon Bedrock with Claude 3.5 Sonnet
- Serverless-first (Lambda, API Gateway)
- S3 for large files, DynamoDB for structured data

#### 2024-12-18 — Project Initialization

**Added**

- Created project structure for Pipeline Creation epic
- Established changelog format and requirements tracking approach
- Defined component hierarchy: Epic → Features → Stages

**Architecture Decisions**

- Pipeline stages are NOT ordered — users can arrange them freely
- Each stage is an independent component with its own requirements
- Stage configuration happens through contextual AI agents
- All content (questions, code, rubrics) is auto-generated from role requirements

---

## Changelog Format

Each feature maintains its own CHANGELOG.md following this format:

```markdown
# [Feature Name] Changelog

## [Unreleased]

### YYYY-MM-DD — Change Title

**Context**: Why this change was made

**Added**

- New functionality

**Changed**

- Modified behavior

**Removed**

- Deprecated functionality

**Requirements Impact**

- REQ-XXX: [Status: Added/Modified/Removed]

**Open Questions**

- Questions that need resolution
```

---

## Requirements Format

Each feature maintains REQUIREMENTS.md with:

```markdown
# [Feature Name] Requirements

## Overview

Brief description of the feature

## User Stories

- As a [user], I want to [action] so that [benefit]

## Functional Requirements

| ID      | Requirement | Priority | Status                     |
| ------- | ----------- | -------- | -------------------------- |
| REQ-001 | Description | P0/P1/P2 | Draft/Approved/Implemented |

## UI Requirements

- Layout and structure
- Interactions and states
- Responsive behavior

## Content Requirements

- What content is displayed
- What content is auto-generated
- What content is user-editable

## Acceptance Criteria

- [ ] Criterion 1
- [ ] Criterion 2

## Out of Scope

- What this feature does NOT include

## Dependencies

- Other features this depends on
- Other features that depend on this

## Open Questions

- Unresolved decisions
```

---

## Next Steps

1. Create Epic overview document
2. Create Role Creation feature (REQUIREMENTS.md + prototype)
3. Create Pipeline Builder feature (REQUIREMENTS.md + prototype)
4. Create each Interview Stage feature individually

---

## Working Files

| Component               |  Requirements  |  Tech Spec  |  Prototype  | Status         |
| ----------------------- | :------------: | :---------: | :---------: | -------------- |
| High-Level Architecture |       —        | ✅ Complete |      —      | 🟢             |
| Epic Overview           |  ✅ Complete   |      —      |      —      | 🟢 Complete    |
| Role Creation           |  ✅ Complete   |   Pending   |   Pending   | 🟡 Reqs Done   |
| Pipeline Builder        |  ✅ Complete   |   Pending   |   Pending   | 🟡 Reqs Done   |
| AI Screening Stage      | 📝 Placeholder |   Pending   |   Pending   | ⚪ Placeholder |
| AI Collaboration Stage  | 📝 Placeholder |   Pending   |   Pending   | ⚪ Placeholder |
| Code Review Stage       |  🟡 In-Progress | ✅ Complete | ✅ Complete | 🟢 Complete    |
| Feature Planning Stage  | 📝 Placeholder |   Pending   |   Pending   | ⚪ Placeholder |
| Voice Interview Stage   |  ✅ Complete   |   Pending   |   Pending   | 🟡 Reqs Done   |
| Human Panel Stage       | 📝 Placeholder |   Pending   |   Pending   | ⚪ Placeholder |

### Legend

- 🟢 Complete: Requirements, tech spec, and prototype done
- 🟡 Reqs Done: Requirements complete, other items pending
- ⚪ Placeholder: Awaiting full requirements development
