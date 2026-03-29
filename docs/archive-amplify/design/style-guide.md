Pipe Design System â€” Style Guide

> Extracted from ProfileExample.tsx and related profile components  
> Version 1.0 â€¢ December 2025

---

## 1. Foundation

### Background

```css
background: #0c0c0e;
```

Single solid dark background. No gradients on the base layer.

### Font Stack

```css
font-family: "Space Mono", monospace;
```

Monospace-first. Used for all UI text.

---

## 2. Background Layers

Applied in order from bottom to top:

### Layer 1: Liquid Metal Shader

```tsx
<LiquidMetal
  width={1920}
  height={1080}
  image="/mario-pipe.svg"
  colorBack="#aaaaac"
  colorTint="#ffffff"
  shape="diamond"
  repetition={2}
  softness={0.1}
  shiftRed={0.3}
  shiftBlue={0.3}
  distortion={0.07}
  contour={0.4}
  angle={70}
  speed={0.3}
  scale={0.6}
  fit="cover"
/>
```

- Position: `fixed`, `inset: 0`
- Opacity: `0.4`
- Pointer events: `none`

### Layer 2: Chrome Mesh Grid

```css
background-image: linear-gradient(
    rgba(255, 255, 255, 0.015) 1px,
    transparent 1px
  ), linear-gradient(90deg, rgba(255, 255, 255, 0.015) 1px, transparent 1px);
background-size: 80px 80px;
```

- Position: `fixed`, `inset: 0`
- Pointer events: `none`

### Layer 3: Floating Orbs

Animated radial gradients that drift slowly.

```css
width: 200px + (i * 100px);
height: 200px + (i * 100px);
border-radius: 50%;
background: radial-gradient(
  ellipse at [30 + sin(t) * 20]% [30 + cos(t) * 20]%,
  rgba(255, 255, 255, 0.15) 0%,
  rgba(200, 210, 230, 0.08) 30%,
  rgba(180, 190, 220, 0.04) 60%,
  transparent 100%
);
filter: blur(60px);
```

- Position: `fixed`
- Transform: translates with sine/cosine animation
- Pointer events: `none`

---

## 3. Layout Structure

### Page Shell

```
â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
â”‚ Header (ProfileHeader)                                  â”‚
â”œâ”€â”€â”€â”€â”€â”€â”€â”€â”¬â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”¤
â”‚ Sidebarâ”‚ Agent Panel (optional)  â”‚ Main Content        â”‚
â”‚ 80px   â”‚ 400px                   â”‚ flex, max 1400px    â”‚
â””â”€â”€â”€â”€â”€â”€â”€â”€â”´â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

### Sidebar

```css
width: 80px;
position: fixed;
left: 0;
top: 100px;
height: calc(100vh - 100px);
padding: 0 16px;
```

### Agent Panel (when open)

```css
width: 400px;
position: fixed;
left: 80px;
top: 100px;
height: calc(100vh - 100px);
background: linear-gradient(
  135deg,
  rgba(20, 20, 30, 0.95),
  rgba(15, 15, 25, 0.98)
);
backdrop-filter: blur(40px) saturate(150%);
border-right: 1px solid rgba(139, 92, 246, 0.2);
box-shadow: 4px 0 24px rgba(0, 0, 0, 0.3);
```

### Main Content

```css
max-width: 1400px;
margin: 0 auto;
margin-left: 80px; /* sidebar only */
margin-left: 480px; /* sidebar + agent */
padding: 24px 20px;
transition: margin-left 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

---

## 4. Typography

### Hierarchy

| Element       | Size      | Weight | Letter Spacing | Color                       |
| ------------- | --------- | ------ | -------------- | --------------------------- |
| Page Title    | 48px      | 800    | -0.02em        | Chrome gradient             |
| Section Label | 9â€“12px  | 400    | 0.2â€“0.4em    | rgba(255,255,255,0.3â€“0.7) |
| Large Score   | 72px      | 900    | -0.03em        | Chrome gradient             |
| Medium Score  | 28â€“36px | 800    | -0.02em        | Chrome gradient             |
| Small Score   | 10â€“12px | 700    | 0.05em         | Solid color                 |
| Body Text     | 13px      | 400    | 0.02em         | rgba(255,255,255,0.6)       |
| Micro Label   | 7â€“9px   | 400    | 0.1â€“0.3em    | rgba(255,255,255,0.3â€“0.5) |

