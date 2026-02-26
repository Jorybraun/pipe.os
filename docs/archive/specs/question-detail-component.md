# Technical Specification - Question Detail Component

**Date:** 2025-12-27
**Author:** Archer (Principal Architect)
**Handoff:** Devin (Staff Engineer)
**Status:** Draft

**Brief:** [Product Brief - Question Detail Component](/docs/briefs/question-detail-component.md)

---

## Overview

The Question Detail Component is a frontend-only feature that allows users (hiring managers, recruiters, interviewers) to view detailed information about interview questions. When a user clicks on a Question Card in the Pipeline Builder, they navigate to a detail view with a 4-tab interface (QUESTION, VIDEO, RUBRIC, SETTINGS) that displays comprehensive question information.

This is a **frontend-first initiative** to validate user experience and interaction patterns before backend implementation. The component will use mock data exclusively and focus on production-ready code quality, accessibility, and visual accuracy.

**Key Objectives:**
- Create production-ready presentational components matching the design prototype
- Implement keyboard-navigable tab interface with WCAG 2.1 AA compliance
- Enable routing-based navigation between questions list and question detail
- Refactor existing prototype components to TypeScript strict mode
- Establish component patterns for future backend integration

---

## System Architecture

### Component Hierarchy

```
src/
├── components/
│   ├── QuestionDetail/
│   │   ├── QuestionDetail.tsx           # Main container component
│   │   ├── QuestionDetail.test.tsx      # Unit tests
│   │   ├── QuestionDetail.stories.tsx   # Storybook stories
│   │   ├── QuestionDetailHeader.tsx     # Header with back arrow
│   │   ├── QuestionDetailHeader.test.tsx
│   │   ├── QuestionDetailHeader.stories.tsx
│   │   ├── tabs/
│   │   │   ├── QuestionTab.tsx          # QUESTION tab content
│   │   │   ├── QuestionTab.test.tsx
│   │   │   ├── QuestionTab.stories.tsx
│   │   │   ├── VideoTab.tsx             # VIDEO tab content
│   │   │   ├── VideoTab.test.tsx
│   │   │   ├── VideoTab.stories.tsx
│   │   │   ├── RubricTab.tsx            # RUBRIC tab content
│   │   │   ├── RubricTab.test.tsx
│   │   │   ├── RubricTab.stories.tsx
│   │   │   ├── SettingsTab.tsx          # SETTINGS tab content
│   │   │   ├── SettingsTab.test.tsx
│   │   │   └── SettingsTab.stories.tsx
│   │   ├── index.ts                     # Barrel export
│   │   └── types.ts                     # Component-specific types
│   └── ui/
│       ├── LiquidMetalCard.tsx          # Refactored from prototype
│       ├── LiquidMetalCard.test.tsx
│       ├── LiquidMetalCard.stories.tsx
│       ├── TabNav.tsx                   # Tab navigation component
│       ├── TabNav.test.tsx
│       ├── TabNav.stories.tsx
│       ├── SubTitle.tsx                 # Section subtitle
│       ├── SubTitle.test.tsx
│       ├── SubTitle.stories.tsx
│       ├── Toggle.tsx                   # Toggle switch component
│       ├── Toggle.test.tsx
│       ├── Toggle.stories.tsx
│       ├── NumberInput.tsx              # Number input with +/- controls
│       ├── NumberInput.test.tsx
│       ├── NumberInput.stories.tsx
│       ├── ButtonGroup.tsx              # Button group for type selection
│       ├── ButtonGroup.test.tsx
│       └── ButtonGroup.stories.tsx
├── pages/
│   └── PipelineBuilderPage.tsx          # Updated with new route
├── mocks/
│   └── questions.ts                     # Enhanced mock data
└── types/
    └── question.ts                      # Already exists, may need updates
```

### Routing Architecture

**Route Pattern:**
```
/pipeline-builder/:pipelineId/question/:questionId
```

**Navigation Flow:**
1. User views Pipeline Builder page at `/pipeline-builder/:pipelineId`
2. User clicks on a Question Card
3. React Router navigates to `/pipeline-builder/:pipelineId/question/:questionId`
4. Question Detail component renders, replacing the questions list
5. User clicks back arrow → navigates back to `/pipeline-builder/:pipelineId`
6. Browser back button also supported via routing

**React Router Setup:**
```typescript
// In App.tsx or routing configuration
<Route path="/pipeline-builder/:pipelineId">
  <Route index element={<PipelineBuilderPage />} />
  <Route path="question/:questionId" element={<QuestionDetail />} />
</Route>
```

