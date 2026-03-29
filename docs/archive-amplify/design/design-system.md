# Pipe Design System — Technical Terminal

**Design Language: Technical Terminal**

Version 3.0.0 • March 2026

> This document replaces all previous design system documents. The old "Brutalist Glassmorphic" and "Modern Glassmorphic" versions have been archived at `docs/archive/design/`.

---

## Design Philosophy

The Pipe recruiter dashboard uses a **Technical Terminal** aesthetic — a dark IDE/terminal-inspired UI paired with large chromatic iridescent 3D sculptural forms as background art. The result is a precise, information-dense interface that communicates technical authority.

Key characteristics:
- **Dark terminal surfaces** — not glass, not chrome; flat dark panels with very subtle borders
- **Chromatic 3D background art** — large liquid-metal sculptural forms behind every recruiter screen; this is the core brand expression
- **Monospace UPPERCASE system labels** — `RECRUITMENT_PIPELINES`, `ALL_STATUS`, `IN_PROGRESS`, `CODE_REVIEW`
- **Mixed typography** — bold sans-serif for human-readable headings; monospace caps for system labels and badges
- **Information density** — compact rows, small badges, tight spacing; no wasted whitespace

---

## Color Tokens

```css
/* Backgrounds */
--bg-base:       #2A2A2E;   /* Page background */
--bg-surface:    #323236;   /* Cards, panels */
--bg-elevated:   #3A3A3F;   /* Dropdown menus, hover states */

/* Borders */
--border-subtle: rgba(255, 255, 255, 0.08);   /* Card borders */
--border-active: rgba(255, 255, 255, 0.16);   /* Focused/active borders */

/* Text */
--text-primary:   #E8E8EC;   /* Headings, primary content */
--text-secondary: #8888A0;   /* Subheadings, metadata */
--text-tertiary:  #5A5A70;   /* Placeholders, empty states */

/* Accent — Brand */
--accent-green:  #00E5A0;   /* Active status, scores, success */
--accent-purple: #7B6CF5;   /* IN_PROGRESS, active nav, primary action */
--accent-blue:   #5B8EF0;   /* CODE_REVIEW badge */
--accent-teal:   #3DCFB8;   /* MCQ/QUIZ badge */
--accent-amber:  #F5A623;   /* WARNING, attention states */
--danger:        #FF4F4F;   /* Delete, destructive actions */

/* Buttons */
--btn-primary-bg:     #FFFFFF;
--btn-primary-text:   #1A1A1E;
--btn-primary-border: 1px solid #FFFFFF;
```

---

## Typography

### When to use each style

| Context | Style | Example |
|---|---|---|
| Page title | Bold sans-serif, 24–32px, `#E8E8EC` | "Active Roles" |
| Section heading | Bold sans-serif, 16–20px | "Test role" |
| System label / badge | Monospace UPPERCASE, 10–12px, tracking +0.05em | `RECRUITMENT_PIPELINES` |
| Body / description | Sans-serif, 14px, `#8888A0` | "Senior Frontend Engineer" |
| Empty state | Monospace, 12px, `#5A5A70` | "No candidates yet" |
| Breadcrumb | Monospace, 11px, `#5A5A70` | `PIPELINE_STAGE / abc123` |

### Font stack

```css
--font-system:  -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
--font-mono:    "Space Mono", "Courier New", monospace;
```

---

## Border Radius

```css
--radius-card:  8px;   /* Cards, panels */
--radius-badge: 4px;   /* Status badges, chips */
--radius-btn:   4px;   /* Buttons */
--radius-input: 4px;   /* Form inputs */
```

---

## Layout Structure (Recruiter Dashboard)

```
┌─────────────────────────────────────────────────────────┐
│  [3D Chromatic Background Art — full bleed]             │
│  ┌──┐  ┌────────────────────────────┐  ┌────────────┐  │
│  │  │  │  Main Content Area         │  │ Filter     │  │
│  │  │  │  (ListingPage, Overview…)  │  │ Panel      │  │
│  │  │  │                            │  │ (optional) │  │
│  │Nav│  │                            │  │            │  │
│  │Rail│ │                            │  │            │  │
│  │  │  │                            │  │            │  │
│  └──┘  └────────────────────────────┘  └────────────┘  │
└─────────────────────────────────────────────────────────┘
```

