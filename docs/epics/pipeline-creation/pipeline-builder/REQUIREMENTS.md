# Feature: Pipeline Builder

## Overview

The Pipeline Builder allows users to assemble interview stages into a complete hiring pipeline through a conversational AI interface. The AI suggests appropriate stages based on role requirements, while users can add, remove, reorder, and configure stages to match their hiring process.

---

## User Stories

| ID | Story | Priority |
|----|-------|----------|
| US-PB-01 | As a hiring manager, I want the AI to suggest a pipeline based on my role so that I have a good starting point | P0 |
| US-PB-02 | As a hiring manager, I want to add stages from a palette so that I can customize the pipeline | P0 |
| US-PB-03 | As a hiring manager, I want to remove stages I don't need so that the pipeline matches our process | P0 |
| US-PB-04 | As a hiring manager, I want to reorder stages so that candidates go through them in my preferred sequence | P0 |
| US-PB-05 | As a hiring manager, I want to click a stage to configure it so that I can customize the interview content | P0 |
| US-PB-06 | As a hiring manager, I want to see a summary of each stage so that I understand what it tests | P1 |
| US-PB-07 | As a hiring manager, I want to ask the AI questions about best practices so that I make informed decisions | P1 |
| US-PB-08 | As a hiring manager, I want to duplicate a stage so that I can have multiple similar interviews | P2 |
| US-PB-09 | As a hiring manager, I want to set pass thresholds per stage so that candidates auto-advance when ready | P1 |
| US-PB-10 | As a hiring manager, I want to publish the pipeline so that candidates can start applying | P0 |

---

## Functional Requirements

| ID | Requirement | Priority | Status |
|----|-------------|----------|--------|
| REQ-PB-001 | System shall display conversational AI assistant for pipeline guidance | P0 | Draft |
| REQ-PB-002 | System shall suggest initial pipeline stages based on role requirements | P0 | Draft |
| REQ-PB-003 | System shall display available stage types in a palette/menu | P0 | Draft |
| REQ-PB-004 | System shall allow adding stages via drag-drop or click | P0 | Draft |
| REQ-PB-005 | System shall allow removing stages with confirmation | P0 | Draft |
| REQ-PB-006 | System shall allow reordering stages via drag-drop | P0 | Draft |
| REQ-PB-007 | System shall display stage cards with summary info (name, type, duration) | P0 | Draft |
| REQ-PB-008 | System shall navigate to stage config when stage is clicked | P0 | Draft |
| REQ-PB-009 | System shall show stage configuration status (not configured/configured/complete) | P1 | Draft |
| REQ-PB-010 | System shall allow setting pass threshold (%) per stage | P1 | Draft |
| REQ-PB-011 | System shall allow enabling/disabling auto-advance per stage | P1 | Draft |
| REQ-PB-012 | System shall validate pipeline has at least one stage before publish | P0 | Draft |
| REQ-PB-013 | System shall show estimated total interview duration | P1 | Draft |
| REQ-PB-014 | System shall allow duplicating existing stages | P2 | Draft |
| REQ-PB-015 | System shall persist pipeline state across sessions | P0 | Draft |
| REQ-PB-016 | System shall support publishing pipeline (makes it live) | P0 | Draft |
| REQ-PB-017 | AI assistant shall answer questions about pipeline best practices | P1 | Draft |
| REQ-PB-018 | AI assistant shall explain why specific stages were suggested | P1 | Draft |

---

## UI Requirements

### Layout

```
┌──────────────────────────────────────────────────────────────────────┐
│  Header: Role Title | Save Status | Preview | Publish                │
├─────────────────────────────────┬────────────────────────────────────┤
│                                 │                                    │
│       LEFT PANEL (50%)          │       RIGHT PANEL (50%)            │
│                                 │                                    │
│   ┌─────────────────────────┐   │   ┌────────────────────────────┐   │
│   │   AI Assistant Chat     │   │   │   Pipeline Canvas          │   │
│   │                         │   │   │                            │   │
│   │   [Avatar] AI message   │   │   │   ┌──────────────────────┐ │   │
│   │                         │   │   │   │ Stage 1: Screening   │ │   │
│   │        User message [U] │   │   │   └──────────────────────┘ │   │
│   │                         │   │   │            ↓               │   │
│   │   [Avatar] AI message   │   │   │   ┌──────────────────────┐ │   │
│   │                         │   │   │   │ Stage 2: AI Collab   │ │   │
│   │   ┌─────────────────┐   │   │   │   └──────────────────────┘ │   │
│   │   │ Quick Replies   │   │   │   │            ↓               │   │
│   │   └─────────────────┘   │   │   │   ┌──────────────────────┐ │   │
│   │                         │   │   │   │ Stage 3: Code Review │ │   │
│   │   ┌─────────────────┐   │   │   │   └──────────────────────┘ │   │
│   │   │ Type message... │   │   │   │                            │   │
│   │   └─────────────────┘   │   │   │   [+ Add Stage]            │   │
│   └─────────────────────────┘   │   └────────────────────────────┘   │
│                                 │                                    │
│                                 │   Pipeline Summary                 │
│                                 │   • 3 stages • ~2 hours total      │
│                                 │   • 2 configured, 1 pending        │
│                                 │                                    │
└─────────────────────────────────┴────────────────────────────────────┘
```

