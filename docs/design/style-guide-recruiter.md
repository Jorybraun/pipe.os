# Recruiter Dashboard — Style Guide

A practical, component-level guide for building new screens in the recruiter dashboard surface.

**Reference screens:** `ListingPage.tsx`, `OverviewPage.tsx`, `StageDetailPage.tsx`
**Design system:** `docs/design/design-system.md`

---

## Before you start: what this guide covers

The recruiter dashboard is a fully implemented design context (Technical Terminal). If you are building a new recruiter page or component, follow the patterns here exactly. Do not invent new patterns — extend what exists.

This guide does **not** cover the candidate assessment workspace, which is `[IN DESIGN — NOT FINAL]`.

---

## 1. Page background

Every recruiter page renders on top of a full-bleed chromatic 3D sculptural background. This is set at the layout level.

```tsx
// Layout wrapper — do not set background per-page
<div className="recruiter-layout">
  <div className="bg-art" /> {/* chromatic sculpture — positioned absolute, full bleed */}
  <div className="bg-overlay" /> {/* rgba(0,0,0,0.5) overlay */}
  <NavRail />
  <main>{children}</main>
</div>
```

CSS:
```css
.recruiter-layout {
  position: relative;
  min-height: 100vh;
  background: #2A2A2E;
}

.bg-art {
  position: absolute;
  inset: 0;
  /* chromatic sculpture image — set via background-image in the layout component */
  background-size: cover;
  background-position: center;
  z-index: 0;
}

.bg-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  z-index: 1;
}

main {
  position: relative;
  z-index: 2;
}
```

---

## 2. Exact color values

```
Page background:     #2A2A2E
Card/panel surface:  #323236
Elevated surface:    #3A3A3F
Subtle border:       rgba(255, 255, 255, 0.08)
Active border:       rgba(255, 255, 255, 0.16)
Text primary:        #E8E8EC
Text secondary:      #8888A0
Text tertiary:       #5A5A70
Accent green:        #00E5A0
Accent purple:       #7B6CF5
Accent blue:         #5B8EF0
Accent teal:         #3DCFB8
Accent amber:        #F5A623
Danger:              #FF4F4F
```

---

## 3. Typography rules

| When | Font | Size | Weight | Transform | Color |
|---|---|---|---|---|---|
| Page title | sans-serif | 28px | 700 | none | `#E8E8EC` |
| Section heading | sans-serif | 18px | 600 | none | `#E8E8EC` |
| Breadcrumb / position label | monospace | 11px | 400 | UPPERCASE | `#5A5A70` |
| System label (filter header, column header) | monospace | 10px | 700 | UPPERCASE | `#8888A0` |
| Body text | sans-serif | 14px | 400 | none | `#8888A0` |
| Badge / chip text | monospace | 10px | 700 | UPPERCASE | varies |
| Button text | monospace | 12px | 700 | UPPERCASE | `#1A1A1E` (primary) |
| Empty state | monospace | 12px | 400 | none | `#5A5A70` |

**Page header pattern** (from `OverviewPage`, `StageDetailPage`):
```
PIPELINE_STAGE / {id}    ← monospace, 11px, #5A5A70 — position/breadcrumb
Technical Assessment     ← sans-serif, 28px, bold — page title
```

---

## 4. Navigation rail pattern

```tsx
// Icon-only left rail, ~56px wide
<nav className="nav-rail">
  <NavItem icon={<PipelinesIcon />} href="/" active={current === 'pipelines'} label="Pipelines" />
  <NavItem icon={<ScheduleIcon />} href="/schedule" active={current === 'schedule'} label="Schedule" />
  <NavItem icon={<ContainersIcon />} href="/sandbox" active={current === 'sandbox'} label="Sandbox" />
</nav>
```

```css
.nav-rail {
  position: fixed;
  left: 0;
  top: 0;
  bottom: 0;
  width: 56px;
  background: #323236;
  border-right: 1px solid rgba(255, 255, 255, 0.08);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 16px 0;
  gap: 4px;
  z-index: 10;
}

.nav-item {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: #5A5A70;
  cursor: pointer;
  position: relative;
}

.nav-item:hover { color: #8888A0; }

.nav-item.active {
  color: #7B6CF5;
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 8px;
  bottom: 8px;
  width: 2px;
  background: #7B6CF5;
  border-radius: 1px;
}
```

---

## 5. Card pattern

```tsx
<div className="card">
  <div className="card-header">
    <span className="card-title">Test role</span>
    <StatusBadge status="ACTIVE" />
  </div>
  <div className="card-body">
    {/* content */}
  </div>
</div>
```

```css
.card {
  background: #323236;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 16px;
  /* No box-shadow */
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.card-title {
  font-size: 16px;
  font-weight: 600;
  color: #E8E8EC;
}
```

