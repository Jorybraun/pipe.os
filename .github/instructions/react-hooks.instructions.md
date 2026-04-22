---
description: 'React Hooks rules, custom hooks patterns, and hooks best practices'
---
# React Hooks Standards

## Hook Rules

### Rules of Hooks

1. **Only call hooks at the top level** - Never inside loops, conditions, or nested functions
2. **Only call hooks from React functions** - Components or custom hooks
3. **Custom hooks must start with `use`** - Enables lint rule enforcement

```typescript
// BAD: Hook inside condition
function Component({ shouldFetch }: Props) {
  if (shouldFetch) {
    const data = useFetch("/api/data"); // Error!
  }
}

// GOOD: Condition inside hook usage
function Component({ shouldFetch }: Props) {
  const data = useFetch(shouldFetch ? "/api/data" : null);
}
```

## Built-in Hooks

### useState

```typescript
import { useState } from "react";

function PipelineForm() {
  // Primitive state
  const [name, setName] = useState("");
  const [count, setCount] = useState(0);
  const [isActive, setIsActive] = useState(false);

  // Object state - always update immutably
  const [form, setForm] = useState({
    name: "",
    description: "",
  });

  // Functional update - when new state depends on previous
  const increment = () => setCount((prev) => prev + 1);

  // Object update - spread to preserve other fields
  const updateName = (name: string) => {
    setForm((prev) => ({ ...prev, name }));
  };

  // Lazy initialization - for expensive computations
  const [data] = useState(() => expensiveComputation());
}
```

### useEffect

```typescript
import { useEffect } from "react";

function PipelineViewer({ pipelineId }: { pipelineId: string }) {
  // Effect with dependency - runs when pipelineId changes
  useEffect(() => {
    fetchPipeline(pipelineId);
  }, [pipelineId]);

  // Effect with cleanup - subscriptions, timers, etc.
  useEffect(() => {
    const subscription = subscribeToPipeline(pipelineId);

    return () => {
      subscription.unsubscribe();
    };
  }, [pipelineId]);

  // Effect that runs once - empty dependency array
  useEffect(() => {
    initializeAnalytics();
  }, []);
}

// AVOID: Missing dependencies
useEffect(() => {
  // ESLint will warn about missing pipelineId in deps
  fetchPipeline(pipelineId);
}, []); // Missing dependency!

// AVOID: Object/array dependencies that change every render
useEffect(() => {
  doSomething(options);
}, [options]); // If options is created each render, this runs every render
```

### useCallback

```typescript
import { useCallback } from "react";

function PipelineList({ onSelect }: { onSelect: (id: string) => void }) {
  // Memoize callback to prevent child re-renders
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
    },
    [onSelect]
  );

  // Memoize callback with multiple dependencies
  const handleUpdate = useCallback(
    (id: string, data: Partial<Pipeline>) => {
      updatePipeline(id, data);
      onSelect(id);
    },
    [onSelect]
  );

  return <List onItemClick={handleSelect} />;
}
```

### useMemo

```typescript
import { useMemo } from "react";

function PipelineStats({ pipelines }: { pipelines: Pipeline[] }) {
  // Memoize expensive computation
  const stats = useMemo(() => {
    console.log("Computing stats..."); // Only logs when pipelines changes
    return {
      total: pipelines.length,
      active: pipelines.filter((p) => p.status === "ACTIVE").length,
      avgScore: calculateAverageScore(pipelines),
    };
  }, [pipelines]);

  // Memoize derived data
  const sortedPipelines = useMemo(
    () => [...pipelines].sort((a, b) => b.createdAt - a.createdAt),
    [pipelines]
  );

  return <StatsDisplay stats={stats} pipelines={sortedPipelines} />;
}
```

### useRef

```typescript
import { useRef, useEffect } from "react";

function SearchInput({ onSearch }: { onSearch: (query: string) => void }) {
  // DOM ref
  const inputRef = useRef<HTMLInputElement>(null);

  // Mutable value that doesn't trigger re-render
  const timeoutRef = useRef<number | null>(null);

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced search
  const handleChange = (value: string) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }

    timeoutRef.current = window.setTimeout(() => {
      onSearch(value);
    }, 300);
  };

  return (
    <input ref={inputRef} onChange={(e) => handleChange(e.target.value)} />
  );
}
```

### useContext

