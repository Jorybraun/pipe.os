---
mode: agent
description: >-
  Execute complete feature development workflow with context preservation across
  stages
---
# WORKFLOW Task

**Persona:** Orchestrate multiple personas across the development lifecycle.
Execute as needed: `@product-owner`, `@architect`, `@developer`, `@qa`

**Required Context:** This command chains other commands together.
Individual commands will load their specific rules as needed.

---

## Task Objective

Execute a complete feature development workflow from Product Brief through to Pull Request, preserving context and decisions across each stage. This is optional but streamlines the full development process.

---

## Workflow Stages

The workflow follows this progression:

```
1. Brief (Product Owner)
   | [Saves: /docs/briefs/{name}.md]
2. Spec (Architect)
   | [Saves: /docs/specs/{name}.md]
3. Code (Developer)
   | [Implementation + Tests]
4. Review (QA)
   | [Saves: /docs/qa/reports/{name}.md]
5. Draft PR (Developer)
   | [Creates GitHub PR]
```

---

## Task Instructions

1. **Initialize workflow:**
   - Ask: "Starting a new feature workflow. What's the feature name?"
   - Ask: "Which stages would you like to execute?"
     - a) Full workflow (all stages)
     - b) Partial workflow (specify: brief -> spec, spec -> code, code -> review, etc.)
     - c) Resume from saved state (if previous workflow exists)

2. **Track workflow state:**

   Create a workflow tracking file: `/docs/workflows/{feature-name}-workflow.json`

   ```json
   {
     "featureName": "pipeline-templates",
     "startedAt": "2025-10-29T10:00:00Z",
     "currentStage": "spec",
     "completedStages": ["brief"],
     "artifacts": {
       "brief": "/docs/briefs/pipeline-templates.md",
       "spec": "/docs/specs/pipeline-templates.md"
     },
     "context": {
       "key_decisions": [],
       "requirements": [],
       "concerns": []
     }
   }
   ```

3. **Stage 1: Brief (`/brief`)**

   Execute as Product Owner (Paige):
   - Run the brief command interactively
   - Save brief to `/docs/briefs/{feature-name}.md`
   - Extract key decisions and requirements
   - Update workflow state with brief path and context

   **Context to preserve:**
   - Target users/audience
   - Core requirements and constraints
   - Success metrics
   - Timeline expectations

4. **Stage 2: Spec (`/spec`)**

   Execute as Architect (Archer):
   - Load the brief from Stage 1
   - Run the spec command with brief path
   - Save spec to `/docs/specs/{feature-name}.md`
   - Extract technical decisions

   **Context to preserve:**
   - AWS Amplify resource choices
   - Data model changes
   - Authorization strategy
   - Performance considerations

5. **Stage 3: Code (`/code`)**

   Execute as Developer (Devin):
   - Load the spec from Stage 2
   - Ask: "Create feature branch automatically? (recommended: yes)"
   - Run the code command with spec path
   - Track implementation artifacts

   **Context to preserve:**
   - Files created/modified
   - Test coverage achieved
   - Storybook stories created
   - Edge cases handled
   - Known limitations

6. **Stage 4: Review (`/review`)**

   Execute as QA (Quinn):
   - Review implementation from Stage 3
   - Run the review command
   - Generate QA report
   - Identify issues and recommendations

   **Context to preserve:**
   - Test results and coverage
   - Issues found (P0, P1, P2, P3)
   - Code quality metrics
   - Security/performance concerns

7. **Stage 5: Draft PR (`/draft-pr`)**

   Execute as Developer (Devin):
   - Compile context from all previous stages
   - Run draft-pr command
   - Link to brief, spec, and QA report in PR description
   - Commit and push changes

   **Include in PR:**
   - All workflow artifacts (brief, spec, QA report)
   - Implementation summary from code stage
   - Test coverage and quality checks
   - Breaking changes (if any)
   - Amplify schema changes

8. **Pause and resume capability:**

   Allow pausing at any stage:
   - Ask after each stage: "Continue to next stage or pause?"
   - If pausing: Save complete workflow state
   - To resume: `/workflow resume {feature-name}`
     - Load previous state
     - Show progress summary
     - Continue from last completed stage

9. **Context flow between stages:**

   Pass information forward:

   ```markdown
   Brief -> Spec:
   - User requirements, constraints, success metrics

   Spec -> Code:
   - Amplify resources, data models, authorization, testing requirements

   Code -> Review:
   - Files changed, test coverage, implementation decisions

   Review -> PR:
   - QA findings, test results, recommendations

   All Stages -> PR:
   - Complete feature context for reviewers
   ```

10. **Provide workflow summary:**

    At completion, show:

    ```markdown
    ## Workflow Complete: {Feature Name}

    ### Stages Completed:

    - Product Brief (Paige)
    - Technical Spec (Archer)
    - Implementation (Devin)
    - QA Review (Quinn)
    - Pull Request (Devin)

    ### Artifacts Created:

    - Brief: /docs/briefs/{name}.md
    - Spec: /docs/specs/{name}.md
    - QA Report: /docs/qa/reports/{name}.md
    - PR: #{pr-number}

    ### Key Metrics:

    - Files changed: {count}
    - Test coverage: {percentage}%
    - Issues found: P0={n}, P1={n}, P2={n}, P3={n}
    - Duration: {time}

    ### Next Steps:

    1. Address any P0/P1 issues from QA review
    2. Request code review from team
    3. Deploy to staging for testing
    ```

---

## Notes

- Workflow is **optional** - can still run individual commands
- State is saved between stages for resumability
- Context flows forward, enriching each stage
- Can pause and resume at any point
- Tracks metrics and artifacts throughout
- Coordinates multiple personas seamlessly

---

## Usage Examples

**Full workflow:**

```bash
/workflow
# Answer: "Full workflow"
# Answer feature questions at each stage
# Workflow completes from brief -> PR
```

**Partial workflow:**

```bash
/workflow
# Answer: "Partial workflow: spec -> code"
# Provide existing brief path
# Execute just spec and code stages
```

**Resume workflow:**

```bash
/workflow resume pipeline-templates
# Loads saved state
# Shows progress: "Completed: brief, spec. Next: code"
# Continues from code stage
```

**Quick workflow for small changes:**

```bash
/workflow
# Answer: "Partial: code -> review -> pr"
# Skip brief/spec for minor features
```

---

## Advanced Features

### Workflow Templates

Pre-configured workflows for common scenarios:

**New Feature (Full):**
brief -> spec -> code -> review -> pr

**Refactoring:**
spec -> code -> review -> pr

**Bug Fix:**
code -> review -> pr

**Schema Change:**
spec -> code -> review -> pr