### Chrome Text Gradient (Display)

```css
background: linear-gradient(
  135deg,
  #fff 0%,
  rgba(200, 210, 230, 0.8) 25%,
  #fff 50%,
  rgba(180, 190, 220, 0.7) 75%,
  rgba(240, 240, 250, 0.9) 100%
);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
filter: drop-shadow(0 4px 30px rgba(200, 210, 230, 0.2));
```

### Chrome Text Gradient (Scores)

```css
background: linear-gradient(180deg, #fff 0%, rgba(200, 210, 230, 0.7) 100%);
-webkit-background-clip: text;
-webkit-text-fill-color: transparent;
```

### Section Labels

```css
font-size: 9px;
letter-spacing: 0.4em;
color: rgba(255, 255, 255, 0.3);
text-transform: uppercase;
```

---

## 5. LiquidMetalCard Variants

All variants share:

```css
backdrop-filter: blur(40px) saturate(150%);
border-radius: 0; /* brutalist â€” no radius by default */
position: relative;
overflow: hidden;
transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
```

### Default

```css
background: linear-gradient(
  135deg,
  rgba(180, 180, 190, 0.08) 0%,
  rgba(120, 120, 140, 0.04) 25%,
  rgba(200, 200, 210, 0.08) 50%,
  rgba(100, 100, 120, 0.04) 75%,
  rgba(160, 160, 180, 0.08) 100%
);
border: 1px solid rgba(255, 255, 255, 0.12);
```

### Chrome

```css
background: linear-gradient(
  135deg,
  rgba(220, 220, 230, 0.15) 0%,
  rgba(180, 180, 200, 0.08) 20%,
  rgba(255, 255, 255, 0.2) 40%,
  rgba(160, 160, 180, 0.08) 60%,
  rgba(200, 200, 220, 0.12) 80%,
  rgba(140, 140, 160, 0.08) 100%
);
border: 1px solid rgba(255, 255, 255, 0.2);
```

### Mercury

```css
background: linear-gradient(
  160deg,
  rgba(200, 210, 230, 0.12) 0%,
  rgba(180, 190, 220, 0.06) 30%,
  rgba(220, 225, 240, 0.15) 50%,
  rgba(170, 180, 210, 0.08) 70%,
  rgba(190, 200, 225, 0.1) 100%
);
border: 1px solid rgba(200, 210, 240, 0.15);
```

### Dark

```css
background: linear-gradient(
  135deg,
  rgba(40, 40, 50, 0.6) 0%,
  rgba(60, 60, 80, 0.5) 50%,
  rgba(30, 30, 40, 0.7) 100%
);
border: 1px solid rgba(255, 255, 255, 0.1);
```

### Hover State (when enabled)

```css
transform: translateY(-2px);
box-shadow: 0 20px 60px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15);
```

### Chrome Sweep Effect

```css
/* Pseudo-element that sweeps across on hover */
position: absolute;
top: 0;
left: -100%; /* moves to 100% on hover */
width: 50%;
height: 100%;
background: linear-gradient(
  90deg,
  transparent,
  rgba(255, 255, 255, 0.1),
  transparent
);
transition: left 0.6s cubic-bezier(0.16, 1, 0.3, 1);
```

---

## 6. Score Components

### MetalScoreRing

SVG circular progress with chrome gradient stroke.

```css
/* Track */
stroke: rgba(255, 255, 255, 0.08);
stroke-width: 6px;
fill: none;

/* Progress */
stroke: url(#chrome-gradient);
stroke-width: 6px;
stroke-linecap: round;
transition: stroke-dashoffset 1.2s cubic-bezier(0.16, 1, 0.3, 1);
```

Gradient definition:

