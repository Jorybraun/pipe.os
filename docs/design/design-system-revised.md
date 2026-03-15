# Pipe Design System

**Modern Glassmorphic Design System**

Version 2.0.0 • March 2026

---

## Design Philosophy

The Pipe design system combines **transparent glass layers** with **subtle depth effects** and **precise typography** to create a clean, functional interface. The design language is characterized by:

- **Glassmorphic Cards**: Transparent backgrounds with subtle gradient depth and backdrop blur
- **Minimal Ornamentation**: Functional-first layouts with intentional whitespace and clear hierarchy
- **Transparent Layers**: Heavy blur effects (40px) with backdrop filters for visual depth without clutter
- **Monospace Typography**: Space Mono for technical precision and consistent visual rhythm
- **Dark Foundation**: Deep dark base (#0c0c0e) with transparent overlay surfaces

---

## Design Tokens at a Glance

### Colors

```css
/* Foundation */
--background: #0c0c0e;
--text-primary: #ffffff;
--text-secondary: rgba(255, 255, 255, 0.6);
--text-tertiary: rgba(255, 255, 255, 0.4);

/* Semantic Status */
--success: #10b981;        /* Green - active/passing */
--warning: #f59e0b;        /* Amber - draft/caution */
--error: #ef4444;          /* Red - error state */
--info: #3b82f6;           /* Blue - informational */

/* Challenge Type Badges */
--challenge-code-review: #60a5fa;           /* Blue */
--challenge-implementation: #a78bfa;        /* Purple */
--challenge-quiz-mcq: #4ade80;              /* Green */
--challenge-quiz-short-answer: #fbbf24;     /* Amber */

/* AI/Agent Accent */
--ai-primary: rgba(139, 92, 246, 0.8);
--ai-secondary: rgba(167, 139, 250, 0.6);
--ai-glow: rgba(139, 92, 246, 0.4);
```

### Spacing Scale

```css
--space-xs: 4px;
--space-sm: 8px;
--space-md: 12px;
--space-lg: 16px;
--space-xl: 20px;
--space-2xl: 24px;
--space-3xl: 32px;
--space-4xl: 48px;
--space-5xl: 60px;
```

### Effects

```css
/* Glassmorphic Depth */
--blur-primary: blur(40px);
--saturate: saturate(150%);
--glass-effect: var(--blur-primary) var(--saturate);

/* Subtle Highlight */
--inset-light: inset 0 1px 0 rgba(255, 255, 255, 0.1);
--shadow-elevation: 0 20px 60px rgba(0, 0, 0, 0.4);

/* Combined Glass */
--glass-full: var(--shadow-elevation), var(--inset-light);
```

### Typography

```css
--font-primary: "Space Mono", "Courier New", monospace;
--font-display: "Monument Extended", "Space Grotesk", sans-serif;

/* Pragmatic Type Scale (7–28px, actual implementation) */
--text-micro: 7px;         /* Indicators */
--text-tiny: 8px;          /* Micro labels */
--text-caption: 9px;       /* Labels, captions */
--text-small: 11px;        /* Secondary text */
--text-body: 13px;         /* Primary body text */
--text-h3: 18px;           /* Subsections */
--text-h2: 24px;           /* Section headers */
--text-h1: 28px;           /* Page titles (was 48px) */

/* Letter Spacing */
--spacing-tight: -0.02em;
--spacing-normal: 0.05em;
--spacing-medium: 0.2em;
--spacing-wide: 0.4em;

/* Font Weights */
--weight-regular: 400;
--weight-bold: 700;
--weight-display: 800;
```

---

## Color Palette

### Base Colors

```css
/* Foundation */
--background: #0c0c0e;
--text-primary: #ffffff;
--text-secondary: rgba(255, 255, 255, 0.6);
--text-tertiary: rgba(255, 255, 255, 0.4);

/* Glass Tints */
--chrome-light: rgba(255, 255, 255, 0.2);
--chrome-medium: rgba(200, 200, 220, 0.15);
--chrome-dark: rgba(180, 180, 200, 0.08);
```

### Semantic Colors

```css
/* Status */
--success: #10b981;
--warning: #f59e0b;
--error: #ef4444;
--info: #3b82f6;

/* AI/Agent */
--ai-primary: rgba(139, 92, 246, 0.8);
--ai-secondary: rgba(167, 139, 250, 0.6);
--ai-glow: rgba(139, 92, 246, 0.4);
```

---

## Typography

### Font Stack

```css
--font-primary: "Space Mono", "Courier New", monospace;
--font-display: "Monument Extended", "Space Grotesk", sans-serif;
```

### Type Scale (Pragmatic Implementation)

These sizes are based on actual implementation across all challenge types and interfaces, optimized for clarity and screen real estate.

```css
/* Headers */
--text-h1: 28px;           /* Page titles */
--text-h2: 24px;           /* Section headers */
--text-h3: 18px;           /* Subsections */

/* Body */
--text-body: 13px;         /* Primary body text */
--text-small: 11px;        /* Secondary text */
--text-caption: 9px;       /* Labels, captions */
--text-tiny: 8px;          /* Micro labels */
--text-micro: 7px;         /* Indicators */
```

### Letter Spacing

```css
--spacing-wide: 0.4em;     /* Section labels */
--spacing-medium: 0.2em;   /* Buttons, tags */
--spacing-normal: 0.05em;  /* Body text */
--spacing-tight: -0.02em;  /* Display text */
```

---

## Component Variants

### LiquidMetalCard

The core container component with four variants, each a glassmorphic card with subtle gradient depth.

#### Default

```css
background: rgba(180, 180, 190, 0.08);
border: 1px solid rgba(255, 255, 255, 0.12);
backdrop-filter: blur(40px) saturate(150%);
border-radius: 12px;
```

**Usage**: General containers, secondary panels

#### Chrome

```css
background: rgba(220, 220, 230, 0.15);
border: 1px solid rgba(255, 255, 255, 0.2);
backdrop-filter: blur(40px) saturate(150%);
border-radius: 12px;
```

**Usage**: Primary content areas, featured cards

#### Mercury

```css
background: rgba(200, 210, 230, 0.12);
border: 1px solid rgba(200, 210, 240, 0.15);
backdrop-filter: blur(40px) saturate(150%);
border-radius: 12px;
```

**Usage**: Highlighted sections, emphasis zones

#### Dark

```css
background: rgba(40, 40, 50, 0.6);
border: 1px solid rgba(255, 255, 255, 0.1);
backdrop-filter: blur(40px) saturate(150%);
border-radius: 12px;
```

**Usage**: Nested or secondary content, background layers

### Hover Effects

```css
/* Card Hover */
transform: translateY(-2px);
box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15);
transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);

/* Chrome Sweep Animation */
.chrome-sweep {
  background: linear-gradient(
    90deg,
    transparent,
    rgba(255, 255, 255, 0.1),
    transparent
  );
  transition: left 0.6s cubic-bezier(0.16, 1, 0.3, 1);
}
```

---

## Layout System

### Grid Structure

```css
/* Main Layout */
max-width: 1400px;
margin: 0 auto;

/* Sidebar */
width: 80px;
position: fixed;
left: 0;
top: 100px;

/* Agent Panel */
width: 400px;
position: fixed;
left: 80px;
top: 100px;

/* Main Content Shifts */
margin-left: 80px;         /* Sidebar only */
margin-left: 480px;        /* Sidebar + Agent */
transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

### Spacing Scale

```css
--space-xs: 4px;
--space-sm: 8px;
--space-md: 12px;
--space-lg: 16px;
--space-xl: 20px;
--space-2xl: 24px;
--space-3xl: 32px;
--space-4xl: 48px;
--space-5xl: 60px;
```

---

## Background Effects

### Floating Depth Layer

```css
/* Animated glassmorphic orbs for background depth */
background: radial-gradient(
  ellipse at 30% 30%,
  rgba(255, 255, 255, 0.15) 0%,
  rgba(200, 210, 230, 0.08) 30%,
  transparent 100%
);
filter: blur(60px);
animation: float 2s ease-out infinite;
```

### Grid Pattern

```css
background-image: 
  linear-gradient(rgba(255, 255, 255, 0.015) 1px, transparent 1px),
  linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px);
