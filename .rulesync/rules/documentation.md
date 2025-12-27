---
name: Documentation Standards
targets: ["*"]
description: "JSDoc comments, README structure, and component documentation requirements"
globs: []
alwaysApply: false
---

# Documentation Standards

## JSDoc Comments

### Required for All Exported Functions

````typescript
/**
 * Creates a new pipeline with the specified configuration.
 *
 * @param name - The pipeline name (1-100 characters)
 * @param options - Optional configuration settings
 * @returns The created pipeline object
 *
 * @throws {ValidationError} When name is empty or exceeds 100 characters
 * @throws {AuthError} When user is not authenticated
 *
 * @example
 * ```typescript
 * const pipeline = await createPipeline('Frontend Interview', {
 *   description: 'React developer assessment',
 *   maxCandidates: 50,
 * });
 * ```
 */
export async function createPipeline(
  name: string,
  options?: PipelineOptions
): Promise<Pipeline> {
  // Implementation
}
````

### Component Documentation

````typescript
/**
 * Displays a pipeline card with summary information and actions.
 *
 * Renders the pipeline name, description, stage count, and provides
 * quick actions for editing and viewing candidates.
 *
 * @example
 * ```tsx
 * <PipelineCard
 *   pipeline={myPipeline}
 *   onEdit={(id) => navigate(`/pipelines/${id}/edit`)}
 * />
 * ```
 */
export function PipelineCard({
  pipeline,
  onEdit,
  onDelete,
}: PipelineCardProps): JSX.Element {
  // Implementation
}
````

### Hook Documentation

````typescript
/**
 * Manages pipeline data with real-time subscriptions.
 *
 * Provides access to pipeline data with automatic updates when
 * the backend data changes. Handles loading states and errors.
 *
 * @param options - Configuration options
 * @returns Pipeline state and mutation functions
 *
 * @example
 * ```tsx
 * function PipelineList() {
 *   const { pipelines, isLoading, error, refresh } = usePipelines({
 *     filter: { status: 'ACTIVE' },
 *   });
 *
 *   if (isLoading) return <Spinner />;
 *   if (error) return <ErrorMessage error={error} />;
 *
 *   return <PipelineGrid pipelines={pipelines} />;
 * }
 * ```
 */
export function usePipelines(
  options?: UsePipelinesOptions
): UsePipelinesResult {
  // Implementation
}
````

## Inline Comments

### When to Comment

Comment the **why**, not the **what**:

```typescript
// BAD: Describes what code does (obvious from reading code)
// Check if user is authenticated
if (user) {
  // Navigate to dashboard
  navigate("/dashboard");
}

// GOOD: Explains business logic or reasoning
// Redirect to dashboard after login - candidates should see their
// active assessments immediately rather than a welcome page
if (user) {
  navigate("/dashboard");
}
```

### Complex Logic

```typescript
// Calculate weighted score across all stages
// Weights are normalized so they sum to 1.0
// Missing stage scores are excluded from calculation (not zero)
const totalWeight = stages
  .filter((stage) => stage.score !== null)
  .reduce((sum, stage) => sum + stage.weight, 0);

const weightedScore = stages
  .filter((stage) => stage.score !== null)
  .reduce((sum, stage) => {
    const normalizedWeight = stage.weight / totalWeight;
    return sum + stage.score! * normalizedWeight;
  }, 0);
```

### Workarounds and TODOs

```typescript
// TODO(#123): Remove this workaround once Amplify fixes the
// subscription reconnection issue in v6.7
await new Promise((resolve) => setTimeout(resolve, 100));

// HACK: Force re-render to work around React 18 concurrent mode
// issue with useEffect cleanup timing. See: https://github.com/...
setKey((prev) => prev + 1);

// FIXME: This is O(n^2) - refactor to use a Map for O(n) lookup
// when we have more than 100 stages per pipeline
```

## README Files

### Project README Structure

```markdown
# Project Name

One-line description of the project.

## Overview

2-3 paragraphs explaining:

- What the project does
- Why it exists
- Who it's for

## Quick Start

\`\`\`bash

# Minimum steps to get running

npm install
npm run dev
\`\`\`

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript
- **Backend:** AWS Amplify Gen 2
- **Database:** DynamoDB via Amplify Data

## Project Structure

\`\`\`
project/
├── amplify/ # Backend configuration
├── src/ # Frontend source
└── ...
\`\`\`

## Development

### Prerequisites

- Node.js 18+
- AWS Account
- Amplify CLI

### Setup

Detailed setup instructions...

### Scripts

- `npm run dev` - Start development server
- `npm run build` - Production build
- `npm run test` - Run tests

## Contributing

Guidelines for contributing...

## License

License information...
```

### Component/Module README