```css
linearGradient {
  0%: rgba(255,255,255,0.9)
  25%: rgba(200,200,220,0.7)
  50%: rgba(255,255,255,0.95)
  75%: rgba(180,180,200,0.7)
  100%: rgba(220,220,240,0.9)
}
```

Glow effect:

```css
background: radial-gradient(
  circle,
  rgba(200, 210, 230, 0.15) 0%,
  transparent 70%
);
filter: blur(10px);
```

### Progress Bars

```css
/* Track */
height: 3px;
background: rgba(255, 255, 255, 0.06);

/* Fill */
background: linear-gradient(
  90deg,
  rgba(255, 255, 255, 0.4),
  rgba(255, 255, 255, 0.8),
  rgba(200, 210, 230, 0.6)
);
box-shadow: 0 0 15px rgba(255, 255, 255, 0.3);
```

---

## 7. Sidebar Navigation

### Button Base

```css
width: 48px;
height: 48px;
border-radius: 12px;
color: rgba(255, 255, 255, 0.4);
background: transparent;
border: none;
transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
```

### Button Hover

```css
background: rgba(255, 255, 255, 0.08);
color: rgba(255, 255, 255, 0.7);
transform: translateX(4px);
```

### Button Active

```css
background: linear-gradient(
  135deg,
  rgba(255, 255, 255, 0.15),
  rgba(200, 200, 220, 0.1)
);
backdrop-filter: blur(20px);
box-shadow: 0 4px 16px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2);
color: #fff;
```

### Active Indicator (left accent)

```css
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

### Agent Button (AI accent)

```css
/* Active state uses purple instead of white */
background: linear-gradient(
  135deg,
  rgba(139, 92, 246, 0.3),
  rgba(59, 130, 246, 0.2)
);
border: 1px solid rgba(139, 92, 246, 0.4);
color: #a78bfa;
box-shadow: 0 4px 16px rgba(139, 92, 246, 0.3), inset 0 1px 0 rgba(139, 92, 246, 0.2);
```

### Pulsing Indicator Dot

```css
width: 6px;
height: 6px;
border-radius: 50%;
background: rgba(139, 92, 246, 0.8);
box-shadow: 0 0 8px rgba(139, 92, 246, 0.6);
animation: pulse 2s ease-in-out infinite;
```

---

## 8. Color System

### Base Neutrals

| Token              | Value                           | Usage                   |
| ------------------ | ------------------------------- | ----------------------- |
| `--bg`             | `#0c0c0e`                       | Page background         |
| `--text-primary`   | `#fff`                          | Headings, active states |
| `--text-secondary` | `rgba(255,255,255,0.6)`         | Body text               |
| `--text-tertiary`  | `rgba(255,255,255,0.4)`         | Labels, icons           |
| `--text-muted`     | `rgba(255,255,255,0.3)`         | Section labels          |
| `--border-subtle`  | `rgba(255,255,255,0.04â€“0.08)` | Dividers                |
| `--border-default` | `rgba(255,255,255,0.1â€“0.12)`  | Card borders            |
| `--border-strong`  | `rgba(255,255,255,0.2)`         | Chrome variant          |

### Accent Colors

| Token             | Value                     | Usage              |
| ----------------- | ------------------------- | ------------------ |
| `--ai-purple`     | `rgba(139, 92, 246, 0.8)` | AI/Agent elements  |
| `--ai-purple-dim` | `rgba(139, 92, 246, 0.3)` | AI backgrounds     |
| `--success`       | `#10b981`                 | Completed states   |
| `--success-glow`  | `rgba(16, 185, 129, 0.6)` | Success indicators |

### Status Indicators

```css
/* Completed */
color: rgba(150, 255, 150, 0.8);

/* Active/In Progress */
color: rgba(255, 255, 255, 0.8);
animation: pulse 1.5s ease-in-out infinite;

/* Pending */
opacity: 0.4;
```

---

## 9. Spacing

