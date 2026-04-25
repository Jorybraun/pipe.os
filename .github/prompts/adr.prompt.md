---
mode: agent
description: Document Architecture Decision Records for important technical decisions
---
# ADR Task

**Persona:** Execute this task as the `@architect` subagent (Archer, Principal Architect).
Load the persona characteristics from `.rulesync/subagents/architect.md` before proceeding.

**Required Context:** Review these rules before proceeding:

- `.rulesync/rules/architecture.md` - AWS Amplify Gen 2 patterns
- `.rulesync/rules/documentation.md` - Documentation standards

---

## Task Objective

Create Architecture Decision Records (ADRs) to document important technical decisions, the context behind them, alternatives considered, and their consequences. Build a searchable history of why the system is designed the way it is.

---

## Task Instructions

1. **Ask discovery questions:**
   1. "What decision needs to be documented?"
      - Provide a brief description
   2. "What's the status of this decision?"
      - a) Proposed (under discussion)
      - b) Accepted (approved and implemented)
      - c) Deprecated (no longer recommended)
      - d) Superseded (replaced by another decision)
   3. "What prompted this decision?"
      - Business requirement, technical constraint, AWS limitation, etc.

2. **Gather decision context:**

   Ask follow-up questions to understand:
   - What problem are we solving?
   - What are the AWS Amplify constraints?
   - What are the goals and non-goals?
   - Who are the stakeholders?
   - What's the timeline?

3. **Explore alternatives:**

   For each option considered:
   - What's the approach?
   - Does it align with AWS Amplify best practices?
   - What are the pros?
   - What are the cons?
   - What's the estimated effort?
   - What are the risks?

4. **Document the decision:**

   Generate ADR number:
   - Check existing ADRs in `/docs/decisions/`
   - Use next sequential number (e.g., `0023`)

   Create file: `/docs/decisions/{nnnn}-{slug}.md`

   Template:

   ```markdown
   # {Number}. {Title}

   **Date:** {YYYY-MM-DD}
   **Status:** {Proposed | Accepted | Deprecated | Superseded}
   **Author:** {Name/Role}
   **Stakeholders:** {List of people involved}

   {If Superseded, add: "Superseded by [ADR-XXXX](link)"}
   {If Supersedes, add: "Supersedes [ADR-YYYY](link)"}

   ---

   ## Context and Problem Statement

   {Describe the context and problem that requires a decision}

   {Include:}

   - What is the background?
   - What triggered this decision?
   - What AWS Amplify constraints exist?
   - What business constraints exist?

   ---

   ## Decision Drivers

   Key factors influencing this decision:

   - {Driver 1: e.g., "Must use DynamoDB single-table design"}
   - {Driver 2: e.g., "Real-time sync required via AppSync"}
   - {Driver 3: e.g., "Must support owner-based authorization"}
   - {Driver 4: e.g., "Must ship by Q2"}

   ---

   ## Considered Options

   ### Option 1: {Name}

   **Description:**
   {Detailed description of this approach}

   **AWS Amplify Alignment:**
   {How well does this align with Amplify patterns?}

   **Pros:**

   - {Positive aspect}
   - {Positive aspect}

   **Cons:**

   - {Negative aspect}
   - {Negative aspect}

   **Estimated Effort:** {time estimate}

   ### Option 2: {Name}

   {Repeat structure}

   ### Option 3: {Name}

   {Repeat structure}

   ---

   ## Decision Outcome

   **Chosen Option:** {Option N - Name}

   **Justification:**

   We chose {Option N} because:

   - {Reason 1}
   - {Reason 2}
   - {Reason 3}

   This option best addresses {key decision drivers} while accepting
   {tradeoffs}.

   ---

   ## Consequences

   ### Positive

   - {Benefit 1}
   - {Benefit 2}
   - {Benefit 3}

   ### Negative

   - {Tradeoff 1}
   - {Tradeoff 2}
   - {Risk 1}

   ### Neutral

   - {Impact 1}
   - {Impact 2}

   ---

   ## Implementation

   {High-level implementation approach}

   **Amplify Resources Affected:**

   - {Resource 1: e.g., "Data schema changes"}
   - {Resource 2: e.g., "Auth configuration"}

   **Migration Path (if applicable):**

   1. {Step 1}
   2. {Step 2}

   **Rollback Plan:**
   {How to rollback if this doesn't work}

   ---

   ## Validation

   **How we'll measure success:**

   - {Metric 1}
   - {Metric 2}

   **Timeline:**

   - {Milestone 1}: {date}
   - {Milestone 2}: {date}

   **Review Date:** {When to reassess this decision}

   ---

   ## References

   - {Link to AWS Amplify docs}
   - {Link to relevant spec, RFC, discussion}
   - {Link to related ADR}

   ---

   ## Related Decisions

   - [ADR-XXXX](link) - {Related decision}
   - [ADR-YYYY](link) - {Related decision}
   ```

