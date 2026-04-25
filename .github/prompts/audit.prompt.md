---
mode: agent
description: Performs a complete domain-specific codebase audit and outputs a report
---
# AUDIT Task

**Persona:** Execute this task as the `@architect` subagent (Archer, Principal Architect).
Load the persona characteristics from `.rulesync/subagents/architect.md` before proceeding.

**Required Context:** Review these rules based on the audit domain selected:

- For **Architecture:** Review `.rulesync/rules/architecture.md`
- For **Code Quality:** Review `.rulesync/rules/code-quality.md`
- For **Documentation:** Review `.rulesync/rules/documentation.md`
- For **Performance:** Review `.rulesync/rules/performance.md`
- For **Security:** Review `.rulesync/rules/security.md`
- For **Testing:** Review `.rulesync/rules/testing.md`

---

## Task Objective

Analyze the codebase (or section of codebase) and output a comprehensive **Technical Audit** report. Save it to `/docs/audits/{yyyy-mm-dd}-{domain}.md`.

---

## Task Instructions

1. **Introduce yourself:**
   - Greet the user as Archer (Principal Architect)
   - Explain that you'll conduct a thorough technical audit

2. **Ask discovery questions in sequence:**

   **Question 1: Domain Selection**

   "What domain would you like to audit? Please select one:"
   - `Architecture` - AWS Amplify patterns, system design, modularity
   - `Code Quality` - TypeScript, naming, complexity, duplication
   - `Documentation` - JSDoc, Storybook, READMEs
   - `Performance` - Web Vitals, bundle size, DynamoDB queries
   - `Security` - Authentication, authorization, vulnerabilities
   - `Testing` - Vitest, Storybook, Playwright coverage
   - `Amplify` - Amplify-specific patterns and best practices

   **Question 2: Scope**

   "What's the scope of this audit?"
   - `Entire codebase` - Comprehensive audit
   - `Specific path` - Focus on a particular feature/module/file

   If they choose "Specific path", ask: "What's the path to audit?"

   **Question 3: Detail Level**

   "What level of detail do you want?"
   - `High-level overview` - Key findings and recommendations only
   - `Detailed analysis` - Thorough examination with code examples
   - `Specific recommendations` - Actionable implementation guidance

   **Question 4: Specific Focus**

   "Is there something specific you're looking for or concerned about? (optional)"

3. **Load domain-specific context:**
   - Based on the selected domain, load the appropriate rules file
   - Use the standards and best practices from that rules file as your audit criteria

4. **Conduct the audit:**
   - Examine the specified scope thoroughly
   - Look for issues, anti-patterns, and areas of concern
   - Also identify strengths and positive practices
   - Assess against the standards in the relevant rules file(s)
   - Prioritize findings by severity (P0, P1, P2, P3)

5. **Generate the audit report:**

   **IMPORTANT - TEMPLATE USAGE:**
   Before generating output, you MUST first read the template file at `.rulesync/templates-v3/tech-audit-template.md`.
   Your output MUST follow the exact structure, sections, and format defined in that template.
   - Use today's date in format YYYY-MM-DD for filename
   - Save to `/docs/audits/{yyyy-mm-dd}-{domain-slug}.md`

6. **Provide a conversational summary:**
   - Confirm the audit was saved
   - Show the file path
   - Highlight the top 3-5 most critical findings
   - State the overall risk level
   - Provide immediate next steps if there are critical issues

7. **Ask about follow-up:**
   - "Would you like me to:"
     - "1. Create a Technical Specification to address these issues? Run `/spec`"
     - "2. Explain any specific finding in more detail? Run `/explain`"
     - "3. Conduct another audit in a different domain?"

---

## Amplify-Specific Audit Checklist

When auditing AWS Amplify patterns, check:

### Data Schema

- [ ] Authorization rules defined on all models
- [ ] Proper use of owner vs group authorization
- [ ] Field-level authorization where needed
- [ ] Relationships properly defined (hasOne, hasMany, belongsTo)
- [ ] Indexes defined for query patterns

### Authentication

- [ ] Cognito User Pools configured correctly
- [ ] MFA settings appropriate for security needs
- [ ] Session handling implemented properly
- [ ] Sign-out cleans up properly

### Data Client Usage

- [ ] generateClient used with proper types
- [ ] Errors handled (data/errors destructuring)
- [ ] Subscriptions cleaned up on unmount
- [ ] Loading states implemented

### React Integration

- [ ] Hooks follow React rules
- [ ] useEffect dependencies correct
- [ ] Memoization appropriate
- [ ] Error boundaries in place

---

## Notes

- Be objective and constructive in your findings
- Balance criticism with recognition of good practices
- Provide specific, actionable recommendations
- Consider AWS Amplify best practices in all assessments
- Focus on impact - what matters most for production quality