background-size: 80px 80px;
```

---

## Interactive Elements

### Icon Buttons

```css
/* Base State */
width: 48px;
height: 48px;
border-radius: 12px;
color: rgba(255, 255, 255, 0.4);
transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);

/* Hover State */
background: rgba(255, 255, 255, 0.08);
color: rgba(255, 255, 255, 0.7);
transform: translateX(4px);

/* Active State */
background: linear-gradient(
  135deg,
  rgba(255, 255, 255, 0.15),
  rgba(200, 200, 220, 0.1)
);
box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
```

### Active Indicator

```css
/* Left accent line for active navigation state */
position: absolute;
left: -12px;
width: 3px;
height: 24px;
background: linear-gradient(
  180deg,
  rgba(255, 255, 255, 0.8),
  rgba(200, 200, 220, 0.6)
);
border-radius: 0 2px 2px 0;
box-shadow: 0 0 12px rgba(255, 255, 255, 0.4);
```

### Pulsing Indicator

```css
/* Notification dot with subtle pulse */
width: 6px;
height: 6px;
border-radius: 50%;
background: rgba(139, 92, 246, 0.8);
box-shadow: 0 0 8px rgba(139, 92, 246, 0.6);
animation: pulse 2s ease-in-out infinite;

@keyframes pulse {
  0%, 100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.6;
    transform: scale(0.95);
  }
}
```

---

## Score Visualization

### MetalScoreRing

```css
/* Glassmorphic progress ring with subtle glow */
stroke: url(#glass-gradient);
stroke-width: 6px;
stroke-linecap: round;
transition: stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1);