- **Left nav rail**: icon-only, ~56px wide, active state = left accent line + `--accent-purple` icon
- **Main content**: flexible, dark surface panels on top of background art
- **Right filter panel**: optional, appears on listing/overview pages

---

## Component Patterns

### Cards

```css
.card {
  background: var(--bg-surface);       /* #323236 */
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-card);
  padding: 16px;
  /* No heavy box-shadow — content-first */
}
```

### Status Badges

Monospace UPPERCASE text, small rounded rect, colored by state:

| State | Text | Style |
|---|---|---|
| `IN_PROGRESS` | `IN_PROGRESS` | `--accent-purple` bg tint + text |
| `COMPLETED` | `COMPLETED` | `--accent-green` bg tint + text |
| `PENDING` | `PENDING` | `--text-tertiary` bg tint + text |
| `ACTIVE` | `ACTIVE` | `--accent-green` left border |

### Challenge Type Badges

| Type | Color | Style |
|---|---|---|
| `CODE_REVIEW` | `--accent-blue` `#5B8EF0` | Outlined |
| `MCQ` / `QUIZ_MCQ` | `--accent-teal` `#3DCFB8` | Outlined |
| `CODE_IMPLEMENTATION` | `--accent-purple` `#7B6CF5` | Outlined |
| `QUIZ_SHORT_ANSWER` | `--accent-amber` `#F5A623` | Outlined |

```css
.badge {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: var(--radius-badge);
  border: 1px solid currentColor;
  background: transparent;
}
```

### Buttons

Primary button: white background, dark text, uppercase, sharp corners, no pill shape.

```css
.btn-primary {
  background: #FFFFFF;
  color: #1A1A1E;
  border: 1px solid #FFFFFF;
  border-radius: var(--radius-btn);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 8px 16px;
  cursor: pointer;
}

.btn-secondary {
  background: transparent;
  color: var(--text-primary);
  border: 1px solid var(--border-active);
  /* same sizing as primary */
}

.btn-danger {
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger);
}
```

### Navigation Rail

```css
.nav-rail {
  width: 56px;
  background: var(--bg-surface);
  border-right: 1px solid var(--border-subtle);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  gap: 8px;
}

.nav-item {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--text-tertiary);
  cursor: pointer;
}

.nav-item.active {
  color: var(--accent-purple);
  /* Left accent line: */
  box-shadow: -2px 0 0 var(--accent-purple);
}
```

### Filter Panel

```css
.filter-panel {
  width: 220px;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-subtle);
  padding: 16px;
}

.filter-label {
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
```

### Empty State

```css
.empty-state {
  text-align: center;
  padding: 48px 24px;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  font-size: 12px;
}
```

---

## Background Art

Every recruiter page has a large chromatic iridescent 3D sculptural form behind the content. These are the core brand expression:
- Large, organic curved shapes (not icons or illustrations)
- Highly reflective, multi-color metallic surface (chromatic)
- Full-bleed positioned, not clipped to a container
- Dark `rgba(0,0,0,0.5)` overlay on top to keep text legible

This background is set at the layout level — individual pages do not manage it.

---

## Two Design Contexts

### Context 1: Recruiter Dashboard ✅ Implemented

Pages: `ListingPage`, `OverviewPage`, `StageDetailPage`, `SchedulingPage`

The Technical Terminal design described in this document. Fully implemented.

### Context 2: Candidate Assessment `[IN DESIGN — NOT FINAL]`

Pages: `CandidateAssessmentPage`, `CandidateScreeningPage`

The candidate-facing challenge workspace design is **under active design and not finalized**.

What exists structurally:
- `StageShell.tsx` — workspace wrapper
- `WorkspaceLayout.tsx` — 3-column CSS grid
- Panel system: `MonacoPanel`, `TextareaPanel`, `ProblemPanel`, `PreviewPanel`, `DiffAnnotationPanel`, `OptionsPanel`

The visual design for the candidate workspace is undecided. Do not apply the recruiter dashboard color tokens or layout to the candidate workspace without an explicit design decision.
