---
description: >-
  TypeScript strict mode configuration, type inference, and type safety best
  practices
---
# TypeScript Type Standards

## Type Safety Philosophy

TypeScript is used in strict mode to catch errors at compile time. All code must pass strict type checking with no use of `any`.

## Configuration

### tsconfig.json Settings

```json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitThis": true,
    "useUnknownInCatchVariables": true,
    "alwaysStrict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true
  }
}
```

## Type Definition Patterns

### Interface vs Type

```typescript
// Use interface for object shapes that may be extended
interface Pipeline {
  id: string;
  name: string;
  description?: string;
  status: PipelineStatus;
}

// Interfaces can be extended
interface DetailedPipeline extends Pipeline {
  stages: Stage[];
  createdAt: Date;
  updatedAt: Date;
}

// Use type for unions, intersections, and computed types
type PipelineStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

type CreatePipelineInput = Omit<Pipeline, "id">;

type PipelineWithOwner = Pipeline & { ownerId: string };
```

### Props Types

```typescript
// Component props
interface PipelineCardProps {
  pipeline: Pipeline;
  onEdit?: (id: string) => void;
  onDelete?: (id: string) => void;
  isSelected?: boolean;
}

// With children
interface ContainerProps {
  children: ReactNode;
  className?: string;
}

// With render prop
interface DataLoaderProps<T> {
  url: string;
  children: (data: T, isLoading: boolean) => ReactNode;
}
```

### Generic Types

```typescript
// Generic function
function getById<T extends { id: string }>(
  items: T[],
  id: string
): T | undefined {
  return items.find((item) => item.id === id);
}

// Generic component
function List<T>({
  items,
  renderItem,
  keyExtractor,
}: {
  items: T[];
  renderItem: (item: T) => ReactNode;
  keyExtractor: (item: T) => string;
}) {
  return (
    <ul>
      {items.map((item) => (
        <li key={keyExtractor(item)}>{renderItem(item)}</li>
      ))}
    </ul>
  );
}

// Generic hook
function useAsyncData<T>(fetcher: () => Promise<T>): {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
} {
  // Implementation
}
```

## Utility Types

### Built-in Utility Types

```typescript
interface Pipeline {
  id: string;
  name: string;
  description: string;
  status: PipelineStatus;
  createdAt: Date;
}

// Partial - all properties optional
type PartialPipeline = Partial<Pipeline>;

// Required - all properties required
type RequiredPipeline = Required<Pipeline>;

// Pick - select specific properties
type PipelinePreview = Pick<Pipeline, "id" | "name" | "status">;

// Omit - exclude specific properties
type CreatePipelineInput = Omit<Pipeline, "id" | "createdAt">;

// Record - dictionary/map type
type StatusCounts = Record<PipelineStatus, number>;

// Readonly - immutable type
type ImmutablePipeline = Readonly<Pipeline>;

// ReturnType - infer function return type
type FetchResult = ReturnType<typeof fetchPipeline>;

// Parameters - infer function parameters
type FetchParams = Parameters<typeof fetchPipeline>;
```

### Custom Utility Types

```typescript
// Make specific properties required
type WithRequired<T, K extends keyof T> = T & { [P in K]-?: T[P] };

type PipelineWithName = WithRequired<Partial<Pipeline>, "name">;

// Make specific properties optional
type WithOptional<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

type PipelineWithOptionalDesc = WithOptional<Pipeline, "description">;

// Deep partial
type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

// Non-nullable
type NonNullableProps<T> = {
  [P in keyof T]: NonNullable<T[P]>;
};
```

## Type Guards

### Basic Type Guards

```typescript
// typeof guard
function processValue(value: string | number) {
  if (typeof value === "string") {
    return value.toUpperCase(); // TypeScript knows it's string
  }
  return value.toFixed(2); // TypeScript knows it's number
}

// instanceof guard
function handleError(error: unknown) {
  if (error instanceof Error) {
    console.error(error.message); // TypeScript knows it's Error
  } else {
    console.error("Unknown error:", error);
  }
}

// in guard
function isPipeline(obj: unknown): obj is Pipeline {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "id" in obj &&
    "name" in obj &&
    "status" in obj
  );
}
```

### Custom Type Guards

```typescript
// Type predicate function
function isActiveStatus(status: PipelineStatus): status is "ACTIVE" {
  return status === "ACTIVE";
}

// Discriminated union guard
type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string };

function handleResponse<T>(response: ApiResponse<T>): T {
  if (response.success) {
    return response.data; // TypeScript narrows to success branch
  }
  throw new Error(response.error); // TypeScript narrows to error branch
}

// Array type guard
function isStringArray(arr: unknown[]): arr is string[] {
  return arr.every((item) => typeof item === "string");
}
```

## Discriminated Unions

### State Machines

