---
description: >-
  Core Web Vitals targets, React performance optimization, and bundle size
  budgets
---
# Performance Standards

## Performance Budgets

### Core Web Vitals Targets

| Metric                         | Target  | Maximum |
| ------------------------------ | ------- | ------- |
| Largest Contentful Paint (LCP) | < 2.5s  | 4.0s    |
| First Input Delay (FID)        | < 100ms | 300ms   |
| Cumulative Layout Shift (CLS)  | < 0.1   | 0.25    |
| Time to First Byte (TTFB)      | < 800ms | 1800ms  |

### Bundle Size Budgets

| Bundle                | Target  | Maximum |
| --------------------- | ------- | ------- |
| Initial JS            | < 150KB | 250KB   |
| Initial CSS           | < 50KB  | 100KB   |
| Largest chunk         | < 100KB | 200KB   |
| Total JS (all chunks) | < 500KB | 1MB     |

### API Response Times

| Operation               | Target  | Maximum |
| ----------------------- | ------- | ------- |
| List queries            | < 200ms | 500ms   |
| Single item fetch       | < 100ms | 300ms   |
| Create/Update mutations | < 300ms | 1000ms  |
| Complex aggregations    | < 500ms | 2000ms  |

## React Performance

### Component Memoization

```typescript
import { memo, useMemo, useCallback } from "react";

// Memoize expensive component
const PipelineCard = memo(function PipelineCard({ pipeline }: Props) {
  return <Card>{pipeline.name}</Card>;
});

// With custom comparison
const PipelineCard = memo(
  function PipelineCard({ pipeline, onSelect }: Props) {
    return <Card onClick={() => onSelect(pipeline.id)}>{pipeline.name}</Card>;
  },
  (prevProps, nextProps) => {
    // Only re-render if these specific props change
    return (
      prevProps.pipeline.id === nextProps.pipeline.id &&
      prevProps.pipeline.name === nextProps.pipeline.name &&
      prevProps.pipeline.updatedAt === nextProps.pipeline.updatedAt
    );
  }
);
```

### Expensive Computation Memoization

```typescript
function PipelineAnalytics({ pipelines }: { pipelines: Pipeline[] }) {
  // Memoize expensive calculation
  const stats = useMemo(() => {
    console.log("Computing stats..."); // Only logs when pipelines changes

    return {
      total: pipelines.length,
      active: pipelines.filter((p) => p.status === "ACTIVE").length,
      averageScore:
        pipelines.reduce((sum, p) => sum + (p.score ?? 0), 0) /
        pipelines.length,
      byStatus: pipelines.reduce((acc, p) => {
        acc[p.status] = (acc[p.status] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };
  }, [pipelines]);

  return <StatsDisplay stats={stats} />;
}
```

### Callback Memoization

```typescript
function PipelineList({ onSelect }: { onSelect: (id: string) => void }) {
  // Memoize callback to prevent unnecessary child re-renders
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
    },
    [onSelect]
  );

  return (
    <ul>
      {pipelines.map((pipeline) => (
        <PipelineCard
          key={pipeline.id}
          pipeline={pipeline}
          onSelect={handleSelect}
        />
      ))}
    </ul>
  );
}
```

## Code Splitting

### Route-based Splitting

```typescript
import { lazy, Suspense } from "react";
import { Routes, Route } from "react-router-dom";

// Lazy load route components
const Dashboard = lazy(() => import("./pages/Dashboard"));
const PipelineBuilder = lazy(() => import("./pages/PipelineBuilder"));
const CandidateReport = lazy(() => import("./pages/CandidateReport"));
const Settings = lazy(() => import("./pages/Settings"));

function App() {
  return (
    <Suspense fallback={<PageLoader />}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/pipelines/new" element={<PipelineBuilder />} />
        <Route path="/candidates/:id" element={<CandidateReport />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
    </Suspense>
  );
}
```

### Component-based Splitting

```typescript
import { lazy, Suspense, useState } from "react";

// Lazy load heavy component
const RichTextEditor = lazy(() => import("./components/RichTextEditor"));
const ChartDashboard = lazy(() => import("./components/ChartDashboard"));

function PipelineDetails({ pipeline }: Props) {
  const [showEditor, setShowEditor] = useState(false);

  return (
    <div>
      <PipelineHeader pipeline={pipeline} />

      {/* Load editor only when needed */}
      {showEditor && (
        <Suspense fallback={<EditorSkeleton />}>
          <RichTextEditor content={pipeline.description} />
        </Suspense>
      )}

      {/* Load charts only when tab is active */}
      <Tabs>
        <Tab id="overview">
          <PipelineOverview pipeline={pipeline} />
        </Tab>
        <Tab id="analytics">
          <Suspense fallback={<ChartSkeleton />}>
            <ChartDashboard pipelineId={pipeline.id} />
          </Suspense>
        </Tab>
      </Tabs>
    </div>
  );
}
```

## Data Loading

### Pagination

```typescript
function usePaginatedPipelines(pageSize = 20) {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const loadMore = useCallback(async () => {
    if (isLoading) return;
    setIsLoading(true);

    try {
      const { data, nextToken: newToken } = await client.models.Pipeline.list({
        limit: pageSize,
        nextToken: nextToken ?? undefined,
      });

      setPipelines((prev) => [...prev, ...data]);
      setNextToken(newToken);
    } finally {
      setIsLoading(false);
    }
  }, [nextToken, pageSize, isLoading]);

  return {
    pipelines,
    isLoading,
    hasMore: nextToken !== null,
    loadMore,
  };
}

// Usage with infinite scroll
function PipelineList() {
  const { pipelines, isLoading, hasMore, loadMore } = usePaginatedPipelines();
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && hasMore && !isLoading) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    if (loadMoreRef.current) {
      observer.observe(loadMoreRef.current);
    }

    return () => observer.disconnect();
  }, [hasMore, isLoading, loadMore]);

  return (
    <div>
      {pipelines.map((pipeline) => (
        <PipelineCard key={pipeline.id} pipeline={pipeline} />
      ))}
      <div ref={loadMoreRef}>{isLoading && <Spinner />}</div>
    </div>
  );
}
```

