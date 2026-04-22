---
mode: agent
description: 'Write comprehensive documentation for a file, folder, or feature'
---
# DOCUMENT Task

**Persona:** Execute this task as the `@developer` subagent (Devin, Staff Engineer).
Load the persona characteristics from `.rulesync/subagents/developer.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/documentation.md` - Documentation standards and patterns
- `.rulesync/rules/code-quality.md` - Code quality standards for inline comments

---

## Task Objective

Create thorough, maintainable documentation for a specified file, folder, or feature. This includes inline code comments, JSDoc function signatures, Storybook documentation, and/or complete README files. Follow all standards from `.rulesync/rules/documentation.md`.

---

## Task Instructions

1. **Initiate discovery:**
   - Ask: "What would you like me to document? (provide a file path, folder path, or feature description)"
   - Examine the target code to understand purpose, functionality, and relationships

2. **Determine documentation type:**

   Ask these questions:
   1. "What type of documentation should I create?"
      - `inline` - Inline code comments
      - `jsdoc` - JSDoc function signatures
      - `storybook` - Storybook stories and documentation
      - `readme` - Complete README file
      - `all` - Comprehensive documentation
   2. "Are there any specific sections or aspects you want me to focus on?"
   3. "Should I update existing documentation or create new documentation?"

3. **Analyze the code:**
   - Read the target file(s)
   - Understand overall purpose and functionality
   - Identify key functions, hooks, components
   - Note Amplify Data usage patterns
   - Check for existing documentation
   - Identify architectural decisions or design patterns used

4. **Write documentation following standards:**

   Apply all documentation patterns from `.rulesync/rules/documentation.md`:

   **Inline Comments:**
   - Explain "why" not "what"
   - Comment edge cases and assumptions
   - Document Amplify-specific patterns

   **JSDoc Comments:**

   ```typescript
   /**
    * Creates a new pipeline with the specified configuration.
    *
    * @param name - The display name for the pipeline
    * @param stages - Array of stage configurations
    * @returns The created pipeline with generated ID
    * @throws {Error} If user is not authenticated
    *
    * @example
    * ```typescript
    * const pipeline = await createPipeline('Engineering', [
    *   { name: 'Resume Review', type: 'REVIEW' },
    *   { name: 'Technical Interview', type: 'INTERVIEW' },
    * ]);
    * ```
    */
   ```

   **Storybook Stories:**

   ```typescript
   import type { Meta, StoryObj } from '@storybook/react';
   import { PipelineCard } from './PipelineCard';

   const meta: Meta<typeof PipelineCard> = {
     title: 'Components/PipelineCard',
     component: PipelineCard,
     tags: ['autodocs'],
     parameters: {
       docs: {
         description: {
           component: 'Displays a pipeline summary with status and candidate count.',
         },
       },
     },
   };

   export default meta;
   type Story = StoryObj<typeof meta>;

   /**
    * Default state with active pipeline.
    */
   export const Default: Story = {
     args: {
       pipeline: {
         id: '1',
         name: 'Engineering Pipeline',
         status: 'ACTIVE',
         candidateCount: 12,
       },
     },
   };
   ```

   **README Files:**
   - Use the template from `.rulesync/templates-v3/readme-template.md`

5. **Document Amplify-specific patterns:**

   ```typescript
   /**
    * Custom hook for managing pipeline data with real-time updates.
    *
    * Uses Amplify Data subscriptions for live sync. Automatically cleans up
    * subscription on unmount to prevent memory leaks.
    *
    * @returns Object containing pipelines, loading state, and error
    *
    * @example
    * ```typescript
    * const { pipelines, isLoading, error } = usePipelines();
    * ```
    */
   export function usePipelines() {
     // Implementation with observeQuery subscription
   }
   ```

6. **Verify documentation quality:**
   - Ensure all code examples are valid TypeScript
   - Verify all links and references are correct
   - Test that documented commands actually work
   - Check for completeness

7. **Provide summary:**
   - List all documentation files created or modified
   - Summarize what was documented
   - Highlight any gaps or areas that need further documentation
   - Note any related files that should be updated
   - Provide recommendations for improving code clarity
   - Ask: "Would you like me to test this code (`/test`) or make any other improvements?"

---

## Documentation Patterns

### Component Documentation

```typescript
/**
 * PipelineCard Component
 *
 * Displays a summary card for a pipeline including name, status,
 * and candidate count. Supports click action for navigation.
 *
 * @component
 *
 * @example
 * ```tsx
 * <PipelineCard
 *   pipeline={pipeline}
 *   onClick={(id) => navigate(`/pipelines/${id}`)}
 * />
 * ```
 */
```

### Hook Documentation

```typescript
/**
 * Hook for creating pipelines with optimistic updates.
 *
 * Provides mutation function with automatic error handling
 * and loading state management.
 *
 * @returns Object with create function, loading state, and error
 *
 * @example
 * ```typescript
 * const { createPipeline, isCreating, error } = useCreatePipeline();
 *
 * await createPipeline({ name: 'New Pipeline' });
 * ```
 */
```

### Amplify Data Pattern Documentation

```typescript
/**
 * Fetches all pipelines for the authenticated user.
 *
 * Uses Amplify Data client with owner-based authorization.
 * Results are automatically filtered by the authenticated user's ID.
 *
 * @returns Promise resolving to array of pipelines
 * @throws {Error} If user is not authenticated
 *
 * @example
 * ```typescript
 * const { data: pipelines, errors } = await client.models.Pipeline.list();
 * ```
 */
```

---

## Notes

- Reference `.rulesync/rules/documentation.md` for all documentation patterns
- For README files, use the template from `.rulesync/templates-v3/readme-template.md`
- Document the "why" more than the "what"
- Keep documentation current with code changes
- Use Storybook for component documentation
- Include Amplify-specific patterns and considerations
