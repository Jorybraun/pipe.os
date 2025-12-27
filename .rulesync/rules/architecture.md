---
name: Architecture Patterns
targets: ["*"]
description: "AWS Amplify Gen 2 architecture patterns, project structure, and backend infrastructure guidelines"
globs: []
alwaysApply: false
---

# Architecture Patterns

## AWS Amplify Gen 2 Architecture

Pipe uses AWS Amplify Gen 2's TypeScript-first approach for backend infrastructure. All backend resources are defined in the `amplify/` directory using TypeScript.

### Project Structure

```
amplify/
├── backend.ts          # Main backend definition (imports all resources)
├── auth/
│   └── resource.ts     # Amazon Cognito authentication
├── data/
│   └── resource.ts     # AWS AppSync API + DynamoDB
├── storage/            # (when needed) Amazon S3 configuration
│   └── resource.ts
├── functions/          # (when needed) AWS Lambda functions
│   └── {function-name}/
│       ├── resource.ts
│       └── handler.ts
├── package.json
└── tsconfig.json
```

### Backend Definition Pattern

```typescript
// amplify/backend.ts
import { defineBackend } from "@aws-amplify/backend";
import { auth } from "./auth/resource";
import { data } from "./data/resource";

export const backend = defineBackend({
  auth,
  data,
});
```

### Authentication Resource

```typescript
// amplify/auth/resource.ts
import { defineAuth } from "@aws-amplify/backend";

export const auth = defineAuth({
  loginWith: {
    email: true,
    // Optional: social providers
    // externalProviders: {
    //   google: { clientId: 'xxx', clientSecret: 'xxx' },
    // },
  },
  // Multi-factor authentication
  multifactor: {
    mode: "OPTIONAL",
    totp: true,
  },
});
```

### Data Resource (GraphQL API)

```typescript
// amplify/data/resource.ts
import { defineData, a, type ClientSchema } from "@aws-amplify/backend";

const schema = a.schema({
  // Model definitions with authorization rules
  Pipeline: a
    .model({
      name: a.string().required(),
      description: a.string(),
      stages: a.hasMany("Stage", "pipelineId"),
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group("admins").to(["read", "create", "update", "delete"]),
    ]),

  Stage: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo("Pipeline", "pipelineId"),
      name: a.string().required(),
      type: a.enum(["CODE_REVIEW", "VOICE_INTERVIEW", "PLANNING"]),
      order: a.integer().required(),
    })
    .authorization((allow) => [allow.owner()]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  schema,
  authorizationModes: {
    defaultAuthorizationMode: "userPool",
  },
});
```

## Frontend Architecture

### React Application Structure

```
src/
├── App.tsx                 # Main application with Amplify config
├── main.tsx                # Entry point
├── components/             # Reusable UI components
│   ├── ui/                 # Base UI components
│   └── features/           # Feature-specific components
├── hooks/                  # Custom React hooks
├── lib/                    # Utilities and helpers
├── pages/                  # Page components (if using routing)
└── types/                  # TypeScript type definitions
```

### Amplify Client Configuration

```typescript
// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { Amplify } from "aws-amplify";
import outputs from "../amplify_outputs.json";
import App from "./App";

Amplify.configure(outputs);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

### Data Fetching Patterns

```typescript
// Using Amplify Data client
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

const client = generateClient<Schema>();

// Query example
async function fetchPipelines() {
  const { data, errors } = await client.models.Pipeline.list();
  if (errors) {
    console.error("Error fetching pipelines:", errors);
    return [];
  }
  return data;
}

// Create example
async function createPipeline(name: string, description?: string) {
  const { data, errors } = await client.models.Pipeline.create({
    name,
    description,
  });
  if (errors) {
    throw new Error(errors[0].message);
  }
  return data;
}

// Real-time subscription example
function subscribeToPipelines(
  callback: (pipeline: Schema["Pipeline"]["type"]) => void
) {
  return client.models.Pipeline.observeQuery().subscribe({
    next: ({ items }) => {
      items.forEach(callback);
    },
  });
}
```

### Authentication Patterns

```typescript
// Using Amplify Authenticator component
import { Authenticator } from "@aws-amplify/ui-react";
import "@aws-amplify/ui-react/styles.css";

function App() {
  return (
    <Authenticator>
      {({ signOut, user }) => (
        <main>
          <h1>Welcome, {user?.username}</h1>
          <button onClick={signOut}>Sign Out</button>
          {/* Protected content */}
        </main>
      )}
    </Authenticator>
  );
}
```

```typescript
// Using Auth APIs directly
import {
  signIn,
  signOut,
  getCurrentUser,
  fetchAuthSession,
} from "aws-amplify/auth";

// Check current user
async function checkAuth() {
  try {
    const user = await getCurrentUser();
    return user;
  } catch {
    return null;
  }
}

// Get auth tokens
async function getAuthTokens() {
  const session = await fetchAuthSession();
  return {
    accessToken: session.tokens?.accessToken?.toString(),
    idToken: session.tokens?.idToken?.toString(),
  };
}
```

## Component Architecture

### Component Organization

```
components/
├── ui/                     # Primitive UI components
│   ├── Button/
│   │   ├── Button.tsx
│   │   ├── Button.stories.tsx
│   │   └── Button.test.tsx
│   ├── Card/
│   └── Input/
├── features/               # Feature-specific components
│   ├── Pipeline/
│   │   ├── PipelineBuilder.tsx
│   │   ├── PipelineCard.tsx
│   │   └── PipelineList.tsx
│   └── Candidate/
└── layouts/                # Layout components
    ├── MainLayout.tsx
    └── AuthLayout.tsx
