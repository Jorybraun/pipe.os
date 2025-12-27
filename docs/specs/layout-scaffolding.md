# Technical Specification - Layout Scaffolding

**Date:** 2025-12-26
**Author:** Archer (Principal Architect)
**Handoff:** Devin (Staff Engineer)
**Status:** Draft

**Brief:** [Layout Scaffolding Product Brief](/docs/briefs/layout-scaffolding.md)

---

## Overview

Transform isolated prototype files into a cohesive, navigable application by:

1. **Refactoring prototypes** into page components using existing shared components
2. **Implementing React Router** for navigation between all prototype screens
3. **Using mock/static data** to demonstrate complete user flows
4. **Establishing component boundaries** before backend integration

This scaffolding work provides developers with a clean, presentational architecture that separates UI from business logic and data fetching, enabling parallel development of features and backend integration.

**Key Principle:** Components should be **presentational and stateless**, with minimal navigation-only state (modals, routes). No data fetching, no complex state management.

---

## System Architecture

### Frontend Stack

| Technology | Purpose | Version |
|------------|---------|---------|
| React | UI framework | 18.2.0 |
| React Router | Client-side routing | 6.x (to be installed) |
| TypeScript | Type safety | 5.4.5 |
| Vite | Build tool | 5.4.10 |
| Lucide React | Icons | 0.562.0 |

### AWS Amplify Resources

**None required for this phase.** This is purely frontend scaffolding work.

- ❌ No Auth integration
- ❌ No Data models
- ❌ No Storage
- ❌ No Functions

Backend integration is explicitly out of scope and will be addressed in Phase 2.

### Component Hierarchy

```
src/
├── main.tsx                    # Application entry point
├── App.tsx                     # Router configuration
├── components/                 # Shared component library
│   ├── ChromeMeshGrid.tsx      # ✅ Already implemented
│   ├── LiquidMetalCard.tsx     # ✅ Already implemented
│   ├── MetalScoreRing.tsx      # ✅ Already implemented
│   ├── SidebarNav.tsx          # ✅ Already implemented
│   ├── Layout.tsx              # ✅ Already implemented
│   ├── Header.tsx              # ✅ Already implemented
│   ├── StageCard.tsx           # ✅ Already implemented
│   ├── CandidateCard.tsx       # ✅ Already implemented
│   ├── RoleCard.tsx            # ✅ Already implemented
│   ├── StatsCard.tsx           # ✅ Already implemented
│   └── index.ts                # Barrel export
├── pages/                      # Page components (NEW)
│   ├── ListingPage.tsx         # Migrated from listing-page.jsx
│   ├── OverviewPage.tsx        # Migrated from overview-prototype.jsx
│   ├── PipelineBuilderPage.tsx # Migrated from pipeline-builder.jsx
│   ├── ScreeningStageBuilderPage.tsx # Migrated from screening-stage-builder.jsx
│   ├── CandidateProfilePage.tsx # Migrated from profile-example.tsx
│   └── CandidateScreeningPage.tsx # Migrated from candidate-screening.jsx
├── mocks/                      # Mock data (NEW)
│   ├── roles.ts                # Mock role/pipeline data
│   ├── candidates.ts           # Mock candidate data
│   ├── stages.ts               # Mock stage data
│   └── index.ts                # Barrel export
└── types/                      # TypeScript types (NEW)
    └── index.ts                # Shared types for mock data
```

### Routing Structure

```
/ (root)
├── /                           → ListingPage (main entry)
├── /pipelines/:id              → OverviewPage (pipeline detail)
├── /pipelines/new              → PipelineBuilderPage
│   ├── /pipelines/new/stages   → ScreeningStageBuilderPage (sub-route)
├── /candidates/:id             → CandidateProfilePage
└── /screenings/:id/preview     → CandidateScreeningPage
```

### Navigation Flow

