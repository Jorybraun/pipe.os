---
description: Document recurring patterns found in the codebase for standardization
targets: ['*']
globs: []
---

# EXTRACT PATTERN Task

**Persona:** Execute this task as the `@architect` subagent (Archer, Principal Architect).
Load the persona characteristics from `.rulesync/subagents/architect.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/overview.md` - Project overview
- `.rulesync/rules/architecture.md` - AWS Amplify Gen 2 patterns
- `.rulesync/rules/code-quality.md` - Code quality standards

---

## Task Objective

Analyze the codebase to find recurring patterns, document them comprehensively, and suggest which rule file to add them to for future reference and standardization.

---

## Task Instructions

1. **Ask discovery questions:**
   1. "What pattern should I extract?" (e.g., "Amplify Data subscription handling," "error boundary patterns")
   2. "Where should I look for this pattern?" (specific directories, file types, or entire codebase)
   3. "Are you looking to standardize this pattern or just document current usage?"

2. **Search for pattern instances:**

   Use codebase search to find all occurrences:
   - Search for relevant functions, hooks, or components
   - Examine different implementations across the codebase
   - Note variations and inconsistencies

3. **Analyze found patterns:**

   For each instance found:
   - Identify the core pattern structure
   - Note common elements across implementations
   - Spot variations and why they differ
   - Evaluate which implementation is best

4. **Categorize patterns:**

   Group into categories:
   - **Consistent:** Pattern used the same way everywhere (good!)
   - **Inconsistent:** Similar pattern with variations (needs standardization)
   - **Outdated:** Old pattern coexisting with newer approach (needs migration)
   - **Anti-pattern:** Pattern that should be avoided

5. **Document the pattern:**

   Create comprehensive documentation including:

   ````markdown
   ## Pattern Name

   ### Purpose

   Brief description of what this pattern accomplishes and when to use it.

   ### Context

   Where and why this pattern is used in the codebase.

   ### Implementation

   **Recommended Approach:**

   ```typescript
   // Show the best/recommended implementation
   // Include actual code from the codebase
   ```
   ````

   **Common Variations:**

   ```typescript
   // Document variations if they're valid
   // Explain when to use each
   ```

   **Anti-patterns to Avoid:**

   ```typescript
   // Show what NOT to do
   // Explain why it's problematic
   ```

   ### Examples from Codebase

   **Good Examples:**
   - `path/to/file.ts:123` - Brief explanation

   **Examples Needing Improvement:**
   - `path/to/old.ts:789` - What needs updating

   ### Related Patterns
   - Link to related patterns

   ### Testing

   How to test code using this pattern

6. **Provide statistics:**

   Summarize findings:

   ```markdown
   ## Pattern Analysis Results

   - **Total instances found:** 23
   - **Consistent implementations:** 15 (65%)
   - **Inconsistent implementations:** 6 (26%)
   - **Outdated implementations:** 2 (9%)

   **Files analyzed:**

   - `src/hooks/*.ts`
   - `src/components/**/*.tsx`
   ```

7. **Suggest rule file placement:**

   Recommend where to add this pattern:

   ```markdown
   ## Recommended Rule File

   **File:** `.rulesync/rules/{rule-file}.md`

   **Reasoning:** This pattern relates to {specific concern} and would fit
   naturally in the {rule name} section because {explanation}.

   **Section to add to:** {specific section within the rule file}
   ```

8. **Generate refactoring recommendations:**

   If standardization is needed:

   ```markdown
   ## Standardization Recommendations

   ### Priority: {High/Medium/Low}

   ### Impact: {High/Medium/Low}

   ### Files to Update:

   1. `path/to/file1.ts` - Update lines 45-67
   2. `path/to/file2.ts` - Update lines 123-145

   ### Refactoring Steps:

   1. Extract shared pattern to utility hook
   2. Update each usage to use the standard approach
   3. Add tests for the standardized pattern
   4. Update Storybook documentation

   ### Breaking Changes: {Yes/No}

   ### Estimated Effort: {hours/days}
   ```

9. **Ask about next steps:**
   1. "Would you like me to add this pattern to the recommended rule file?"
   2. "Should I create a refactoring task to standardize inconsistent usages?"
   3. "Would you like me to generate tests for this pattern?"

---

## Common Patterns to Extract

### Amplify Data Patterns:

- Real-time subscription handling with observeQuery
- Error handling with data/errors destructuring
- Authorization patterns in schema
- Client typing with generateClient

### React Patterns:

- Custom hooks for Amplify operations
- Error boundary implementations
- Loading state management
- Form handling with validation

### Component Patterns:

- Storybook story structure
- Props interface definitions
- Accessibility implementations
- Responsive design patterns

### Testing Patterns:

- Vitest test structure
- Amplify client mocking
- Storybook interaction tests
- Playwright E2E patterns

---

## Example Output

```markdown
## Pattern Extraction Complete

### Pattern: Amplify Data Subscription Cleanup

**Instances Found:** 12 across 8 files

**Analysis:**

- 9 instances (75%) use proper cleanup
- 3 instances (25%) missing unsubscribe

**Recommended Approach:**

```typescript
useEffect(() => {
  const subscription = client.models.Pipeline.observeQuery().subscribe({
    next: ({ items }) => setPipelines([...items]),
  });

  return () => subscription.unsubscribe(); // CRITICAL: Always cleanup
}, []);
```

**Needs Updating:**

1. `src/hooks/useCandidates.ts:23` - Missing cleanup
2. `src/components/StageList.tsx:45` - Missing cleanup
3. `src/pages/Dashboard.tsx:67` - Missing cleanup

**Recommended Rule File:**
`.rulesync/rules/database.md` - Section: "Real-time Subscriptions"

**Estimated Impact:**
Fixing these 3 files prevents memory leaks and improves stability.
```

---

## Notes

- Focus on patterns unique to THIS codebase, not generic best practices
- Provide concrete statistics and file locations
- Show actual code examples from the codebase
- Identify opportunities for standardization
- Make documentation actionable and practical
- Prioritize Amplify-specific patterns
