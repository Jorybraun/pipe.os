# Product Brief - Challenge Studio

**Date:** 2026-02-28
**Author:** Paige (Product Owner)
**Handoff:** Archer (Principal Architect)
**Status:** Completed

---

## Goal / Problem

Recruiters currently have no ergonomic way to author, preview, and validate interview challenges. The `ChallengeEditorPage` is embedded inside the pipeline builder (no dedicated URL), offers only minimal per-type forms (plain textareas), and has no live preview or test validation. Creating a high-quality challenge — one a real candidate will respect — requires writing problem statements in Markdown, writing starter code in a proper editor, and proving that test cases actually execute correctly before publishing. Today, none of that is possible in the product.

The Challenge Studio is a **dedicated, first-class creation environment** for interview challenges. It gives recruiters a professional authoring experience: a Markdown editor for problem descriptions, a Monaco code editor for starter code and answer keys, and a test editor with live execution validation so recruiters can confirm tests pass before a candidate ever sees them.

---

## Target User

- **Primary:** Recruiters and hiring managers who create custom challenges for their pipelines. They are comfortable with Markdown and have basic coding literacy (can read JS/Python, understand what a test case is), but are not engineers. They need guardrails — "does this test actually run?" — not raw power.
- **Secondary:** Technical leads who write challenging code implementation exercises and need full code editor functionality, including test case authoring with live execution feedback.

---

## Non-Negotiables / Constraints

- **Composable architecture is not negotiable.** All challenge types must use the same Shell + Panel system defined in `docs/design/monaco-challenge-architecture.md` and ADR-005. No per-type monolithic components. The editor panels (MarkdownEditor, CodeEditor, TestEditor) must be individually composable and reusable across challenge types.
- **Decoupled editor panels via inversion of control.** The challenge shell (which holds the editor layout, save/discard toolbar, and preview toggle) must not know which editors it contains. Each challenge type resolves which editor panels to render via `resolveEditorLayout(challenge.type)` — the same pattern as `resolveLayout()` for the candidate side. This makes adding a fifth challenge type a config change, not a component rewrite.
- **New dedicated route:** `/studio` (or `/studio/:challengeId`). Challenge Studio must not be embedded inside the pipeline builder. Challenges are standalone entities; the Studio treats them that way. Recruiters reach the Studio from the pipeline builder ("Edit in Studio →") or from a standalone Challenge Library page.
- **Test validation before save.** If a challenge has test cases, the recruiter must be able to run them inside the Studio before saving. A challenge with failing tests cannot be marked "ready" without the recruiter explicitly acknowledging it. Validation uses Piston API (already planned in `docs/design/monaco-challenge-architecture.md`).
- **Must not break existing `ChallengeEditorPage` flows** until the Studio fully replaces them. During transition, the existing editor remains functional as a fallback.
- **TypeScript strict mode.** No `any`. All new code must pass `npx tsc --noEmit`.
- **Amplify Gen 2 data model.** All persistence through AppSync/DynamoDB using the existing `Challenge` and `CodeArtifact` models. No new backend infrastructure for MVP of the Studio.

---

## Business Rules (Explicit)

These rules must be enforced in the UI and in any scoring/validation logic:

### Challenge Lifecycle
1. A challenge in the Studio always has one of these states: `draft` (being authored), `ready` (validated and usable in pipelines), `archived` (soft-deleted from library).
2. A challenge can exist without being assigned to any stage (standalone template). `stageId` is optional.
3. A challenge must have a `title` and a `type` before it can be saved.
4. A challenge's `config` JSON shape is determined by its `type`. The Studio must prevent saving invalid config shapes per type (validated before the save call).

### Markdown Editor (used by all types)
5. Every challenge has a `instructions` field rendered as Markdown. This is the problem statement — what the candidate reads.
6. The Markdown editor must support: headings, bold/italic, inline code, fenced code blocks, ordered and unordered lists. GitHub Flavored Markdown (GFM) minimum.
7. The recruiter must be able to toggle between **Edit** (raw Markdown textarea) and **Preview** (rendered HTML) without leaving the editor.
8. The Markdown editor is always present — it is never optional regardless of challenge type.

