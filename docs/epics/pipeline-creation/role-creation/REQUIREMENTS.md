# Feature: Role Creation

## Overview

The Role Creation feature allows hiring managers to define a new job role with all the information needed to generate tailored interview content. This is the first step in pipeline creation and sets the foundation for all subsequent content generation.

---

## User Stories

| ID | Story | Priority |
|----|-------|----------|
| US-RC-01 | As a hiring manager, I want to create a new role by entering basic job details so that I can start building an interview pipeline | P0 |
| US-RC-02 | As a hiring manager, I want to specify required skills so that interview content focuses on relevant technologies | P0 |
| US-RC-03 | As a hiring manager, I want to define qualifications and requirements so that screening questions are generated appropriately | P0 |
| US-RC-04 | As a hiring manager, I want to set seniority level so that question difficulty matches the role | P1 |
| US-RC-05 | As a hiring manager, I want to add a job description so that the AI has full context for content generation | P1 |
| US-RC-06 | As a hiring manager, I want to save a role as draft so that I can return to it later | P1 |
| US-RC-07 | As a hiring manager, I want to duplicate an existing role so that I can quickly create similar positions | P2 |

---

## Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| REQ-RC-001 | System shall allow entering job title (required, text, max 100 chars) | P0 | Draft |
| REQ-RC-002 | System shall allow selecting department from predefined list or entering custom | P1 | Draft |
| REQ-RC-003 | System shall allow specifying work location (remote/hybrid/onsite + location) | P1 | Draft |
| REQ-RC-004 | System shall allow selecting seniority level (Junior/Mid/Senior/Staff/Principal/Lead/Manager) | P0 | Draft |
| REQ-RC-005 | System shall allow adding required skills with proficiency level (1-5 stars or Beginner/Intermediate/Advanced/Expert) | P0 | Draft |
| REQ-RC-006 | System shall allow adding nice-to-have skills separately from required | P1 | Draft |
| REQ-RC-007 | System shall allow entering qualifications as free-text bullet points | P0 | Draft |
| REQ-RC-008 | System shall allow entering responsibilities as free-text bullet points | P1 | Draft |
| REQ-RC-009 | System shall allow entering full job description (rich text) | P1 | Draft |
| REQ-RC-010 | System shall allow specifying salary range (optional) | P2 | Draft |
| REQ-RC-011 | System shall validate required fields before allowing progression | P0 | Draft |
| REQ-RC-012 | System shall auto-save form state to prevent data loss | P1 | Draft |
| REQ-RC-013 | System shall suggest skills based on job title (AI-assisted) | P1 | Draft |

---

## UI Requirements

### Layout
- Single-page form with clear sections
- Progressive disclosure (basic → advanced)
- Sticky header with role title and save status
- Fixed footer with navigation (Back / Continue to Pipeline)

### Sections

#### 1. Basic Information
- Job title (prominent, large input)
- Department (dropdown with custom option)
- Location settings (remote toggle, location input)
- Seniority level (visual selector, not dropdown)

#### 2. Skills & Technologies
- Required skills (tag input with autocomplete)
- Optional skills (separate tag input)
- Skill suggestions from AI based on title
- Proficiency level per skill (optional)

#### 3. Qualifications & Requirements
- Years of experience range (slider or inputs)
- Education requirements (optional checkboxes)
- Custom qualifications (bullet list builder)
- Must-have vs nice-to-have distinction

#### 4. Role Details (Expandable)
- Responsibilities (bullet list builder)
- Full job description (rich text editor)
- Salary range (dual slider or inputs)
- Team size/structure (optional)

### States
- Empty state (first visit)
- In-progress (partially filled)
- Valid (ready to continue)
- Saving (auto-save indicator)
- Error (validation failures)

### Interactions
- Tab through sections
- Keyboard shortcuts for common actions
- Drag to reorder skills/qualifications
- Click to remove tags
- Inline validation on blur

---

## Content Requirements

### Auto-Generated
- Skill suggestions based on job title
- Qualification suggestions based on seniority
- Responsibility templates based on role type

### User-Provided
- Job title
- Custom skills
- Custom qualifications
- Job description

### Displayed
- Section help text
- Field descriptions
- Validation messages
- AI suggestion explanations

---

## Acceptance Criteria

- [ ] User can create a role with just title and seniority (minimum viable)
- [ ] User can add unlimited skills with proficiency levels
- [ ] User can add unlimited qualifications
- [ ] Form auto-saves every 30 seconds and on field blur
- [ ] User can navigate away and return to saved state
- [ ] Validation prevents progression without required fields
- [ ] AI suggests relevant skills within 2 seconds of title entry
- [ ] All form sections are keyboard accessible
- [ ] Form works on tablet-sized screens (768px+)

---

## Out of Scope

- Editing existing published roles (separate feature)
- Role approval workflow
- Job posting to external boards
- Candidate requirements beyond qualifications
- Team/interviewer assignment

---

## Dependencies

| Depends On | For |
|------------|-----|
| Design System | Form components, inputs, buttons |
| AI Service | Skill suggestions |
| Department List | Predefined department options |

| Depended On By | For |
|----------------|-----|
| Pipeline Builder | Role context for stage suggestions |
| All Interview Stages | Role requirements for content generation |

---

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| OQ-RC-01 | Should we support multiple hiring managers per role? | Open | — |
| OQ-RC-02 | How do we handle roles that span multiple departments? | Open | — |
| OQ-RC-03 | Should seniority affect available interview stages? | Open | — |
| OQ-RC-04 | Do we need role templates for common positions? | Open | — |

---

## Design Notes

### Visual Hierarchy
1. Job title should be most prominent
2. Skills section is high-value — make it easy to add many
3. Qualifications less critical but important for screening
4. Full description is reference material — can be collapsed

### AI Integration Points
- Title → suggests skills
- Title + seniority → suggests qualifications
- Title + skills → suggests responsibilities

### Error Prevention
- Autocomplete reduces typos in skills
- Predefined lists where possible
- Inline validation before submit