### Integration Points

- **React Router:** For navigation between questions list and detail view
- **Mock Data:** `/src/mocks/questions.ts` enhanced to match `Question` interface
- **Type System:** `/src/types/question.ts` for type safety
- **Existing UI Components:** Reuse and refactor from `/prototypes/questions/components/`
- **AWS Amplify UI:** Use existing Amplify UI React components where appropriate

---

## Mock Data Enhancement

### Current Mock Data Structure

The existing `/src/mocks/questions.ts` provides basic question data:

```typescript
{
  order: number,
  type: string,
  timeLimit: number,
  required: boolean,
  text: string,
  hasVideo: boolean,
  videoDuration: number,
  rubricDimensions: number
}
```

### Enhanced Mock Data Structure

Enhance mock data to fully match the `Question` interface from `/src/types/question.ts`:

```typescript
export interface Question {
  id: string;                          // ADD: UUID format
  text: string;                        // EXISTS
  type: QuestionType;                  // EXISTS (convert to type)
  timeLimit: number;                   // EXISTS
  isRequired: boolean;                 // EXISTS (rename from required)
  hasVideo: boolean;                   // EXISTS
  videoDuration?: number;              // EXISTS
  rubric: RubricDimension[];           // ADD: Full rubric array (not just count)
  settings: QuestionSettings;          // ADD: Settings object
  status: QuestionStatus;              // ADD: Status field
  createdAt: Date;                     // ADD: Timestamp
  updatedAt: Date;                     // ADD: Timestamp
}
```

**Required Additions:**

1. **Generate IDs:** Use format `question-{order}` or UUIDs
2. **Create Rubric Arrays:** Convert `rubricDimensions: 4` to full `RubricDimension[]` arrays
3. **Add Settings Objects:**
   ```typescript
   settings: {
     allowRerecording: boolean,
     preparationTime: number,  // in seconds
     autoAdvance: boolean
   }
   ```
4. **Add Status:** Default to `'active'` for all questions
5. **Add Timestamps:** Use current date or mock dates

**Example Enhanced Question:**
```typescript
{
  id: 'question-1',
  order: 1,
  text: 'Tell me about a time when you made short-term sacrifices for long-term gains.',
  type: 'behavioral' as QuestionType,
  timeLimit: 3,
  isRequired: true,
  hasVideo: false,
  videoDuration: 0,
  rubric: [
    {
      id: 1,
      name: 'Clarity',
      weight: 25,
      description: 'How clearly the candidate explains their thinking'
    },
    {
      id: 2,
      name: 'Depth',
      weight: 25,
      description: 'Depth of analysis and critical thinking'
    },
    {
      id: 3,
      name: 'Relevance',
      weight: 25,
      description: 'Relevance to the question asked'
    },
    {
      id: 4,
      name: 'Impact',
      weight: 25,
      description: 'Demonstrated impact of the decision'
    }
  ],
  settings: {
    allowRerecording: true,
    preparationTime: 30,
    autoAdvance: false
  },
  status: 'active' as QuestionStatus,
  createdAt: new Date('2025-01-15T10:00:00Z'),
  updatedAt: new Date('2025-01-15T10:00:00Z')
}
```

---

## Component Design

### QuestionDetail (Main Container)

**Responsibilities:**
- Fetch question data from mock based on `questionId` route param
- Manage active tab state (only state management allowed)
- Render header, tab navigation, and active tab content
- Handle 404 if question not found

**Props:**
```typescript
interface QuestionDetailProps {
  // No props - uses route params
}
```

**State:**
```typescript
const [activeTab, setActiveTab] = useState<'question' | 'video' | 'rubric' | 'settings'>('question');
```

**Key Behaviors:**
- Read `:questionId` from React Router params
- Find question in mock data by ID
- Display error state if question not found
- Tab switching updates `activeTab` state
- No form state management (display only)

---

### QuestionDetailHeader

**Responsibilities:**
- Display back arrow button
- Show question ID or title (optional)
- Handle navigation back to questions list

**Props:**
```typescript
interface QuestionDetailHeaderProps {
  pipelineId: string;
  questionId: string;
  onBack?: () => void;  // Optional callback
}
```

**Key Behaviors:**
- Back arrow uses `useNavigate()` to go to `/pipeline-builder/:pipelineId`
- Keyboard accessible (Enter/Space triggers navigation)
- ARIA label: "Back to questions list"