### Left Panel: AI Assistant

**Components:**
- Chat message thread (scrollable)
- AI avatar with stage-colored accent
- User message bubbles (right-aligned)
- Assistant message bubbles (left-aligned)
- Quick reply buttons (contextual suggestions)
- Text input with send button

**Behavior:**
- Initial message welcomes and shows suggested pipeline
- Responds to questions about stages and best practices
- Updates when pipeline changes ("I see you added Code Review...")
- Offers guidance when user seems stuck

### Right Panel: Pipeline Canvas

**Components:**
- Vertical list of stage cards
- Connector lines between stages (arrows)
- "Add Stage" button at bottom
- Stage palette/modal when adding
- Drag handles on stage cards

**Stage Card (Summary View):**
```
┌─────────────────────────────────────────────────────┐
│ ≡  [Icon] Stage Name                    [···] Menu  │
│     Stage type • Duration • Status badge            │
│     Pass threshold: 70%    [Edit]                   │
└─────────────────────────────────────────────────────┘
```

**Stage Palette (Add Stage Modal):**
- Grid of available stage types
- Each type shows: icon, name, description, typical duration
- Click to add, drag to position

### Header

- Role title (link back to role edit)
- Auto-save status indicator
- Preview button (see candidate view)
- Publish button (make live)

### States

| State | Behavior |
|-------|----------|
| Empty | Show welcome message, suggest starting pipeline |
| Has stages | Show stage cards, enable publish when valid |
| Editing | Show drag handles, allow reorder |
| Publishing | Show confirmation dialog |
| Published | Show "Live" badge, edit creates draft |

---

## Content Requirements

### AI-Generated
- Initial pipeline suggestion based on role
- Explanation of why stages were chosen
- Best practice recommendations
- Warning if pipeline seems incomplete

### User-Controlled
- Stage selection and order
- Pass thresholds
- Auto-advance settings
- Stage removal decisions

### Displayed
- Stage summaries (type, duration, config status)
- Total pipeline duration estimate
- Configuration completeness indicator

---

## AI Assistant Behavior

### Initial Message
When pipeline builder loads:
```
"Based on your [Role Title] position, I recommend a [N]-stage pipeline:

1. **AI Screening** — Quick qualification check (15 min)
2. **AI Collaboration** — How they work with AI tools (45 min)
3. **Code Review** — Bug detection skills (30 min)
4. **Voice Interview** — Technical deep-dive (30 min)
5. **Human Panel** — Team fit assessment (60 min)

This covers technical skills, AI proficiency, and culture fit.
Click any stage to configure it, or ask me to adjust the pipeline."
```

### Quick Replies (Contextual)
- After suggestion: "Why this order?" | "Remove a stage" | "Add more stages"
- After adding stage: "Configure this stage" | "Tell me about it"
- After configuring: "Review pipeline" | "What's next?"

### Response Patterns
- Explains reasoning for suggestions
- Offers alternatives when asked
- Warns about potential gaps
- Celebrates progress ("Great, your pipeline is almost ready!")

---

## Acceptance Criteria

- [ ] AI suggests pipeline within 3 seconds of page load
- [ ] User can add a stage in under 3 clicks
- [ ] User can reorder stages via drag-drop
- [ ] User can remove a stage with confirmation
- [ ] Stage cards show configuration status (pending/complete)
- [ ] Total duration updates automatically when stages change
- [ ] Pipeline persists if user navigates away
- [ ] Publish requires at least one configured stage
- [ ] AI responds to user questions within 2 seconds
- [ ] Works on tablet-sized screens (768px+)

---

## Out of Scope

- Stage configuration UI (separate feature per stage type)
- Pipeline templates library
- Pipeline versioning/history
- Comparison between pipeline versions
- Team collaboration on pipeline editing

---

## Dependencies

| Depends On | For |
|------------|-----|
| Role Creation | Role context for AI suggestions |
| Design System | Cards, buttons, chat components |
| AI Service | Pipeline suggestions and chat |

| Depended On By | For |
|----------------|-----|
| All Interview Stages | Navigation from pipeline to stage config |
| Publishing System | Pipeline structure to publish |

---

## Open Questions

| ID | Question | Status | Resolution |
|----|----------|--------|------------|
| OQ-PB-01 | Should stages have estimated candidate drop-off rates? | Open | — |
| OQ-PB-02 | Can the same stage type appear multiple times? | Open | — |
| OQ-PB-03 | Should we show a timeline/calendar view option? | Open | — |
| OQ-PB-04 | How do we handle conditional branching (if/then stages)? | Open | — |

---

## Design Notes

### AI Personality
- Helpful and knowledgeable
- Not pushy — respects user decisions
- Explains reasoning when asked
- Celebrates progress

### Visual Flow
- Vertical pipeline emphasizes sequence
- Arrows show progression
- Color-coded by stage type
- Clear status indicators

### Error Prevention
- Confirm before removing stages
- Warn if pipeline seems incomplete
- Validate before publish
