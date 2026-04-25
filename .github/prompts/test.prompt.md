---
mode: agent
description: >-
  Write comprehensive tests using Vitest, Storybook, and Playwright for a file,
  folder, or feature
---
# TEST Task

**Persona:** Execute this task as the `@developer` subagent (Devin, Staff Engineer).
Load the persona characteristics from `.rulesync/subagents/developer.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/testing.md` - Testing standards and patterns
- `.rulesync/rules/code-quality.md` - Code quality standards

---

## Task Objective

Create comprehensive test coverage for a specified file, folder, or feature using:

- **Vitest** - Unit and integration tests
- **Storybook** - Component visual testing and documentation
- **Playwright** - End-to-end browser testing

---

## Task Instructions

1. **Initiate discovery:**
   - Ask: "What would you like me to test? (provide a file path, folder path, or feature description)"
   - Examine the target code to understand functionality and dependencies

2. **Determine test scope:**

   Ask these questions:

   1. "What type of tests should I write?"
      - `unit` - Test individual functions and modules
      - `component` - Test React components with Storybook
      - `e2e` - Test complete user workflows with Playwright
      - `all` - Comprehensive test coverage

   2. "Are there specific test cases or edge cases to focus on?"

   3. "Should I update existing tests or create new test files?"

3. **Analyze the code:**
   - Read the target file(s)
   - Understand function signatures and expected behaviors
   - Identify dependencies and integrations
   - Note error handling and edge cases
   - Check for existing test coverage

4. **Write unit tests (Vitest):**

   Create `.test.ts` or `.test.tsx` files alongside source:

   ```typescript
   import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
   import { render, screen, fireEvent, waitFor } from '@testing-library/react';
   import { functionUnderTest } from './module';
   import { ComponentUnderTest } from './Component';

   describe('functionUnderTest', () => {
     it('should handle the happy path', () => {
       // Arrange
       const input = 'test input';

       // Act
       const result = functionUnderTest(input);

       // Assert
       expect(result).toBe('expected output');
     });

     it('should handle edge cases', () => {
       expect(functionUnderTest('')).toBe('');
       expect(functionUnderTest(null as any)).toThrow();
     });

     it('should handle errors gracefully', () => {
       expect(() => functionUnderTest('invalid')).toThrow('Error message');
     });
   });

   describe('ComponentUnderTest', () => {
     const mockProps = {
       data: { id: '1', name: 'Test' },
       onAction: vi.fn(),
     };

     beforeEach(() => {
       vi.clearAllMocks();
     });

     it('renders correctly with props', () => {
       render(<ComponentUnderTest {...mockProps} />);
       expect(screen.getByText('Test')).toBeInTheDocument();
     });

     it('calls onAction when button is clicked', () => {
       render(<ComponentUnderTest {...mockProps} />);
       fireEvent.click(screen.getByRole('button'));
       expect(mockProps.onAction).toHaveBeenCalledWith('1');
     });
   });
   ```

5. **Write Storybook stories:**

   Create `.stories.tsx` files for visual testing:

   ```typescript
   import type { Meta, StoryObj } from '@storybook/react';
   import { expect, within, userEvent } from '@storybook/test';
   import { ComponentUnderTest } from './Component';

   const meta: Meta<typeof ComponentUnderTest> = {
     title: 'Features/ComponentUnderTest',
     component: ComponentUnderTest,
     tags: ['autodocs'],
     parameters: {
       layout: 'centered',
     },
     argTypes: {
       onAction: { action: 'action' },
     },
   };

   export default meta;
   type Story = StoryObj<typeof meta>;

   export const Default: Story = {
     args: {
       data: { id: '1', name: 'Default State' },
     },
   };

   export const Loading: Story = {
     args: {
       isLoading: true,
     },
   };

   export const Empty: Story = {
     args: {
       data: null,
     },
   };

   export const WithInteraction: Story = {
     args: {
       data: { id: '1', name: 'Interactive' },
     },
     play: async ({ canvasElement, args }) => {
       const canvas = within(canvasElement);

       // Find and click button
       const button = canvas.getByRole('button');
       await userEvent.click(button);

       // Verify action was called
       await expect(args.onAction).toHaveBeenCalled();
     },
   };
   ```