---

### Tab Components

All tab components are **presentational/display components only**:

#### QuestionTab

**Responsibilities:**
- Display question text in textarea (read-only or display-only)
- Show question type badges (TECHNICAL, BEHAVIORAL, etc.)
- Display response time limit with +/- controls (non-functional)
- Show required toggle (display only)
- Show video status indicator

**Props:**
```typescript
interface QuestionTabProps {
  question: Question;
}
```

**Key Features:**
- Question text displayed in `LiquidMetalCard`
- Type selection displayed as button group (non-interactive)
- Time limit displayed with NumberInput component (display only)
- Required toggle shows current state (non-interactive)
- Video status shows green/yellow indicator with duration

---

#### VideoTab

**Responsibilities:**
- Display video recording interface
- Show existing video duration if `hasVideo === true`
- Show placeholder if no video recorded

**Props:**
```typescript
interface VideoTabProps {
  question: Question;
}
```

**Key Features:**
- If `hasVideo`: Show video duration, recording indicator
- If no video: Show "No video recorded" placeholder
- Non-functional record/edit buttons (display only)

---

#### RubricTab

**Responsibilities:**
- Display scoring rubric criteria
- Show dimension names, weights, descriptions
- Display criteria in card layout

**Props:**
```typescript
interface RubricTabProps {
  rubric: RubricDimension[];
}
```

**Key Features:**
- Map over `rubric` array to display each dimension
- Show weight percentage (e.g., "25%")
- Display in `LiquidMetalCard` components

---

#### SettingsTab

**Responsibilities:**
- Display question settings
- Show allow re-recording toggle (display only)
- Show preparation countdown time (display only)
- Show auto-advance toggle (display only)
- Display danger zone with delete button (non-functional)

**Props:**
```typescript
interface SettingsTabProps {
  settings: QuestionSettings;
}
```

**Key Features:**
- Three setting cards: Re-recording, Preparation, Auto-Advance
- Toggles display current state (non-interactive)
- Danger zone with red-themed delete button (display only)

---

### UI Components (Refactored from Prototypes)

#### LiquidMetalCard

Refactor from `/prototypes/questions/components/ui/LiquidMetalCard.jsx` to TypeScript:

**Props:**
```typescript
interface LiquidMetalCardProps {
  variant?: 'default' | 'mercury' | 'dark';
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}
```

**Key Features:**
- Maintains existing visual shader effects
- TypeScript strict mode compliant
- Proper prop types and validation

---

#### TabNav

Refactor from `/prototypes/questions/components/ui/TabNav.jsx`:

**Props:**
```typescript
interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
}

interface TabNavProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}
```

**Accessibility Requirements:**
- **Keyboard Navigation:**
  - Arrow Left/Right: Navigate between tabs
  - Home/End: Jump to first/last tab
  - Enter/Space: Activate tab (same as click)
- **ARIA Attributes:**
  - `role="tablist"` on container
  - `role="tab"` on each tab button
  - `aria-selected={isActive}` on active tab
  - `aria-controls` pointing to tab panel ID
- **Focus Management:**
  - Tab buttons are focusable
  - Visual focus indicator (outline)

---

#### Other UI Components

**SubTitle:**
```typescript
interface SubTitleProps {
  children: string;
}
```

**Toggle:**
```typescript
interface ToggleProps {
  checked: boolean;
  onChange?: (checked: boolean) => void;  // Optional (display only)
  disabled?: boolean;
  ariaLabel: string;
}
```

**NumberInput:**
```typescript
interface NumberInputProps {
  value: number;
  min?: number;
  max?: number;
  onChange?: (value: number) => void;  // Optional (display only)
  unit?: string;  // e.g., "MIN", "SEC"
  disabled?: boolean;
}
```

**ButtonGroup:**
```typescript
interface ButtonGroupOption {
  value: string;
  label: string;
}

interface ButtonGroupProps {
  options: ButtonGroupOption[];
  selected: string | string[];
  onChange?: (value: string) => void;  // Optional (display only)
  disabled?: boolean;
}
```

---

## Testing Plan

### Unit Tests (Vitest)

**Test Area: QuestionDetail Component**

- **Test:** Renders with valid question ID
  - **Setup:** Mock questions data, mock route params with valid ID
  - **Actions:** Render QuestionDetail component
  - **Assertions:**
    - Component renders without errors
    - Question text is displayed
    - Tab navigation is visible
    - Default tab (QUESTION) content is shown

