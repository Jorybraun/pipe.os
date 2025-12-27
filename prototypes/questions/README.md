# Question Detail Component Structure

This directory contains the refactored question detail prototype, split into reusable, stateless components.

## Architecture

The component structure follows these principles:

1. **Stateless Components**: All components are stateless except for:
   - Navigation state (activeTab) in the main component
   - Ephemeral UI state (e.g., recording timer, isRecording) in VideoRecorder

2. **Controlled Components**: All form inputs and complex components accept their state as props and notify parents of changes via callbacks

3. **Single Responsibility**: Each component has a clear, focused purpose

## File Structure

```
prototypes/questions/
├── question-detail-prototype.jsx          # Original monolithic prototype
├── question-detail-refactored.jsx         # New refactored main component
├── components/
│   ├── index.js                           # Central export file
│   ├── ui/                                # Reusable UI primitives
│   │   ├── LiquidMetalCard.jsx           # Glass card container
│   │   ├── SubTitle.jsx                   # Section subtitle
│   │   ├── ChromeMeshGrid.jsx            # Background grid pattern
│   │   ├── TabNav.jsx                     # Tab navigation
│   │   ├── Toggle.jsx                     # Toggle switch
│   │   ├── NumberInput.jsx                # Number input with +/- buttons
│   │   └── ButtonGroup.jsx                # Option selector buttons
│   ├── tabs/                              # Tab content components
│   │   ├── QuestionContent.jsx            # Question tab content
│   │   ├── VideoContent.jsx               # Video tab content
│   │   ├── RubricContent.jsx              # Rubric tab content
│   │   └── SettingsContent.jsx            # Settings tab content
│   ├── VideoRecorder.jsx                  # Video recording component
│   └── RubricEditor.jsx                   # Rubric editing component
└── README.md                              # This file
```

## Component Hierarchy

```
QuestionDetail (Main - Has State)
├── ChromeMeshGrid (Stateless)
├── TabNav (Stateless - Navigation)
└── Tab Content (Stateless)
    ├── QuestionContent
    │   ├── LiquidMetalCard
    │   ├── SubTitle
    │   ├── ButtonGroup
    │   ├── NumberInput
    │   └── Toggle
    ├── VideoContent
    │   └── VideoRecorder (Has Recording Session State)
    │       └── LiquidMetalCard
    ├── RubricContent
    │   └── RubricEditor (Stateless - Controlled)
    │       └── LiquidMetalCard
    └── SettingsContent
        ├── LiquidMetalCard
        └── Toggle
```

## Component Categories

### Design System Components (`components/ui/`)

**LiquidMetalCard**
- Glass morphism card container
- Variants: default, chrome, mercury, dark
- Props: `children`, `style`, `variant`, `onClick`

**SubTitle**
- Section subtitle with consistent styling
- Props: `children`

**ChromeMeshGrid**
- Background mesh grid pattern
- No props (fixed background)

### UI Primitives (`components/ui/`)

**TabNav**
- Tab navigation bar
- Props: `activeTab`, `onTabChange`, `tabs`
- Fully controlled navigation

**Toggle**
- Toggle switch component
- Props: `value`, `onChange`, `disabled`
- Controlled boolean input

**NumberInput**
- Number input with increment/decrement buttons
- Props: `value`, `onChange`, `min`, `max`, `step`, `unit`, `disabled`
- Controlled numeric input

**ButtonGroup**
- Radio-style button group for selecting one option
- Props: `options`, `value`, `onChange`, `disabled`
- Controlled selection input

### Feature Components

**VideoRecorder** (`components/VideoRecorder.jsx`)
- Complete video recording interface
- Props: `hasExistingVideo`, `existingDuration`, `onSave`, `onDelete`
- Internal state for recording session (isRecording, timer, etc.)
- Parent controls persisted video data

**RubricEditor** (`components/RubricEditor.jsx`)
- Rubric dimension editor
- Props: `dimensions`, `onChange`
- Fully controlled - parent manages all dimension state

### Tab Content Components (`components/tabs/`)

All tab content components are stateless presentational components:

**QuestionContent**
- Question text and settings
- Props: All question state + change handlers

**VideoContent**
- Video recording interface wrapper
- Props: Video state + change handlers

**RubricContent**
- Rubric editing interface wrapper
- Props: Dimensions + change handler

**SettingsContent**
- Question settings and danger zone
- Props: Settings state + change handlers

## Usage Example

```jsx
import QuestionDetail from './question-detail-refactored';

// Main component manages all state
function App() {
  return <QuestionDetail />;
}
```

Or use individual components:

```jsx
import { LiquidMetalCard, Toggle, NumberInput } from './components';

function MyComponent() {
  const [enabled, setEnabled] = useState(false);
  const [count, setCount] = useState(5);

  return (
    <LiquidMetalCard variant="mercury" style={{ padding: 20 }}>
      <Toggle value={enabled} onChange={setEnabled} />
      <NumberInput
        value={count}
        onChange={setCount}
        min={1}
        max={10}
        unit="MIN"
      />
    </LiquidMetalCard>
  );
}
```

## State Management

### Main Component State (question-detail-refactored.jsx)

The main `QuestionDetail` component manages all application state:

- **Navigation**: `activeTab` (only navigation state allowed)
- **Question Data**: `questionText`, `questionType`, `timeLimit`, `isRequired`
- **Video Data**: `hasVideo`, `videoDuration`
- **Rubric Data**: `dimensions` (array of scoring criteria)
- **Settings Data**: `allowRerecording`, `preparationTime`, `autoAdvance`
- **UI State**: `hasChanges`, `mounted`

### Change Handlers

All state changes flow through explicit handler functions:
- `handleQuestionTextChange(value)`
- `handleQuestionTypeChange(value)`
- `handleTimeLimitChange(value)`
- etc.

This makes data flow explicit and easy to trace.

## Testing Strategy

### Unit Testing
- Test UI primitives (Toggle, NumberInput, ButtonGroup) in isolation
- Test state transformations in handlers
- Test conditional rendering logic

### Integration Testing
- Test tab content components with mock data
- Test VideoRecorder recording flow
- Test RubricEditor dimension management

### E2E Testing
- Test full question editing workflow
- Test video recording and save flow
- Test rubric weight validation

## Migration from Original

To migrate from the original `question-detail-prototype.jsx`:

1. Replace the import:
   ```jsx
   // Old
   import QuestionDetail from './question-detail-prototype';

   // New
   import QuestionDetail from './question-detail-refactored';
   ```

2. The API is identical - no prop changes needed

3. All functionality is preserved

## Benefits of This Architecture

1. **Reusability**: UI primitives can be used across the application
2. **Testability**: Each component can be tested in isolation
3. **Maintainability**: Clear separation of concerns
4. **Type Safety**: Easy to add TypeScript interfaces
5. **Performance**: Can optimize individual components with React.memo
6. **Clarity**: Data flow is explicit and unidirectional
