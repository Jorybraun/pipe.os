---
name: Database Patterns
targets: ["*"]
description: "AWS Amplify Data patterns, GraphQL schema design, and database best practices"
globs: []
alwaysApply: false
---

# Database Patterns (Amplify Data)

## Overview

Pipe uses AWS Amplify Gen 2 Data, which provides:

- **GraphQL API** via AWS AppSync
- **NoSQL Database** via Amazon DynamoDB
- **Real-time Subscriptions** built-in
- **Type Safety** via TypeScript schema definitions

## Schema Definition

### Basic Model Pattern

```typescript
// amplify/data/resource.ts
import { defineData, a, type ClientSchema } from "@aws-amplify/backend";

const schema = a.schema({
  // Basic model with required and optional fields
  Pipeline: a
    .model({
      name: a.string().required(),
      description: a.string(),
      status: a.enum(["DRAFT", "ACTIVE", "ARCHIVED"]),
      isPublic: a.boolean().default(false),
      maxCandidates: a.integer().default(100),
      createdAt: a.datetime(),
      updatedAt: a.datetime(),
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

### Field Types

```typescript
const schema = a.schema({
  Example: a.model({
    // Scalar types
    stringField: a.string(),
    intField: a.integer(),
    floatField: a.float(),
    boolField: a.boolean(),
    dateField: a.date(), // YYYY-MM-DD
    timeField: a.time(), // HH:mm:ss.sss
    datetimeField: a.datetime(), // ISO 8601
    timestampField: a.timestamp(), // Unix timestamp
    emailField: a.email(),
    phoneField: a.phone(),
    urlField: a.url(),
    ipField: a.ipAddress(),
    jsonField: a.json(),
    idField: a.id(),

    // Modifiers
    requiredField: a.string().required(),
    defaultField: a.string().default("default value"),
    arrayField: a.string().array(),

    // Enums
    statusField: a.enum(["PENDING", "ACTIVE", "COMPLETED"]),
  }),
});
```

### Relationships

```typescript
const schema = a.schema({
  // One-to-Many: Pipeline has many Stages
  Pipeline: a
    .model({
      name: a.string().required(),
      stages: a.hasMany("Stage", "pipelineId"),
    })
    .authorization((allow) => [allow.owner()]),

  Stage: a
    .model({
      pipelineId: a.id().required(),
      pipeline: a.belongsTo("Pipeline", "pipelineId"),
      name: a.string().required(),
      order: a.integer().required(),
    })
    .authorization((allow) => [allow.owner()]),

  // Many-to-Many: Candidates participate in multiple Pipelines
  Candidate: a
    .model({
      email: a.email().required(),
      participations: a.hasMany("Participation", "candidateId"),
    })
    .authorization((allow) => [allow.owner()]),

  Participation: a
    .model({
      candidateId: a.id().required(),
      pipelineId: a.id().required(),
      candidate: a.belongsTo("Candidate", "candidateId"),
      pipeline: a.belongsTo("Pipeline", "pipelineId"),
      status: a.enum(["INVITED", "IN_PROGRESS", "COMPLETED"]),
      startedAt: a.datetime(),
      completedAt: a.datetime(),
    })
    .authorization((allow) => [allow.owner()]),
});
```

## Authorization Rules

### Owner-based Authorization

```typescript
const schema = a.schema({
  // Only the owner can read/write
  PrivateNote: a
    .model({
      content: a.string().required(),
    })
    .authorization((allow) => [allow.owner()]),

  // Owner can do everything, others can only read
  SharedPipeline: a
    .model({
      name: a.string().required(),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.authenticated().to(["read"]),
    ]),
});
```

### Group-based Authorization

```typescript
const schema = a.schema({
  // Admins have full access, managers can read/update
  CompanySettings: a
    .model({
      name: a.string().required(),
      config: a.json(),
    })
    .authorization((allow) => [
      allow.group("admins"),
      allow.group("managers").to(["read", "update"]),
    ]),
});
```

### Public Access

```typescript
const schema = a.schema({
  // Anyone can read, authenticated users can create
  PublicPipeline: a
    .model({
      name: a.string().required(),
      description: a.string(),
    })
    .authorization((allow) => [
      allow.guest().to(["read"]),
      allow.authenticated().to(["read", "create"]),
      allow.owner(),
    ]),
});
```

### Field-level Authorization

```typescript
const schema = a.schema({
  User: a
    .model({
      email: a.email().required(),
      displayName: a.string(),
      // Only owner can see their internal notes
      internalNotes: a.string().authorization((allow) => [allow.owner()]),
      // Only admins can see admin notes
      adminNotes: a.string().authorization((allow) => [allow.group("admins")]),
    })
    .authorization((allow) => [
      allow.owner(),
      allow.authenticated().to(["read"]),
    ]),
});
```

## Client Operations

### Setup

```typescript
import { generateClient } from "aws-amplify/data";
import type { Schema } from "../amplify/data/resource";

