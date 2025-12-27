---
description: Implement a technical specification with full AWS Amplify integration, tests, and documentation
targets: ["*"]
globs: []
---

# CODE Task

**Persona:** Execute this task as the `@developer` subagent (Devin, Staff Engineer).
Load the persona characteristics from `.rulesync/subagents/developer.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/architecture.md` - AWS Amplify Gen 2 patterns
- `.rulesync/rules/code-quality.md` - Code quality standards
- `.rulesync/rules/react-components.md` - React component patterns
- `.rulesync/rules/testing.md` - Vitest and Playwright testing patterns

---

## Task Objective

Implement a feature based on a Technical Specification, including:

1. AWS Amplify backend resources (if needed)
2. React components and hooks
3. Comprehensive tests (Vitest unit, Storybook, Playwright E2E)
4. Documentation (JSDoc, inline comments)

---

## Task Instructions

1. **Locate and read the Technical Specification:**
   - Ask: "What feature should I implement? (provide the spec path or describe the feature)"
   - Read the specification document to understand requirements
   - Identify backend vs frontend work needed

2. **Plan the implementation:**

   Break down the work into phases:

   **Phase 1: Backend (Amplify)**
   - Data schema changes in `amplify/data/resource.ts`
   - Authentication configuration (if needed)
   - Lambda functions (if needed)

   **Phase 2: Frontend**
   - React components
   - Custom hooks
   - State management

   **Phase 3: Integration**
   - Connect frontend to Amplify Data client
   - Implement real-time subscriptions (if needed)

   **Phase 4: Testing**
   - Unit tests with Vitest
   - Component tests with Storybook
   - E2E tests with Playwright

3. **Implement Amplify backend (if needed):**

   ```typescript
   // amplify/data/resource.ts
   import { defineData, a, type ClientSchema } from '@aws-amplify/backend';

   const schema = a.schema({
     // Add new models with authorization
     NewModel: a
       .model({
         name: a.string().required(),
         // ... fields from spec
       })
       .authorization((allow) => [allow.owner()]),
   });

   export type Schema = ClientSchema<typeof schema>;
   export const data = defineData({ schema });
   ```

4. **Implement React components:**

   Follow patterns from `.rulesync/rules/react-components.md`:

   ```typescript
   // src/components/features/Feature/FeatureName.tsx
   import { useState, useCallback } from 'react';
   import { generateClient } from 'aws-amplify/data';
   import type { Schema } from '../../../amplify/data/resource';

   const client = generateClient<Schema>();

   interface FeatureNameProps {
     // Props from spec
   }

   export function FeatureName({ ...props }: FeatureNameProps) {
     // Implementation
   }
   ```

5. **Create custom hooks:**

   ```typescript
   // src/hooks/useFeature.ts
   import { useState, useEffect, useCallback } from 'react';
   import { generateClient } from 'aws-amplify/data';
   import type { Schema } from '../../amplify/data/resource';

   const client = generateClient<Schema>();

   export function useFeature() {
     const [data, setData] = useState<Schema['Model']['type'][]>([]);
     const [isLoading, setIsLoading] = useState(true);
     const [error, setError] = useState<Error | null>(null);

     useEffect(() => {
       const subscription = client.models.Model.observeQuery().subscribe({
         next: ({ items, isSynced }) => {
           setData([...items]);
           if (isSynced) setIsLoading(false);
         },
         error: (err) => {
           setError(err);
           setIsLoading(false);
         },
       });

       return () => subscription.unsubscribe();
     }, []);

     return { data, isLoading, error };
   }
   ```

6. **Write tests:**

   **Unit tests (Vitest):**
   ```typescript
   // src/components/features/Feature/FeatureName.test.tsx
   import { describe, it, expect, vi } from 'vitest';
   import { render, screen } from '@testing-library/react';
   import { FeatureName } from './FeatureName';

   describe('FeatureName', () => {
     it('renders correctly', () => {
       render(<FeatureName />);
       expect(screen.getByTestId('feature-name')).toBeInTheDocument();
     });
   });
   ```

   **Storybook stories:**
   ```typescript
   // stories/FeatureName.stories.tsx
   import type { Meta, StoryObj } from '@storybook/react';
   import { FeatureName } from '../src/components/features/Feature/FeatureName';

   const meta: Meta<typeof FeatureName> = {
     title: 'Features/FeatureName',
     component: FeatureName,
     tags: ['autodocs'],
   };

   export default meta;
   type Story = StoryObj<typeof meta>;

   export const Default: Story = {
     args: {},
   };
   ```

7. **Add documentation:**

   ```typescript
   /**
    * FeatureName displays the main feature interface.
    *
    * @example
    * ```tsx
    * <FeatureName onComplete={(result) => handleComplete(result)} />
    * ```
    */
   export function FeatureName({ onComplete }: FeatureNameProps) {
     // ...
   }
   ```

8. **Run quality checks:**

   ```bash
   npm run lint
   npm run build
   npm run test
   ```

9. **Provide summary:**

   ```markdown
   ## Implementation Complete

   ### Backend Changes
   - Added `Model` to Amplify Data schema
   - Authorization: owner-based access

   ### Frontend Changes
   - Created `FeatureName` component
   - Created `useFeature` hook

   ### Files Created/Modified
   - `amplify/data/resource.ts` - Added Model schema
   - `src/components/features/Feature/FeatureName.tsx` - New component
   - `src/hooks/useFeature.ts` - New hook
   - `stories/FeatureName.stories.tsx` - Storybook story
   - `src/components/features/Feature/FeatureName.test.tsx` - Tests

   ### Test Coverage
   - Unit tests: 100% of new code
   - Storybook: All component states documented

   ### Quality Checks
   - Lint: Pass
   - TypeScript: Pass
   - Tests: Pass

   ### Next Steps
   - Run `/review` for QA verification
   - Run `/draft-pr` to create pull request
   ```

---

## Notes

- Always check Amplify sandbox before modifying backend: `npx ampx sandbox`
- Use `generateClient<Schema>()` for type-safe data operations
- Follow existing patterns in codebase for consistency
- Test in Storybook before integration testing