| Token         | Value | Usage                 |
| ------------- | ----- | --------------------- |
| `--space-xs`  | 4px   | Tight gaps            |
| `--space-sm`  | 8px   | Between related items |
| `--space-md`  | 12px  | Default gap           |
| `--space-lg`  | 16px  | Section padding       |
| `--space-xl`  | 20px  | Card padding          |
| `--space-2xl` | 24px  | Large sections        |
| `--space-3xl` | 32px  | Section dividers      |
| `--space-4xl` | 40px  | Major sections        |
| `--space-5xl` | 48px  | Chrome card padding   |
| `--space-6xl` | 60px  | Section margins       |

---

## 10. Animation

### Timing Functions

```css
--ease-standard: cubic-bezier(0.4, 0, 0.2, 1); /* Default transitions */
--ease-smooth: cubic-bezier(0.16, 1, 0.3, 1); /* Card animations, sweeps */
```

### Durations

```css
--duration-fast: 0.2s; /* Hover states */
--duration-normal: 0.3s; /* Panel transitions */
--duration-slow: 0.4s; /* Card transforms */
--duration-sweep: 0.6s; /* Chrome sweep */
--duration-progress: 1.2s; /* Score rings */
```

### Pulse Keyframes

```css
@keyframes pulse {
  0%,
  100% {
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

## 11. Component Patterns

### Contact Info Row

```css
display: flex;
align-items: center;
gap: 16px;
padding: 16px 24px;
border-bottom: 1px solid rgba(255, 255, 255, 0.04);
font-size: 11px;
letter-spacing: 0.05em;
color: rgba(255, 255, 255, 0.5);
text-transform: uppercase;
```

Icon color: `rgba(255,255,255,0.25)`

### Quote Block

```css
padding: 24px;
background: rgba(0, 0, 0, 0.2);
border-left: 2px solid rgba(255, 255, 255, 0.2);
font-size: 13px;
line-height: 1.7;
color: rgba(255, 255, 255, 0.6);
letter-spacing: 0.02em;
```

### Divider Line

```css
height: 1px;
background: linear-gradient(
  90deg,
  transparent,
  rgba(255, 255, 255, 0.15),
  transparent
);
margin: 8px 0;
```

### Grid Layouts

Hero grid:

```css
display: grid;
grid-template-columns: 320px 1fr 200px;
gap: 24px;
```

Pipeline row:

```css
display: grid;
grid-template-columns: repeat(6, 1fr);
gap: 2px;
```

---

## 12. Icon Treatment

### Default State

```css
color: rgba(255, 255, 255, 0.4);
```

### Active State

```css
color: #fff;
```

### In Card Context

```css
color: rgba(255, 255, 255, 0.25);
```

---

## 13. Scrollbar

```css
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: rgba(255, 255, 255, 0.02);
}

::-webkit-scrollbar-thumb {
  background: rgba(255, 255, 255, 0.1);
  border-radius: 3px;
}

::-webkit-scrollbar-thumb:hover {
  background: rgba(255, 255, 255, 0.15);
}
```

---

## 14. Z-Index Scale

| Layer       | Z-Index | Usage                    |
| ----------- | ------- | ------------------------ |
| Background  | 0       | Liquid metal, mesh, orbs |
| Content     | 1       | Main content             |
| Sidebar     | 10      | Fixed sidebar            |
| Agent Panel | 9       | Slides under sidebar     |
| Modals      | 50      | Overlays                 |

---

## 15. Key Principles

1. **No border-radius on cards** â€” Brutalist aesthetic uses sharp corners
2. **Monospace everything** â€” Space Mono for all text
3. **Chrome gradients for emphasis** â€” Multi-stop white/silver gradients
4. **Subtle transparency** â€” Cards are translucent, never fully opaque
5. **Left-aligned active indicators** â€” 3px accent bars with glow
6. **Uppercase labels** â€” Section labels always uppercase with wide tracking
7. **Minimal color** â€” Mostly grayscale with purple for AI elements
8. **Consistent blur** â€” 40px blur on all glassmorphic elements
9. **Inset highlights** â€” Top inset border/shadow for depth
10. **Animation restraint** â€” Smooth but not excessive motion

---

_Style guide extracted from Pipe ProfileExample component_
