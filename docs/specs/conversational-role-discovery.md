# Tech Spec: Conversational Role Discovery Flow

**Status:** UI Implementation Complete
**Author:** Archer (Principal Architect)
**Date:** 2026-02-26

## 1. Goal & Context
Create a "Conversational" onboarding experience for role discovery. The UI feels like a guided dialogue, while the underlying architecture remains a single, semantically valid HTML form. The data structure supports future AI-driven follow-up questions for every field.

## 2. Frontend Architecture

### 3.1 Component Structure
- `RoleDiscoveryPage`: Container managing the `RoleContext` state and layout.
- `PhaseProgress`: Visual indicator with pulsing active states and success feedback.
- `ConversationalForm`: The core `<form>` wrapper.
  - `FormFieldSet`: Represents a "Phase". Uses grid stacking for transitions.
- `TabNav`: Sidebar navigation for switching between "Summary" and "Settings".

### 3.2 Navigation & Visual Flow (Grid Stacking)
- **Grid-Area Stacking:** All `FormFieldSet` components are stacked in the same grid cell (`grid-area: 1 / 1`).
- **Semantic Continuity:** All fields remain in the DOM for browser autofill and validation.
- **Transitions:**
  - Active section: `opacity: 1`, `transform: translateX(0)`, `pointer-events: auto`.
  - Inactive sections: `opacity: 0`, `transform: translateX(±40px)`, `pointer-events: none`, `aria-hidden: true`.
  - This ensures the container height calculates correctly based on the active content while maintaining smooth horizontal slides.

### 3.3 State Management
- Local React state manages form data and current phase.
- Sidebar settings (e.g., AI Follow-ups) are integrated into the global discovery data object.

## 4. Design Overrides (Next-Gen Layer)
To signal agentic intelligence, this page intentionally breaks the base OS's brutalist rules:
- **Rounded Corners:** 16px radius for the sidebar and 12px for glass components.
- **AI Accents:** Pulsing indicators and purple/blue gradients for primary actions.
- **Vibrant Glass:** Use of semi-translucent purple glass for agent-specific controls.

## 5. Extensibility Path (Phase 2)
- **AI Integration:** Add `onBlur` or `onStepComplete` effects to trigger the `QuestionAgent` Lambda.
- **Dynamic Updates:** The `nextSection` returned by the agent will be rendered reactively within the grid-stacked flow.
