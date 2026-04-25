---
mode: agent
description: >-
  Analyze codebase to extract actual patterns and generate custom rules specific
  to YOUR code
---
# LEARN Task

**Persona:** Execute this task as the `@architect` subagent (Archer, Principal Architect).
Load the persona characteristics from `.rulesync/subagents/architect.md` before proceeding.

**Required Context:** This command analyzes existing code to learn patterns.
Rules will be loaded as needed based on what's being learned.

---

## Task Objective

Analyze the codebase to extract actual patterns, conventions, and styles used in YOUR code (not generic best practices), then generate or update rule files to match the reality of how the codebase works.

---

## Task Instructions

1. **Ask discovery questions:**
   1. "What aspect of the codebase should I learn?"
      - a) Architecture (component structure, file organization)
      - b) Testing (Vitest, Storybook, Playwright patterns)
      - c) Components (React patterns, UI library usage)
      - d) Amplify Data (schema patterns, client usage)
      - e) Hooks (custom hook patterns)
      - f) Everything (comprehensive scan)
   2. "Should I scan the entire codebase or specific directories?"
   3. "What's the goal?"
      - a) Document current patterns (as-is documentation)
      - b) Identify inconsistencies (find variations)
      - c) Generate new rules (add to rulesync)
      - d) Update existing rules (sync rules with reality)

2. **Scan the codebase:**

   Based on selected aspect, search relevant files:

   **For Architecture:**
   - `src/**/*.tsx` - React components
   - `src/hooks/*.ts` - Custom hooks
   - `src/lib/**/*.ts` - Utility functions

   **For Testing:**
   - `**/*.test.ts` - Vitest test files
   - `**/*.test.tsx` - Component test files
   - `**/*.stories.tsx` - Storybook stories
   - `e2e/**/*.spec.ts` - Playwright tests

   **For Components:**
   - `src/components/**/*.tsx` - UI components

   **For Amplify Data:**
   - `amplify/data/resource.ts` - Schema definition
   - `src/**/*.ts` - Client usage patterns

   **For Hooks:**
   - `src/hooks/**/*.ts` - Custom hooks

3. **Extract patterns:**

   For each pattern type, identify:

   **File Organization:**
   - Naming conventions (camelCase, kebab-case, PascalCase)
   - File structure (co-location, barrel exports)
   - Directory hierarchy (feature-based, layer-based)

   **Code Patterns:**
   - How functions are structured
   - Error handling approaches
   - Amplify client usage
   - Type definitions

   **Conventions:**
   - Import order and grouping
   - Export patterns
   - Comment styles
   - Variable naming

4. **Analyze consistency:**

   Measure pattern usage:

   ````markdown
   ## Pattern Consistency Analysis

   ### Pattern: Amplify Subscription Cleanup

   **Dominant Pattern (85% - 17 of 20 hooks):**

   ```typescript
   useEffect(() => {
     const sub = client.models.Model.observeQuery().subscribe({
       next: ({ items }) => setState([...items]),
     });
     return () => sub.unsubscribe();
   }, []);
   ```
   ````

   **Alternative Pattern (15% - 3 of 20 hooks):**

   ```typescript
   // Missing cleanup - needs fixing
   useEffect(() => {
     client.models.Model.observeQuery().subscribe({...});
   }, []);
   ```

   **Recommendation:** Standardize on dominant pattern

5. **Generate codebase fingerprint:**

   Create a profile of YOUR codebase:

   ````markdown
   ## Codebase Fingerprint: {Aspect}

   ### Overview

   Analyzed {N} files across {M} directories

   ### Key Patterns

   #### 1. {Pattern Name}

   **Usage:** {percentage}% of files
   **Example from codebase:**

   ```typescript
   // Actual code from your codebase
   ```
   ````

   **Files using this pattern:**
   - `path/to/file1.ts:45`
   - `path/to/file2.ts:67`

   ### Naming Conventions
   - Functions: {convention}
   - Components: {convention}
   - Hooks: {convention}
   - Files: {convention}

   ### Import Style

   ```typescript
   // Standard import order found:
   // 1. React
   // 2. AWS Amplify
   // 3. Third-party libraries
   // 4. Local imports
   ```

   ### Testing Patterns
   - Unit tests: Vitest with Testing Library
   - Component tests: Storybook stories
   - E2E tests: Playwright

   ### Inconsistencies Found
   1. {Inconsistency} - {N} files affected
   2. {Inconsistency} - {N} files affected