```typescript
import { createContext, useContext, type ReactNode } from "react";

// 1. Create context with type
interface AuthContextType {
  user: User | null;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

// 2. Create provider component
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const signIn = async (email: string, password: string) => {
    const result = await authService.signIn(email, password);
    setUser(result.user);
  };

  const signOut = async () => {
    await authService.signOut();
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, signIn, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

// 3. Create custom hook for consumption
export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
}

// 4. Usage
function ProfileButton() {
  const { user, signOut } = useAuth();

  if (!user) return <SignInButton />;

  return <button onClick={signOut}>{user.name} (Sign Out)</button>;
}
```

### useReducer

```typescript
import { useReducer } from "react";

// State type
interface FormState {
  name: string;
  description: string;
  status: "idle" | "submitting" | "success" | "error";
  error: string | null;
}

// Action types
type FormAction =
  | { type: "SET_FIELD"; field: keyof FormState; value: string }
  | { type: "SUBMIT" }
  | { type: "SUCCESS" }
  | { type: "ERROR"; error: string }
  | { type: "RESET" };

// Reducer
function formReducer(state: FormState, action: FormAction): FormState {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "SUBMIT":
      return { ...state, status: "submitting", error: null };
    case "SUCCESS":
      return { ...state, status: "success" };
    case "ERROR":
      return { ...state, status: "error", error: action.error };
    case "RESET":
      return initialState;
    default:
      return state;
  }
}

const initialState: FormState = {
  name: "",
  description: "",
  status: "idle",
  error: null,
};

// Usage
function PipelineForm() {
  const [state, dispatch] = useReducer(formReducer, initialState);

  const handleSubmit = async () => {
    dispatch({ type: "SUBMIT" });
    try {
      await createPipeline(state.name, state.description);
      dispatch({ type: "SUCCESS" });
    } catch (e) {
      dispatch({ type: "ERROR", error: e.message });
    }
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={state.name}
        onChange={(e) =>
          dispatch({ type: "SET_FIELD", field: "name", value: e.target.value })
        }
        disabled={state.status === "submitting"}
      />
      {state.error && <ErrorMessage>{state.error}</ErrorMessage>}
    </form>
  );
}
```

## Custom Hooks

### Data Fetching Hook

```typescript
import { useState, useEffect } from "react";

interface UseFetchResult<T> {
  data: T | null;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

export function useFetch<T>(url: string | null): UseFetchResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(!!url);
  const [error, setError] = useState<Error | null>(null);
  const [refetchIndex, setRefetchIndex] = useState(0);

  useEffect(() => {
    if (!url) {
      setData(null);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [url, refetchIndex]);

  const refetch = () => setRefetchIndex((i) => i + 1);

  return { data, isLoading, error, refetch };
}
```

### Amplify Data Hook

```typescript
import { useState, useEffect, useCallback } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

interface UsePipelinesOptions {
  filter?: { status?: { eq: string } };
}

interface UsePipelinesResult {
  pipelines: Schema["Pipeline"]["type"][];
  isLoading: boolean;
  error: Error | null;
  create: (name: string) => Promise<Schema["Pipeline"]["type"]>;
  update: (
    id: string,
    data: Partial<Schema["Pipeline"]["type"]>
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function usePipelines(
  options?: UsePipelinesOptions
): UsePipelinesResult {
  const [pipelines, setPipelines] = useState<Schema["Pipeline"]["type"][]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const subscription = client.models.Pipeline.observeQuery({
      filter: options?.filter,
    }).subscribe({
      next: ({ items, isSynced }) => {
        setPipelines([...items]);
        if (isSynced) setIsLoading(false);
      },
      error: (err) => {
        setError(err);
        setIsLoading(false);
      },
    });

    return () => subscription.unsubscribe();
  }, [options?.filter]);

  const create = useCallback(async (name: string) => {
    const { data, errors } = await client.models.Pipeline.create({
      name,
      status: "DRAFT",
    });
    if (errors) throw new Error(errors[0].message);
    return data!;
  }, []);

  const update = useCallback(
    async (id: string, updates: Partial<Schema["Pipeline"]["type"]>) => {
      const { errors } = await client.models.Pipeline.update({
        id,
        ...updates,
      });
      if (errors) throw new Error(errors[0].message);
    },
    []
  );

  const remove = useCallback(async (id: string) => {
    const { errors } = await client.models.Pipeline.delete({ id });
    if (errors) throw new Error(errors[0].message);
  }, []);

  return { pipelines, isLoading, error, create, update, remove };
}
```

