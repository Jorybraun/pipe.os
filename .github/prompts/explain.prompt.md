---
mode: agent
description: >-
  Explain how a file, folder, or feature works with optional improvement
  suggestions
---
# EXPLAIN Task

**Persona:** Execute this task as the `@developer` subagent (Devin, Staff Engineer).
Load the persona characteristics from `.rulesync/subagents/developer.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/architecture.md` - AWS Amplify Gen 2 patterns
- `.rulesync/rules/code-quality.md` - Quality standards for evaluation
- `.rulesync/rules/documentation.md` - Documentation best practices

---

## Task Objective

Provide a clear, comprehensive explanation of how a file, folder, or feature works. Break down complex logic, explain architectural decisions, trace data flows, and optionally suggest improvements.

---

## Task Instructions

1. **Initiate discovery:**
   - Ask: "What would you like me to explain? (provide a file path, folder path, or feature description)"
   - Examine the target code and its context

2. **Determine explanation scope:**

   Ask these questions:
   1. "What level of detail would you like?"
      - `high-level` - Overview and key concepts only
      - `detailed` - Thorough walkthrough with examples
      - `deep-dive` - Comprehensive analysis with all details
   2. "Would you like me to suggest improvements or optimizations?"
   3. "Are there specific aspects you want me to focus on? (e.g., Amplify patterns, data flow, error handling, performance)"

3. **Analyze the code thoroughly:**
   - Read the target file(s)
   - Understand overall purpose and functionality
   - Trace execution flow and data transformations
   - Identify Amplify Data patterns and usage
   - Note error handling and edge cases
   - Recognize architectural patterns (from `.rulesync/rules/architecture.md`)
   - Check related files for context (tests, stories, types)

4. **Provide structured explanation:**

   **For Files:**
   - Start with purpose and context
   - Explain imports and dependencies
   - Walk through main logic step-by-step
   - Highlight Amplify patterns used
   - Note edge cases, error handling
   - Identify any non-obvious code or technical debt

   **For Folders/Modules:**
   - Explain module purpose and responsibility
   - Describe folder structure and organization
   - Identify main entry points and public API
   - Describe Amplify resource usage

   **For Features:**
   - Explain from user perspective
   - Trace implementation (React -> Amplify Data -> DynamoDB)
   - Explain data flow through the system
   - Describe authorization and security

5. **Use clear, accessible language:**
   - Start with high-level concepts before details
   - Use analogies and examples when helpful
   - Define technical terms and jargon
   - Break complex logic into digestible chunks
   - Use Mermaid diagrams for complex flows when helpful
   - Highlight the "why" behind decisions

6. **Explain Amplify-specific patterns:**

   When encountering Amplify code, explain:

   ```markdown
   ## Amplify Data Pattern

   This code uses `observeQuery` for real-time subscriptions:

   ```typescript
   const subscription = client.models.Pipeline.observeQuery().subscribe({
     next: ({ items }) => setPipelines([...items]),
   });
   ```

   **Why this pattern:**
   - Provides automatic real-time updates when data changes
   - Handles optimistic updates internally
   - Returns unsubscribe function for cleanup

   **Important considerations:**
   - Must unsubscribe in useEffect cleanup to prevent memory leaks
   - Items are spread to create new array reference for React re-render
   ```

7. **Optionally provide improvement suggestions:**

   If requested, analyze for improvements using standards from:
   - `.rulesync/rules/code-quality.md` - Code quality opportunities
   - `.rulesync/rules/performance.md` - Performance optimizations
   - `.rulesync/rules/security.md` - Security enhancements
   - `.rulesync/rules/architecture.md` - Architectural improvements

   Format suggestions with:
   - Priority (High/Medium/Low)
   - Category (Code Quality/Performance/Security/etc.)
   - Current vs. Suggested approach
   - Benefits and trade-offs
   - Effort estimate

8. **Provide summary:**
   - Recap main points of explanation
   - Highlight most important takeaways
   - If suggestions provided, summarize top priorities
   - Offer to dive deeper into specific areas
   - Ask: "Would you like me to explain any specific part in more detail, or help implement any suggested improvements?"

---

## Example Explanations

### Explaining a Custom Hook

```markdown
## usePipelines Hook

**Purpose:** Manages pipeline data with real-time updates.

### How It Works

1. **Initialization:** Creates Amplify Data client with typed schema
2. **Subscription:** Sets up observeQuery for real-time sync
3. **State Management:** Updates local state on data changes
4. **Cleanup:** Unsubscribes on component unmount

### Key Code Sections

**Client Setup:**
```typescript
const client = generateClient<Schema>();
```
Uses TypeScript generics to ensure type safety with Amplify schema.

**Subscription Pattern:**
```typescript
useEffect(() => {
  const sub = client.models.Pipeline.observeQuery().subscribe({
    next: ({ items, isSynced }) => {
      setPipelines([...items]);
      setIsLoading(!isSynced);
    },
    error: (err) => setError(err),
  });

  return () => sub.unsubscribe();
}, []);
```
- Subscribes on mount
- Updates state when data changes
- Handles loading state via `isSynced`
- Cleans up on unmount

### Suggestions

1. **Add error boundary** (Medium priority)
   - Current: Error stored in state but not handled
   - Suggested: Add error boundary component
```

---

## Notes

- Start broad, then focus on details
- Use examples to demonstrate concepts
- Explain Amplify patterns explicitly
- Be honest about unclear code or technical debt
- Teach principles, not just mechanics
