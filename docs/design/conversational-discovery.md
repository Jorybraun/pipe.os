# Design Spec: Conversational Role Discovery

**Status:** Implementation Complete (UI Shell)
**Date:** 2026-02-26
**Context:** Post-MVP Agentic Discovery Flow (`/pipeline/new/discovery`)

---

## 1. Visual Philosophy: "Next-Gen Layer"

The Conversational Discovery interface is designed to feel like a high-end, AI-powered layer sitting on top of the standard Pipe OS. While the base OS follows a strict **Brutalist** aesthetic (sharp corners, grayscale), this page intentionally **breaks convention** to signal "Agentic" intelligence.

### Key Contrast Rules
| Element | Base OS (Brutalist) | Conversational Discovery (Next-Gen) |
|---------|---------------------|-------------------------------------|
| **Corners** | 0px (Sharp) | 12px - 16px (Rounded) |
| **Colors** | Grayscale / Chrome | AI Purple / Blue Accents |
| **Glow** | Inset only | Outer Radial Glows & Pulsing Dots |
| **Motion** | Rigid / Instant | Liquid Sliding (Cubic Bezier) |

---

## 2. Layout Structure

The page uses a focused two-column grid designed for high-context data entry.

```
┌─────────────────────────────────────────────────────────────┐
│  PhaseProgress (Full Width)                                 │
├──────────────────────────────┬──────────────────────────────┤
│                              │                              │
│  Main Discovery Form         │  Draft Summary / Settings    │
│  (LiquidMetalCard Default)   │  (LiquidMetalCard Dark)      │
│  flex: 1                     │  width: 400px                │
│                              │                              │
└──────────────────────────────┴──────────────────────────────┤
```

### Main Form Container
- **Component:** `LiquidMetalCard` (variant: `default`)
- **Padding:** `48px`
- **Minimum Height:** `640px`
- **Content:** `ConversationalForm` with sliding phase transitions.

---

## 3. Component Specifications

### 3.1 PhaseProgress
Visual tracker for the 6-phase journey.
- **Current Step:** Pulsing AI Purple dot (`top: -4px`, `left: -4px`) + outer shadow glow.
- **Completed Step:** Emerald Green (`#10b981`) with `Check` icon.
- **Pending Step:** Muted tertiary text.
- **Labels:** Space Mono, 9px, `0.3em` letter-spacing, Uppercase.

### 3.2 ConversationalForm
The core interaction engine.
- **Transition:** Grid-stacked `FormFieldSet` components using `translateX` and `opacity`.
- **Timing:** `0.6s cubic-bezier(0.16, 1, 0.3, 1)`.
- **Headers:** Chrome Text Gradient (135deg stop-sequence) with drop-shadow.

### 3.3 AI-Accent Buttons
Primary action buttons for the discovery flow.
- **Style:** Sharp corners (Brutalist) but with AI Colors.
- **Background:** `linear-gradient(135deg, rgba(139, 92, 246, 0.3), rgba(59, 130, 246, 0.2))`
- **Border:** `1px solid rgba(139, 92, 246, 0.4)`
- **Text Color:** `#a78bfa` (Light Purple)
- **Hover:** `translateY(-2px)` + increased glow intensity.

### 3.4 Right Column (Tabs)
Contextual sidebar with dual-purpose tabs.
- **Component:** `TabNav` (Summary | Settings).
- **Radius:** `16px` (Next-Gen override).
- **Summary Tab:** Dynamic list of extracted facts (Title, Level, Dept, Loc).
- **Settings Tab:** Global agent configurations (e.g., AI Follow-up Toggle).
- **Tech Stack Cloud:** Auto-generated tag list using Purple Dim backgrounds.

---

## 4. Animation & Interaction

### The "Slide"
When navigating between phases, the outgoing section slides left (`-40px`) while the incoming section slides in from the right (`40px`). The grid-area stacking ensures the form container height remains fluid and the navigation buttons stay "glued" to the bottom of the active content.

### Pulsing Indicator
The `isActive` dot in the progress bar uses a 2-second ease-in-out infinite loop:
- `0%`: Opacity 1, Scale 1
- `50%`: Opacity 0.4, Scale 1.5
- `100%`: Opacity 1, Scale 1

---

## 5. Implementation Reference
- **Page:** `src/pages/RoleDiscoveryPage.tsx`
- **Form Wrapper:** `src/components/RoleDiscovery/Conversational/ConversationalForm.tsx`
- **Field Stacking:** `src/components/RoleDiscovery/Conversational/FormFieldSet.tsx`
- **Progress UI:** `src/components/RoleDiscovery/Conversational/PhaseProgress.tsx`