- **Test:** Shows 404 for invalid question ID
  - **Setup:** Mock route params with non-existent ID
  - **Actions:** Render QuestionDetail component
  - **Assertions:**
    - Error message displayed
    - "Question not found" text visible

- **Test:** Tab switching updates displayed content
  - **Setup:** Render component with valid question
  - **Actions:** Click VIDEO tab, then RUBRIC tab, then SETTINGS tab
  - **Assertions:**
    - Active tab state updates correctly
    - Corresponding tab content is rendered
    - Previous tab content is hidden

---

**Test Area: QuestionDetailHeader Component**

- **Test:** Back button navigation
  - **Setup:** Mock `useNavigate` from React Router
  - **Actions:** Click back arrow button
  - **Assertions:**
    - `navigate()` called with `/pipeline-builder/:pipelineId`

- **Test:** Keyboard accessibility
  - **Setup:** Render header
  - **Actions:** Focus back button, press Enter
  - **Assertions:**
    - Navigation triggered
    - ARIA label is present

---

**Test Area: Tab Components (QuestionTab, VideoTab, RubricTab, SettingsTab)**

Each tab component should have tests for:

- **Test:** Renders with question data
  - **Setup:** Provide valid question prop
  - **Actions:** Render component
  - **Assertions:**
    - All expected content is displayed
    - Data from question object is correctly shown

- **Test:** Handles missing optional data
  - **Setup:** Provide question with `hasVideo: false` (for VideoTab)
  - **Actions:** Render component
  - **Assertions:**
    - Placeholder content shown for missing data
    - No errors thrown

---

**Test Area: UI Components (LiquidMetalCard, TabNav, Toggle, etc.)**

- **Test:** LiquidMetalCard renders with variants
  - **Setup:** Render with different variant props
  - **Actions:** N/A
  - **Assertions:**
    - Correct CSS classes applied
    - Children rendered correctly

- **Test:** TabNav keyboard navigation
  - **Setup:** Render TabNav with 4 tabs
  - **Actions:**
    - Focus first tab
    - Press Arrow Right key
    - Press Arrow Left key
    - Press Home/End keys
  - **Assertions:**
    - Focus moves to correct tab
    - `onTabChange` called with correct tab ID
    - ARIA attributes are correct

- **Test:** Toggle component accessibility
  - **Setup:** Render Toggle
  - **Actions:** Focus toggle, press Space
  - **Assertions:**
    - ARIA attributes correct (`role="switch"`, `aria-checked`)
    - Keyboard accessible

---

### Component Tests (Storybook)

**Component: QuestionDetail**

- **Story:** Default
  - **Props:** Mock question with all data populated
  - **Assertions:** Renders all tabs, default tab active

- **Story:** Question Not Found
  - **Props:** Invalid question ID
  - **Assertions:** Error state displayed

- **Story:** Tab Navigation
  - **Actions:** Click through all tabs
  - **Assertions:** Each tab displays correctly

---

**Component: QuestionTab**

- **Story:** Default Question
  - **Props:** Question with technical type, 45 min limit
  - **Assertions:** Question text, type badges, time limit all visible

- **Story:** Question with Video
  - **Props:** Question with `hasVideo: true`, `videoDuration: 180`
  - **Assertions:** Green video indicator, duration shown as "3:00"

- **Story:** Question without Video
  - **Props:** Question with `hasVideo: false`
  - **Assertions:** Yellow indicator, "No video recorded" text

---

**Component: VideoTab**

- **Story:** No Video Recorded
  - **Props:** Question with `hasVideo: false`
  - **Assertions:** Placeholder message shown

- **Story:** Video Recorded
  - **Props:** Question with `hasVideo: true`, `videoDuration: 240`
  - **Assertions:** Video duration "4:00" displayed

---

**Component: RubricTab**

- **Story:** Standard Rubric (4 dimensions)
  - **Props:** Question with 4 rubric dimensions
  - **Assertions:** All 4 dimensions displayed with weights

- **Story:** Complex Rubric (7 dimensions)
  - **Props:** Question with 7 rubric dimensions
  - **Assertions:** All 7 dimensions displayed, scrollable if needed

---

**Component: SettingsTab**

- **Story:** Default Settings
  - **Props:** Standard settings object
  - **Assertions:** All three settings cards displayed, toggles show correct state

- **Story:** Danger Zone
  - **Props:** Any settings
  - **Assertions:** Delete button displayed with warning styling

---

**Component: TabNav**

