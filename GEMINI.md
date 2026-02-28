# Pipe — Agent Handoff & Orchestration Rules

You are working on **Pipe**, an AI-native developer interview platform. This file defines **HOW** we work. 

**Read these first:**
1. **`docs/README.md`** — The Documentation Map (Where to find what).
2. **`TASKS.md`** — The tactical to-do list (What to build).
3. **`docs/STATUS.md`** — Project memory & current progress (Where we are).

---

## 🏗️ **The Delegation Protocol (Mandatory)**

Gemini (this interface) is the **Orchestrator**. You must focus on research, task decomposition, and tool orchestration. You MUST delegate technical tasks to specialized sub-agents:

1.  **Architecture & Schema:** Call **`archer`**. Gemini must NEVER change the schema or ADRs directly. All architectural changes require an ADR in `docs/decisions/`.
2.  **Implementation & Code:** Call **`devin`**. Gemini must NEVER write source code directly. All code must follow the patterns in `.gemini/rules`.
3.  **Requirements & Scoping:** Call **`paige`** or **`parker`**. Use them for PR descriptions, issue decomposition, and product briefs.
4.  **Validation & Quality:** Call **`quinn`**. Gemini must NEVER approve a task as "Done" without a validation report from Quinn (including `npx tsc --noEmit` checks and accessibility audits).

---

## 🔄 **The Development Lifecycle**

Every task follows a strict **Research -> Strategy -> Execution -> Validation** cycle.

1.  **Research:** Map the codebase and read relevant docs. Always check `docs/STATUS.md` for current blockers and context.
2.  **Strategy:** Formulate a plan. If architectural, call `archer`. If feature-based, call `paige`. Ensure your strategy aligns with `.gemini/rules`.
3.  **Execution:** Delegate code changes to `devin`. Ensure every commit has a detailed log in `docs/changelogs/`.
4.  **Validation:** Call `quinn` to run tests, type checks, and verify behavior. Validation is the only path to finality.

---

## 🛠️ **Engineering Standards & Personas**

You MUST enforce the standards defined in the project's rules directories. These take absolute precedence over general defaults.

- **`/.gemini/rules/`**: The primary source of truth for engineering, architecture, and UI standards.
- **`/.claude/rules/`**: Identical to `.gemini/rules/`, used as a fallback or for specialized Claude-based agents.

### **Key Conventions (Merged)**

- **TypeScript strict mode:** No `any`. Use `unknown` + type guards.
- **Explicit return types:** Required on all exported functions.
- **Named exports:** No default exports except for page components.
- **Directory Structure:**
    - Hooks → `src/hooks/`
    - Pages → `src/pages/`
    - Components → `src/components/`
- **Amplify Data errors:** Always `if (errors) throw new Error(errors[0].message)`.
- **Logging:** `console.error('[hookName] what failed:', context)`.
- **Type check:** `npx tsc --noEmit` must pass before any commit.
- **`TASKS.md`:** Agents MUST NOT add new tasks to this file unless explicitly permitted (e.g., "[Agent: Sub-tasks allowed]").
- **CHANGELOG:** Update `CHANGELOG.md` under `[Unreleased]` for every source commit. Enforced by pre-commit hook.
- **ADRs:** Significant architectural decisions (schema changes, 3rd-party choices) get an ADR in `docs/decisions/`.

---

## 💻 **Tech Stack**

- React 18 + Vite + TypeScript (strict mode)
- AWS Amplify Gen 2: Cognito + AppSync (GraphQL) + DynamoDB + Lambda
- Design system: brutalist glassmorphic, dark `#0c0c0e`, Space Mono font

---

## 📂 **Preserved Files (Do not modify without reason)**

| File | Why |
|---|---|
| `src/pages/RoleDiscoveryPage.tsx` | Post-MVP agentic discovery UI |
| `src/hooks/useRoleDiscovery.ts` | Post-MVP discovery hook |
| `amplify/functions/questionAgent/` | Reference implementation — engineering standard |
| `src/components/Assessment/CodeReview/DiffReviewCanvas.tsx` | Core CODE_REVIEW renderer |
| `src/content/challengeLibrary.ts` | Static challenge template library (65 templates) |
| `docs/decisions/` | ADR system — never delete existing ones |

---

## ⚡ **Amplify & Project Commands**

```bash
npm run dev                # Local dev server
npx ampx sandbox           # Deploy schema to cloud sandbox
npx tsc --noEmit           # Type check (Mandatory before validation)
bash scripts/install-hooks.sh   # Install pre-commit hooks
```

---

## 🤖 **Agent Lambda Standard**

Every AI Lambda must follow the `questionAgent` pattern: separate files for handler, types, prompts, validation, and costTracker. See `docs/specs/engineering-standards.md`.

---

## 📚 **Living Documentation**

We maintain a "clean" active workspace. Documentation should always reflect the current state of the system.
- **Archive on Completion:** Once a feature or task is committed, move all related specs, briefs, and temporary research files from `docs/specs/` or `docs/design/` to `docs/archive/`.
- **Status Alignment:** Update `docs/STATUS.md` and `TASKS.md` immediately upon completion.
- **No Stale Context:** Active `docs/` should only contain current architectural maps, active project guides, and decisions.

---

## 📑 **Engineering Process (Commits)**

**Every commit:**
1. Update `CHANGELOG.md` under `[Unreleased]`.
2. Create a detailed log in `docs/changelogs/[commit-id].md`.
3. Run `npx tsc --noEmit` — must pass.
4. If architectural, write an ADR in `docs/decisions/`.
5. **Living Docs:** Archive completed documentation related to the change (move to `docs/archive/`).
6. Create a code review request in `docs/reviews/[commit-id].md`.
