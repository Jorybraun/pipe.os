# Pipe — Project Documentation Map

This directory contains the project's source of truth for design, decisions, and history.

---

## 🏛️ **Pillar 1: System Foundations (The "Architecture")**

*   **`ARCHITECTURE.md`** — The high-level system overview, data model, and auth flow.
*   **`docs/decisions/`** — Architectural Decision Records (ADRs). **WHY** we chose specific tools or patterns.
*   **`docs/specs/`** — Engineering standards (e.g., `engineering-standards.md`) and technical requirements.
*   **`/.gemini/rules/`** — Project-wide coding, architecture, and UI standards.

## 🎨 **Pillar 2: Feature & System Design (The "Execution")**

*   **`docs/design/`** — Specific design specs for features (e.g., `challenge-architecture.md`). **HOW** it works.
*   **`docs/briefs/`** — Product requirements and business context for why features exist.
*   **`ROADMAP.md`** — High-level strategic timeline (different from `TASKS.md`'s tactical steps).

## 🕒 **Pillar 3: Project State & Progress (The "Memory")**

*   **`TASKS.md`** — (Project Root) The tactical, ordered list of steps to complete. **WHAT** is next.
*   **`docs/STATUS.md`** — The active progress report and project context. **WHERE** we are right now.
*   **`docs/changelogs/`** — Detailed technical summaries of every significant commit.
*   **`CHANGELOG.md`** — (Project Root) The human-readable index of all commits.

## 🧪 **Pillar 4: Quality & Operations (The "Validation")**

*   **`docs/reviews/`** — Code review reports and quality gate results.
*   **`docs/ops/`** — Runbooks and "How-To" guides for maintenance, migration, and data cleanup.

---

## 🗄️ **Historical Archive**

*   **`docs/archive/`** — Legacy designs and specs. **Do not act on these.**

---

## 🤖 **Agent Rules for Documentation**

1.  **Always Check `docs/STATUS.md` first.** It contains the "Project Memory" and current phase.
2.  **Refer to ADRs (`docs/decisions/`)** before proposing structural changes.
3.  **Create a Changelog Log** in `docs/changelogs/` for every significant commit.
4.  **Follow `.gemini/rules/`** for all code implementation and UI development.
5.  **Strictly adhere to the Persona Protocol** defined in `GEMINI.md`.