- **Story:** Four Tabs
  - **Props:** `tabs: [QUESTION, VIDEO, RUBRIC, SETTINGS]`, `activeTab: 'question'`
  - **Assertions:** All tabs visible, first tab active
  - **Interactions:** Click each tab, verify `onTabChange` called

- **Story:** Keyboard Navigation
  - **Actions:** Focus first tab, use Arrow keys
  - **Assertions:** Focus moves correctly, Enter activates tab

---

**Component: LiquidMetalCard**

- **Story:** Default Variant
- **Story:** Mercury Variant
- **Story:** Dark Variant
- **Assertions:** Visual differences between variants

---

**Component: Toggle**

- **Story:** Checked State
- **Story:** Unchecked State
- **Story:** Disabled State
- **Interactions:** Click toggle, verify onChange called (if provided)

---

**Component: NumberInput**

- **Story:** Default
  - **Props:** `value: 3`, `unit: "MIN"`
  - **Assertions:** Value displayed, +/- buttons visible

- **Story:** At Min Boundary
  - **Props:** `value: 1`, `min: 1`
  - **Assertions:** Minus button disabled or styled differently

- **Story:** At Max Boundary
  - **Props:** `value: 10`, `max: 10`
  - **Assertions:** Plus button disabled or styled differently

---

### Coverage Requirements

- **Critical paths:** 90%+ (Tab navigation, question data display)
- **Business logic:** 80%+ (Mock data loading, routing logic)
- **UI components:** 70%+ (Presentational components)
- **Utilities:** 100% (Any helper functions)

---

## Accessibility Standards

### WCAG 2.1 AA Compliance

**Keyboard Navigation:**
- All interactive elements (tabs, buttons, back arrow) must be keyboard accessible
- Tab navigation supports Arrow keys, Home/End
- Focus indicators visible on all focusable elements
- No keyboard traps

**ARIA Attributes:**
- TabNav uses proper tablist/tab/tabpanel roles
- Active tab has `aria-selected="true"`
- Tab panels have `aria-labelledby` pointing to tab button
- Back button has descriptive `aria-label`

**Color Contrast:**
- Text meets 4.5:1 contrast ratio for normal text
- Large text meets 3:1 contrast ratio
- Focus indicators have sufficient contrast

**Screen Reader Support:**
- Semantic HTML (`<nav>`, `<button>`, `<main>`)
- Meaningful alt text for icons (if any)
- ARIA labels for icon-only buttons

**Focus Management:**
- Tab order is logical
- Focus visible indicator on all interactive elements
- No unexpected focus changes

---

## Responsive Design

**Breakpoints:**
- Mobile: < 768px
- Tablet: 768px - 1024px
- Desktop: > 1024px

**Responsive Behaviors:**
- Tab navigation may stack vertically on mobile
- Cards adjust padding for smaller screens
- Text wraps appropriately
- Grid layouts adjust to single column on mobile

---

## Visual Design Requirements

**Design Reference:**
Screenshot at `/var/folders/wj/418sgtvs7xn5mk5l3m4gfnb40000gn/T/TemporaryItems/NSIRD_screencaptureui_GlWmpS/Screenshot 2025-12-27 at 6.08.10 AM.png`

**Visual Accuracy Target:**
Pixel-perfect match to the design screenshot

**Key Visual Elements:**
- Dark theme with glassmorphic LiquidMetalCard components
- Tab navigation with active state styling
- Question type badges (TECHNICAL, BEHAVIORAL, MOTIVATION, SITUATIONAL)
- Time limit display with large numerals
- Green indicator for recorded video (with duration)
- Yellow indicator for no video
- Toggle switches with smooth transitions
- Red-themed danger zone for delete action

---

## Security Considerations

### Frontend Validation

- Input validation patterns in place (even though non-functional)
- No XSS vulnerabilities in rendered content
- Sanitize any user-generated content if displayed

### No Backend Integration

- No API calls to secure
- No authentication/authorization in this phase
- Mock data is static and safe

### Future Backend Preparation

- Component design allows easy prop replacement with real data
- No hardcoded assumptions that would break with API integration
- Type definitions align with future backend schema expectations

---

## Performance Considerations

### Optimization Strategy

**Current Phase:**
- No optimization priority (per product requirements)
- Focus on code quality and maintainability
- Bundle size not a concern

**Future Considerations:**
- Code splitting by route (React.lazy for QuestionDetail)
- Lazy loading tab content if needed
- Memoization of expensive renders (if identified)

---

## Documentation Deliverables

