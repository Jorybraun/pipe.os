# QA Review Report - {{PR or Branch Name}}

**Date:** {{today's date}}
**Reviewer:** Quinn (Quality Assurance Lead)
**PR/Branch:** {{PR URL or branch name}}
**Base Branch:** {{base branch, e.g., main or dev}}
**Decision:** {{PASS | PASS WITH RECOMMENDATIONS | BLOCK}}

---

## Review Context

**Changes Summary:**
{{Brief description of what changed in this PR/branch}}

**Files Changed:** {{number}} files
{{List key files or areas affected}}

**Related Issues:**

- {{Link to related GitHub issues or specs}}

**Developer Notes:**
{{Any context provided by the developer about the changes}}

---

## Automated Checks

| Check | Status | Notes |
|-------|--------|-------|
| `npm run lint` | {{PASS / FAIL}} | {{Pass or list errors}} |
| `npm run build` | {{PASS / FAIL}} | {{Pass or list type errors}} |
| `npm run test` | {{PASS / FAIL}} | {{Pass or list failing tests}} |
| `npm run test:e2e` | {{PASS / FAIL / SKIP}} | {{Pass, fail, or skipped with reason}} |

**Overall Automated Check Status:** {{All Pass | Failures Detected}}

---

## Code Quality Review

### Code Standards

- {{PASS / FAIL}} Code follows project style guidelines
- {{PASS / FAIL}} No `console.log` or debug statements
- {{PASS / FAIL}} No `any` types used
- {{PASS / FAIL}} Error handling implemented
- {{PASS / FAIL}} Sensitive data redacted from logs
- {{PASS / FAIL}} Imports properly ordered

**Notes:** {{Any issues or observations}}

### Amplify Patterns

- {{PASS / FAIL}} Data schema has proper authorization rules
- {{PASS / FAIL}} Amplify Data client used correctly with types
- {{PASS / FAIL}} Real-time subscriptions cleaned up properly
- {{PASS / FAIL}} Error handling for API calls (data/errors destructuring)
- {{PASS / FAIL}} Loading states implemented for async operations

**Notes:** {{Any Amplify-specific issues}}

### React Patterns

- {{PASS / FAIL}} Hooks follow rules (top-level, consistent order)
- {{PASS / FAIL}} Dependencies in useEffect/useCallback are correct
- {{PASS / FAIL}} Memoization used appropriately (not over-used)
- {{PASS / FAIL}} Components have proper TypeScript props
- {{PASS / FAIL}} Error boundaries in place for component trees

**Notes:** {{Any React-specific issues}}

---

## Testing Review

- {{PASS / FAIL / N/A}} Unit tests written and passing (Vitest)
- {{PASS / FAIL / N/A}} Component stories created (Storybook)
- {{PASS / FAIL / N/A}} E2E tests written and passing (Playwright)
- {{PASS / FAIL}} Edge cases covered
- {{PASS / FAIL}} Error states tested
- {{PASS / FAIL / N/A}} Test coverage >90% for critical paths

**Notes:** {{Any testing gaps or concerns}}

---

## Documentation Review

- {{PASS / FAIL}} JSDoc added to all exported functions
- {{PASS / FAIL}} Inline comments explain complex logic
- {{PASS / FAIL / N/A}} README updated (if applicable)
- {{PASS / FAIL / N/A}} Storybook stories documented

**Notes:** {{Any documentation gaps}}

---

## Accessibility Review (UI Changes Only)

{{If no UI changes, write "N/A - No UI changes in this PR" and skip this section}}

- {{PASS / FAIL}} WCAG 2.1 AA compliance verified
- {{PASS / FAIL}} Keyboard navigation works properly
- {{PASS / FAIL}} Screen reader compatibility checked
- {{PASS / FAIL}} Color contrast meets standards
- {{PASS / FAIL}} Focus indicators are visible
- {{PASS / FAIL}} ARIA labels present where needed
- {{PASS / FAIL}} AWS Amplify UI components used correctly

**Accessibility Tools Used:** {{e.g., axe DevTools, Lighthouse, Storybook a11y addon}}

**Issues Found:**
{{List any accessibility issues with severity and location}}

**Notes:** {{Additional accessibility observations}}

---

## Performance Review

- {{PASS / FAIL / N/A}} No obvious performance regressions
- {{PASS / FAIL / N/A}} Bundle size within acceptable limits
- {{PASS / FAIL / N/A}} DynamoDB queries optimized (no N+1 problems)
- {{PASS / FAIL / N/A}} Images optimized and lazy-loaded
- {{PASS / FAIL}} Loading states implemented for async operations
- {{PASS / FAIL}} Memoization appropriate for expensive computations

**Performance Metrics:**
{{If applicable, include bundle size, load time, or Lighthouse scores}}

**Issues Found:**
{{List any performance concerns with location and impact}}

**Notes:** {{Additional performance observations}}

---

## Security Review

- {{PASS / FAIL}} Authorization rules defined in Amplify Data schema
- {{PASS / FAIL}} No sensitive data exposed in client code or logs
- {{PASS / FAIL}} Input validation present on all user inputs
- {{PASS / FAIL}} Dependencies up to date and secure
- {{PASS / FAIL}} No hardcoded secrets or API keys

**Security Scan Results:**
{{Any results from npm audit or dependency scanning}}

**Issues Found:**
{{List any security concerns with severity and recommended fixes}}

**Notes:** {{Additional security observations}}

---

## User Experience Review

- {{PASS / FAIL / N/A}} Responsive design works across devices
- {{PASS / FAIL}} Error messages are user-friendly and actionable
- {{PASS / FAIL}} Loading states prevent user confusion
- {{PASS / FAIL}} Feature works as expected from end-user perspective
- {{PASS / FAIL}} Edge cases handled gracefully (empty states, errors)

**Manual Testing Performed:**
{{Description of manual testing done by developer or QA}}

**Test Scenarios:**

1. {{Scenario 1 and result}}
2. {{Scenario 2 and result}}
3. {{Scenario 3 and result}}

**Browsers/Devices Tested:**

- {{Browser/device 1}}
- {{Browser/device 2}}
- {{Browser/device 3}}

**Screenshots/Videos:**
{{Links to screenshots or videos demonstrating the changes}}

**Issues Found:**
{{List any UX issues with severity and suggested improvements}}

**Notes:** {{Additional UX observations}}

---

## Issues Found

{{If no issues found, write "No issues found! All checks passed."}}

### P0 - Critical Issues (Block Merge)

{{List critical issues that must be fixed before merge}}

1. **{{Issue Title}}**
   - **Location:** {{File and line number}}
   - **Description:** {{What's wrong}}
   - **Impact:** {{Why it's critical}}
   - **Suggested Fix:** {{How to resolve}}

### P1 - High Priority Issues (Should Fix Before Merge)

{{List high priority issues}}

1. **{{Issue Title}}**
   - **Location:** {{File and line number}}
   - **Description:** {{What's wrong}}
   - **Impact:** {{Why it matters}}
   - **Suggested Fix:** {{How to resolve}}

### P2 - Medium Priority Issues (Address Soon)

{{List medium priority issues}}

1. **{{Issue Title}}**
   - **Location:** {{File and line number}}
   - **Description:** {{What could be improved}}
   - **Impact:** {{Why it would help}}
   - **Suggested Fix:** {{How to improve}}

### P3 - Low Priority Issues (Nice to Have)

{{List low priority issues}}

1. **{{Issue Title}}**
   - **Location:** {{File and line number}}
   - **Description:** {{Optional improvement}}
   - **Impact:** {{Minor benefit}}
   - **Suggested Fix:** {{How to optimize}}

---

## Decision

**{{PASS | PASS WITH RECOMMENDATIONS | BLOCK}}**

**Rationale:**
{{Clear explanation of why this decision was made based on the findings above}}

---

## Required Actions (If Blocked)

{{If decision is PASS, write "None - PR is ready to merge!" and skip this section}}

Before this PR can be merged, the following must be addressed:

1. {{Action 1 with reference to issue}}
2. {{Action 2 with reference to issue}}
3. {{Action 3 with reference to issue}}

**After addressing these issues:**

- Re-run automated checks to verify fixes
- Request another QA review by running `/review`

---

## Recommended Follow-ups (If Pass with Recommendations)

{{If decision is PASS or BLOCK, write "N/A" and skip this section}}

These non-blocking issues should be addressed in follow-up PRs:

1. {{Follow-up 1 with issue reference or new issue link}}
2. {{Follow-up 2 with issue reference or new issue link}}
3. {{Follow-up 3 with issue reference or new issue link}}

**Recommended Timeline:** {{e.g., Next sprint, Next month, etc.}}

---

## Additional Notes

{{Any other context, observations, or recommendations that don't fit the above categories}}

---

## Next Steps

{{If PASS:}}

- PR is approved and ready to merge
- Confirm with team lead or maintainer before merging
- Monitor Amplify deployment for any issues
- Verify feature works as expected in production

{{If PASS WITH RECOMMENDATIONS:}}

- PR is approved and can be merged
- Create follow-up issues for recommended improvements
- Monitor Amplify deployment
- Consider addressing follow-ups in next iteration

{{If BLOCK:}}

- PR is blocked from merge
- Developer should address required actions listed above
- Request another QA review after fixes are complete: `/review`
- Reach out if you need clarification on any issues

---

**QA Review completed by Quinn (Quality Assurance Lead)**
**Report generated:** {{today's date and time}}
