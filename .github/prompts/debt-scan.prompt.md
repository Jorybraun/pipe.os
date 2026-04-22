---
mode: agent
description: Identify and catalog technical debt across the codebase with prioritization
---
# DEBT SCAN Task

**Persona:** Execute this task as the `@architect` subagent (Archer, Principal Architect).
Load the persona characteristics from `.rulesync/subagents/architect.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/code-quality.md` - Code quality standards
- `.rulesync/rules/architecture.md` - AWS Amplify patterns
- `.rulesync/rules/testing.md` - Testing requirements

---

## Task Objective

Systematically scan the codebase to identify technical debt, categorize by type and severity, estimate impact and effort, and generate a prioritized technical debt report.

---

## Task Instructions

1. **Ask discovery questions:**
   1. "What scope should I scan?"
      - a) Entire codebase (comprehensive)
      - b) Specific directory/module
      - c) Specific concern (security, performance, testing, etc.)
   2. "What types of debt are you concerned about?"
      - a) All types (comprehensive scan)
      - b) Code quality (duplication, complexity, style)
      - c) Testing (missing tests, poor coverage)
      - d) Security (vulnerabilities, authorization gaps)
      - e) Performance (slow queries, bundle size)
      - f) Documentation (missing docs, outdated)
      - g) Dependencies (outdated packages, vulnerabilities)
      - h) Amplify patterns (schema issues, client usage)
   3. "What priority level should trigger alerts?"
      - a) P0 only (critical/blockers)
      - b) P0 and P1 (critical and high)
      - c) All priorities (comprehensive)

2. **Scan for technical debt indicators:**

   **Code Quality Debt:**
   - TODO/FIXME comments
   - Code duplication (similar patterns repeated)
   - High complexity functions
   - Long functions (>100 lines)
   - Large files (>500 lines)
   - `any` types in TypeScript
   - Console.log statements
   - Commented-out code blocks

   **Testing Debt:**
   - Files without test coverage
   - Test files with skipped tests (`.skip`, `.todo`)
   - Low test coverage areas (<80%)
   - Missing Storybook stories for components
   - Missing E2E tests for critical flows
   - Tests without assertions

   **Security Debt:**
   - Missing authorization rules in Amplify schema
   - Hardcoded secrets or API keys
   - Missing input validation
   - Unsafe dependencies (known vulnerabilities)
   - Missing field-level authorization

   **Performance Debt:**
   - Missing memoization on expensive operations
   - Large bundle sizes
   - Unoptimized images
   - Missing pagination
   - Unnecessary re-renders
   - Subscriptions not cleaned up

   **Documentation Debt:**
   - Missing README files
   - Missing JSDoc comments
   - Outdated documentation
   - Missing Storybook documentation
   - No inline comments for complex logic

   **Amplify Pattern Debt:**
   - Schema without authorization rules
   - Improper client usage (not using types)
   - Missing error handling on API calls
   - Subscriptions without cleanup
   - Improper use of real-time features

3. **Categorize by severity:**

   **P0 - Critical (Fix Immediately):**
   - Security vulnerabilities
   - Missing authorization on sensitive data
   - Data integrity issues
   - Production blockers

   **P1 - High (Fix Soon):**
   - Performance degradation affecting users
   - Missing tests for critical paths
   - Security concerns (non-exploitable)
   - Code blocking future development

   **P2 - Medium (Plan to Fix):**
   - Code quality issues
   - Missing documentation
   - Minor performance issues
   - Maintainability concerns

   **P3 - Low (Nice to Have):**
   - Code style inconsistencies
   - Minor duplication
   - Non-critical TODOs
   - Optimization opportunities

4. **Estimate impact and effort:**

   For each debt item:

   ```markdown
   ### {Debt Item Title}

   **Type:** {Code Quality | Testing | Security | Performance | Documentation | Amplify}
   **Severity:** {P0 | P1 | P2 | P3}

   **Location:**

   - `path/to/file1.ts:45-67`
   - `path/to/file2.ts:123`

   **Description:**
   {What's wrong and why it's debt}

   **Impact:**

   - **Business Impact:** {How it affects users/business}
   - **Technical Impact:** {How it affects developers/system}
   - **Risk:** {What could go wrong if not fixed}

   **Effort:**

   - **Estimated Time:** {hours/days/weeks}
   - **Complexity:** {Low | Medium | High}
   - **Dependencies:** {What else needs to change}

   **Proposed Solution:**
   {How to fix it}

   **Benefits:**
   {Why fixing this is valuable}
   ```

5. **Aggregate findings:**

   Create summary statistics:

   ```markdown
   ## Technical Debt Summary

   ### By Severity:

   - **P0 (Critical):** {N} items - {percentage}%
   - **P1 (High):** {M} items - {percentage}%
   - **P2 (Medium):** {P} items - {percentage}%
   - **P3 (Low):** {Q} items - {percentage}%
   - **Total:** {sum} items

   ### By Type:

   - **Code Quality:** {N} items
   - **Testing:** {M} items
   - **Security:** {P} items
   - **Performance:** {Q} items
   - **Documentation:** {R} items
   - **Amplify Patterns:** {S} items

   ### By Effort:

   - **Quick Wins (<4 hours):** {N} items
   - **Medium (1-3 days):** {M} items
   - **Large (>1 week):** {P} items

   ### Debt Hotspots:

   Top areas with most debt:

   1. `src/components/{module}/` - {N} items
   2. `amplify/data/` - {M} items
   3. `src/hooks/` - {P} items
   ```

6. **Generate prioritization matrix:**

   ```markdown
   ## Prioritization Matrix

   ### High Impact, Low Effort (DO FIRST)

   1. {Item} - P1, 2 hours
   2. {Item} - P1, 4 hours
   3. {Item} - P2, 3 hours

   ### High Impact, High Effort (PLAN CAREFULLY)

   1. {Item} - P0, 2 weeks
   2. {Item} - P1, 1 week

   ### Low Impact, Low Effort (FILL GAPS)

   1. {Item} - P3, 1 hour
   2. {Item} - P3, 2 hours

   ### Low Impact, High Effort (DEPRIORITIZE)

   1. {Item} - P3, 1 week
   ```

7. **Generate the report:**

   Save comprehensive report to `/docs/audits/{date}-tech-debt.md`

   Include:
   - Executive summary
   - Detailed findings by category
   - Prioritization matrix
   - Recommended actions
   - Trend analysis (if previous scans exist)
   - Appendix with all debt items

8. **Provide next steps:**

   ```markdown
   ## Next Steps

   1. **Review P0 items immediately**
      - Schedule fixes for this sprint
      - Assign to team members

   2. **Create tasks for P1 items**
      - Add to backlog
      - Estimate in sprint planning

   3. **Plan debt reduction**
      - Allocate 20% of sprint capacity to debt
      - Target quick wins first

   4. **Schedule next scan**
      - Recommended: Monthly
      - Track trend over time
   ```

---

## Notes

- Focus on actionable debt, not perfection
- Quantify impact to justify fixing
- Quick wins build momentum
- Prioritize by impact x effort
- Track trends to measure progress
- Include Amplify-specific patterns in assessment
