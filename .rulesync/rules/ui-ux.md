---
name: UI/UX Standards
targets: ["*"]
description: "AWS Amplify UI components, responsive design, and accessibility guidelines"
globs: []
alwaysApply: false
---

# UI/UX Standards

## Component Library

### AWS Amplify UI React

Use `@aws-amplify/ui-react` as the primary component library for Amplify-integrated components:

```typescript
import {
  Authenticator,
  Button,
  Card,
  Flex,
  Text,
  TextField,
  SelectField,
  View,
} from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

function LoginPage() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <View padding="medium">
          <Card>
            <Flex direction="column" gap="small">
              <Text>Welcome, {user?.username}</Text>
              <Button onClick={signOut}>Sign Out</Button>
            </Flex>
          </Card>
        </View>
      )}
    </Authenticator>
  );
}
```

## Design Tokens

### Spacing System

Use consistent spacing based on a 4px base unit:

```typescript
// Spacing scale
const spacing = {
  xs: "4px", // 0.25rem
  sm: "8px", // 0.5rem
  md: "16px", // 1rem
  lg: "24px", // 1.5rem
  xl: "32px", // 2rem
  xxl: "48px", // 3rem
};

// Usage in components
<div style={{ padding: spacing.md, marginBottom: spacing.lg }}>Content</div>;
```

### Color System

```typescript
// Semantic color tokens
const colors = {
  // Primary actions
  primary: "var(--amplify-colors-brand-primary-80)",
  primaryHover: "var(--amplify-colors-brand-primary-90)",

  // Status colors
  success: "var(--amplify-colors-green-60)",
  warning: "var(--amplify-colors-orange-60)",
  error: "var(--amplify-colors-red-60)",
  info: "var(--amplify-colors-blue-60)",

  // Neutral
  background: "var(--amplify-colors-background-primary)",
  surface: "var(--amplify-colors-background-secondary)",
  border: "var(--amplify-colors-border-primary)",

  // Text
  textPrimary: "var(--amplify-colors-font-primary)",
  textSecondary: "var(--amplify-colors-font-secondary)",
  textDisabled: "var(--amplify-colors-font-disabled)",
};
```

### Typography

```typescript
// Typography scale
const typography = {
  // Headings
  h1: {
    fontSize: "2rem", // 32px
    fontWeight: 700,
    lineHeight: 1.2,
  },
  h2: {
    fontSize: "1.5rem", // 24px
    fontWeight: 600,
    lineHeight: 1.3,
  },
  h3: {
    fontSize: "1.25rem", // 20px
    fontWeight: 600,
    lineHeight: 1.4,
  },

  // Body text
  body: {
    fontSize: "1rem", // 16px
    fontWeight: 400,
    lineHeight: 1.5,
  },
  small: {
    fontSize: "0.875rem", // 14px
    fontWeight: 400,
    lineHeight: 1.5,
  },
  caption: {
    fontSize: "0.75rem", // 12px
    fontWeight: 400,
    lineHeight: 1.4,
  },
};
```

## Accessibility

### WCAG 2.1 AA Compliance

All UI must meet WCAG 2.1 Level AA standards:

1. **Color Contrast:** Minimum 4.5:1 for normal text, 3:1 for large text
2. **Keyboard Navigation:** All interactive elements accessible via keyboard
3. **Focus Indicators:** Visible focus states on all interactive elements
4. **Screen Reader Support:** Proper ARIA labels and semantic HTML
5. **Text Sizing:** UI remains usable at 200% zoom

### Semantic HTML

```typescript
// Use semantic elements
function PipelineCard({ pipeline }: Props) {
  return (
    <article className="pipeline-card">
      <header>
        <h3>{pipeline.name}</h3>
        <time dateTime={pipeline.createdAt}>
          {formatDate(pipeline.createdAt)}
        </time>
      </header>

      <p>{pipeline.description}</p>

      <footer>
        <nav aria-label="Pipeline actions">
          <button aria-label="Edit pipeline">Edit</button>
          <button aria-label="Delete pipeline">Delete</button>
        </nav>
      </footer>
    </article>
  );
}
```

### ARIA Labels