/* Background glow */
radial-gradient(circle,
  rgba(200, 210, 230, 0.15) 0%,
  transparent 70%
);
filter: blur(10px);
```

### Progress Bars

```css
/* Track */
height: 6px;
background: rgba(255, 255, 255, 0.05);
border-radius: 3px;

/* Fill with subtle gradient */
background: linear-gradient(
  90deg,
  rgba(200, 210, 230, 0.3) 0%,
  rgba(255, 255, 255, 0.7) 50%,
  rgba(180, 190, 220, 0.5) 100%
);
box-shadow: 0 0 20px rgba(200, 210, 230, 0.4);
transition: width 1s cubic-bezier(0.16, 1, 0.3, 1);
```

---

## Animation Principles

### Timing Functions

```css
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1);     /* Default */
--ease-smooth: cubic-bezier(0.16, 1, 0.3, 1);     /* Smooth */
--ease-bounce: cubic-bezier(0.68, -0.55, 0.265, 1.55);  /* Bounce */
```

### Duration Scale

```css
--duration-fast: 0.2s;     /* Instant feedback */
--duration-normal: 0.3s;   /* Standard transitions */
--duration-slow: 0.6s;     /* Sweep effects */
--duration-slower: 1.2s;   /* Progress animations */
```

---

## Accessibility

### Focus States

```css
/* Keyboard Focus */
outline: 2px solid rgba(139, 92, 246, 0.6);
outline-offset: 2px;
```

### Text Contrast

All text maintains minimum WCAG AA contrast ratios:

- Primary text: #fff on #0c0c0e (18.5:1)
- Secondary text: rgba(255,255,255,0.6) (11.1:1)
- Tertiary text: rgba(255,255,255,0.4) (7.4:1)

---

## Best Practices

### Component Usage

1. **Always use LiquidMetalCard** for containers requiring visual depth
2. **Prefer 'chrome' variant** for primary content areas
3. **Use 'mercury' variant** for highlighted or emphasized sections
4. **Use 'dark' variant** for nested or secondary content
5. **Enable hover effects** only on interactive cards

### Layout Guidelines

1. **Max content width**: 1400px
2. **Sidebar width**: 80px fixed
3. **Agent panel width**: 400px fixed
4. **Standard padding**: 24px for large containers, 16px for compact areas
5. **Gap spacing**: Use 8px, 16px, or 24px for consistency

### Performance

1. **backdrop-filter**: Use sparingly, combine with opacity for performance
2. **Transitions**: Limit to transform and opacity where possible
3. **Blur radius**: Keep at 40px for glassmorphic effects
4. **SVG animations**: Use CSS transforms over attribute changes

---

## Component API

### LiquidMetalCard Props

```typescript
interface LiquidMetalCardProps {
  children: ReactNode;
  style?: CSSProperties;
  variant?: "default" | "chrome" | "mercury" | "dark";
  hover?: boolean;
  className?: string;
}
```

### ProfileLayout Props

```typescript
interface ProfileLayoutProps {
  header: ReactNode;
  children: ReactNode;
  sidebar?: ReactNode;
  showSidebar?: boolean;
  agentPanel?: ReactNode;
  isAgentOpen?: boolean;
}
```

### SidebarNav Props

```typescript
interface SidebarNavProps {
  activeSection?: string;
  onSectionChange?: (section: string) => void;
  isAgentOpen?: boolean;
  onAgentToggle?: () => void;
}
```

### MetalScoreRing Props

```typescript
interface MetalScoreRingProps {
  value: number;     // 0-100
  size?: number;     // Default: 120
  label?: string;
}
```

---

## Usage Examples

### Basic Card

```tsx
<LiquidMetalCard variant="chrome" hover>
  <div style={{ padding: 24 }}>
    <h3>Card Title</h3>
    <p>Card content</p>
  </div>