const client = generateClient<Schema>();
```

### Create

```typescript
// Basic create
async function createPipeline(
  name: string
): Promise<Schema["Pipeline"]["type"]> {
  const { data, errors } = await client.models.Pipeline.create({
    name,
    status: "DRAFT",
  });

  if (errors) {
    console.error("[createPipeline] Error:", errors);
    throw new Error(errors[0].message);
  }

  return data!;
}

// Create with relationships
async function createStage(
  pipelineId: string,
  name: string,
  order: number
): Promise<Schema["Stage"]["type"]> {
  const { data, errors } = await client.models.Stage.create({
    pipelineId,
    name,
    order,
  });

  if (errors) throw new Error(errors[0].message);
  return data!;
}
```

### Read

```typescript
// Get by ID
async function getPipeline(id: string) {
  const { data, errors } = await client.models.Pipeline.get({ id });
  if (errors) throw new Error(errors[0].message);
  return data;
}

// List all
async function listPipelines() {
  const { data, errors } = await client.models.Pipeline.list();
  if (errors) throw new Error(errors[0].message);
  return data;
}

// List with filter
async function listActivePipelines() {
  const { data, errors } = await client.models.Pipeline.list({
    filter: {
      status: { eq: "ACTIVE" },
    },
  });
  if (errors) throw new Error(errors[0].message);
  return data;
}

// Pagination
async function listPipelinesPage(nextToken?: string) {
  const {
    data,
    errors,
    nextToken: newNextToken,
  } = await client.models.Pipeline.list({
    limit: 20,
    nextToken,
  });
  if (errors) throw new Error(errors[0].message);
  return { data, nextToken: newNextToken };
}
```

### Update

```typescript
async function updatePipeline(
  id: string,
  updates: Partial<Omit<Schema["Pipeline"]["type"], "id">>
) {
  const { data, errors } = await client.models.Pipeline.update({
    id,
    ...updates,
  });

  if (errors) throw new Error(errors[0].message);
  return data;
}
```

### Delete

```typescript
async function deletePipeline(id: string) {
  const { data, errors } = await client.models.Pipeline.delete({ id });
  if (errors) throw new Error(errors[0].message);
  return data;
}
```

## Real-time Subscriptions

### Basic Subscription

```typescript
function subscribeToPipelines(
  callback: (pipeline: Schema["Pipeline"]["type"]) => void
) {
  const subscription = client.models.Pipeline.observeQuery().subscribe({
    next: ({ items, isSynced }) => {
      console.log("[Pipelines] Synced:", isSynced, "Count:", items.length);
      items.forEach(callback);
    },
    error: (error) => {
      console.error("[Pipelines] Subscription error:", error);
    },
  });

  return () => subscription.unsubscribe();
}
```

### Filtered Subscription

```typescript
function subscribeToActivePipelines(
  callback: (pipelines: Schema["Pipeline"]["type"][]) => void
) {
  const subscription = client.models.Pipeline.observeQuery({
    filter: { status: { eq: "ACTIVE" } },
  }).subscribe({
    next: ({ items }) => callback([...items]),
    error: (error) => console.error("[ActivePipelines] Error:", error),
  });

  return () => subscription.unsubscribe();
}
```

### React Hook Pattern

```typescript
import { useState, useEffect } from "react";

function usePipelines() {
  const [pipelines, setPipelines] = useState<Schema["Pipeline"]["type"][]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const subscription = client.models.Pipeline.observeQuery().subscribe({
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
  }, []);

  return { pipelines, isLoading, error };
}
```

## Best Practices

### Data Modeling

1. **Denormalize for read performance** - DynamoDB favors read-optimized schemas
2. **Use composite keys** - Combine IDs for efficient querying
3. **Design for access patterns** - Model data based on how you query it

### Authorization

1. **Default to owner authorization** - Start restrictive, open up as needed
2. **Use groups for roles** - Admins, managers, viewers
3. **Field-level for sensitive data** - Protect individual fields when needed

### Performance

1. **Use pagination** - Never load unbounded lists
2. **Filter on server** - Use filter parameters, not client-side filtering
3. **Limit subscription scope** - Filter subscriptions to reduce traffic

### Error Handling

```typescript
// Always check for errors
const { data, errors } = await client.models.Pipeline.list();
if (errors) {
  // Log with context
  console.error("[listPipelines] GraphQL errors:", errors);

  // Provide user-friendly message
  throw new Error("Failed to load pipelines. Please try again.");
}

// Handle null data
if (!data || data.length === 0) {
  return []; // Return empty array, not null
}
```