5. **Update ADR index:**

   Create/update `/docs/decisions/README.md`:

   ```markdown
   # Architecture Decision Records

   Index of all ADRs for the Pipe platform.

   ## Active Decisions

   | Number                           | Title                           | Date       | Status   |
   | -------------------------------- | ------------------------------- | ---------- | -------- |
   | [0023](0023-auth-strategy.md)    | Cognito Authentication Strategy | 2025-10-29 | Accepted |
   | [0022](0022-data-authorization.md) | Amplify Data Authorization    | 2025-10-15 | Accepted |

   ## Deprecated Decisions

   | Number                     | Title              | Date       | Superseded By                         |
   | -------------------------- | ------------------ | ---------- | ------------------------------------- |
   | [0010](0010-api-design.md) | REST API Design    | 2024-06-12 | [ADR-0020](0020-amplify-data.md)      |

   ## By Category

   ### Authentication

   - [ADR-0023](0023-auth-strategy.md) - Cognito Authentication Strategy

   ### Data Layer

   - [ADR-0022](0022-data-authorization.md) - Amplify Data Authorization
   - [ADR-0020](0020-amplify-data.md) - Amplify Data with AppSync

   ### Infrastructure

   - [ADR-0015](0015-amplify-deployment.md) - Amplify Deployment Strategy
   ```

6. **Link to related artifacts:**

   Ask about related documentation:
   - Technical specifications
   - Product briefs
   - Pull requests
   - AWS documentation

   Add links to the ADR

7. **Generate diagram (if helpful):**

   Offer to create diagram illustrating the decision:
   - Architecture diagram showing new structure
   - Flow diagram showing new process
   - Comparison diagram of options considered

8. **Provide summary:**

   ```markdown
   ## ADR Created

   **Number:** ADR-0023
   **Title:** Cognito Authentication Strategy
   **File:** `/docs/decisions/0023-auth-strategy.md`

   **Decision:**
   Use AWS Cognito User Pools via Amplify Auth for all authentication.

   **Key Points:**

   - Evaluated 3 options (custom auth, Auth0, Cognito)
   - Chose Cognito for native Amplify integration
   - Supports MFA and social sign-in
   - Expected benefits: Seamless Amplify integration, built-in security

   **Status:** Accepted
   **Review Date:** 2026-01-15

   **Next Steps:**

   1. Share with team for feedback
   2. Link to implementation spec
   3. Update project roadmap
   ```

---

## Notes

- Write ADRs for significant decisions only, not every small choice
- Focus on "why" not "how" (implementation goes in specs)
- Make ADRs searchable and discoverable
- Link related ADRs to show decision evolution
- Set review dates for major decisions
- Include AWS Amplify considerations explicitly

---

## When to Write an ADR

**DO write ADRs for:**

- AWS Amplify resource choices (Auth, Data, Storage, Functions)
- Authorization strategy decisions
- Data model design choices
- Third-party integration selections
- Major architectural patterns
- Security or compliance decisions

**DON'T write ADRs for:**

- Code style preferences (use linter config)
- Routine bug fixes
- Feature implementations (use specs)
- Trivial choices
- Personal preferences