```
ListingPage
  ├─ Click role item ──────────────→ OverviewPage
  │                                    ├─ Click candidate ──→ CandidateProfilePage
  │                                    └─ Click preview ────→ CandidateScreeningPage
  │
  └─ Click "New" button ────────────→ PipelineBuilderPage
                                       └─ Sub-route ────────→ ScreeningStageBuilderPage
```

---

## Data Model

### Mock Data Structure

Since this is a scaffolding phase with no backend, we'll use TypeScript types for mock data:

```typescript
// src/types/index.ts

export interface Role {
  id: string;
  title: string;
  department: string;
  location: string;
  status: 'ACTIVE' | 'DRAFT' | 'ARCHIVED';
  candidateCount: number;
  avgScore: number;
  stageCount: number;
  createdAt: string;
  updatedAt: string;
  progress: number; // 0-100
}

export interface Stage {
  id: string;
  pipelineId: string;
  name: string;
  type: 'CODE_REVIEW' | 'VOICE_INTERVIEW' | 'PLANNING';
  order: number;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED';
  score?: number;
  progress: number; // 0-100
  icon: string; // lucide icon name
}

export interface Candidate {
  id: string;
  name: string;
  email: string;
  company?: string;
  location?: string;
  initials: string;
  score: number;
  signal: 'STRONG' | 'YES' | 'MAYBE' | 'NO';
  stages: CandidateStage[];
  createdAt: string;
}

export interface CandidateStage {
  id: string;
  stageId: string;
  candidateId: string;
  name: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'COMPLETED';
  score?: number;
  completedAt?: string;
}

export interface Screening {
  id: string;
  candidateId: string;
  questions: ScreeningQuestion[];
  currentQuestionIndex: number;
  progress: number;
}

export interface ScreeningQuestion {
  id: string;
  question: string;
  type: 'VIDEO' | 'TEXT' | 'CODE';
  duration?: number; // seconds for video questions
  answered: boolean;
}
```

### Mock Data Files

```typescript
// src/mocks/roles.ts
import type { Role } from '../types';

export const mockRoles: Role[] = [
  {
    id: 'role-1',
    title: 'Senior Frontend Engineer',
    department: 'Engineering',
    location: 'San Francisco, CA',
    status: 'ACTIVE',
    candidateCount: 12,
    avgScore: 85,
    stageCount: 4,
    createdAt: '2025-12-01',
    updatedAt: '2025-12-26',
    progress: 75,
  },
  {
    id: 'role-2',
    title: 'Backend Engineer',
    department: 'Engineering',
    location: 'Remote',
    status: 'ACTIVE',
    candidateCount: 8,
    avgScore: 78,
    stageCount: 3,
    createdAt: '2025-12-15',
    updatedAt: '2025-12-26',
    progress: 45,
  },
  {
    id: 'role-3',
    title: 'Product Designer',
    department: 'Design',
    location: 'New York, NY',
    status: 'DRAFT',
    candidateCount: 0,
    avgScore: 0,
    stageCount: 2,
    createdAt: '2025-12-20',
    updatedAt: '2025-12-26',
    progress: 0,
  },
];

export const getRoleById = (id: string): Role | undefined => {
  return mockRoles.find(role => role.id === id);
};
```

```typescript
// src/mocks/candidates.ts
import type { Candidate } from '../types';

export const mockCandidates: Candidate[] = [
  {
    id: 'candidate-1',
    name: 'Alex Johnson',
    email: 'alex.johnson@example.com',
    company: 'TechCorp',
    location: 'San Francisco, CA',
    initials: 'AJ',
    score: 92,
    signal: 'STRONG',
    stages: [
      {
        id: 'cs-1',
        stageId: 'stage-1',
        candidateId: 'candidate-1',
        name: 'Code Review',
        status: 'COMPLETED',
        score: 95,
        completedAt: '2025-12-20',
      },
      {
        id: 'cs-2',
        stageId: 'stage-2',
        candidateId: 'candidate-1',
        name: 'Voice Interview',
        status: 'IN_PROGRESS',
      },
    ],
    createdAt: '2025-12-15',
  },
  {
    id: 'candidate-2',
    name: 'Morgan Smith',
    email: 'morgan.smith@example.com',
    company: 'StartupXYZ',
    location: 'Austin, TX',
    initials: 'MS',
    score: 78,
    signal: 'YES',
    stages: [
      {
        id: 'cs-3',
        stageId: 'stage-1',
        candidateId: 'candidate-2',
        name: 'Code Review',
        status: 'COMPLETED',
        score: 78,
        completedAt: '2025-12-22',
      },
    ],
    createdAt: '2025-12-18',
  },
];

export const getCandidateById = (id: string): Candidate | undefined => {
  return mockCandidates.find(candidate => candidate.id === id);
};
```