```typescript
function SearchInput({ onSearch }: Props) {
  return (
    <div role="search">
      <label htmlFor="pipeline-search" className="visually-hidden">
        Search pipelines
      </label>
      <input
        id="pipeline-search"
        type="search"
        aria-label="Search pipelines"
        placeholder="Search..."
        onChange={(e) => onSearch(e.target.value)}
      />
    </div>
  );
}

function StatusBadge({ status }: { status: "ACTIVE" | "DRAFT" | "ARCHIVED" }) {
  return (
    <span
      role="status"
      aria-label={`Pipeline status: ${status.toLowerCase()}`}
      className={`badge badge-${status.toLowerCase()}`}
    >
      {status}
    </span>
  );
}
```

### Focus Management

```typescript
function Modal({ isOpen, onClose, title, children }: ModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousActiveElement = useRef<Element | null>(null);

  useEffect(() => {
    if (isOpen) {
      // Store current focus
      previousActiveElement.current = document.activeElement;
      // Move focus to modal
      closeButtonRef.current?.focus();
    } else if (previousActiveElement.current instanceof HTMLElement) {
      // Restore focus when closing
      previousActiveElement.current.focus();
    }
  }, [isOpen]);

  // Trap focus within modal
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-title"
      onKeyDown={handleKeyDown}
    >
      <h2 id="modal-title">{title}</h2>
      <button ref={closeButtonRef} onClick={onClose} aria-label="Close modal">
        Close
      </button>
      {children}
    </div>
  );
}
```

## Responsive Design

### Breakpoints

```css
/* Mobile first approach */
.container {
  padding: 16px;
}

/* Tablet: 768px+ */
@media (min-width: 768px) {
  .container {
    padding: 24px;
  }
}

/* Desktop: 1024px+ */
@media (min-width: 1024px) {
  .container {
    padding: 32px;
    max-width: 1200px;
    margin: 0 auto;
  }
}

/* Large desktop: 1440px+ */
@media (min-width: 1440px) {
  .container {
    max-width: 1400px;
  }
}
```

### Responsive Components

```typescript
import { useMediaQuery } from "@/hooks/useMediaQuery";

function PipelineLayout({ children }: { children: ReactNode }) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isTablet = useMediaQuery("(min-width: 768px)");

  if (isDesktop) {
    return (
      <div className="layout-desktop">
        <Sidebar />
        <main>{children}</main>
      </div>
    );
  }

  if (isTablet) {
    return (
      <div className="layout-tablet">
        <CollapsibleSidebar />
        <main>{children}</main>
      </div>
    );
  }

  return (
    <div className="layout-mobile">
      <main>{children}</main>
      <BottomNav />
    </div>
  );
}
```

## Loading States

### Skeleton Loading

```typescript
function PipelineCardSkeleton() {
  return (
    <div className="pipeline-card skeleton" aria-hidden="true">
      <div className="skeleton-line skeleton-title" />
      <div className="skeleton-line skeleton-text" />
      <div className="skeleton-line skeleton-text short" />
    </div>
  );
}

function PipelineList() {
  const { pipelines, isLoading } = usePipelines();

  if (isLoading) {
    return (
      <div aria-busy="true" aria-label="Loading pipelines">
        {Array.from({ length: 3 }).map((_, i) => (
          <PipelineCardSkeleton key={i} />
        ))}
      </div>
    );
  }

  return (
    <div>
      {pipelines.map((pipeline) => (
        <PipelineCard key={pipeline.id} pipeline={pipeline} />
      ))}
    </div>
  );
}
```

### Loading Indicators

```typescript
function Button({ isLoading, children, ...props }: ButtonProps) {
  return (
    <button disabled={isLoading} aria-busy={isLoading} {...props}>
      {isLoading ? (
        <>
          <Spinner aria-hidden="true" />
          <span className="visually-hidden">Loading</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
```

## Error States

### Error Messages

```typescript
function FormField({ label, error, ...inputProps }: FormFieldProps) {
  const errorId = error ? `${inputProps.id}-error` : undefined;

  return (
    <div className="form-field">
      <label htmlFor={inputProps.id}>{label}</label>
      <input
        aria-invalid={!!error}
        aria-describedby={errorId}
        {...inputProps}
      />
      {error && (
        <span id={errorId} role="alert" className="error-message">
          {error}
        </span>
      )}
    </div>
  );
}
```

