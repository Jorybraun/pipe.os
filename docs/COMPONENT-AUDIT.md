# Component Audit: Shared Components Analysis

**Date:** December 26, 2025  
**Purpose:** Identify reusable components across prototypes and track implementation status

---

## ✅ Components Already Implemented

### 1. **LiquidMetalCard**

- **Location:** `src/components/LiquidMetalCard.tsx`
- **Used in:** All 7 prototypes
- **Variants:** default, chrome, mercury, dark
- **Props:** children, style, variant, hover, className
- **Status:** ✅ **Fully implemented and consistent**

### 2. **MetalScoreRing**

- **Location:** `src/components/MetalScoreRing.tsx`
- **Used in:**
  - `profile-example.tsx` (AVG score)
  - `brutalist-glasomorphic-profile.jsx` (multiple instances)
  - `pipeline-builder.jsx` (rubric visualization)
- **Props:** value, size, label
- **Status:** ✅ **Fully implemented**

### 3. **SidebarNav**

- **Location:** `src/components/SidebarNav.tsx`
- **Used in:**
  - `profile-example.tsx`
  - `overview-prototype.jsx`
  - `pipeline-builder.jsx`
  - `screening-stage-builder.jsx`
  - `listing-page.jsx`
- **Props:** activeSection, onSectionChange, isAgentOpen, onAgentToggle
- **Variations:** Nav items differ slightly between prototypes
- **Status:** ✅ **Implemented** (may need configuration for nav items)

### 4. **Layout**

- **Location:** `src/components/Layout.tsx`
- **Used in:** `profile-example.tsx`
- **Features:** Liquid metal background, chrome mesh, sidebar, agent panel
- **Status:** ✅ **Fully implemented**

### 5. **ProfileHeader / SubTitle**

- **Location:** `src/components/Header.tsx`
- **Used in:**
  - All prototypes use SubTitle pattern
  - Profile/overview screens use ProfileHeader
- **Status:** ✅ **Implemented**
- **SubTitle:** Dot + uppercase text pattern
- **ProfileHeader:** Version + title with gradient

---

## 🔴 Missing Shared Components (Need Implementation)

### 6. **ChromeMeshGrid**

- **Used in:** All prototypes except candidate-screening
- **Pattern:**
  ```jsx
  <div
    style={{
      position: "fixed",
      inset: 0,
      backgroundImage: `
      linear-gradient(rgba(255,255,255,0.015) 1px, transparent 1px),
      linear-gradient(90deg, rgba(255,255,255,0.015) 1px, transparent 1px)
    `,
      backgroundSize: "80px 80px",
      pointerEvents: "none",
      zIndex: 0,
    }}
  />
  ```
- **Status:** 🔴 **Should be extracted** (could be added to Layout or standalone)
- **Priority:** Medium (simple utility component)

### 7. **StageCard** (Assessment Stage Display)

- **Used in:**
  - `profile-example.tsx` (Pipeline Status section)
  - `overview-prototype.jsx` (StageHeaderCard)
  - `pipeline-builder.jsx` (StageCard)
- **Common features:**
  - Icon (top-left)
  - Status indicator (top-right: CheckCircle or Activity)
  - Stage name (uppercase, small)
  - Score/number (large, 42px+)
  - Progress bar (bottom)
  - Variants: active (chrome), completed (with checkmark)
- **Status:** 🔴 **Should be created**
- **Priority:** High (appears in 3 prototypes)

### 8. **CandidateCard** (Candidate List Item)

- **Used in:**
  - `overview-prototype.jsx` (detailed version)
  - Could be used in listing contexts
- **Features:**
  - Initials block (left)
  - Company/location info (middle)
  - Score display (right)
  - Signal indicator (STRONG, YES)
- **Status:** 🔴 **Should be created**
- **Priority:** Medium

### 9. **RoleCard** (Role Listing Card)