---

## 6. Badge and chip pattern

### Status badge

```tsx
type StatusBadgeProps = {
  status: 'ACTIVE' | 'IN_PROGRESS' | 'COMPLETED' | 'PENDING' | 'ARCHIVED';
};

// Example rendering:
<span className={`badge badge--${status.toLowerCase()}`}>
  {status.replace('_', ' ')}
</span>
```

```css
.badge {
  font-family: "Space Mono", monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 8px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
}

.badge--active     { color: #00E5A0; background: rgba(0, 229, 160, 0.1); }
.badge--in_progress { color: #7B6CF5; background: rgba(123, 108, 245, 0.1); }
.badge--completed  { color: #00E5A0; background: rgba(0, 229, 160, 0.08); }
.badge--pending    { color: #5A5A70; background: rgba(90, 90, 112, 0.1); }
.badge--archived   { color: #5A5A70; background: rgba(90, 90, 112, 0.08); }
```

### Challenge type badge (outlined)

```tsx
<span className={`type-badge type-badge--${type.toLowerCase()}`}>
  {type.replace('_', ' ')}
</span>
```

```css
.type-badge {
  font-family: "Space Mono", monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid currentColor;
  background: transparent;
}

.type-badge--code_review       { color: #5B8EF0; }
.type-badge--quiz_mcq          { color: #3DCFB8; }
.type-badge--code_implementation { color: #7B6CF5; }
.type-badge--quiz_short_answer { color: #F5A623; }
```

---

## 7. Filter panel pattern

Used on `ListingPage` (right side) for filtering pipelines/roles.

```tsx
<aside className="filter-panel">
  <div className="filter-section">
    <span className="filter-label">FILTER_CONTROLS</span>
    <FilterOption value="all" label="ALL_STATUS" active={filter === 'all'} />
    <FilterOption value="active" label="ACTIVE" active={filter === 'active'} />
    <FilterOption value="in_progress" label="IN_PROGRESS" active={filter === 'in_progress'} />
  </div>
</aside>
```

```css
.filter-panel {
  width: 200px;
  background: #323236;
  border-left: 1px solid rgba(255, 255, 255, 0.08);
  padding: 20px 16px;
  flex-shrink: 0;
}

.filter-section { margin-bottom: 20px; }

.filter-label {
  font-family: "Space Mono", monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #8888A0;
  display: block;
  margin-bottom: 10px;
}

.filter-option {
  font-family: "Space Mono", monospace;
  font-size: 11px;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: #5A5A70;
  padding: 6px 8px;
  border-radius: 4px;
  cursor: pointer;
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
}

.filter-option:hover  { color: #8888A0; background: rgba(255,255,255,0.04); }
.filter-option.active { color: #7B6CF5; background: rgba(123,108,245,0.08); }
```

---

## 8. Button pattern

```tsx
// Primary — white bg, dark text, monospace uppercase
<button className="btn btn--primary">ADD_CHALLENGE</button>

// Secondary — transparent, white border
<button className="btn btn--secondary">CANCEL</button>

// Danger — transparent, red border
<button className="btn btn--danger">DELETE</button>
```

```css
.btn {
  font-family: "Space Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  padding: 8px 16px;
  border-radius: 4px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.btn--primary   { background: #FFFFFF; color: #1A1A1E; border: 1px solid #FFFFFF; }
.btn--secondary { background: transparent; color: #E8E8EC; border: 1px solid rgba(255,255,255,0.16); }
.btn--danger    { background: transparent; color: #FF4F4F; border: 1px solid #FF4F4F; }

.btn:hover.btn--primary   { background: #E8E8EC; }
.btn:hover.btn--secondary { border-color: rgba(255,255,255,0.3); }
.btn:hover.btn--danger    { background: rgba(255,79,79,0.08); }
```

---

## 9. Empty state pattern

```tsx
<div className="empty-state">
  <span>NO_CHALLENGES_YET</span>
  <p>Add a challenge to get started.</p>
</div>
```

```css
.empty-state {
  text-align: center;
  padding: 48px 24px;
}

.empty-state span {
  font-family: "Space Mono", monospace;
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  color: #5A5A70;
  display: block;
  margin-bottom: 8px;
}

.empty-state p {
  font-size: 13px;
  color: #5A5A70;
  margin: 0;
}
```

---

## Reference components

When building new recruiter UI:

1. Look at `ListingPage.tsx` for the two-column layout + filter sidebar pattern
2. Look at `OverviewPage.tsx` for the stage/challenge list + detail panel layout
3. Look at `StageDetailPage.tsx` for the challenge management card pattern
4. All badge components are co-located with their parent pages — extract to `src/components/ui/` if you need to reuse them
