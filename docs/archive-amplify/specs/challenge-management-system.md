# Product Specification: Challenge Management & Template System

**Status:** Draft
**Owner:** Paige (Product Owner)
**Decisions:** ADR-010

---

## 1. Goal & Problem Statement
Currently, all assessment challenges are either hard-coded in `src/content/challengeLibrary.ts` or locked inside specific hiring pipelines. Recruiters cannot manage, edit, or create their own reusable templates. This system "liberates" that data into a centralized, database-driven library.

## 2. Target User
**The Recruiter:** Needs to quickly discover existing high-quality questions and create custom, reusable ones to maintain consistency across different hiring pipelines.

## 3. User Stories
- **Discovery:** "As a recruiter, I want to search and filter a global library of challenges so I can find the best fit for my role."
- **Creation:** "As a recruiter, I want to create a new challenge once and save it as a template so I can reuse it in future pipelines."
- **Management:** "As a recruiter, I want to edit my existing templates to improve them over time based on candidate performance."
- **Promotion:** "As a recruiter, I want to take a great question I just wrote for a specific job and 'Promote' it to my global library."

## 4. Functional Requirements

### A. Challenge Management Page (`/challenges`)
- **List View:** Display all `isTemplate: true` challenges.
- **Search:** Search by `title`, `instructions`, or `tags`.
- **Filtering:** Filter by `type` (CODE_REVIEW, QUIZ_MCQ, etc.) and `difficulty`.
- **Mini-Preview:** Hover or click to see a non-interactive preview of the question using the `ChallengeRegistry`.

### B. Unified Editor
- **Template Mode:** Edits the master template record (requires `isTemplate: true`).
- **Instance Mode:** Edits a specific challenge inside a pipeline. Changes do *not* affect the template unless "Sync to Template" is chosen.
- **Save as Template:** A new action in the Pipeline Builder to clone an instance-level challenge into the global library.

### C. Challenge Picker (Updated)
- Pulls data from DynamoDB instead of the static `.ts` file.
- Distinguishes between "System Templates" (the original 65) and "My Templates" (user-created).

## 5. UI/UX Requirements
- **Theme:** Brutalist glassmorphic, dark `#0c0c0e`, Space Mono font.
- **Components:** Reuse `LiquidMetalCard` for list items, `MetalScoreRing` for difficulty indicators, and `ChallengeRegistry` for previews.

## 6. Data Model Changes (Ref: ADR-010)
- `Challenge.stageId`: Made optional.
- `Challenge.isTemplate`: Boolean flag.
- `Challenge.isSystem`: Boolean flag for read-only system defaults.
- `Challenge.tags`: String array for indexing.
- `Challenge.difficulty`: Enum field.

## 7. Success Metrics
- **Recruiter NPS:** Measured via feedback on the new creation flow.
- **Reuse Rate:** % of custom challenges that are "Promoted" to templates.
- **Time-to-Hire:** (Indirect) Reduction in pipeline setup time.

---

## 8. Phased Rollout
1. **Phase 1:** Schema update & Data migration (65 templates to DB).
2. **Phase 2:** Challenge Management Page (Read-only list + Previews).
3. **Phase 3:** Unified Editor (Create/Edit templates).
4. **Phase 4:** Pipeline Builder integration (Save as Template action).