### Form Hook

```typescript
import { useState, useCallback } from "react";

interface UseFormOptions<T> {
  initialValues: T;
  validate?: (values: T) => Partial<Record<keyof T, string>>;
  onSubmit: (values: T) => Promise<void>;
}

interface UseFormResult<T> {
  values: T;
  errors: Partial<Record<keyof T, string>>;
  isSubmitting: boolean;
  handleChange: (field: keyof T, value: T[keyof T]) => void;
  handleSubmit: () => Promise<void>;
  reset: () => void;
}

export function useForm<T extends Record<string, unknown>>({
  initialValues,
  validate,
  onSubmit,
}: UseFormOptions<T>): UseFormResult<T> {
  const [values, setValues] = useState<T>(initialValues);
  const [errors, setErrors] = useState<Partial<Record<keyof T, string>>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleChange = useCallback((field: keyof T, value: T[keyof T]) => {
    setValues((prev) => ({ ...prev, [field]: value }));
    // Clear error when field changes
    setErrors((prev) => ({ ...prev, [field]: undefined }));
  }, []);

  const handleSubmit = useCallback(async () => {
    // Validate
    if (validate) {
      const validationErrors = validate(values);
      if (Object.keys(validationErrors).length > 0) {
        setErrors(validationErrors);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await onSubmit(values);
    } finally {
      setIsSubmitting(false);
    }
  }, [values, validate, onSubmit]);

  const reset = useCallback(() => {
    setValues(initialValues);
    setErrors({});
  }, [initialValues]);

  return { values, errors, isSubmitting, handleChange, handleSubmit, reset };
}
```

### Debounce Hook

```typescript
import { useState, useEffect } from "react";

export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(timer);
  }, [value, delay]);

  return debouncedValue;
}

// Usage
function SearchComponent() {
  const [query, setQuery] = useState("");
  const debouncedQuery = useDebounce(query, 300);

  useEffect(() => {
    if (debouncedQuery) {
      searchPipelines(debouncedQuery);
    }
  }, [debouncedQuery]);

  return <input value={query} onChange={(e) => setQuery(e.target.value)} />;
}
```

### Local Storage Hook

```typescript
import { useState, useEffect } from "react";

export function useLocalStorage<T>(
  key: string,
  initialValue: T
): [T, (value: T | ((prev: T) => T)) => void] {
  // Get initial value from localStorage or use provided initial value
  const [storedValue, setStoredValue] = useState<T>(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  // Update localStorage when value changes
  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(storedValue));
    } catch (error) {
      console.error(`Error saving to localStorage: ${error}`);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}

// Usage
function Settings() {
  const [theme, setTheme] = useLocalStorage("theme", "light");

  return (
    <select value={theme} onChange={(e) => setTheme(e.target.value)}>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  );
}
```

## Hook Best Practices

### Dependency Arrays

```typescript
// Include all values from component scope used in the effect
useEffect(() => {
  // pipelineId and onUpdate are used, so include them
  const unsubscribe = subscribe(pipelineId, onUpdate);
  return () => unsubscribe();
}, [pipelineId, onUpdate]);

// For objects/arrays, memoize or extract primitives
const { id, status } = pipeline;
useEffect(() => {
  fetchDetails(id, status);
}, [id, status]); // Use primitives, not pipeline object
```

### Avoiding Infinite Loops

```typescript
// BAD: Object created every render
useEffect(() => {
  doSomething(options);
}, [{ page: 1, limit: 10 }]); // New object every render = infinite loop

// GOOD: Memoize the object
const options = useMemo(() => ({ page: 1, limit: 10 }), []);
useEffect(() => {
  doSomething(options);
}, [options]);

// BETTER: Extract primitive values
const [page, limit] = [1, 10];
useEffect(() => {
  doSomething({ page, limit });
}, [page, limit]);
```

### Custom Hook Return Types

```typescript
// Return object for complex hooks (named values)
function usePipeline(id: string) {
  return {
    pipeline,
    isLoading,
    error,
    update,
    remove,
  };
}

// Return array for simple hooks (positional values, like useState)
function useToggle(initial: boolean): [boolean, () => void] {
  const [value, setValue] = useState(initial);
  const toggle = useCallback(() => setValue((v) => !v), []);
  return [value, toggle];
}
```
