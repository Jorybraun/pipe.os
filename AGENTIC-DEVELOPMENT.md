# AI-Native Development with Gemini CLI

**Gemini CLI** is the primary agentic orchestration tool for the Pipe platform. It uses specialized AI agents to help developers build features faster while maintaining high architectural integrity and code quality.

---

## The Orchestration Layer

The `.gemini/` directory contains the configuration for our AI agents:

```
.gemini/
├── rules/          # Project-specific coding standards and patterns
├── commands/       # Available AI agent commands (workflows)
├── agents/         # Agent persona definitions (Archer, Devin, Paige, Parker, Quinn)
└── templates/      # Document templates (READMEs, QA reports, etc.)
```

---

## Agent Personas

We use a multi-agent system where each agent has specialized expertise. You can call these agents using the sub-agent tools in Gemini CLI.

### 🧠 Archer (@architect)
**Role:** Principal Architect & AWS Amplify Specialist
**Responsibilities:** 
- Technical specifications (`/spec`)
- Architecture Decision Records (`/adr`)
- Codebase audits (`/audit`)
- System diagrams (`/diagram`)
**Focus:** Architectural integrity, security by default, and Amplify Gen 2 best practices.

### 💻 Devin (@developer)
**Role:** Staff Full-Stack Engineer
**Responsibilities:**
- Feature implementation (`/code`)
- Automated testing (`/test`)
- Documentation (`/document`)
- Code explanations (`/explain`)
**Focus:** Production-ready implementation, detail-oriented coding, and comprehensive testing.

### 📋 Paige (@product-owner)
**Role:** Product Owner
**Responsibilities:**
- Linear task management and prioritization
- Product briefs (`/brief`)
- Scope definition and success metrics
**Focus:** Linear as Source of Truth, user outcomes, strategic value, and requirement clarity.

### 📊 Parker (@planner)
**Role:** Strategic Planner
**Responsibilities:**
- Business requirements and Linear backlog alignment
- Epic organization and prototype analysis
**Focus:** Business alignment and long-term project planning.

### ✅ Quinn (@qa)
**Role:** Quality Assurance Lead
**Responsibilities:**
- PR reviews (`/review`)
- Quality gate enforcement (P0/P1/P2)
- Accessibility and performance audits
**Focus:** Objective verification and zero-regression standards.

---

## Core Development Workflows

Commands are invoked using the `/{command}` syntax in Gemini CLI.

### Feature Lifecycle
Follow this sequence for new features:
1. **`/brief`** (Paige) - Define the "What" and "Why".
2. **`/spec`** (Archer) - Define the "How" (Architecture).
3. **`/code`** (Devin) - Build it with tests.
4. **`/review`** (Quinn) - Verify quality and standards.
5. **`/draft-pr`** (Devin) - Prepare for merge.

### Maintenance & Analysis
- **`/test`** - Add Vitest or Playwright tests to existing code.
- **`/document`** - Standardize JSDoc and READMEs.
- **`/audit`** - Perform a deep-dive security or performance audit.
- **`/debt-scan`** - Identify and prioritize technical debt.
- **`/adr`** - Record a major architectural decision.

---

## Engineering Rules (`.gemini/rules/`)

The `.gemini/rules/` directory is the project's source of truth. Every agent is required to follow these standards:

| Rule File               | Description                                                                              |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| **overview.md**         | Project mission, tech stack, and structure.                                              |
| **architecture.md**     | AWS Amplify Gen 2 patterns and backend infrastructure.                                   |
| **code-quality.md**     | TypeScript standards, naming conventions, and linting.                                   |
| **database.md**         | AppSync/DynamoDB schema design and authorization.                                        |
| **documentation.md**    | JSDoc and README standards.                                                              |
| **performance.md**      | Core Web Vitals and React optimization.                                                  |
| **security.md**         | Auth patterns and data protection.                                                       |
| **testing.md**          | Vitest, Playwright, and Storybook testing patterns.                                       |
| **ui-ux.md**            | Design system (Brutalist Glassmorphism) and accessibility.                               |
| **react-components.md** | Component structure and React best practices.                                            |

---

## Quality Gates (Enforced by Quinn)

### P0 - Critical (Blockers)
- ❌ TypeScript errors (`npx tsc --noEmit`)
- ❌ Failing tests
- ❌ Security vulnerabilities (Auth bypass, etc.)

### P1 - High (Warnings)
- ⚠️ Missing JSDoc on public APIs
- ⚠️ Accessibility violations (Aria roles, etc.)
- ⚠️ Significant performance regressions

---

## Best Practices

1. **Orchestration Only:** Gemini (the main interface) should act as an Orchestrator. Always delegate implementation to Devin and architecture to Archer.
2. **Commit Logs:** Every significant change must have a technical log in `docs/changelogs/`.
3. **ADRs First:** Never change the core system architecture without an accepted ADR in `docs/decisions/`.
4. **Verified Code:** No task is complete until `Quinn` has validated the build.

---

**Happy coding with Gemini CLI! 🤖**
