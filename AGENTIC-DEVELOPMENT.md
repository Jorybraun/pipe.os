# AI-Assisted Development with Rulesync

**Rulesync** is an AI agent system that helps developers build features faster while maintaining high code quality. This guide explains how to use AI agents effectively in the Gheeggle codebase.

For the complete AI agent reference (auto-generated), see [AGENTS.md](AGENTS.md).

---

## What is Rulesync?

Rulesync provides specialized AI agents that handle different aspects of software development:

- **Product Owner** creates product briefs defining features
- **Architect** transforms briefs into technical specifications
- **Developer** implements specs with tests and documentation
- **QA** reviews code quality and runs automated checks

Each agent has access to project-specific rules and patterns, ensuring consistency across the codebase.

---

## Setup

### Directory Structure

The `.rulesync/` directory contains all AI agent configuration:

```
.rulesync/
├── rules/          # Project-specific coding standards and patterns
├── commands/       # Available AI agent commands (workflows)
├── subagents/      # Agent persona definitions
├── templates/      # Document templates (READMEs, QA reports, etc.)
```

### Rule Synchronization

Rules are automatically synced to your AI coding tool via the `pnpm rulesync` command:

- **Cursor**: `.cursor/rules/` (synced from `.rulesync/rules/`)
- **Claude**: `.claude/memories/` (synced from `.rulesync/rules/`)
- etc

This ensures AI agents always follow the latest project standards.

---

## Available Commands

Commands are invoked using the `/{command}` syntax. Each command is an interactive workflow that guides you through a specific task.

### Core Development Workflow

Follow this sequence for new features:

1. **`/brief`** - Create a Product Brief defining the feature
2. **`/spec`** - Transform the brief into a Technical Specification
3. **`/code`** - Implement the spec with tests and documentation
4. **`/review`** - QA review with automated quality checks
5. **`/draft-pr`** - Create a draft pull request

Alternatively, run **`/workflow`** to run the above sequence in one command.

### Standalone Development Tasks

Use these for working with existing code:

- **`/test`** - Write comprehensive tests (unit, integration, E2E)
- **`/document`** - Add JSDoc, inline comments, README updates
- **`/explain`** - Understand how existing code works

### Code Quality & Analysis

- **`/audit`** - Multi-domain codebase audit (security, performance, accessibility)
- **`/debt-scan`** - Identify technical debt and improvement opportunities
- **`/extract-pattern`** - Extract reusable patterns from existing code
- **`/monitor`** - Add logging and error tracking for observability

### Architecture & Planning

- **`/adr`** - Create Architecture Decision Records
- **`/diagram`** - Generate system architecture diagrams
- **`/learn`** - Study new technologies or patterns

### Onboarding

- **`/onboard`** - Interactive repository tour for new developers

---

## Rules Overview

The `.rulesync/rules/` directory contains project-specific standards:

| Rule File               | Description                                                               |
| ----------------------- | ------------------------------------------------------------------------- |
| **overview.md**         | Project overview and entry point for AI agents                            |
| **architecture.md**     | Next.js App Router, tRPC, Server Components                            |
| **code-quality.md**     | TypeScript standards, error handling with TRPCError, Zod validation       |
| **database.md**         | Prisma with SQLite/LibSQL, query optimization, authorization patterns     |
| **documentation.md**    | JSDoc standards, inline comments, README structure                        |
| **integrations.md**     | Event handling and integrations                                           |
| **performance.md**      | Query optimization, bundle size                                           |
| **security.md**         | Authentication, authorization, input validation, SQL injection prevention |
| **unit-testing.md**     | Vitest unit and integration tests, test patterns                            |
| **e2e-testing.md**      | Playwright E2E tests, page objects, test patterns                         |
| **ui-ux.md**            | shadcn/ui, Tailwind CSS, accessibility (WCAG 2.1 AA)                      |
| **react-components.md** | Component structure and patterns                                          |
| **react-hooks.md**      | Hook best practices and performance optimization                          |
| **types.md**            | TypeScript type patterns and derivation                                   |

Each rule file contains:

- Best practices and patterns
- Code examples (good and bad)
- Anti-patterns to avoid
- Links to related documentation

---

## Subagents

AI agents adopt specialized personas for different tasks:

### Developer (@developer / Devin 💻)

**Role:** Staff Full-Stack Engineer

**Responsibilities:**

- Implement technical specifications with production-ready code
- Write comprehensive tests (unit, integration, E2E)
- Document code with JSDoc and inline comments
- Create well-structured pull requests

**Commands:** `code`, `test`, `document`, `explain`, `draft-pr`, `monitor`

**Focus:** Pragmatic, detail-oriented, quality-focused implementation

---

### Architect (@architect / Archer 🧠)

**Role:** Principal Architect

**Responsibilities:**

- Transform Product Briefs into Technical Specifications
- Conduct multi-domain codebase audits
- Design scalable, secure system architectures
- Create Architecture Decision Records

**Commands:** `spec`, `audit`, `adr`, `diagram`, `debt-scan`

**Focus:** Systems thinking, architectural integrity, security by default

---

### Product Owner (@product-owner / Parker 📋)

**Role:** Senior Product Manager

**Responsibilities:**

- Create Product Briefs defining features and requirements
- Define success metrics and acceptance criteria
- Prioritize features and manage scope

**Commands:** `brief`

**Focus:** User-centric, outcome-driven, strategic thinking

