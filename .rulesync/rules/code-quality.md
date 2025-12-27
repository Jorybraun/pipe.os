---
name: Code Quality Standards
targets: ["*"]
description: "TypeScript strict mode, linting rules, naming conventions, and code quality standards"
globs: []
alwaysApply: false
---

# Code Quality Standards

## TypeScript Configuration

### Strict Mode Required

All code must pass TypeScript strict mode validation.

```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true
  }
}
```

### Type Safety Rules

1. **Never use `any`** - Use `unknown` and narrow with type guards
2. **Explicit return types** - All exported functions must have explicit return types
3. **Proper generics** - Use generic constraints appropriately
4. **Discriminated unions** - Use for complex state management

```typescript
// BAD: Using any
function process(data: any) {
  return data.value;
}

// GOOD: Using unknown with type guard
function process(data: unknown): string {
  if (isValidData(data)) {
    return data.value;
  }
  throw new Error("Invalid data");
}

function isValidData(data: unknown): data is { value: string } {
  return (
    typeof data === "object" &&
    data !== null &&
    "value" in data &&
    typeof (data as { value: unknown }).value === "string"
  );
}
```

## ESLint Configuration

### Required Plugins

```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:react-hooks/recommended",
    "plugin:react-refresh/recommended"
  ],
  "rules": {
    "@typescript-eslint/no-explicit-any": "error",
    "@typescript-eslint/explicit-function-return-type": "warn",
    "@typescript-eslint/no-unused-vars": [
      "error",
      { "argsIgnorePattern": "^_" }
    ],
    "react-hooks/rules-of-hooks": "error",
    "react-hooks/exhaustive-deps": "warn"
  }
}
```

## Naming Conventions

### Files and Directories

- **Components:** PascalCase - `PipelineBuilder.tsx`
- **Hooks:** camelCase with `use` prefix - `usePipelines.ts`
- **Utilities:** camelCase - `formatDate.ts`
- **Types:** PascalCase - `types.ts` containing `Pipeline`, `Stage`
- **Constants:** camelCase for files, UPPER_SNAKE_CASE for values

### Code Elements

```typescript
// Components: PascalCase
function PipelineCard({ pipeline }: PipelineCardProps) {}

// Hooks: camelCase with 'use' prefix
function usePipelines() {}

// Functions: camelCase
function formatDate(date: Date): string {}

// Variables: camelCase
const pipelineCount = 10;

// Constants: UPPER_SNAKE_CASE
const MAX_STAGES = 10;
const API_TIMEOUT_MS = 30000;

// Types/Interfaces: PascalCase
interface Pipeline {}
type StageType = "CODE_REVIEW" | "VOICE_INTERVIEW";

// Enums: PascalCase with PascalCase members
enum StageStatus {
  Pending = "PENDING",
  Active = "ACTIVE",
  Completed = "COMPLETED",
}
```

## Code Structure

### File Organization

```typescript
// 1. Imports (grouped and ordered)
// - React/framework imports
import { useState, useEffect, type ReactNode } from "react";

// - Third-party imports
import { generateClient } from "aws-amplify/data";

// - Internal imports (absolute paths)
import { Button } from "@/components/ui/Button";
import type { Pipeline } from "@/types";

// - Relative imports
import { formatPipelineName } from "./utils";
import type { PipelineCardProps } from "./types";

// 2. Types (if component-specific)
interface LocalState {
  isExpanded: boolean;
}

// 3. Constants
const MAX_DESCRIPTION_LENGTH = 200;

// 4. Component or main export
export function PipelineCard({ pipeline, onSelect }: PipelineCardProps) {
  // ...
}

// 5. Helper functions (if any)
function truncateDescription(text: string): string {
  // ...
}
```

### Function Structure

```typescript
/**
 * Creates a new pipeline with the specified configuration.
 *
 * @param name - The pipeline name (1-100 characters)
 * @param config - Optional configuration settings
 * @returns The created pipeline object
 * @throws {ValidationError} When name is invalid
 * @throws {AuthError} When user is not authenticated
 */
async function createPipeline(
  name: string,
  config?: PipelineConfig
): Promise<Pipeline> {
  // 1. Input validation
  if (!name || name.length > 100) {
    throw new ValidationError("Invalid pipeline name");
  }

  // 2. Authentication/authorization check
  const user = await getCurrentUser();
  if (!user) {
    throw new AuthError("User not authenticated");
  }

  // 3. Main logic
  const { data, errors } = await client.models.Pipeline.create({
    name,
    ...config,
    ownerId: user.userId,
  });

  // 4. Error handling
  if (errors) {
    console.error("[createPipeline] Failed:", errors);
    throw new Error(errors[0].message);
  }

  // 5. Return result
  return data;
}
```

## Error Handling

### Error Handling Patterns

