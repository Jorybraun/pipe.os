---
mode: agent
description: 'Test-Driven Development workflow - Write a failing test for a bug, then fix it'
---
# TDD Task

**Persona:** Execute this task as the `@developer` subagent (Devin, Staff Engineer).
Load the persona characteristics from `.rulesync/subagents/developer.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/architecture.md` - AWS Amplify Gen 2 patterns
- `.rulesync/rules/code-quality.md` - Code quality standards
- `.rulesync/rules/testing.md` - Testing patterns (Vitest, Storybook, Playwright)
- `.rulesync/rules/documentation.md` - Documentation standards

---

## Task Objective

Follow a Test-Driven Development (TDD) workflow to fix a bug:

1. Understand the bug description
2. Write a test that reproduces the bug (failing test)
3. Verify the test fails for the expected reason
4. Fix the bug
5. Verify the test passes after the fix

---

## Task Instructions

1. **Gather bug information:**

   Ask the user: "Please describe the bug you're experiencing."

   If the description is unclear or incomplete, prompt for clarification:

   ```
   I need more information to write an accurate test. Please provide:

   1. **Expected behavior:** What should happen?
   2. **Actual behavior:** What is actually happening?
   3. **Steps to reproduce:** How can I trigger this bug?
   4. **Affected component/feature:** Which file, function, or feature is involved?
   5. **Error messages (if any):** What errors or warnings appear?
   ```

   Continue asking clarifying questions until you have a clear understanding of:
   - The expected outcome
   - The actual (buggy) outcome
   - How to reproduce the issue
   - Which code is affected

2. **Identify the affected code:**
   - Search for the relevant files, functions, or components
   - Read the code to understand the current implementation
   - Identify where the bug likely exists
   - Check for existing tests related to this functionality

3. **Write a failing test:**

   Follow testing patterns from `.rulesync/rules/testing.md`:

   **For Vitest Unit Tests:**

   ```typescript
   import { describe, it, expect, vi } from 'vitest';
   import { functionUnderTest } from './module';

   describe('Bug fix: {brief description}', () => {
     it('should {expected behavior} when {scenario}', async () => {
       // Arrange: Set up test data and context
       const testData = createTestData();

       // Act: Perform the action that triggers the bug
       const result = await functionUnderTest(testData);

       // Assert: Verify expected behavior (this will fail until bug is fixed)
       expect(result).toEqual(expectedValue);
     });
   });
   ```

   **For React Component Tests:**

   ```typescript
   import { describe, it, expect } from 'vitest';
   import { render, screen, fireEvent } from '@testing-library/react';
   import { ComponentUnderTest } from './Component';

   describe('Bug fix: {brief description}', () => {
     it('should {expected behavior} when {scenario}', () => {
       render(<ComponentUnderTest {...props} />);

       // Trigger the bug scenario
       fireEvent.click(screen.getByRole('button'));

       // Assert expected behavior
       expect(screen.getByText('Expected Text')).toBeInTheDocument();
     });
   });
   ```

   **For Storybook Interaction Tests:**

   ```typescript
   export const BugFix: Story = {
     args: { /* props that trigger the bug */ },
     play: async ({ canvasElement }) => {
       const canvas = within(canvasElement);

       // Trigger the bug scenario
       await userEvent.click(canvas.getByRole('button'));

       // Assert expected behavior
       await expect(canvas.getByText('Expected')).toBeInTheDocument();
     },
   };
   ```

4. **Run the test and verify it fails:**

   ```bash
   # For unit/integration tests
   npm run test {test-file-path}

   # For Storybook tests
   npm run storybook
   # Then run interaction tests

   # For E2E tests
   npm run test:e2e {test-file-path}
   ```

   **CRITICAL:** Verify that:
   - The test fails (as expected)
   - The failure message matches the bug description
   - The test is testing the right thing (not a false positive)

   Show the test failure output to the user and confirm:
   "Test is failing as expected. The failure matches the bug you described: {summary}. Proceeding to fix the bug."

5. **Fix the bug:**
   - Analyze the code to identify the root cause
   - Implement the fix following patterns from:
     - `.rulesync/rules/architecture.md` - For Amplify patterns
     - `.rulesync/rules/code-quality.md` - For code quality standards
     - `.rulesync/rules/security.md` - For security-related bugs
   - Ensure the fix addresses the root cause, not just symptoms
   - Keep the fix minimal and focused
   - Add comments explaining the fix if the bug was non-obvious

6. **Verify the fix:**

   Re-run the test:

   ```bash
   npm run test {test-file-path}
   ```

   **CRITICAL:** Verify that:
   - The test now passes
   - No other tests were broken by the fix
   - The fix doesn't introduce regressions

7. **Run related tests:**

   Run the full test suite for the affected area:

   ```bash
   # Run all tests in the affected directory
   npm run test {affected-directory}

   # Or run all tests if the change is broad
   npm run test
   ```

8. **Check for linting errors:**

   ```bash
   npm run lint
   npm run build
   ```

   Fix any linting or type errors introduced by the fix.

9. **Document the fix (if significant):**

   If the bug was complex or the fix is non-obvious:
   - Add JSDoc comments explaining the fix
   - Update relevant Storybook documentation
   - Add inline comments for complex logic

10. **Provide summary:**

    ```markdown
    ## Bug Fix Complete

    ### Bug Description:

    {Brief description of the bug}

    ### Root Cause:

    {What was causing the bug}

    ### Fix Applied:

    {What was changed to fix the bug}

    ### Test Coverage:

    - Test written: `{test-file-path}`
    - Test passes: Confirmed
    - No regressions: All related tests passing

    ### Files Modified:

    - `{file1}` - {what was changed}
    - `{file2}` - {what was changed}

    ### Next Steps:

    - [ ] Review the fix
    - [ ] Run full test suite: `npm run test`
    - [ ] Create PR if ready: `/draft-pr`
    ```

---

## Quality Gates

Before marking the bug as fixed:

- Test written and failing for the expected reason
- Bug fixed
- Test now passes
- All related tests still pass
- No linting errors
- No type errors
- Code follows project patterns

---

## Anti-Patterns to Avoid

**Don't:** Fix the bug before writing the test
**Don't:** Write a test that doesn't actually fail
**Don't:** Skip verifying the test failure matches the bug
**Don't:** Fix symptoms instead of root cause
**Don't:** Break existing tests with the fix
**Don't:** Skip running related tests after the fix

**Do:** Write test first
**Do:** Verify test fails for the right reason
**Do:** Fix root cause
**Do:** Verify all tests pass
**Do:** Check for regressions