- **Used in:** `listing-page.jsx`
- **Features:**
  - Status badge
  - Title + metadata (department, location)
  - Stats grid (candidates, avg score, stages)
  - Footer with date
  - Progress bar
- **Status:** 🔴 **Should be created**
- **Priority:** Medium (specific to listing page)

### 10. **StatsCard**

- **Used in:** `listing-page.jsx`
- **Features:**
  - Label (uppercase, small)
  - Large number value
  - Icon (top-right)
  - Optional trend indicator
- **Status:** 🔴 **Should be created**
- **Priority:** Low (simple stat display)

---

## 🟡 Specialized Components (May Not Need Sharing)

### ProgressBar (Screening Progress)

- **Used in:** `candidate-screening.jsx` (top progress bar)
- **Status:** 🟡 **Specialized** - Very specific to screening flow

### VideoRecorder

- **Used in:** `screening-stage-builder.jsx`
- **Status:** 🟡 **Specialized** - Complex, specific to video screening

### QuestionCard

- **Used in:** `screening-stage-builder.jsx`, `candidate-screening.jsx`
- **Status:** 🟡 **Could be shared** if video screening is used elsewhere

### FormInput/Button Patterns

- **Used in:** Multiple prototypes
- **Status:** 🟡 **Need design system** - Should standardize button styles

---

## 📊 Component Usage Matrix

| Component       | profile-example | brutalist-profile | candidate-screening | listing-page | overview | pipeline-builder | screening-builder |
| --------------- | --------------- | ----------------- | ------------------- | ------------ | -------- | ---------------- | ----------------- |
| LiquidMetalCard | ✅              | ✅                | ✅                  | ✅           | ✅       | ✅               | ✅                |
| MetalScoreRing  | ✅              | ✅                | ❌                  | ❌           | ❌       | ✅               | ❌                |
| SidebarNav      | ✅              | ❌                | ❌                  | ✅           | ✅       | ✅               | ✅                |
| SubTitle        | ✅              | ✅                | ✅                  | ✅           | ✅       | ✅               | ✅                |
| ChromeMeshGrid  | ✅              | ✅                | ✅                  | ✅           | ✅       | ✅               | ✅                |
| StageCard       | ✅              | ✅                | ❌                  | ❌           | ✅       | ✅               | ❌                |
| CandidateCard   | ❌              | ❌                | ❌                  | ❌           | ✅       | ❌               | ❌                |
| RoleCard        | ❌              | ❌                | ❌                  | ✅           | ❌       | ❌               | ❌                |

---

## 🎯 Recommendations

### Immediate Priority (High Impact)

1. **StageCard** - Appears in 3+ prototypes with consistent pattern

   - Extract common props: icon, status, name, score, progress
   - Support variants: active, completed, pending

2. **ChromeMeshGrid** - Used everywhere, trivial to extract
   - Add to Layout as optional prop, or
   - Create standalone component

### Medium Priority

3. **CandidateCard** - Standardize candidate display
4. **RoleCard** - For role listing pages

### Low Priority (Can Wait)

5. **StatsCard** - Simple display component
6. **Button/FormInput** - Need broader design system discussion

---

## 📝 Notes on Differences

### SidebarNav Variations

Different prototypes use different nav items:

- **Profile/Overview:** User, Target, GitBranch, Clock, MessageSquare, FileText
- **Listing:** Briefcase, Target, GitBranch, Clock, MessageSquare, FileText

**Solution:** Make nav items configurable via props

### LiquidMetalCard Consistency

✅ All prototypes use identical implementation - great consistency!

### MetalScoreRing Sizes

Different sizes used:

- 120px (default) - profile pages
- 80px - pipeline builder

**Solution:** Already supports `size` prop ✅

---

## 🔧 Action Items

1. [ ] Extract **ChromeMeshGrid** as utility component
2. [ ] Create **StageCard** component (priority)
3. [ ] Create **CandidateCard** component
4. [ ] Make **SidebarNav** nav items configurable
5. [ ] Consider button/form component standardization
6. [ ] Document component API in Storybook