```typescript
// src/mocks/stages.ts
import type { Stage } from '../types';

export const mockStages: Stage[] = [
  {
    id: 'stage-1',
    pipelineId: 'role-1',
    name: 'Code Review',
    type: 'CODE_REVIEW',
    order: 1,
    status: 'COMPLETED',
    score: 85,
    progress: 100,
    icon: 'FileText',
  },
  {
    id: 'stage-2',
    pipelineId: 'role-1',
    name: 'Voice Interview',
    type: 'VOICE_INTERVIEW',
    order: 2,
    status: 'ACTIVE',
    score: 82,
    progress: 60,
    icon: 'MessageSquare',
  },
  {
    id: 'stage-3',
    pipelineId: 'role-1',
    name: 'System Design',
    type: 'PLANNING',
    order: 3,
    status: 'PENDING',
    progress: 0,
    icon: 'GitBranch',
  },
];

export const getStagesByPipelineId = (pipelineId: string): Stage[] => {
  return mockStages.filter(stage => stage.pipelineId === pipelineId);
};
```

---

## Routing Implementation

### Router Configuration

```typescript
// src/App.tsx
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import ListingPage from './pages/ListingPage';
import OverviewPage from './pages/OverviewPage';
import PipelineBuilderPage from './pages/PipelineBuilderPage';
import ScreeningStageBuilderPage from './pages/ScreeningStageBuilderPage';
import CandidateProfilePage from './pages/CandidateProfilePage';
import CandidateScreeningPage from './pages/CandidateScreeningPage';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Main entry point */}
        <Route path="/" element={<ListingPage />} />

        {/* Pipeline routes */}
        <Route path="/pipelines/:id" element={<OverviewPage />} />
        <Route path="/pipelines/new" element={<PipelineBuilderPage />} />
        <Route path="/pipelines/new/stages" element={<ScreeningStageBuilderPage />} />

        {/* Candidate routes */}
        <Route path="/candidates/:id" element={<CandidateProfilePage />} />
        <Route path="/screenings/:id/preview" element={<CandidateScreeningPage />} />

        {/* Catch-all redirect */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
```

### Navigation Patterns

**Using `useNavigate` hook:**
```typescript
import { useNavigate } from 'react-router-dom';

function ListingPage() {
  const navigate = useNavigate();

  const handleRoleClick = (roleId: string) => {
    navigate(`/pipelines/${roleId}`);
  };

  const handleNewPipeline = () => {
    navigate('/pipelines/new');
  };

  // ...
}
```

**Using `Link` component:**
```typescript
import { Link } from 'react-router-dom';

function RoleCard({ role }: { role: Role }) {
  return (
    <Link to={`/pipelines/${role.id}`} style={{ textDecoration: 'none' }}>
      <LiquidMetalCard variant="chrome" hover>
        {/* Card content */}
      </LiquidMetalCard>
    </Link>
  );
}
```

**Accessing route parameters:**
```typescript
import { useParams } from 'react-router-dom';

function OverviewPage() {
  const { id } = useParams<{ id: string }>();
  const role = getRoleById(id!);

  if (!role) {
    return <div>Role not found</div>;
  }

  // Render role overview
}
```

---

## Page Component Specifications

### ListingPage

**Source:** `prototypes/listing-page.jsx`

**Purpose:** Main entry point showing all roles/pipelines

