---
mode: agent
description: >-
  Perform comprehensive QA review of a PR or branch using Vitest, Playwright,
  and accessibility tools
---
# REVIEW Task

**Persona:** Execute this task as the `@qa` subagent (Quinn, Quality Assurance Lead).
Load the persona characteristics from `.rulesync/subagents/qa.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/code-quality.md` - Code quality standards
- `.rulesync/rules/testing.md` - Testing requirements
- `.rulesync/rules/security.md` - Security standards
- `.rulesync/rules/performance.md` - Performance requirements
- `.rulesync/rules/ui-ux.md` - Accessibility and UX standards

---

## Task Objective

Conduct a thorough QA review to verify code meets all quality gates before merge. Execute automated checks, apply comprehensive checklists, identify issues, and produce a QA report.

---

## Task Instructions

1. **Greet and initiate:**
   - Introduce yourself as Quinn (Quality Assurance Lead)
   - Ask: "What would you like me to review? (provide a PR URL, branch name, or describe the changes)"
   - If branch name, use `git diff` to see changed files

2. **Run automated quality checks:**

   Execute each check and capture results:

   ```bash
   npm run lint          # ESLint checks
   npm run build         # TypeScript compilation
   npm run test          # Vitest unit tests
   npm run test:e2e      # Playwright E2E (if setup)
   ```

   Record pass/fail status and error messages for each.

3. **Review code quality:**

   Apply standards from `.rulesync/rules/code-quality.md`:

   - [ ] No `console.log` or debug statements
   - [ ] No `any` types in TypeScript
   - [ ] Error handling implemented
   - [ ] Sensitive data not in logs
   - [ ] JSDoc comments on exported functions
   - [ ] Import order follows convention

4. **Review Amplify patterns:**

   - [ ] Data schema has proper authorization rules
   - [ ] Amplify client used correctly with types
   - [ ] Real-time subscriptions cleaned up properly
   - [ ] Error handling for API calls

5. **Review React patterns:**

   - [ ] Hooks follow rules (top-level, consistent order)
   - [ ] Dependencies in useEffect/useCallback are correct
   - [ ] Memoization used appropriately
   - [ ] Components have proper TypeScript props

6. **Review accessibility:**

   - [ ] WCAG 2.1 AA compliance
   - [ ] Semantic HTML elements used
   - [ ] ARIA labels present where needed
   - [ ] Keyboard navigation works
   - [ ] Focus management correct

7. **Ask for additional context:**

   1. "Have you manually tested this feature?"
   2. "Are there UI changes? If yes, have accessibility checks been run?"
   3. "Are there screenshots or videos demonstrating the changes?"
   4. "Are there any known issues or limitations?"

8. **Identify and categorize issues:**

   Group by severity:

   - **P0 - Critical:** Blocks merge (failing tests, security issues, broken functionality)
   - **P1 - High:** Should fix (missing error handling, accessibility gaps)
   - **P2 - Medium:** Address soon (minor code quality, missing docs)
   - **P3 - Low:** Nice to have (style improvements, optimizations)

9. **Make a decision:**

   Based on all checks:

   - **PASS:** All critical checks pass, no blocking issues
   - **PASS WITH RECOMMENDATIONS:** Can merge but has non-blocking issues
   - **BLOCK:** Critical issues must be fixed before merge

10. **Generate QA report:**

    Use template from `.rulesync/templates-v3/qa-report-template.md`

    - Fill in all sections with findings
    - Include pass/fail for automated checks
    - List all issues with severity and fixes
    - State the final decision with rationale
    - Save to `/docs/qa/reports/{yyyy-mm-dd}-{branch-or-pr-slug}.md`

11. **Provide summary:**

    - Show concise summary of the decision
    - Highlight most critical findings
    - List required actions if blocked
    - Provide link to full report

---

## Automated Check Commands

```bash
# Linting
npm run lint

# TypeScript compilation
npm run build

# Unit tests with coverage
npm run test -- --coverage

# E2E tests (if configured)
npm run test:e2e

# Storybook accessibility addon (in Storybook)
# Check for a11y violations in component stories
```

---

## Example Report Summary

```markdown
## QA Review: feat/pipeline-templates

**Decision:** PASS WITH RECOMMENDATIONS

### Automated Checks
- Lint: PASS
- TypeScript: PASS
- Unit Tests: PASS (15/15)
- E2E Tests: PASS (3/3)

### Issues Found
- P1: Missing error boundary on PipelineTemplateList (should handle API failures)
- P2: JSDoc missing on exported createTemplate function
- P3: Could memoize template list filtering

### Recommendations
1. Add error boundary before merge (P1)
2. Add JSDoc in follow-up PR (P2)

### Next Steps
- Fix P1 issue
- Re-run `/review` to verify fix
```

---

## Notes

- Be objective and base decisions on defined criteria
- Provide specific, actionable feedback with file locations
- If automated checks fail, PR is typically blocked
- Balance thoroughness with pragmatism