- [x] JSDoc comments on all exported functions and components
- [x] README for `/src/components/QuestionDetail/` explaining component structure
- [x] Storybook documentation strings for all stories
- [x] Inline comments for complex logic (if any)
- [x] Type definitions with TSDoc comments in `types.ts`

---

## Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| Prototype components difficult to refactor to TypeScript | Medium | Low | Review prototype code early; identify complex dependencies; refactor incrementally |
| Design-code visual mismatch | Medium | Medium | Implement visual QA comparison process; use screenshot overlay technique; iterate with design review |
| Routing conflicts with existing Pipeline Builder | High | Low | Review existing routing setup before implementation; test navigation flows; coordinate with Pipeline Builder code |
| Mock data structure misalignment with future backend | Medium | Medium | Align mock data with type definitions; design for easy prop replacement; document assumptions |
| Accessibility keyboard navigation complexity | Low | Low | Follow WAI-ARIA authoring practices; test with keyboard only; use automated accessibility tools |
| Component library (LiquidMetalCard) missing features | Low | Low | Review existing prototype components early; identify gaps; implement missing features or find alternatives |

---

## Rollout Plan

### Phase 1: Component Refactoring & Setup
- Refactor UI components from `/prototypes/questions/components/ui/` to TypeScript
- Move to `/src/components/ui/`
- Create Storybook stories for each UI component
- Write unit tests for UI components
- Verify TypeScript strict mode compliance

### Phase 2: Mock Data Enhancement
- Enhance `/src/mocks/questions.ts` to match `Question` interface
- Add IDs, full rubric arrays, settings objects
- Add timestamps and status fields
- Validate mock data against type definitions

### Phase 3: Tab Components Implementation
- Build QuestionTab, VideoTab, RubricTab, SettingsTab
- Create Storybook stories for each tab
- Write unit tests for tab components
- Ensure display-only behavior (no form state)

### Phase 4: Main Container & Routing
- Implement QuestionDetail main container
- Integrate React Router with route params
- Implement QuestionDetailHeader with back navigation
- Add tab switching state management
- Wire up routing in Pipeline Builder

### Phase 5: Testing & QA
- Run full test suite (unit + Storybook interaction tests)
- Visual QA against design screenshot
- Keyboard navigation testing
- Accessibility audit with automated tools
- Cross-browser testing (Chrome, Firefox, Safari)
- Responsive design testing (mobile, tablet, desktop)

### Phase 6: Polish & Documentation
- Fix any visual discrepancies
- Add JSDoc comments
- Create component README
- Final code review
- Merge to main branch

---

## Agent Impact Analysis

### Architectural Pattern Changes

**New Patterns Introduced:**
- **Display-only presentational components:** This spec establishes a pattern for building UI components without form state management, focusing purely on visual presentation
- **Tab navigation with keyboard accessibility:** Introduces WAI-ARIA compliant tab patterns that can be reused across the application
- **Mock data enhancement strategy:** Pattern for enriching prototype mock data to match production type interfaces

**No Backend Changes:**
This specification does not introduce any new Amplify backend patterns, as it is frontend-only.

### New Dependencies or Integrations

**No new AWS services or Amplify packages.**

**Potential NPM Dependencies:**
- No new dependencies anticipated
- Uses existing: React Router, Storybook, Vitest, TypeScript
- May use existing `react-icons` or similar for icons (back arrow, video icon, etc.)

### Required Agent Updates

#### Agent Personas (`.rulesync/subagents/*.md`)

- **@product-owner (product-owner.md)**: No changes required
- **@architect (architect.md)**: No changes required (this pattern is already aligned with frontend-first approach)
- **@developer (developer.md)**: No changes required
- **@qa (qa.md)**: Consider adding guidance on testing display-only components and keyboard navigation testing

#### Agent Commands (`.rulesync/commands/*.md`)

- **No command updates required**

#### Agent Rules (`.rulesync/rules/*.md`)

- **`react-components.md`**: Consider adding a section on "Display-only/Presentational Components" to document the pattern of building components without form state management
- **`ui-ux.md`**: Consider adding detailed keyboard navigation patterns for tabbed interfaces (WAI-ARIA tab widget pattern)
- **`testing.md`**: Consider adding guidance on testing keyboard navigation and accessibility with Storybook interaction tests

**Summary:** Minimal agent maintenance impact. This spec introduces display-only component patterns and keyboard navigation best practices that may be worth documenting in rules for future reference, but no critical updates required.