**Key Features:**
- Stats cards (total roles, active candidates, avg score)
- Search/filter bar
- Role cards grid
- "New Pipeline" button

**State:**
- `searchQuery: string` - for filtering roles
- No other state needed (use mock data)

**Navigation:**
- Click role → `/pipelines/:id`
- Click "New" → `/pipelines/new`

### OverviewPage

**Source:** `prototypes/overview-prototype.jsx`

**Purpose:** Detailed view of a single pipeline/role

**Key Features:**
- Pipeline header with metadata
- Stage cards showing progress
- Candidate list
- Preview button

**State:**
- `activeSection: string` - for sidebar navigation
- Modal state (if any dialogs)

**Navigation:**
- Click candidate → `/candidates/:id`
- Click preview → `/screenings/:id/preview`
- Back to listing → `/`

### PipelineBuilderPage

**Source:** `prototypes/pipeline-builder.jsx`

**Purpose:** Create/edit pipeline configuration

**Key Features:**
- Pipeline name/description form
- Stage configuration
- Navigation to stage builder

**State:**
- Form state (controlled inputs)
- Modal/dialog state

**Navigation:**
- Add stage → `/pipelines/new/stages`
- Cancel → `/`

### ScreeningStageBuilderPage

**Source:** `prototypes/screening-stage-builder.jsx`

**Purpose:** Configure screening stage details

**Key Features:**
- Stage type selection
- Video recording setup
- Question configuration

**State:**
- Form state
- Video recorder state (if applicable)

**Navigation:**
- Back to pipeline builder → `/pipelines/new`
- Save and close → `/`

### CandidateProfilePage

**Source:** `prototypes/profile-example.tsx`

**Purpose:** Detailed candidate profile

**Key Features:**
- Candidate info header
- Stage progress
- Score visualizations
- Assessment details

**State:**
- `activeSection: string` - sidebar navigation
- Minimal navigation state

**Navigation:**
- Back to overview → `/pipelines/:pipelineId`

### CandidateScreeningPage

**Source:** `prototypes/candidate-screening.jsx`

**Purpose:** Candidate-facing screening interface

**Key Features:**
- Progress indicator
- Question display
- Answer input/recording
- Navigation controls

**State:**
- `currentQuestionIndex: number`
- `answers: Record<string, any>`
- Modal/confirmation state

**Navigation:**
- Complete screening → back to overview

---

## Component Migration Strategy

### Phase 1: Extract Shared Components (✅ COMPLETE)

All shared components are already implemented:
- ✅ LiquidMetalCard
- ✅ MetalScoreRing
- ✅ SidebarNav
- ✅ Layout
- ✅ Header (ProfileHeader, SubTitle)
- ✅ ChromeMeshGrid
- ✅ StageCard
- ✅ CandidateCard
- ✅ RoleCard
- ✅ StatsCard

### Phase 2: Create Page Components

**For each prototype:**

1. **Create page component file** in `src/pages/`
2. **Import shared components** from `src/components/`
3. **Import mock data** from `src/mocks/`
4. **Replace hardcoded data** with mock data imports
5. **Add routing hooks** (`useNavigate`, `useParams`)
6. **Remove duplicate component definitions** (use shared versions)
7. **Keep presentation logic** only
8. **Remove business logic** (if any)

**Migration Checklist (per page):**
- [ ] Create TypeScript file in `src/pages/`
- [ ] Import Layout and shared components
- [ ] Import mock data
- [ ] Replace inline components with shared versions
- [ ] Add route parameters (if needed)
- [ ] Add navigation handlers
- [ ] Test navigation flow
- [ ] Verify no console errors

### Phase 3: Configure Routing

1. **Install React Router**: `npm install react-router-dom @types/react-router-dom`
2. **Update App.tsx** with router configuration
3. **Test all navigation paths**
4. **Add 404 handling**

### Phase 4: Validate & Test

1. **Manual testing** of all navigation flows
2. **Verify no breaking errors**
3. **Check browser console** for warnings
4. **Test responsive behavior**
5. **Accessibility check** (keyboard navigation)