### Optimistic Updates

```typescript
function usePipelineMutation() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);

  const updatePipeline = useCallback(
    async (id: string, updates: Partial<Pipeline>) => {
      // Optimistically update UI
      setPipelines((prev) =>
        prev.map((p) => (p.id === id ? { ...p, ...updates } : p))
      );

      try {
        // Persist to backend
        await client.models.Pipeline.update({ id, ...updates });
      } catch (error) {
        // Revert on failure
        setPipelines((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, ...updates, ...rollbackData } : p
          )
        );
        throw error;
      }
    },
    []
  );

  return { pipelines, updatePipeline };
}
```

## Image Optimization

### Lazy Loading Images

```typescript
function CandidateAvatar({ src, name }: { src: string; name: string }) {
  return (
    <img
      src={src}
      alt={`${name}'s avatar`}
      loading="lazy" // Native lazy loading
      decoding="async"
      width={48}
      height={48}
    />
  );
}
```

### Responsive Images

```typescript
function HeroImage({ src, alt }: { src: string; alt: string }) {
  return (
    <picture>
      <source
        srcSet={`${src}?w=400 400w, ${src}?w=800 800w, ${src}?w=1200 1200w`}
        sizes="(max-width: 400px) 400px, (max-width: 800px) 800px, 1200px"
        type="image/webp"
      />
      <img
        src={`${src}?w=800`}
        alt={alt}
        loading="lazy"
        style={{ width: "100%", height: "auto" }}
      />
    </picture>
  );
}
```

## State Management Performance

### Avoid Unnecessary Re-renders

```typescript
// BAD: Creating new object every render
function Component() {
  return <Child options={{ page: 1, limit: 10 }} />; // New object each render
}

// GOOD: Memoize or lift out
const DEFAULT_OPTIONS = { page: 1, limit: 10 }; // Constant reference

function Component() {
  return <Child options={DEFAULT_OPTIONS} />;
}

// Or with useMemo if options depend on props/state
function Component({ page }: Props) {
  const options = useMemo(() => ({ page, limit: 10 }), [page]);
  return <Child options={options} />;
}
```

### Split Context to Reduce Re-renders

```typescript
// BAD: Single context causes all consumers to re-render
const AppContext = createContext({ user: null, theme: "light", settings: {} });

// GOOD: Split into focused contexts
const UserContext = createContext<User | null>(null);
const ThemeContext = createContext<"light" | "dark">("light");
const SettingsContext = createContext<Settings>({});

// Components only re-render when their specific context changes
function ThemeToggle() {
  const theme = useContext(ThemeContext); // Only re-renders on theme change
  return <button>{theme}</button>;
}
```

## Monitoring

### Performance Monitoring

```typescript
// Track component render time
function useRenderTime(componentName: string) {
  useEffect(() => {
    const start = performance.now();

    return () => {
      const duration = performance.now() - start;
      if (duration > 16) {
        // Longer than one frame
        console.warn(
          `[${componentName}] Slow render: ${duration.toFixed(2)}ms`
        );
      }
    };
  });
}

// Track API response times
async function fetchWithTiming<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  const start = performance.now();

  try {
    const result = await operation();
    const duration = performance.now() - start;

    if (duration > 500) {
      console.warn(
        `[${operationName}] Slow API call: ${duration.toFixed(2)}ms`
      );
    }

    return result;
  } catch (error) {
    const duration = performance.now() - start;
    console.error(
      `[${operationName}] Failed after ${duration.toFixed(2)}ms:`,
      error
    );
    throw error;
  }
}
```

### Web Vitals Tracking

```typescript
import { onCLS, onFID, onLCP, onFCP, onTTFB } from "web-vitals";

function reportWebVitals() {
  onCLS((metric) => console.log("CLS:", metric.value));
  onFID((metric) => console.log("FID:", metric.value));
  onLCP((metric) => console.log("LCP:", metric.value));
  onFCP((metric) => console.log("FCP:", metric.value));
  onTTFB((metric) => console.log("TTFB:", metric.value));
}

// Call in main.tsx
reportWebVitals();
```

## Build Optimization

### Vite Configuration

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Enable minification
    minify: "esbuild",

    // Split chunks for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate vendor chunks
          vendor: ["react", "react-dom"],
          amplify: ["aws-amplify", "@aws-amplify/ui-react"],
        },
      },
    },

    // Generate source maps for production debugging
    sourcemap: true,

    // Target modern browsers
    target: "es2020",
  },
});
```

## Performance Checklist

### Before Launch

- [ ] Bundle size is within budget
- [ ] Images are optimized and lazy-loaded
- [ ] Code splitting is implemented for routes
- [ ] Heavy components are lazy-loaded
- [ ] Lists use pagination or virtualization
- [ ] API responses are paginated
- [ ] Web Vitals meet targets
- [ ] No unnecessary re-renders
- [ ] Expensive computations are memoized
- [ ] Suspense boundaries provide good loading UX