---

### QA (@qa / Quinn ✅)

**Role:** Quality Assurance Lead

**Responsibilities:**

- Review code quality and enforce quality gates
- Run automated checks (lint, typecheck, tests)
- Generate comprehensive QA reports
- Identify issues by severity (P0, P1, P2, P3)

**Commands:** `review`

**Focus:** Objective, thorough, process-oriented quality assurance

---

## How Commands Work

### Invocation

Commands are triggered using the `/{command}` syntax:

```bash
# Example: Write tests for a component
/test

# Example: Implement a technical specification
/code

# Example: Review a pull request
/review
```

### Interactive Workflow

Each command:

1. **Loads the appropriate persona** (Developer, Architect, Product Owner, or QA)
2. **Reads relevant rules** (e.g., unit-testing.md, e2e-testing.md, architecture.md, security.md)
3. **Asks clarifying questions** to understand requirements
4. **Executes the task** following project standards
5. **Provides a summary** with next steps

### Example: `/code` Workflow

```
1. Read Technical Specification from /docs/specs/
2. Ask: "Should I proceed with full implementation?"
3. Create feature branch (if approved)
4. Implement following architecture.md patterns:
   - Database schema (Prisma)
   - tRPC routers
   - Frontend components
5. Write comprehensive tests (Vitest + Playwright)
6. Run quality gates (lint, typecheck, test)
7. Update spec with implementation summary
8. Ask: "Create draft PR? (s/draft-pr)"
```

---

## Quality Gates

AI agents enforce automated quality gates during development:

### P0 - Critical (Blockers)

- ❌ TypeScript errors
- ❌ Failing unit tests
- ❌ Test coverage < 80% on new code
- ❌ Security vulnerabilities
- ❌ Circular dependencies

### P1 - High (Warnings)

- ⚠️ Missing JSDoc on public APIs
- ⚠️ Accessibility violations
- ⚠️ Performance issues

### P2 - Medium (Notes)

- ℹ️ Code duplication
- ℹ️ Minor style warnings
- ℹ️ Optimization opportunities

**AI agents will STOP if P0 issues are detected** and require fixes before proceeding.

---

## Best Practices

### For New Developers

1. **Start with onboarding:** Run `/onboard` for an interactive repository tour
2. **Read the rules:** Browse `.rulesync/rules/` to understand project standards
3. **Follow the workflow:** Use `brief → spec → code → review` for new features
4. **Let AI enforce quality:** Trust the quality gates and fix issues immediately

### For Feature Development

1. **Create a brief first:** Use `/brief` to define the feature clearly
2. **Get a spec:** Use `/spec` to transform the brief into technical requirements
3. **Implement with tests:** Use `/code` to build the feature with comprehensive tests
4. **QA review:** Use `/review` before creating a pull request
5. **Draft PR:** Use `/draft-pr` to create a well-documented pull request

### For Code Maintenance

- **Add tests:** Use `/test` to add tests to existing code
- **Improve docs:** Use `/document` to add JSDoc and inline comments
- **Understand code:** Use `/explain` to learn how complex code works
- **Find patterns:** Use `/extract-pattern` to identify reusable patterns

### For Quality Assurance

- **Run audits:** Use `/audit` to check security, performance, accessibility
- **Identify debt:** Use `/debt-scan` to find technical debt
- **Review PRs:** Use `/review` for comprehensive QA reviews

---

## Self-Improving Rules

Rulesync has a unique feature: **rules improve based on QA reviews**.

When `/review` completes, the QA agent:

1. Analyzes patterns in the reviewed code
2. Identifies gaps in current rules
3. Suggests rule additions or updates
4. Applies approved updates to `.rulesync/rules/`
5. Regenerates synchronized rules

This ensures rules stay current with actual code patterns and team learnings.

---

## Additional Resources

### Project Documentation

- **[README.md](README.md)** - Developer onboarding and setup instructions
- **[PRODUCT.md](PRODUCT.md)** - Complete product scope, features, and architecture
- **[AGENTS.md](AGENTS.md)** - Auto-generated AI agent reference

### Rules & Standards

- **[.rulesync/rules/](.rulesync/rules/)** - Complete coding standards and patterns
- **[.rulesync/commands/](.rulesync/commands/)** - Command definitions and workflows
- **[.rulesync/subagents/](.rulesync/subagents/)** - Agent persona specifications

### External Documentation

- [Next.js Documentation](https://nextjs.org/docs)
- [tRPC Documentation](https://trpc.io/docs)
- [Prisma Documentation](https://www.prisma.io/docs)
- [shadcn/ui Documentation](https://ui.shadcn.com/)
- [Playwright Documentation](https://playwright.dev/docs/intro)

---

## Quick Reference

### Common Command Sequences

**New Feature:**

```
/brief → /spec → /code → /review → /draft-pr
```

**Add Tests to Existing Code:**

```
/test
```

**Improve Documentation:**

```
/document
```

**Understand Complex Code:**

```
/explain
```

**Quality Audit:**

```
/audit
```

**Technical Debt Analysis:**

```
/debt-scan
```

---

## Getting Help

- **Repository tour:** Run `/onboard`
- **Command help:** Each command provides interactive guidance
- **Rule reference:** Check `.rulesync/rules/` for detailed patterns
- **Agent reference:** See [AGENTS.md](AGENTS.md) for complete AI agent documentation

---

**Happy coding with AI assistance! 🤖**