---

## Testing Plan

**IMPORTANT:** This section documents test requirements, not implementations.

### Component Tests (Storybook)

**Component: RoleCard**
- **Story:** Default
  - **Props:** Mock role data
  - **Assertions:** Displays title, department, stats correctly

- **Story:** With Link
  - **Props:** Role with navigate handler
  - **Assertions:** Clickable, navigates to correct route

**Component: StageCard**
- **Story:** Active
  - **Props:** Stage with ACTIVE status
  - **Assertions:** Shows active styling, progress bar

- **Story:** Completed
  - **Props:** Stage with COMPLETED status, score
  - **Assertions:** Shows check icon, score display

### E2E Tests (Playwright)

**Feature: Complete User Flow**
- **Test:** Navigate from listing to candidate profile
  - **Setup:** Start at `/`
  - **Actions:**
    1. Click first role card
    2. Verify overview page loads
    3. Click first candidate
    4. Verify profile page loads
  - **Assertions:**
    - All pages load without errors
    - URLs change correctly
    - Data displays correctly

**Feature: Pipeline Creation Flow**
- **Test:** Navigate to pipeline builder
  - **Setup:** Start at `/`
  - **Actions:** Click "New Pipeline" button
  - **Assertions:**
    - Navigates to `/pipelines/new`
    - Builder page renders
    - Can navigate to stage builder sub-route

### Coverage Requirements

- **Navigation flows:** 100% (all routes accessible)
- **Page components:** 70% (rendering and basic interactions)
- **Shared components:** 80% (already covered by existing tests)

---

## Performance Budgets

Since this is a scaffolding phase with mock data:

| Metric | Target | Notes |
|--------|--------|-------|
| Initial Bundle | < 200KB | Includes React Router |
| Page Transition | < 100ms | Client-side routing only |
| First Contentful Paint | < 1.5s | No data fetching |
| Time to Interactive | < 2.0s | Static content |

**Optimization Notes:**
- Code splitting by route (lazy loading pages)
- Shared components in main bundle
- Mock data tree-shaken in production

---

## Security Considerations

### Authentication

- ❌ **Not applicable** - No auth in this phase

### Authorization

- ❌ **Not applicable** - No backend data

### Data Protection

- ✅ **Mock data only** - No real user data
- ✅ **No API calls** - No data transmission

### Input Validation

- ⚠️ **Minimal** - Only navigation state (IDs in URLs)
- ✅ Validate route parameters exist before accessing mock data
- ✅ Handle 404 cases gracefully

---

## Documentation Deliverables

- [x] This technical specification
- [ ] README update with:
  - Navigation structure
  - How to add new pages
  - Mock data patterns
  - Component usage examples
- [ ] Inline code comments explaining:
  - Navigation patterns
  - Mock data structure
  - Component composition
- [ ] Storybook documentation for new page components

---

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Prototype code incompatibility** | High | Low | Shared components already extracted and tested |
| **Routing complexity** | Medium | Low | Use standard React Router patterns, keep routes flat |
| **Mock data divergence from future backend** | Medium | Medium | Define TypeScript types that match Amplify schema design |
| **Over-engineering navigation** | Low | Medium | Keep navigation state minimal, defer complex state management |
| **Component API changes during migration** | Medium | Low | Document shared component APIs, use TypeScript for type safety |

---

## Rollout Plan

### Phase 1: Setup (Day 1)

- [x] Review and approve specification
- [ ] Install React Router dependency
- [ ] Create directory structure (`pages/`, `mocks/`, `types/`)
- [ ] Define TypeScript types for mock data
- [ ] Create mock data files

### Phase 2: Page Migration (Days 2-4)

**Day 2:**
- [ ] Migrate ListingPage
- [ ] Migrate OverviewPage
- [ ] Configure basic routing

**Day 3:**
- [ ] Migrate PipelineBuilderPage
- [ ] Migrate ScreeningStageBuilderPage
- [ ] Add sub-routes