### Error Pages

```typescript
function ErrorBoundaryFallback({ error, resetErrorBoundary }: FallbackProps) {
  return (
    <div role="alert" className="error-page">
      <h1>Something went wrong</h1>
      <p>We're sorry, but something unexpected happened.</p>

      {import.meta.env.DEV && (
        <pre className="error-details">{error.message}</pre>
      )}

      <div className="error-actions">
        <button onClick={resetErrorBoundary}>Try Again</button>
        <a href="/">Go Home</a>
      </div>
    </div>
  );
}
```

## Empty States

```typescript
function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="empty-state" role="status">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <h3 className="empty-state-title">{title}</h3>
      <p className="empty-state-description">{description}</p>
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}

// Usage
function PipelineList() {
  const { pipelines, isLoading } = usePipelines();

  if (!isLoading && pipelines.length === 0) {
    return (
      <EmptyState
        icon={<PipelineIcon />}
        title="No pipelines yet"
        description="Create your first interview pipeline to start evaluating candidates."
        action={
          <Button onClick={() => navigate("/pipelines/new")}>
            Create Pipeline
          </Button>
        }
      />
    );
  }

  // ...
}
```

## Form Patterns

### Form Layout

```typescript
function PipelineForm({ onSubmit }: Props) {
  return (
    <form onSubmit={onSubmit} noValidate>
      <fieldset>
        <legend>Pipeline Details</legend>

        <TextField
          label="Pipeline Name"
          name="name"
          isRequired
          placeholder="e.g., Frontend Developer Interview"
          descriptiveText="A clear name helps candidates understand the role"
        />

        <TextAreaField
          label="Description"
          name="description"
          placeholder="Describe what this pipeline evaluates..."
        />
      </fieldset>

      <fieldset>
        <legend>Configuration</legend>

        <SelectField
          label="Visibility"
          name="visibility"
          options={[
            { value: "private", label: "Private - Only you can access" },
            { value: "team", label: "Team - Your team can access" },
            { value: "public", label: "Public - Anyone can view" },
          ]}
        />
      </fieldset>

      <div className="form-actions">
        <Button type="button" variation="link">
          Cancel
        </Button>
        <Button type="submit" variation="primary">
          Create Pipeline
        </Button>
      </div>
    </form>
  );
}
```

### Validation Feedback

```typescript
function ValidatedInput({
  label,
  value,
  onChange,
  validate,
  ...props
}: ValidatedInputProps) {
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const handleBlur = () => {
    setTouched(true);
    if (validate) {
      const validationError = validate(value);
      setError(validationError);
    }
  };

  const handleChange = (newValue: string) => {
    onChange(newValue);
    if (touched && validate) {
      setError(validate(newValue));
    }
  };

  return (
    <TextField
      label={label}
      value={value}
      onChange={(e) => handleChange(e.target.value)}
      onBlur={handleBlur}
      hasError={touched && !!error}
      errorMessage={touched ? error : undefined}
      {...props}
    />
  );
}
```

## Animations

### Micro-interactions

```css
/* Subtle hover effect */
.card {
  transition: transform 0.2s ease, box-shadow 0.2s ease;
}

.card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

/* Focus ring animation */
.button:focus-visible {
  outline: 2px solid var(--amplify-colors-brand-primary-80);
  outline-offset: 2px;
  animation: focus-ring 0.2s ease;
}

@keyframes focus-ring {
  from {
    outline-offset: 0;
  }
  to {
    outline-offset: 2px;
  }
}

/* Loading spinner */
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.spinner {
  animation: spin 0.8s linear infinite;
}
```

### Reduced Motion

```css
/* Respect user preferences */
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## Testing Accessibility

### Automated Testing

```typescript
// Storybook accessibility addon
// .storybook/main.ts
export default {
  addons: ["@storybook/addon-a11y"],
};

// Component story with a11y checks
import { expect, within } from "@storybook/test";

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    // Check button is accessible
    const button = canvas.getByRole("button", { name: /submit/i });
    expect(button).toBeVisible();
    expect(button).not.toBeDisabled();
  },
};
```