```

### Component Pattern

```typescript
// components/ui/Button/Button.tsx
import { type ReactNode, type ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md" | "lg";
  children: ReactNode;
  isLoading?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  children,
  isLoading = false,
  disabled,
  className = "",
  ...props
}: ButtonProps) {
  return (
    <button
      className={`btn btn-${variant} btn-${size} ${className}`}
      disabled={disabled || isLoading}
      {...props}
    >
      {isLoading ? <LoadingSpinner /> : children}
    </button>
  );
}
```

## State Management

### Local State with React Hooks

```typescript
import { useState, useEffect } from "react";
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../../amplify/data/resource";

const client = generateClient<Schema>();

function usePipelines() {
  const [pipelines, setPipelines] = useState<Schema["Pipeline"]["type"][]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    async function load() {
      try {
        const { data, errors } = await client.models.Pipeline.list();
        if (errors) throw new Error(errors[0].message);
        setPipelines(data);
      } catch (err) {
        setError(err instanceof Error ? err : new Error("Unknown error"));
      } finally {
        setIsLoading(false);
      }
    }
    load();
  }, []);

  return { pipelines, isLoading, error };
}
```

### Real-time State with Subscriptions

```typescript
function usePipelinesRealtime() {
  const [pipelines, setPipelines] = useState<Schema["Pipeline"]["type"][]>([]);

  useEffect(() => {
    const subscription = client.models.Pipeline.observeQuery().subscribe({
      next: ({ items, isSynced }) => {
        setPipelines([...items]);
      },
      error: (err) => console.error("Subscription error:", err),
    });

    return () => subscription.unsubscribe();
  }, []);

  return pipelines;
}
```

## Error Handling

### API Error Handling

```typescript
import { type GraphQLError } from "graphql";

interface AmplifyError {
  message: string;
  errorType?: string;
}

function handleAmplifyError(errors: AmplifyError[] | GraphQLError[]): never {
  const error = errors[0];
  const message = error.message || "An unexpected error occurred";

  // Log for debugging
  console.error("[Amplify Error]", { errors });

  throw new Error(message);
}

async function safeFetch<T>(
  operation: () => Promise<{ data: T | null; errors?: AmplifyError[] }>
): Promise<T> {
  const { data, errors } = await operation();
  if (errors) handleAmplifyError(errors);
  if (!data) throw new Error("No data returned");
  return data;
}
```

### Component Error Boundaries

```typescript
import { Component, type ReactNode, type ErrorInfo } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || <div>Something went wrong.</div>;
    }
    return this.props.children;
  }
}
```

## Performance Patterns

### Code Splitting

```typescript
import { lazy, Suspense } from "react";

// Lazy load heavy components
const PipelineBuilder = lazy(
  () => import("./features/Pipeline/PipelineBuilder")
);

function App() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <PipelineBuilder />
    </Suspense>
  );
}
```

### Memoization

```typescript
import { memo, useMemo, useCallback } from "react";

// Memoize expensive computations
function PipelineStats({ pipelines }: { pipelines: Pipeline[] }) {
  const stats = useMemo(
    () => ({
      total: pipelines.length,
      active: pipelines.filter((p) => p.isActive).length,
      completed: pipelines.filter((p) => p.status === "COMPLETED").length,
    }),
    [pipelines]
  );

  return <StatsDisplay stats={stats} />;
}

// Memoize callbacks
function PipelineList({ onSelect }: { onSelect: (id: string) => void }) {
  const handleSelect = useCallback(
    (id: string) => {
      onSelect(id);
    },
    [onSelect]
  );

  return <List onItemClick={handleSelect} />;
}

// Memoize components
const PipelineCard = memo(function PipelineCard({
  pipeline,
}: {
  pipeline: Pipeline;
}) {
  return <Card>{pipeline.name}</Card>;
});
```

## Security Patterns

### Authorization Rules

Follow Amplify's authorization model:

1. **Owner-based:** User owns and controls their data
2. **Group-based:** Role-based access control
3. **Public:** Unauthenticated access (use sparingly)
4. **Custom:** Lambda-based authorization

```typescript
// In data/resource.ts
const schema = a.schema({
  PrivateData: a
    .model({
      content: a.string(),
    })
    .authorization((allow) => [allow.owner()]),

  TeamData: a
    .model({
      content: a.string(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.group("team").to(["read"]),
    ]),

  PublicData: a
    .model({
      content: a.string(),
    })
    .authorization((allow) => [
      allow.guest().to(["read"]),
      allow.authenticated().to(["read", "create"]),
    ]),
});
```

### Input Validation

Always validate input at multiple layers:

```typescript
import { z } from "zod";

const PipelineSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  stages: z
    .array(
      z.object({
        name: z.string().min(1),
        type: z.enum(["CODE_REVIEW", "VOICE_INTERVIEW", "PLANNING"]),
      })
    )
    .min(1),
});

function createPipeline(input: unknown) {
  const validated = PipelineSchema.parse(input);
  return client.models.Pipeline.create(validated);
}
```