### Code Editor (CODE_REVIEW and CODE_IMPLEMENTATION types)
9. The code editor uses Monaco. Language selection is required before typing (defaults to `javascript`). Supported languages at MVP: `javascript`, `typescript`, `python`, `go`.
10. For `CODE_REVIEW` challenges: the code editor writes to `config.code`. This is the code the candidate will annotate. Required field.
11. For `CODE_IMPLEMENTATION` challenges: the code editor writes to `config.starterCode`. This is optional — if empty, candidate starts from a blank file.
12. The recruiter may also use the code editor to write the **answer key** (`config.solutionCode`) for their own reference. This is not sent to the candidate (enforced by ground truth sanitization when ADR-007 is implemented; for now, label it clearly in the UI).
13. A `CODE_REVIEW` challenge with no code in `config.code` cannot be marked "ready".

### Test Editor (CODE_IMPLEMENTATION type only, subtype WRITE_FUNCTION or REFACTOR_FUNCTION)
14. The Test Editor allows recruiters to write executable test cases. Each test case has: a `description` (plain text), optional `setupCode` (runs before the candidate's function), and `assertionCode` (the assertion expression). These map to `ExecutableTestCase` in `CodeImplementationConfig`.
15. The recruiter can add up to 20 test cases per challenge. Each test case can be toggled as "visible to candidate" or "hidden" (hidden test cases are post-MVP — for now, all tests are visible).
16. **Run Tests button:** When clicked, the Studio sends the current `starterCode` + all test cases to the Piston API and displays pass/fail per test case. This validates that the test harness itself is correct — starter code should fail most tests (it's intentionally incomplete), but the test assertions must not throw syntax errors.
17. A challenge with test cases where ANY test case has a syntax error in `assertionCode` cannot be marked "ready". The UI must surface which test case has the error.
18. A challenge may have zero test cases. In that case, `CODE_IMPLEMENTATION` challenges default to manual scoring by the recruiter.

### Multiple Choice Questions (QUIZ_MCQ type)
19. A `QUIZ_MCQ` challenge must have: a `question`, at least 2 options, at most 5 options, and exactly one correct option marked.
20. Options are labeled A, B, C, D, E. The recruiter selects which is correct via radio button.
21. An optional `explanation` field (Markdown) shows the recruiter's rationale when reviewing candidate answers. Not shown to candidates.
22. A `QUIZ_MCQ` challenge with fewer than 2 options or no correct option marked cannot be marked "ready".
23. Scoring: 100 points if the candidate selects the correct option, 0 if wrong. No partial credit. This is automatic — no recruiter action needed.

### Short Answer (QUIZ_SHORT_ANSWER type)
24. A `QUIZ_SHORT_ANSWER` challenge must have a `question`. Optional: `placeholder` (hint text), `maxLength` (character limit, 0 = unlimited), `rubric` (Markdown, shown to recruiter when scoring — never to candidate).
25. Scoring: always manual. The recruiter reviews the candidate's text response and enters a score 0–100 with an optional comment. The rubric is shown to the recruiter as a reference during scoring.
26. The rubric is NOT shown to the candidate at any point.

### Scoring Rubric (all types)
27. Every challenge has a `weight` (1–5 scale, default 1) that controls how much it contributes to the stage score. The recruiter sets this in the Studio.
28. **Score rollup rules:**
    - `QUIZ_MCQ`: auto-scored on submission. Score = 100 if correct, 0 if wrong.
    - `CODE_REVIEW`: auto-scored on submission using `scoreCodeReview()`. Score = 0–100 based on bugs found, false positives, ±1 line tolerance.
    - `CODE_IMPLEMENTATION`: manual or auto (if test cases exist and pass via Piston). If test cases: score = (tests passed / total tests) × 100. If no test cases: score = recruiter-entered 0–100.
    - `QUIZ_SHORT_ANSWER`: always manual. Score = recruiter-entered 0–100.
29. Stage score = weighted average of all challenge scores, using each challenge's `weight`. Only scored challenges are included in the weighted average — unscored challenges are excluded (not treated as 0).
30. A stage is "fully scored" only when all challenges have a score. Partially scored stages show a warning badge on the recruiter dashboard.

### Challenge Templates vs. Pipeline Instances
31. A challenge without a `stageId` is a **template** (belongs to the library). A challenge with a `stageId` is a **pipeline instance** (belongs to a specific stage).
32. When a recruiter adds a challenge to a stage from the library (via `ChallengePicker`), the system **copies** the template into a new Challenge record with the `stageId` set. Editing the copy does not affect the original template.
33. A recruiter can promote a pipeline instance to a template ("Save as Template") — this creates a new Challenge record with `isTemplate: true` and `stageId: null`.
34. System-seeded templates (`isSystem: true`) are read-only. Recruiters can use them and fork them, but cannot edit or delete them.

---

## Out of Scope

- **Hidden test cases (anti-cheat):** All test cases visible to candidate at MVP. Post-MVP toggle only.
- **`BUILD_COMPONENT` subtype (Sandpack live preview):** The PreviewPanel and Sandpack integration are deferred. Only `WRITE_FUNCTION` and `REFACTOR_FUNCTION` subtypes need the Test Editor at MVP.
- **`RecordingShell` (screen capture):** Post-MVP behavioral wrapper. Studio does not surface recording config yet.
- **`AutoSaveShell` (draft autosave):** Save is explicit (Save button). No background drafts at MVP.
- **Collaborative editing:** One recruiter edits a challenge at a time. No real-time collaboration.
- **`SYSTEM_DESIGN` challenge type:** Deferred — no diagramming canvas.
- **AI-assisted challenge generation:** Deferred. The Studio is human-authored only at MVP. AI generation of challenges from job descriptions is a post-MVP `questionAgent` feature.
- **Answer key security (ground truth sanitization):** ADR-007 is Proposed, not yet implemented. For MVP, the Studio labels answer key fields clearly but does not enforce server-side separation. The `scoringAgent` Lambda is post-MVP.
- **Mobile-responsive Studio layout:** The Challenge Studio is a desktop authoring tool. Mobile candidates use the candidate-side `WorkspaceLayout` (which is responsive). The Studio assumes ≥1024px viewport.
- **Bulk challenge import (CSV/JSON):** Post-MVP.
- **Challenge versioning history:** Post-MVP.

---

## Feature Breakdown (One Ticket per Editor)

Per the user's direction, each editor component is its own independent deliverable:

| Ticket | Feature | Challenge Types |
|--------|---------|-----------------|
| CS-001 | Challenge Studio route + shell (layout, toolbar, save/discard, preview toggle) | All types |
| CS-002 | Challenge Management Page (`/challenges`) — library browse, search, filter | All types |
| CS-003 | Markdown Editor panel (with Edit/Preview toggle, GFM support) | All types |
| CS-004 | Code Editor panel (Monaco, language selector, line numbers) | CODE_REVIEW, CODE_IMPLEMENTATION |
| CS-005 | MCQ Editor panel (question, 2–5 options, correct answer radio, explanation) | QUIZ_MCQ |
| CS-006 | Short Answer Editor panel (question, placeholder, maxLength, rubric) | QUIZ_SHORT_ANSWER |
| CS-007 | Test Editor panel (test case list, add/remove/edit, Run Tests via Piston) | CODE_IMPLEMENTATION |
| CS-008 | Scoring rubric panel (weight slider, per-type rubric fields, score preview) | All types |
| CS-009 | Challenge preview mode (renders candidate-side WorkspaceLayout with mock data) | All types |
| CS-010 | "Save as Template" + library promotion flow | All types |

---

## Success Metrics

| Metric | Target | How Measured |
|--------|--------|--------------|
| Challenge authoring time | Recruiter can create a valid CODE_IMPLEMENTATION challenge with 3 test cases in < 10 minutes (first use) | Stopwatch during user testing |
| Test validation pass rate | 95%+ of challenges with test cases pass Piston validation before being marked "ready" | Piston run logs in CloudWatch |
| Challenge reuse | 50%+ of pipeline challenges are created from library templates within 30 days of Studio launch | `isTemplate: true` origin tracked on Challenge records |
| Editor abandonment | < 20% of Studio sessions end without saving | Session events (future analytics) |
| Type coverage | All 4 MVP challenge types are authored and used in real pipeline by first recruiter cohort | DynamoDB query on `Challenge.type` distribution |

---

## Business Context / Rationale

The current challenge editor is an afterthought — a set of plain textareas bolted onto the pipeline builder. It gives recruiters no confidence that their challenges are correct. A recruiter who spends 30 minutes crafting a code challenge only to discover a test case has a typo after candidates have already seen it loses trust in the platform.

The Challenge Studio makes challenge authoring a first-class product experience. It unblocks the path to a **recruiter self-serve library** — where hiring managers can build a company-specific challenge pool without engineering support. This is the core value proposition for teams that hire more than a few times per year, and the foundation for the AI-assisted generation tier that follows.

This is also the prerequisite for proper scoring infrastructure. Until challenges are authored with explicit rubrics and test cases, scoring remains manual and inconsistent. The Studio forces recruiters to define "what good looks like" at creation time, not review time.

---

## Timeline / Deadline

- **Target Delivery:** As soon as possible. The current editor is blocking first real recruiter cohort.
- **Key Milestones:**
  - CS-001 + CS-002 (Studio shell + Management page): Week 1
  - CS-003 + CS-004 + CS-005 + CS-006 (all editor panels): Week 2
  - CS-007 (Test Editor + Piston validation): Week 3
  - CS-008 + CS-009 + CS-010 (Scoring rubric + Preview + Templates): Week 4
  - Full smoke test + CHANGELOG + ADR: End of Week 4

---

## Notes

- The `resolveEditorLayout(type)` function should mirror `resolveLayout(type)` from `src/lib/challenge/resolveLayout.ts`. Both functions live in `src/lib/challenge/`. The editor side maps `challenge.type → { markdownEditor, codeEditor, testEditor, mcqEditor, shortAnswerEditor }`.
- The Studio shell wraps editor panels with a save toolbar and preview toggle — it does NOT wrap with `TimerShell` or `RecordingShell` (those are candidate-side behavioral shells only).
- The "Preview" tab in the Studio renders the full candidate-side `WorkspaceLayout` with the current challenge config. This gives recruiters an accurate preview of the candidate experience.
- Piston API endpoint: `https://emkc.org/api/v2/piston/execute`. MVP calls it directly from browser. Lambda proxy (for rate limiting + auth) is post-MVP but code structure should allow swapping the executor without touching `TestEditor`.
- Challenge score weight is a `1–5` integer, not a float percentage. The stage rollup normalizes weights.
- The database-driven template system (ADR-010) is the prerequisite for CS-002 and CS-010. Schema migration (adding `isTemplate`, `isSystem`, `tags`, `difficulty` to `Challenge`) must land before the Studio ships.

---

## References

- `docs/design/challenge-architecture.md` — canonical data model and business rules for Challenge, Stage, CodeArtifact
- `docs/design/monaco-challenge-architecture.md` — composable Shell + Panel system; resolveLayout, resolveShells, WorkspaceLayout
- `docs/decisions/ADR-005-composable-challenge-system.md` — why Shell + Panel composition over monolithic per-type components
- `docs/decisions/ADR-007-ground-truth-sanitization.md` — answer key security (Proposed; Studio must not block on this)
- `docs/decisions/ADR-010-database-driven-challenge-library.md` — template system schema design
- `TASKS.md → Epic: Challenge Management & Template System` — related task list (Steps 1–5)
- `src/content/challengeLibrary.ts` — 65 existing challenge templates (static; will migrate to DynamoDB)
- `src/lib/challenge/resolveLayout.ts` — candidate-side layout resolver (Studio needs a parallel `resolveEditorLayout`)