6. **Write E2E tests (Playwright):**

   Create `.spec.ts` files in `e2e/` directory:

   ```typescript
   import { test, expect } from '@playwright/test';

   test.describe('Feature Name', () => {
     test.beforeEach(async ({ page }) => {
       // Setup - navigate to page, login if needed
       await page.goto('/feature');
     });

     test('should complete the main user flow', async ({ page }) => {
       // Arrange - find elements
       const input = page.getByLabel('Name');
       const submitButton = page.getByRole('button', { name: 'Submit' });

       // Act - perform actions
       await input.fill('Test Value');
       await submitButton.click();

       // Assert - verify outcome
       await expect(page.getByText('Success')).toBeVisible();
     });

     test('should handle errors gracefully', async ({ page }) => {
       // Simulate error condition
       await page.route('**/api/**', route => route.abort());

       await page.getByRole('button', { name: 'Load Data' }).click();

       await expect(page.getByRole('alert')).toContainText('Error loading');
     });
   });
   ```

7. **Mock Amplify Data client:**

   ```typescript
   import { vi } from 'vitest';

   // Mock the Amplify client
   vi.mock('aws-amplify/data', () => ({
     generateClient: () => ({
       models: {
         Pipeline: {
           list: vi.fn().mockResolvedValue({
             data: [{ id: '1', name: 'Test Pipeline' }],
             errors: undefined,
           }),
           create: vi.fn().mockResolvedValue({
             data: { id: '2', name: 'New Pipeline' },
             errors: undefined,
           }),
           observeQuery: vi.fn().mockReturnValue({
             subscribe: vi.fn().mockImplementation(({ next }) => {
               next({ items: [{ id: '1', name: 'Test' }], isSynced: true });
               return { unsubscribe: vi.fn() };
             }),
           }),
         },
       },
     }),
   }));
   ```

8. **Run tests and verify:**

   ```bash
   # Run unit tests
   npm run test

   # Run with coverage
   npm run test -- --coverage

   # Run specific test file
   npm run test -- path/to/file.test.ts

   # Run Storybook for visual testing
   npm run storybook

   # Run E2E tests
   npm run test:e2e

   # Run E2E in headed mode (see browser)
   npm run test:e2e -- --headed
   ```

9. **Provide summary:**

   ```markdown
   ## Test Coverage Complete

   ### Unit Tests
   - Created: `src/components/Feature/Feature.test.tsx`
   - Tests: 8 passing
   - Coverage: 95% statements, 100% branches

   ### Storybook Stories
   - Created: `stories/Feature.stories.tsx`
   - Stories: Default, Loading, Empty, Error, Interactive

   ### E2E Tests
   - Created: `e2e/feature.spec.ts`
   - Scenarios: Happy path, error handling, edge cases

   ### Test Results
   ```
   npm run test
   ✓ 8 tests passed

   npm run test:e2e
   ✓ 3 tests passed
   ```

   ### Next Steps
   - Review test coverage with `/review`
   - Create PR with `/draft-pr`
   ```

---

## Testing Best Practices

### Arrange-Act-Assert

```typescript
it('should update the count when button is clicked', () => {
  // Arrange - set up test conditions
  render(<Counter initialCount={0} />);

  // Act - perform the action
  fireEvent.click(screen.getByRole('button', { name: 'Increment' }));

  // Assert - verify the outcome
  expect(screen.getByText('Count: 1')).toBeInTheDocument();
});
```

### Test Isolation

- Each test should be independent
- Clean up mocks between tests with `beforeEach`/`afterEach`
- Don't rely on test execution order

### Coverage Goals

- Critical paths: 90%+
- Business logic: 80%+
- UI components: 70%+
- Utilities: 100%

---

## Notes

- Reference `.rulesync/rules/testing.md` for all testing patterns
- Test behavior, not implementation
- Keep tests fast and focused
- Use data-testid for reliable element selection
