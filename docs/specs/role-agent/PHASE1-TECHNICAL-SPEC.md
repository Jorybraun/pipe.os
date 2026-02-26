# Phase 1: Role Discovery — Technical Specification (Amplify Gen 2)

**Version:** 2.1 (Implemented UI Shell)
**Purpose:** Implementation spec for multi-agent role discovery system
**Target:** AWS Amplify Gen 2, TypeScript, React
**Status:** UI Shell Implemented

---

## 1. System Overview

### Architecture (UI Layer)

```
┌─────────────────────────────────────────────────────────────────┐
│                     CLIENT (React + Vite)                       │
│                        Route: /pipeline/new                     │
│                                                                 │
│  ┌─────────────────────────┐       ┌─────────────────────────┐  │
│  │ MAIN CONTENT (flex: 1)  │       │ SIDEBAR (400px)         │  │
│  │                         │       │                         │  │
│  │ ┌─────────────────────┐ │       │ ┌─────────────────────┐ │  │
│  │ │ ConversationalForm  │ │       │ │ TabNav              │ │  │
│  │ │ (Grid Stacked)      │ │       │ │ [Summary] [Settings]│ │  │
│  │ └─────────────────────┘ │       │ └─────────────────────┘ │  │
│  │                         │       │                         │  │
│  └─────────────────────────┘       └─────────────────────────┘  │
│                                                                 │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                   AWS AMPLIFY GEN 2 BACKEND                     │
│                                                                 │
│  ┌────────────────────────────────────────────────────────┐    │
│  │ Amplify Data (AppSync + DynamoDB)                      │    │
│  │ - RoleContext model (owner authorization)             │    │
│  └────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

### Page Layout
- **Route:** `/pipeline/new`
- **Transitions:** Grid-area stacking (`grid-area: 1 / 1`) for phase transitions.
- **Sidebar Tabs:**
  - **Summary Tab:** Real-time visualization of extracted role data.
  - **Settings Tab:** Agent configuration (e.g., AI Follow-up opt-in).

### Performance Constraints (from Product Brief)

| Constraint | Target | Implementation |
|------------|--------|----------------|
| Question generation time | < 5 seconds | 4.5s timeout + optimized quality loop |
| AI cost per session | < $0.50 | Cost tracker middleware + circuit breaker |
| Max questions per batch | 5 | Generator validation + FormSection validator |

---

## 2. Component Integration

### 5.1 UI Shell Structure
The `RoleDiscoveryPage` implements a "Next-Gen" visual layer that breaks from standard OS Brutalism:
- **Rounded Corners:** 16px radius for primary containers.
- **AI Accent:** Purple/Blue gradients for active states and primary buttons.
- **Dynamic Feedback:** Pulsing indicators in `PhaseProgress` and success states (emerald green).

### 5.2 Settings Tab
Global preferences, previously part of the main form flow, are now isolated in the sidebar:
- `allowFollowUps` (Boolean): Controls if the `QuestionAgent` should probe deeper.