</LiquidMetalCard>
```

### Score Display

```tsx
<MetalScoreRing value={91} size={140} label="SCORE" />
```

### Full Layout

```tsx
<ProfileLayout
  header={<ProfileHeader title="TITLE" subtitle="SUBTITLE" />}
  sidebar={<SidebarNav />}
  agentPanel={<AgentPanel />}
  isAgentOpen={isOpen}
>
  {/* Main content */}
</ProfileLayout>
```

---

## Asset Requirements

### Fonts

- Space Mono (400, 700) - Google Fonts
- Monument Extended (optional display font)

### Icons

- All icons via Lucide React library

---

## Browser Support

- Chrome 90+
- Firefox 88+
- Safari 14+
- Edge 90+

**Note**: backdrop-filter requires recent browser versions. Fallback to solid backgrounds for older browsers.

---

## Component Inventory & Status

Tracked as of 2026-03-13. Every component is marked **built**, **unused**, or **partial** based on current codebase state.

| Component | Status | Usage | Storybook | Tests | Notes |
|---|---|---|---|---|---|
| **LiquidMetalCard** | ✅ Built | ✅ Everywhere | ❌ | ❌ | Most reused primitive |
| **Toggle** | ✅ Built | ✅ Profile settings | ✅ | ✅ | Complete |
| **TabNav** | ✅ Built | ✅ Candidate profile | ✅ | ✅ | Complete |
| **ButtonGroup** | ✅ Built | ✅ Filter/action groups | ❌ | ❌ | Needs stories |
| **NumberInput** | ✅ Built | ❌ Unused | ✅ | ❌ | Ready but not wired |
| **SubTitle** | ✅ Built | ❌ Unused (inline instead) | ❌ | ❌ | Lower priority |
| **MetalScoreRing** | ✅ Built | ✅ Candidate profile | ❌ | ❌ | Core for MVP |
| **TextInput** | ✅ Built | ✅ Forms throughout | ❌ | ❌ | High priority |
| **SelectInput** | ✅ Built | ✅ Pipeline/stage forms | ❌ | ❌ | Medium priority |
| **TextareaInput** | ✅ Built | ✅ SHORT_ANSWER challenges | ❌ | ❌ | Medium priority |
| **TagsInput** | ✅ Built | ❌ Unused | ❌ | ❌ | Post-MVP |
| **RadioGroup** | ✅ Built | ✅ QUIZ_MCQ challenges | ❌ | ❌ | Medium priority |
| **StatusBadge** | ⚠️ Inline | ✅ Candidate signals | ❌ | ❌ | **Should extract** to component |
| **ProgressBar** | ⚠️ Inline | ✅ Assessment progress | ❌ | ❌ | **Should extract** to component |
| **RoleCard** | ✅ Built | ✅ Listing page | ❌ | ❌ | Core for MVP |
| **StageCard** | ✅ Built | ✅ Pipeline editor | ❌ | ❌ | Medium priority |
| **CandidateCard** | ✅ Built | ✅ Overview page | ❌ | ❌ | Core for MVP |
| **Layout** | ✅ Built | ✅ Page wrappers | ❌ | ❌ | Medium priority |
| **SidebarNav** | ✅ Built | ✅ Pipeline dashboard | ✅ | ❌ | Medium priority |
| **Header** | ✅ Built | ✅ Global chrome | ❌ | ❌ | Low priority |
| **ChromeMeshGrid** | ✅ Built | ✅ Background only | ❌ | ❌ | Visual element |
| **AgentPanel** | ⚠️ Partial | ⚠️ Post-MVP | ❌ | ❌ | Preserved for Phase 8+ |
| **DiffReviewCanvas** | ✅ Built | ✅ CODE_REVIEW display | ❌ | ❌ | Ground-truth renderer |
| **MonacoEditor** | ✅ Integrated | ✅ CODE_IMPLEMENTATION | ❌ | ❌ | Via `@monaco-editor/react` |
| **Sandpack** | ✅ Integrated | ✅ BUILD_COMPONENT preview | ❌ | ❌ | Via `@codesandbox/sandpack-react` |

---

## UI Patterns

### Hover — Card Lift + Chrome Sweep

All interactive cards use this pattern. Implement using a pseudo-element overlay.

```css
/* Applied to interactive LiquidMetalCard wrappers */
.card-interactive {
  position: relative;
  overflow: hidden;
  cursor: pointer;
  transition:
    transform 0.3s cubic-bezier(0.16, 1, 0.3, 1),
    box-shadow 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.card-interactive:hover {
  transform: translateY(-2px);
  box-shadow:
    0 20px 60px rgba(0, 0, 0, 0.40),
    inset 0 1px 0 rgba(255, 255, 255, 0.20);
}

/* Chrome sweep overlay */
.card-interactive::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.05), transparent);
  transform: translateX(-100%);
  transition: transform 0.6s cubic-bezier(0.16, 1, 0.3, 1);
  pointer-events: none;
}