**Day 4:**
- [ ] Migrate CandidateProfilePage
- [ ] Migrate CandidateScreeningPage
- [ ] Complete all navigation links

### Phase 3: Testing & Validation (Day 5)

- [ ] Manual testing of all flows
- [ ] Fix navigation issues
- [ ] Add Playwright E2E tests
- [ ] Performance check
- [ ] Accessibility audit

### Phase 4: Documentation (Day 6)

- [ ] Update README
- [ ] Add code comments
- [ ] Create Storybook examples
- [ ] Document migration patterns

### Phase 5: Cleanup (Day 7)

- [ ] Remove prototype files (or archive)
- [ ] Remove unused dependencies
- [ ] Final review
- [ ] Mark specification as Complete

---

## Agent Impact Analysis

### Architectural Pattern Changes

**New Pattern: Client-Side Routing**
- Introduction of React Router for SPA navigation
- Page component pattern (distinct from shared components)
- Mock data pattern for development without backend

**Component Organization:**
- `/pages` directory for route-level components
- `/components` for shared, reusable components
- `/mocks` for static data (temporary until backend integration)
- `/types` for shared TypeScript definitions

### New Dependencies or Integrations

**Added:**
- `react-router-dom` (v6.x) - Client-side routing
- `@types/react-router-dom` - TypeScript definitions

**No AWS changes** - this phase is frontend-only

### Required Agent Updates

#### Agent Personas (`.rulesync/subagents/*.md`)

- **@product-owner (product-owner.md)**: No changes required
- **@architect (architect.md)**: No changes required
- **@developer (developer.md)**: Consider adding guidance on:
  - Page component structure vs. shared components
  - Mock data patterns for development
  - React Router navigation patterns
- **@qa (qa.md)**: Consider adding:
  - E2E testing patterns for client-side routing
  - Testing navigation flows

#### Agent Commands (`.rulesync/commands/*.md`)

- **No command updates required** - This is infrastructure work

#### Agent Rules (`.rulesync/rules/*.md`)

**Potential updates:**

- **`react-components.md`**: Add section on page components vs. shared components
  - Page components can use routing hooks
  - Page components coordinate shared components
  - Presentational components stay pure

- **`architecture.md`**: Add section on routing architecture
  - React Router setup
  - Route-based code splitting
  - Navigation patterns (Link vs. useNavigate)

**Summary**: Minimal agent maintenance impact. Primary changes are additive patterns (routing, page components, mock data) that don't conflict with existing Amplify patterns. Future backend integration will build on this foundation.

---

## Next Steps After Completion

Once this scaffolding is complete, the following can proceed in parallel:

1. **Backend Integration (Phase 2)**
   - Implement Amplify Data models
   - Replace mock data with real API calls
   - Add authentication

2. **State Management (Phase 3)**
   - Evaluate needs based on component structure
   - Choose solution (Context, Zustand, Redux)
   - Implement if needed

3. **Feature Development**
   - Individual features can be developed in isolation
   - Each page becomes a feature boundary
   - Components are ready for backend integration

4. **Design System Refinement**
   - Standardize button variants
   - Formalize input components
   - Create comprehensive Storybook

---

## Appendix: File Mapping

| Prototype File | New Page Component | Route |
|----------------|-------------------|-------|
| `listing-page.jsx` | `src/pages/ListingPage.tsx` | `/` |
| `overview-prototype.jsx` | `src/pages/OverviewPage.tsx` | `/pipelines/:id` |
| `pipeline-builder.jsx` | `src/pages/PipelineBuilderPage.tsx` | `/pipelines/new` |
| `screening-stage-builder.jsx` | `src/pages/ScreeningStageBuilderPage.tsx` | `/pipelines/new/stages` |
| `profile-example.tsx` | `src/pages/CandidateProfilePage.tsx` | `/candidates/:id` |
| `candidate-screening.jsx` | `src/pages/CandidateScreeningPage.tsx` | `/screenings/:id/preview` |
