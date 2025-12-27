---
name: React Component Standards
targets: ["*"]
description: "Functional component patterns, prop types, component structure, and React best practices"
globs: []
alwaysApply: false
---

# React Component Standards

## Component Structure

### Functional Components Only

Use functional components with hooks. Class components are deprecated.

```typescript
// GOOD: Functional component
export function PipelineCard({ pipeline, onEdit }: PipelineCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  return <div className="pipeline-card">{/* ... */}</div>;
}

// BAD: Class component (deprecated)
class PipelineCard extends Component<PipelineCardProps> {
  // ...
}
```

### Component File Organization

```typescript
// PipelineCard.tsx

// 1. Imports
import { useState, useCallback, type ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type { Pipeline } from "@/types";

// 2. Types/Interfaces (component-specific)
interface PipelineCardProps {
  pipeline: Pipeline;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  children?: ReactNode;
}

// 3. Constants
const MAX_DESCRIPTION_LENGTH = 150;

// 4. Component
export function PipelineCard({
  pipeline,
  onEdit,
  onDelete,
  children,
}: PipelineCardProps) {
  // 4a. Hooks (in consistent order)
  const [isDeleting, setIsDeleting] = useState(false);

  // 4b. Callbacks
  const handleEdit = useCallback(() => {
    onEdit?.(pipeline.id);
  }, [onEdit, pipeline.id]);

  const handleDelete = useCallback(async () => {
    setIsDeleting(true);
    try {
      await onDelete?.(pipeline.id);
    } finally {
      setIsDeleting(false);
    }
  }, [onDelete, pipeline.id]);

  // 4c. Computed values
  const truncatedDescription = pipeline.description?.slice(
    0,
    MAX_DESCRIPTION_LENGTH
  );

  // 4d. Render
  return (
    <article className="pipeline-card" data-testid="pipeline-card">
      <header>
        <h3>{pipeline.name}</h3>
        {truncatedDescription && <p>{truncatedDescription}</p>}
      </header>

      <footer>
        <Button onClick={handleEdit} aria-label="Edit pipeline">
          Edit
        </Button>
        <Button
          onClick={handleDelete}
          variant="ghost"
          isLoading={isDeleting}
          aria-label="Delete pipeline"
        >
          Delete
        </Button>
      </footer>

      {children}
    </article>
  );
}

// 5. Helper components (if small and component-specific)
function StatusBadge({ status }: { status: Pipeline["status"] }) {
  return (
    <span className={`badge badge-${status.toLowerCase()}`}>{status}</span>
  );
}
```

## Props Patterns

### Required vs Optional Props

```typescript
interface ComponentProps {
  // Required props - no default value needed
  id: string;
  name: string;

  // Optional props - provide defaults or handle undefined
  description?: string;
  isActive?: boolean;
  onSelect?: (id: string) => void;
}

function Component({
  id,
  name,
  description,
  isActive = false,      // Default value
  onSelect,              // Handle undefined in usage
}: ComponentProps) {
  return (
    <div>
      <h2>{name}</h2>
      {description && <p>{description}</p>}  {/* Conditional render */}
      {isActive && <Badge>Active</Badge>}
      {onSelect && (                          {/* Conditional callback */}
        <button onClick={() => onSelect(id)}>Select</button>
      )}
    </div>
  );
}
```

### Children Props

```typescript
import { type ReactNode, type PropsWithChildren } from "react";

// Explicit children type
interface CardProps {
  title: string;
  children: ReactNode;
}

function Card({ title, children }: CardProps) {
  return (
    <div className="card">
      <h3>{title}</h3>
      <div className="card-content">{children}</div>
    </div>
  );
}

// Using PropsWithChildren
interface PanelProps {
  title: string;
}

function Panel({ title, children }: PropsWithChildren<PanelProps>) {
  return (
    <section>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
```

### Render Props