```typescript
// 1. Custom error classes
class PipeError extends Error {
  constructor(
    message: string,
    public code: string,
    public context?: Record<string, unknown>
  ) {
    super(message);
    this.name = "PipeError";
  }
}

class ValidationError extends PipeError {
  constructor(message: string, context?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", context);
    this.name = "ValidationError";
  }
}

class AuthError extends PipeError {
  constructor(message: string) {
    super(message, "AUTH_ERROR");
    this.name = "AuthError";
  }
}

// 2. Try-catch with proper typing
async function safeFetch<T>(
  operation: () => Promise<T>,
  errorMessage: string
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    console.error(`[safeFetch] ${errorMessage}:`, error);

    if (error instanceof PipeError) {
      throw error; // Re-throw known errors
    }

    throw new PipeError(errorMessage, "UNKNOWN_ERROR", {
      originalError: error instanceof Error ? error.message : String(error),
    });
  }
}

// 3. Result pattern for operations that can fail
type Result<T, E = Error> = { ok: true; data: T } | { ok: false; error: E };

async function tryCreatePipeline(
  name: string
): Promise<Result<Pipeline, PipeError>> {
  try {
    const pipeline = await createPipeline(name);
    return { ok: true, data: pipeline };
  } catch (error) {
    if (error instanceof PipeError) {
      return { ok: false, error };
    }
    return {
      ok: false,
      error: new PipeError("Failed to create pipeline", "UNKNOWN_ERROR"),
    };
  }
}
```

## Logging Standards

### Structured Logging

```typescript
// Use structured logging with consistent prefixes
console.log("[PipelineBuilder] Initializing", { userId, pipelineId });
console.warn("[PipelineBuilder] Retrying operation", {
  attempt: 2,
  maxAttempts: 3,
});
console.error("[PipelineBuilder] Failed to save", {
  error: error.message,
  pipelineId,
});

// Never log sensitive data
console.log("[Auth] User authenticated", { userId }); // Good
console.log("[Auth] User authenticated", { userId, token }); // BAD - exposes token

// Development-only logging
if (import.meta.env.DEV) {
  console.debug("[PipelineBuilder] State update", state);
}
```

### Log Levels

- **log:** Normal operations, milestones
- **warn:** Recoverable issues, deprecations
- **error:** Errors requiring attention
- **debug:** Development debugging (remove in production)

## Code Comments

### When to Comment

1. **Why, not what** - Explain reasoning, not obvious logic
2. **Complex algorithms** - Explain non-obvious approaches
3. **Workarounds** - Document temporary fixes with issue links
4. **Business logic** - Explain domain-specific rules

```typescript
// BAD: Describes what code does (obvious)
// Loop through pipelines
for (const pipeline of pipelines) {
  // ...
}

// GOOD: Explains why
// Process pipelines in reverse chronological order to ensure
// the most recent changes are applied last (conflict resolution)
for (const pipeline of pipelines.sort((a, b) => a.updatedAt - b.updatedAt)) {
  // ...
}

// GOOD: Documents workaround
// TODO(#123): Remove this workaround once Amplify fixes the
// subscription reconnection issue in v6.7
await new Promise((resolve) => setTimeout(resolve, 100));
```

### JSDoc Standards

````typescript
/**
 * Validates and processes a candidate assessment submission.
 *
 * This function performs multi-stage validation:
 * 1. Schema validation against the stage requirements
 * 2. Plagiarism detection for code submissions
 * 3. AI-assistance analysis for transparency scoring
 *
 * @param submission - The candidate's submission data
 * @param stageId - The pipeline stage being assessed
 * @returns Assessment result with scores and feedback
 *
 * @throws {ValidationError} When submission format is invalid
 * @throws {TimeoutError} When external API calls exceed 30s
 *
 * @example
 * ```typescript
 * const result = await processSubmission(
 *   { code: 'function add(a, b) { return a + b; }' },
 *   'stage_code_review_001'
 * );
 * console.log(result.scores.codeQuality); // 0.85
 * ```
 */
async function processSubmission(
  submission: Submission,
  stageId: string
): Promise<AssessmentResult> {
  // ...
}
````

## Quality Gates

### Pre-commit Checks

All code must pass these checks before committing:

1. **TypeScript:** `npm run build` - No type errors
2. **Linting:** `npm run lint` - No ESLint errors
3. **Formatting:** Consistent code style

### CI/CD Gates

1. **Build:** `npm run build` must succeed
2. **Lint:** `npm run lint` with zero warnings
3. **Tests:** All tests passing
4. **Coverage:** Minimum 80% on new code

### Priority Levels

- **P0 (Critical):** Must fix before merge

  - Type errors
  - Failing tests
  - Security vulnerabilities
  - Build failures

- **P1 (High):** Should fix before merge

  - Missing error handling
  - Accessibility issues
  - Missing JSDoc on public APIs

- **P2 (Medium):** Address soon

  - Minor code quality issues
  - Performance optimizations
  - Documentation gaps

- **P3 (Low):** Nice to have
  - Style improvements
  - Refactoring opportunities