.card-interactive:hover::before {
  transform: translateX(100%);
}
```

---

### Navigation — Page Chrome & Breadcrumb

Every page in Pipe shares the same global chrome but uses different amounts of contextual navigation. There are **two page types**:

---

#### Type A — Shell Page (no pipeline context)

Used for: `/` (listing), `/pipeline/new` (create form)

```
┌─────────────────────────────────────────────────────────┐
│  ProfileHeader  │  PIPE_OS  V.2.0.4  │  [+] CREATE  [↪] SIGN OUT  │
├────┬────────────────────────────────────────────────────┤
│    │                                                     │
│ S  │   ← BACK TO [PARENT]          ← page-level only    │
│ i  │                                                     │
│ d  │   SECTION_LABEL                                     │
│ e  │   Page Title                                        │
│ b  │   Subtitle / description                            │
│ a  │                                                     │
│ r  │   [Content]                                         │
│    │                                                     │
└────┴────────────────────────────────────────────────────┘
```

- **No SubHeader bar** — there is no pipeline in context yet
- The page renders its own `← BACK TO [PARENT]` inline, above its heading
- The back button uses `useNavigate()` to go to the parent route

**Back button spec:**

```tsx
<button
  onClick={() => navigate('/')}
  style={{
    display: 'flex', alignItems: 'center', gap: 8,
    background: 'transparent', border: 'none',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10, letterSpacing: '0.15em',
    fontFamily: '"Space Mono", monospace',
    padding: 0, cursor: 'pointer',
    transition: 'color 0.2s ease',
  }}
>
  <ArrowLeft size={12} />
  BACK TO ROLES
</button>
```

---

#### Type B — Context Page (pipeline selected)

Used for: `/pipeline/:id`, `/pipeline/:id/:stage`, `/pipeline/:id/:stage/:questionId`, `/candidates/:id`

```
┌─────────────────────────────────────────────────────────┐
│  ProfileHeader  │  PIPE_OS  V.2.0.4  │  [+] CREATE  [↪] SIGN OUT  │
├─────────────────────────────────────────────────────────┤
│  ← BACK TO [PARENT]  │  POSITION: [Role Title]  │  42 CANDIDATES  │
├────┬────────────────────────────────────────────────────┤
│    │                                                     │
│ S  │   [Page content — no extra back nav needed]         │
│ i  │                                                     │
│ d  │                                                     │
│ e  │                                                     │
│ b  │                                                     │
│ a  │                                                     │
│ r  │                                                     │
│    │                                                     │
└────┴────────────────────────────────────────────────────┘
```

- **SubHeader bar** is shown — it carries the breadcrumb + pipeline context
- The SubHeader back label changes based on nesting depth:
  - On `/pipeline/:id` → `← BACK TO ROLES`
  - On `/pipeline/:id/:stage` → `← BACK TO OVERVIEW`
  - On `/pipeline/:id/:stage/:questionId` → `← BACK TO [STAGE NAME]`
- POSITION and ACTIVE CANDIDATES are **real data** from the loaded pipeline — not hardcoded
- Page-level content does **not** duplicate a back button

---

#### Navigation Hierarchy

```
/                              ← Shell (listing, no SubHeader)
  /pipeline/new                ← Shell (create form, no SubHeader)
  /pipeline/:id                ← Context (SubHeader: ← BACK TO ROLES)
    /pipeline/:id/:stage       ← Context (SubHeader: ← BACK TO OVERVIEW)
      /pipeline/:id/:stage/:q  ← Context (SubHeader: ← BACK TO [STAGE])
  /candidates/:id              ← Context (SubHeader: ← BACK TO OVERVIEW)
