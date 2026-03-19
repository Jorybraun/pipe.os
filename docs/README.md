# Pipe — Documentation Map

This directory is the source of truth for design, decisions, and history.

---

## Pillar 1: System Foundations

- **`ARCHITECTURE.md`** — System overview, file inventory, data model, and auth flow. The code map.
- **`docs/decisions/`** — Architectural Decision Records (ADRs). Why we chose specific tools or patterns.
- **`docs/specs/`** — Engineering standards (e.g., `engineering-standards.md`) and technical requirements.

## Pillar 2: Feature & System Design

- **`docs/design/`** — Design specs for features and systems. How things work.
  - `design-system.md` — **UI source of truth** (Technical Terminal design language)
  - `style-guide-recruiter.md` — Practical guide for building recruiter UI components
  - `challenge-architecture.md` — Challenge data model and composition system
  - `video-interview-architecture.md` — WebRTC and signaling design
  - `scheduling-notification-flow.md` — Scheduling OAuth and webhook flow
  - `notification-engine-architecture.md` — Notification Lambda design
- **`docs/briefs/`** — Product requirements and business context.

## Pillar 3: Project State & Progress

- **`docs/STATUS.md`** — Current project state. What is implemented, what is in design, what is not built.
- **`docs/changelogs/`** — Detailed technical summaries of significant commits.
- **`CHANGELOG.md`** (project root) — Human-readable commit index.

## Pillar 4: Quality & Operations

- **`docs/reviews/`** — Code review reports and quality gate results.
- **`docs/ops/`** — Runbooks and how-to guides for maintenance, migration, and data cleanup.

---

## Historical Archive

- **`docs/archive/`** — Legacy designs and superseded specs. **Do not act on these.** Files here describe things that were cut, redesigned, or replaced.

---

## Documentation Rules

These rules apply to any agent or developer updating documentation:

1. **Only document what exists.** If a component, Lambda, page, or feature is not in the codebase, do not document it as implemented.
2. **Design docs describe implemented UI only.** If a UI surface is under active design, mark it clearly as `[IN DESIGN — NOT FINAL]`.
3. **Move stale content to `docs/archive/`.** Do not delete history — archive it.
4. **`ARCHITECTURE.md` is the code map.** It lists what files exist and what they do. Keep it in sync with the codebase.
5. **`docs/design/design-system.md` is the UI source of truth.** Do not introduce new visual patterns without updating it.
