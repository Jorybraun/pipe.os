# MASTER CLAUDE — The Boss's Backlog

> [!IMPORTANT]
> **AI AGENT DIRECTIVE:** Do NOT perform, modify, or check off the tasks in this file. This document is for the "Boss" (the human user) to orchestrate and manage. Use this file EXCLUSIVELY for high-level architectural context and roadmap alignment. Do not initiate implementation of these items without an explicit user directive.

This document is the high-level orchestration hub for Pipe. It tracks strategic technical debt, architectural evolutions, and the long-term vision of the platform.

---

## 🔍 Code Review Requests

- **Commit `39e8289`**: Implemented the **Granular Changelog System** and updated the project standards. Every significant commit now has a dedicated log in `docs/changelogs/`.
- **Commit `a5b30a4`**: Formalized the **Commit & Review Workflow** and the **Preservation & Merging** mandate within `GEMINI.md`. [Detailed Log](docs/changelogs/a5b30a4.md)
- **Commit `a3e1539`**: Implemented the **Composable Challenge System** (Phase 7 Step 4A-4D). [Detailed Log](docs/changelogs/a3e1539.md). Please review the Shell + Panel architecture and the context-backed timer enforcement.

---

## ✅ Dual FK — Resolved (2026-02-27)
**Context:** During the Phase 7 migration, `Assessment` was updated to include `challengeId`. A dual-FK concern was raised about retaining `stageId` for backward compatibility.

**Resolution:** Reviewed `amplify/data/resource.ts` — `Assessment` only carries `challengeId`. There is no `stageId` on the Assessment model. The dual FK issue was fully resolved during Phase 7 pre-flight bug fixes. No migration needed.

**Pre-launch data cleanup** (tracked in TASKS.md): ~5 test Candidate + Assessment records will be purged via `scripts/purgeTestData.ts`. Stale schema relics (`Stage.type`, `Stage.config`, `ChallengeTemplate` model) will be removed at the same time. No real user data exists, so no migration is required.

**No further action needed on this item.**

---

## 🏗️ Future-Proofing the Stage Model
The Stage model needs to evolve from a simple container into a "Smart Orchestrator."
- [ ] **Customizable Data Model:** We need to define attributes for:
    - **Automation Hooks:** `onComplete` (e.g., send automated email, Slack notification) and `onFailure`.
    - **Progression Rules:** Logic for "Moving Forward" (e.g., minimum score threshold to unlock the next stage).
    - **Proctoring & Logistics:**
        - `isScheduled`: Is this a proctored session or a live meeting?
        - `isRecorded`: Should the screen be recorded during the challenge?
        - `liveVideo`: Is there a requirement for a live video feed (proctoring)?
        - `meetingType`: Is this an interview, an offer conference, or an async screen?
    - **Configuration UI:** Ability for recruiters to edit stage names, descriptions, and these new orchestration flags.
- [ ] **TODO:** Design the updated `Stage` schema and identify necessary data attributes.

---

## 🧩 The Challenge Ecosystem
We need a comprehensive strategy for how challenges are born, tested, and rendered.
- **Seeding:** Moving from static `challengeLibrary.ts` to DynamoDB-backed storage.
- **Lists & Templates:** How recruiters browse, search, and clone challenge templates.
- **Content & Components:** Mapping `ChallengeType` to specific UI renderers and validation logic.
- **Testing:** Automated tests for each challenge type (MCQ, Monaco, Short Answer).

---

## 🎨 Design System & Storybook
**Audit Status:**
- [ ] **Components in Storybook:** Are all current UI components (LiquidMetalCard, TextInput, etc.) represented in Storybook?
- [ ] **Design System:** Is the "Brutalist Glassmorphic" design system documented and interactive within Storybook?
- [ ] **Action:** Review the `stories/` directory and `docs/design/design-system.md`. Ensure every new component starts in Storybook.

---

## 🌟 Future Dreams & Vision
Where is Pipe going?
- **LinkedIn Integration?** Could this become the "Verified Skills" layer for professional profiles?
- **Developer Experience:** How do we make this "cool" and "fun" for developers? It shouldn't feel like a sterile test; it should feel like a high-end tool.
- **Community & Chats:** Is there a world where developers can discuss challenges or showcase their assessment results in a community?
- **The Core Question:** Is this tool for the Recruiter (efficiency) or the Developer (fairness/experience)? *Answer: Both, by being a platform for technical truth.*