```

---

#### `SubHeader` Data Requirements

The SubHeader must never show hardcoded/mock data. It should receive:

```tsx
interface SubHeaderProps {
  roleTitle: string;          // from Pipeline.title
  candidateCount: number;     // from Candidate[] length
  backLabel: string;          // computed from route depth
  onBack: () => void;         // navigate to parent
}
```

> ⚠️ **Current state (2026-03-13):** `SubHeader` in `App.tsx` is hardcoded with mock values (`"Senior Full-Stack Engineer"`, `42`). This is a known gap — tracked as a Phase 2 task. The SubHeader also renders on Shell pages (create form), which is incorrect. Fix: move SubHeader rendering into individual Context pages, or pass a `showSubHeader` prop to `AppLayout`.

---

### Loading — Skeleton Shimmer

Use skeletons, not spinners, for content loading. Skeletons should match the exact shape of the content they replace.

```css
@keyframes shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position:  200% 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.05) 25%,
    rgba(255, 255, 255, 0.10) 50%,
    rgba(255, 255, 255, 0.05) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s ease-in-out infinite;
}
```

Apply to shaped divs:
```tsx
{isLoading ? (
  <div className="skeleton" style={{ height: 80, width: '100%', borderRadius: 0 }} />
) : (
  <RoleCard role={role} />
)}
```

---

### Empty States

Pattern for pages/sections with no data.

```tsx
function EmptyState({ icon: Icon, title, description, action }) {
  return (
    <div style={{ textAlign: 'center', padding: '48px 24px' }}>
      <Icon size={32} style={{ color: 'rgba(255,255,255,0.20)', marginBottom: 16 }} />
      <h3 style={{ fontSize: 14, fontWeight: 800, marginBottom: 8 }}>{title}</h3>
      <p style={{ fontSize: 12, color: 'rgba(255,255,255,0.40)', marginBottom: 24 }}>
        {description}
      </p>
      {action}
    </div>
  );
}
```

---

### Status Badge

Until extracted as a component, use this exact pattern for status rendering:

```tsx
const statusStyles = {
  ACTIVE:   { color: 'rgba(150,255,150,0.80)', background: 'rgba(150,255,150,0.10)', border: 'rgba(150,255,150,0.30)' },
  DRAFT:    { color: 'rgba(255,200,100,0.80)', background: 'rgba(255,200,100,0.10)', border: 'rgba(255,200,100,0.30)' },
  ARCHIVED: { color: 'rgba(255,255,255,0.40)', background: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.10)' },
};

<span style={{
  ...statusStyles[status],
  fontSize: 8,
  fontWeight: 800,
  letterSpacing: '0.20em',
  textTransform: 'uppercase',
  padding: '4px 10px',
  border: `1px solid ${statusStyles[status].border}`,
}}>
  {status}
</span>
```

---

## MVP — New Components Needed

These components don't exist yet and are required for the MVP.

### 1. Toast / Notification
Used to confirm saves, errors, and async completions. No third-party library — implement inline.
- Position: bottom-right, `position: fixed`
- Variants: success (green glow), error (red glow), info (default)
- Auto-dismiss after 4s
- Stack up to 3 toasts

### 2. Modal / Confirm Dialog
Used for destructive actions (delete pipeline, remove candidate).
- Backdrop: `rgba(0,0,0,0.70)` with `blur(4px)`
- Card: `LiquidMetalCard` variant `chrome`, max-width `480px`
- Two buttons: confirm (white/destructive) + cancel (ghost)

### 3. Code Review Editor
The central MVP experience — a candidate reviews code with inline annotations. **Entirely new design work needed.**
- Split pane: code on left, comments panel on right
- Candidate can highlight a line range and attach a comment
- Bug categories selectable per annotation (security, logic, performance, edge case)
- Submit button locks the editor and shows confirmation

### 4. Candidate Invite Link UI
A recruiter-facing screen that shows a generated shareable URL with a copy button.
- Simple card with URL in a styled `<input readonly>` field
- Copy icon button with toast confirmation
- Expiry date display (if applicable)

### 5. StatusBadge (extracted)
Promote the inline pattern above to a proper component: `src/components/ui/StatusBadge.tsx`

### 6. ProgressBar (extracted)
Promote the inline pattern to a proper component: `src/components/ui/ProgressBar.tsx`

---

_Design System maintained by Pipe Engineering Team_
_Last major update: 2026-03-13_