```typescript
interface DataLoaderProps<T> {
  fetch: () => Promise<T>;
  children: (data: T, isLoading: boolean) => ReactNode;
}

function DataLoader<T>({ fetch, children }: DataLoaderProps<T>) {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch()
      .then(setData)
      .finally(() => setIsLoading(false));
  }, [fetch]);

  if (!data) return <LoadingSpinner />;

  return <>{children(data, isLoading)}</>;
}

// Usage
<DataLoader fetch={fetchPipelines}>
  {(pipelines, isLoading) => (
    <PipelineList pipelines={pipelines} loading={isLoading} />
  )}
</DataLoader>;
```

## State Management

### Local State with useState

```typescript
function PipelineForm() {
  // Simple state
  const [name, setName] = useState("");

  // Object state
  const [form, setForm] = useState({
    name: "",
    description: "",
    status: "DRAFT" as const,
  });

  // Update object state immutably
  const updateField = (field: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <form>
      <input
        value={form.name}
        onChange={(e) => updateField("name", e.target.value)}
      />
    </form>
  );
}
```

### Complex State with useReducer

```typescript
type PipelineState = {
  pipelines: Pipeline[];
  selectedId: string | null;
  filter: "all" | "active" | "draft";
  isLoading: boolean;
  error: Error | null;
};

type PipelineAction =
  | { type: "SET_PIPELINES"; payload: Pipeline[] }
  | { type: "SELECT"; payload: string }
  | { type: "SET_FILTER"; payload: PipelineState["filter"] }
  | { type: "SET_LOADING"; payload: boolean }
  | { type: "SET_ERROR"; payload: Error | null };

function pipelineReducer(
  state: PipelineState,
  action: PipelineAction
): PipelineState {
  switch (action.type) {
    case "SET_PIPELINES":
      return { ...state, pipelines: action.payload, isLoading: false };
    case "SELECT":
      return { ...state, selectedId: action.payload };
    case "SET_FILTER":
      return { ...state, filter: action.payload };
    case "SET_LOADING":
      return { ...state, isLoading: action.payload };
    case "SET_ERROR":
      return { ...state, error: action.payload, isLoading: false };
    default:
      return state;
  }
}

function PipelineManager() {
  const [state, dispatch] = useReducer(pipelineReducer, {
    pipelines: [],
    selectedId: null,
    filter: "all",
    isLoading: true,
    error: null,
  });

  // ...
}
```

## Event Handling

### Event Types

```typescript
import { type ChangeEvent, type FormEvent, type MouseEvent } from "react";

function Form() {
  const handleInputChange = (e: ChangeEvent<HTMLInputElement>) => {
    console.log(e.target.value);
  };

  const handleSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    console.log(e.target.value);
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Submit logic
  };

  const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    // Click logic
  };

  return (
    <form onSubmit={handleSubmit}>
      <input onChange={handleInputChange} />
      <select onChange={handleSelectChange}>
        <option>Option 1</option>
      </select>
      <button onClick={handleClick}>Submit</button>
    </form>
  );
}
```

### Callback Memoization

```typescript
function PipelineList({ onSelect }: { onSelect: (id: string) => void }) {
  // Memoize callback to prevent unnecessary re-renders
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
    },
    [onSelect]
  );

  // For callbacks with parameters, use inline arrow functions
  return (
    <ul>
      {pipelines.map((pipeline) => (
        <li key={pipeline.id}>
          <button onClick={() => handleSelect(pipeline.id)}>
            {pipeline.name}
          </button>
        </li>
      ))}
    </ul>
  );
}
```

## Conditional Rendering

### Patterns

```typescript
function PipelineView({ pipeline, isEditing, error }: Props) {
  // Early return for loading/error states
  if (error) {
    return <ErrorMessage error={error} />;
  }

  if (!pipeline) {
    return <Skeleton />;
  }

  return (
    <div>
      {/* Inline conditional - short expressions */}
      {isEditing && <EditForm />}

      {/* Ternary - two options */}
      {pipeline.status === "ACTIVE" ? <ActiveBadge /> : <DraftBadge />}

      {/* Logical AND - optional content */}
      {pipeline.description && (
        <p className="description">{pipeline.description}</p>
      )}

      {/* Nullish coalescing - default values */}
      <span>{pipeline.candidateCount ?? 0} candidates</span>
    </div>
  );
}
```