```typescript
type PipelineState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; data: Pipeline }
  | { status: "error"; error: Error };

function PipelineViewer({ state }: { state: PipelineState }) {
  switch (state.status) {
    case "idle":
      return <p>Ready to load</p>;
    case "loading":
      return <Spinner />;
    case "success":
      return <PipelineCard pipeline={state.data} />;
    case "error":
      return <ErrorMessage error={state.error} />;
  }
}
```

### Action Types (Reducers)

```typescript
type PipelineAction =
  | { type: "FETCH_START" }
  | { type: "FETCH_SUCCESS"; payload: Pipeline[] }
  | { type: "FETCH_ERROR"; payload: Error }
  | { type: "SELECT"; payload: string }
  | { type: "DELETE"; payload: string }
  | { type: "UPDATE"; payload: { id: string; changes: Partial<Pipeline> } };

function pipelineReducer(state: State, action: PipelineAction): State {
  switch (action.type) {
    case "FETCH_START":
      return { ...state, isLoading: true };
    case "FETCH_SUCCESS":
      return { ...state, isLoading: false, pipelines: action.payload };
    case "FETCH_ERROR":
      return { ...state, isLoading: false, error: action.payload };
    // TypeScript ensures all cases are handled
  }
}
```

## Amplify Data Types

### Schema Types

```typescript
// Import generated types from Amplify Data
import type { Schema } from "../amplify/data/resource";

// Model types
type Pipeline = Schema["Pipeline"]["type"];
type Stage = Schema["Stage"]["type"];

// Create input types
type CreatePipelineInput = Schema["Pipeline"]["createType"];
type UpdatePipelineInput = Schema["Pipeline"]["updateType"];

// Using in components
interface PipelineCardProps {
  pipeline: Schema["Pipeline"]["type"];
  onUpdate: (data: Schema["Pipeline"]["updateType"]) => Promise<void>;
}
```

### API Response Types

```typescript
// Amplify Data client response
type ListPipelinesResult = {
  data: Schema["Pipeline"]["type"][];
  errors?: { message: string }[];
  nextToken?: string | null;
};

type GetPipelineResult = {
  data: Schema["Pipeline"]["type"] | null;
  errors?: { message: string }[];
};

// Type-safe wrapper
async function fetchPipelines(): Promise<Pipeline[]> {
  const { data, errors } = await client.models.Pipeline.list();
  if (errors) {
    throw new Error(errors[0].message);
  }
  return data;
}
```

## Best Practices

### Avoid `any`

```typescript
// BAD: Using any
function process(data: any) {
  return data.value; // No type safety
}

// GOOD: Using unknown with type narrowing
function process(data: unknown): string {
  if (isDataWithValue(data)) {
    return data.value;
  }
  throw new Error("Invalid data");
}

function isDataWithValue(data: unknown): data is { value: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    "value" in data &&
    typeof (data as { value: unknown }).value === "string"
  );
}
```

### Explicit Return Types

```typescript
// GOOD: Explicit return types for exported functions
export function formatPipelineName(name: string): string {
  return name.trim().toLowerCase();
}

export async function fetchPipelines(): Promise<Pipeline[]> {
  // ...
}

// Inferred types are fine for internal/simple functions
const double = (n: number) => n * 2; // number inferred
```

### Const Assertions

```typescript
// Use as const for literal types
const PIPELINE_STATUSES = ["DRAFT", "ACTIVE", "ARCHIVED"] as const;
type PipelineStatus = (typeof PIPELINE_STATUSES)[number]; // 'DRAFT' | 'ACTIVE' | 'ARCHIVED'

// Object literal as const
const CONFIG = {
  maxRetries: 3,
  timeout: 5000,
} as const;
// CONFIG.maxRetries is literal type 3, not number
```

### Null Handling

```typescript
// Optional chaining
const userName = user?.profile?.name;

// Nullish coalescing
const displayName = userName ?? "Anonymous";

// Non-null assertion (use sparingly, with justification)
const element = document.getElementById("root")!; // We know this exists

// Better: Handle null case
const element = document.getElementById("root");
if (!element) {
  throw new Error("Root element not found");
}
```

## Type Organization

### File Structure

```
src/
├── types/
│   ├── index.ts           # Re-exports all types
│   ├── pipeline.ts        # Pipeline-related types
│   ├── candidate.ts       # Candidate-related types
│   └── api.ts             # API response types
├── components/
│   └── PipelineCard/
│       ├── PipelineCard.tsx
│       └── types.ts       # Component-specific types
```

### Import/Export Patterns

```typescript
// types/pipeline.ts
export interface Pipeline {
  id: string;
  name: string;
  status: PipelineStatus;
}

export type PipelineStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

// types/index.ts
export type { Pipeline, PipelineStatus } from "./pipeline";
export type { Candidate, CandidateProfile } from "./candidate";

// Usage in components
import type { Pipeline, PipelineStatus } from "@/types";
```
