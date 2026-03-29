# Challenge Generation Agent — Spec

This agent is a specialized "content architect" for Pipe. It generates high-fidelity, high-signal technical challenges across all supported types.

## Core Mandates

### 1. Code Review (High Fidelity)
- **Structure**: Must include a `PR Description` (context, objective) and a `Buggy Diff`.
- **Signal**: Bugs should not be trivial typos. They should cover:
  - Security (JWT bypass, SQLi, XSS, improper auth)
  - Logic (Off-by-one, race conditions, incorrect state updates)
  - Performance (O(n²) in loops, memory leaks, unnecessary re-renders)
- **Context**: Challenges should feel like they came from a real production codebase.

### 2. Code Implementation (Monaco)
- **Structure**: Detailed `Problem Statement` (Markdown), `Starter Code`, `Examples`, and `Constraints`.
- **Signal**: Focus on core patterns (Closures, Async, Data Transformation, UI State).

### 3. Quiz (MCQ & Short Answer)
- **Signal**: Avoid "trivia." Focus on "Why" and "Trade-offs."
- **MCQ**: Distractors should be plausible and based on common misconceptions.
- **Short Answer**: Provide a clear `Scoring Rubric` for the recruiter.

## Prompt Blueprint

```markdown
Role: Senior Staff Engineer & Content Architect
Objective: Generate a [Type] challenge for [Skill/Topic] at [Difficulty] level.

Output Format: JSON (ChallengeTemplate compatible)
```

## Rubric for "Good" Content
- Is it ambiguous? (No)
- Is it too easy for the level? (No)
- Does it test for a specific, identifiable skill? (Yes)
- Would a Staff Engineer find this a reasonable check? (Yes)