6. **Generate rule recommendations:**

   Create markdown for rules based on actual code:

   ````markdown
   ## Recommended Rule Addition

   **Target File:** `.rulesync/rules/{rule-file}.md`
   **Section:** {section-name}

   **Content to Add:**

   ### {Pattern Name}

   This pattern is used in {N}% of the codebase ({count} files).

   **Standard Approach:**

   ```typescript
   // Actual pattern from YOUR codebase
   ```
   ````

   **Real Examples:**
   - `src/hooks/usePipelines.ts:45-67`
   - `src/hooks/useCandidates.ts:89-112`

   **When to use:**
   - {Specific scenario from your codebase}

   **Common mistakes to avoid:**
   - {Mistake seen in outlier files}

7. **Identify refactoring opportunities:**

   Find areas needing standardization:

   ```markdown
   ## Standardization Opportunities

   ### High Priority

   1. **Subscription Cleanup** - 3 files need updating
      - Impact: Prevents memory leaks
      - Effort: 1-2 hours
      - Files: [list]

   ### Medium Priority

   2. **Error Handling Pattern** - 5 files missing
      - Impact: Improved reliability
      - Effort: 3-4 hours
      - Files: [list]

   ### Low Priority

   3. **Import Order Consistency** - 12 files varying
      - Impact: Code cleanliness
      - Effort: 30 min (ESLint can fix)
      - Files: [list]
   ```

8. **Compare with existing rules:**

   Check if current rules match reality:

   ```markdown
   ## Rule Drift Analysis

   ### Rules Matching Codebase

   - Amplify Data patterns (95% compliance)
   - TypeScript strict mode (100% compliance)
   - Testing structure (88% compliance)

   ### Rules Needing Updates

   - React hook patterns: Rule should document usePipelines pattern
   - Storybook structure: Rule should show interaction test pattern

   ### Missing Rules

   - No documentation for error boundary pattern (found in 8 components)
   - No pattern for form validation (used in 12 forms)
   ```

9. **Update or create rules:**

   Ask user what to do with findings:
   1. "I've identified {N} patterns and {M} inconsistencies. What would you like to do?"
      - a) Update existing rules to match current code
      - b) Create new rule sections for missing patterns
      - c) Generate refactoring tasks for inconsistencies
      - d) All of the above
   2. If updating rules, show diffs before applying
   3. If creating new sections, ask which rule file to add to

10. **Provide summary:**

    ```markdown
    ## Learning Complete

    ### Codebase Analysis:

    - Scanned: {N} files
    - Patterns identified: {M}
    - Consistency score: {percentage}%

    ### Findings:

    - {N} patterns well-established and consistent
    - {M} patterns with variations (standardization opportunity)
    - {P} anti-patterns found (refactoring needed)

    ### Rule Updates:

    - Updated: {N} existing rule sections
    - Added: {M} new rule sections
    - Flagged: {P} rules needing manual review

    ### Files Modified:

    - `.rulesync/rules/{file1}.md` - Added {section}
    - `.rulesync/rules/{file2}.md` - Updated {section}

    ### Next Steps:

    1. Run `/extract-pattern` for specific pattern deep-dives
    2. Create refactoring tasks for inconsistencies
    3. Share updated rules with team
    ```

---

## Notes

- Learns from YOUR code, not generic patterns
- Provides statistical analysis of pattern usage
- Identifies what's working well
- Flags inconsistencies needing standardization
- Generates rules matching reality, not ideals
- Keeps rules synchronized with actual codebase