```markdown
# Component Name

Brief description of what this component does.

## Usage

\`\`\`tsx
import { Component } from './Component';

<Component prop="value" />
\`\`\`

## Props

| Prop | Type                 | Default | Description                |
| ---- | -------------------- | ------- | -------------------------- |
| name | string               | -       | Required. The display name |
| size | 'sm' \| 'md' \| 'lg' | 'md'    | Size variant               |

## Examples

### Basic Usage

\`\`\`tsx
<Component name="Example" />
\`\`\`

### With Custom Size

\`\`\`tsx
<Component name="Large Example" size="lg" />
\`\`\`

## Styling

CSS custom properties available:

- `--component-color` - Primary color
- `--component-spacing` - Internal spacing

## Accessibility

- Uses semantic HTML elements
- Supports keyboard navigation
- ARIA labels provided
```

## Technical Specifications

### Structure

Technical specifications should be stored in `/docs/specs/` and follow this structure:

```markdown
# Technical Specification - Feature Name

**Date:** YYYY-MM-DD
**Author:** Name
**Status:** Draft | In Review | Approved | Implemented

## Overview

Brief summary of what this spec covers.

## Goals

- Goal 1
- Goal 2

## Non-Goals

- What this spec explicitly does NOT cover

## Technical Design

### Architecture

Diagram and explanation of the architecture.

### Data Model

Schema definitions and relationships.

### API Design

Endpoints, parameters, responses.

## Implementation Plan

1. Phase 1: ...
2. Phase 2: ...

## Testing Strategy

How this will be tested.

## Security Considerations

Security implications and mitigations.

## Open Questions

- Question 1
- Question 2
```

## API Documentation

### REST/GraphQL Operations

```typescript
/**
 * @api {mutation} Pipeline.create Create Pipeline
 * @apiName CreatePipeline
 * @apiGroup Pipeline
 * @apiVersion 1.0.0
 *
 * @apiParam {String} name Pipeline name (1-100 chars)
 * @apiParam {String} [description] Pipeline description
 * @apiParam {String="DRAFT","ACTIVE"} [status=DRAFT] Initial status
 *
 * @apiSuccess {Object} pipeline Created pipeline object
 * @apiSuccess {String} pipeline.id Unique pipeline ID
 * @apiSuccess {String} pipeline.name Pipeline name
 *
 * @apiError ValidationError Invalid input parameters
 * @apiError AuthError User not authenticated
 */
```

### Type Definitions

```typescript
/**
 * Pipeline configuration for creating or updating pipelines.
 */
export interface PipelineConfig {
  /**
   * The pipeline display name.
   * @minLength 1
   * @maxLength 100
   */
  name: string;

  /**
   * Optional description explaining the pipeline's purpose.
   * @maxLength 1000
   */
  description?: string;

  /**
   * Maximum number of candidates that can participate.
   * @minimum 1
   * @maximum 10000
   * @default 100
   */
  maxCandidates?: number;

  /**
   * Whether the pipeline is visible to all users.
   * @default false
   */
  isPublic?: boolean;
}
```

## Storybook Documentation

### Story Format

```typescript
import type { Meta, StoryObj } from "@storybook/react";
import { PipelineCard } from "./PipelineCard";

/**
 * PipelineCard displays a summary view of a pipeline with
 * its name, description, and stage count. Used in pipeline
 * listings and dashboards.
 */
const meta: Meta<typeof PipelineCard> = {
  title: "Features/Pipeline/PipelineCard",
  component: PipelineCard,
  tags: ["autodocs"],
  argTypes: {
    onEdit: { action: "edit" },
    onDelete: { action: "delete" },
  },
};

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Default pipeline card with minimal configuration.
 */
export const Default: Story = {
  args: {
    pipeline: {
      id: "1",
      name: "Frontend Developer Interview",
      description: "Technical assessment for React developers",
      stageCount: 3,
      status: "ACTIVE",
    },
  },
};

/**
 * Card showing a draft pipeline with no description.
 */
export const Draft: Story = {
  args: {
    pipeline: {
      id: "2",
      name: "Backend Assessment",
      stageCount: 0,
      status: "DRAFT",
    },
  },
};

/**
 * Card with a very long description to test text truncation.
 */
export const LongDescription: Story = {
  args: {
    pipeline: {
      id: "3",
      name: "Full Stack Developer",
      description:
        "A comprehensive assessment covering frontend, backend, database design, and system architecture skills...",
      stageCount: 5,
      status: "ACTIVE",
    },
  },
};
```

## Documentation Maintenance

### Review Checklist

- [ ] All exported functions have JSDoc comments
- [ ] Complex logic has explanatory inline comments
- [ ] README files are up to date
- [ ] Examples compile and work correctly
- [ ] Types are fully documented
- [ ] Breaking changes are documented

### When to Update

1. **New features:** Document before merging
2. **API changes:** Update immediately
3. **Bug fixes:** Add inline comments if behavior is non-obvious
4. **Refactors:** Update any affected documentation