### Avoid This

```typescript
// BAD: Rendering false, 0, or empty string
{
  count && <Badge count={count} />;
} // Renders "0" if count is 0

// GOOD: Explicit boolean check
{
  count > 0 && <Badge count={count} />;
}
{
  Boolean(count) && <Badge count={count} />;
}
```

## Lists and Keys

### Key Requirements

```typescript
function PipelineList({ pipelines }: { pipelines: Pipeline[] }) {
  return (
    <ul>
      {pipelines.map((pipeline) => (
        // GOOD: Use unique, stable ID
        <li key={pipeline.id}>
          <PipelineCard pipeline={pipeline} />
        </li>
      ))}
    </ul>
  );
}

// BAD: Using array index as key (causes issues with reordering)
{
  pipelines.map((pipeline, index) => (
    <li key={index}>
      {" "}
      {/* Avoid this */}
      <PipelineCard pipeline={pipeline} />
    </li>
  ));
}
```

### Fragment Keys

```typescript
function StageList({ stages }: { stages: Stage[] }) {
  return (
    <>
      {stages.map((stage) => (
        // Use React.Fragment with key when needed
        <Fragment key={stage.id}>
          <StageHeader stage={stage} />
          <StageContent stage={stage} />
        </Fragment>
      ))}
    </>
  );
}
```

## Accessibility

### ARIA Attributes

```typescript
function PipelineCard({ pipeline, onSelect }: Props) {
  return (
    <article role="article" aria-labelledby={`pipeline-${pipeline.id}-title`}>
      <h3 id={`pipeline-${pipeline.id}-title`}>{pipeline.name}</h3>

      <button
        onClick={() => onSelect(pipeline.id)}
        aria-label={`Select ${pipeline.name} pipeline`}
        aria-pressed={isSelected}
      >
        Select
      </button>

      {isLoading && (
        <div role="status" aria-live="polite">
          Loading...
        </div>
      )}
    </article>
  );
}
```

### Focus Management

```typescript
function Modal({ isOpen, onClose, children }: ModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) {
      // Focus close button when modal opens
      closeButtonRef.current?.focus();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <button ref={closeButtonRef} onClick={onClose} aria-label="Close modal">
        Close
      </button>
      {children}
    </div>
  );
}
```

## Performance

### Memoization

```typescript
import { memo, useMemo, useCallback } from "react";

// Memoize entire component
const PipelineCard = memo(function PipelineCard({ pipeline }: Props) {
  return <div>{pipeline.name}</div>;
});

// Memoize expensive computations
function PipelineStats({ pipelines }: { pipelines: Pipeline[] }) {
  const stats = useMemo(
    () => ({
      total: pipelines.length,
      active: pipelines.filter((p) => p.status === "ACTIVE").length,
      avgScore:
        pipelines.reduce((sum, p) => sum + (p.score ?? 0), 0) /
        pipelines.length,
    }),
    [pipelines]
  );

  return <StatsDisplay stats={stats} />;
}

// Memoize callbacks
function PipelineList({ onSelect }: Props) {
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
    },
    [onSelect]
  );

  return <List onItemClick={handleSelect} />;
}
```

### Code Splitting

```typescript
import { lazy, Suspense } from "react";

// Lazy load heavy components
const PipelineBuilder = lazy(() => import("./PipelineBuilder"));
const CandidateReport = lazy(() => import("./CandidateReport"));

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <Routes>
        <Route path="/builder" element={<PipelineBuilder />} />
        <Route path="/report/:id" element={<CandidateReport />} />
      </Routes>
    </Suspense>
  );
}
```
