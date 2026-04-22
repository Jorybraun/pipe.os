# Phase 2: Recruiter Core — Stage Detail, Overview, Challenge Editor

**Status:** Not started
**Depends on:** Phase 1 (Listing + Pipeline Create)
**Pages:** `/pipeline/:id` (Overview), `/pipeline/:id/stages/:stageId` (Stage Detail), `/pipeline/:id/challenges/:challengeId` (Challenge Editor)

---

## 1. Overview

Phase 2 migrates the three most complex recruiter-facing pages from AWS Amplify (AppSync + DynamoDB) to Cloudflare Workers + D1 + Clerk. These pages represent the core pipeline management workflow: viewing the kanban pipeline overview, configuring stages and their challenges, and editing individual challenges.

The OverviewPage alone makes ~20 data calls today (pipeline, candidates, stages, challenges per stage, assessments per candidate, scheduled interviews). This phase replaces those with purpose-built Workers API routes that return pre-joined data, eliminating the N+1 waterfall that Amplify's client-side model forces.

### Key changes from Amplify

| Concern | Amplify (current) | Cloudflare (target) |
|---|---|---|
| Data access | `generateClient<Schema>()` + per-model `.list()` / `.get()` | `fetch('/api/v1/...')` via `apiClient` abstraction |
| Auth | Cognito JWT verified by AppSync | Clerk JWT verified by Worker middleware |
| Database | DynamoDB single-table (Amplify-managed) | D1 SQLite with explicit relational schema |
| GitHub PR fetch | Lambda mutation `fetchGitHubPR` | Worker route `POST /api/v1/github/pr` |
| Drag-and-drop persistence | Individual `.update()` calls per item | Batch `PATCH /api/v1/stages/reorder` and `PATCH /api/v1/challenges/reorder` |

### What is NOT in scope

- Candidate-facing assessment flow (Phase 3)
- Video signaling / scheduling (Phase 4)
- AI scoring agents (Phase 3)
- Dev container management (Phase 3b — ECS → Cloudflare Containers)

---

## 2. BDD User Journeys

### 2.1 Recruiter views pipeline overview with candidates and stages

```gherkin
Feature: Pipeline Overview

  Scenario: Recruiter loads pipeline overview
    Given the recruiter is authenticated via Clerk
    And a pipeline "Senior Frontend Engineer" exists with 2 stages
    And 3 candidates exist across stages with assessment scores
    When the recruiter navigates to /pipeline/:id
    Then the page loads within 500ms
    And the pipeline title "Senior Frontend Engineer" is displayed
    And 2 stage columns are rendered in order
    And each stage column shows its candidates with name, email, status, and score
    And candidates with currentStageId are placed in the correct column

  Scenario: Empty pipeline
    Given the recruiter is authenticated
    And a pipeline exists with 0 stages and 0 candidates
    When the recruiter navigates to /pipeline/:id
    Then a "No stages" empty state is displayed
    And the "ADD_STAGE" button is visible
```

### 2.2 Recruiter adds a new stage to pipeline

```gherkin
Feature: Add Stage

  Scenario: Add stage to draft pipeline
    Given the recruiter is on a DRAFT pipeline overview
    When the recruiter clicks "ADD_STAGE"
    And enters "Technical Screen" in the prompt
    Then a new stage is created with order = (existing stage count)
    And the stage column appears in the kanban view
    And the D1 stages table has the new row with correct pipelineId and order

  Scenario: Cannot add stage to ACTIVE pipeline via ADD_STAGE button
    Given the recruiter is on an ACTIVE pipeline overview
    Then the "ADD_STAGE" button is not displayed
```

### 2.3 Recruiter reorders stages via drag-and-drop

```gherkin
Feature: Stage Reorder

  Scenario: Drag stage to new position
    Given a DRAFT pipeline has stages ["Screen", "Technical", "Final"] with orders [0, 1, 2]
    When the recruiter drags "Final" before "Technical"
    Then the UI updates immediately to ["Screen", "Final", "Technical"]
    And a PATCH /api/v1/pipelines/:id/stages/reorder is sent with body:
      | stageId | order |
      | screen-id | 0 |
      | final-id | 1 |
      | technical-id | 2 |
    And all three stages have updated order values in D1

  Scenario: Reorder fails gracefully
    Given the PATCH request fails with 500
    Then the stages revert to their original order
    And an error notification is shown
```

### 2.4 Recruiter adds a challenge to a stage

```gherkin
Feature: Add Challenge

  Scenario: Add challenge from template library
    Given the recruiter is on StageDetailPage for stage "Technical Screen"
    When the recruiter clicks "ADD_CHALLENGE"
    And selects a CODE_IMPLEMENTATION template from the library
    Then a POST /api/v1/stages/:stageId/challenges is sent with:
      | field | value |
      | type | CODE_IMPLEMENTATION |
      | title | (template title) |
      | instructions | (template instructions) |
      | config | (template config as JSON) |
      | order | (current challenge count) |
    And the challenge appears in the stage's challenge list

  Scenario: Add CODE_REVIEW challenge from org slopify repo
    Given the recruiter is on StageDetailPage
    And the organization has a slopify exercise repo configured
    When the recruiter clicks "ADD_CHALLENGE"
    And selects "Code Review" type
    Then the repo dropdown shows the org's slopify repo (always present, per-project)
    And the PR list shows branches prepared as exercise PRs
    When the recruiter selects PR "SLOP-101: Search with Debounced Input"
    Then a CODE_REVIEW challenge is created with:
      | field | value |
      | type | CODE_REVIEW |
      | title | (PR title) |
      | practice_repo | pipe-hq/slopify |
      | pr_number | (PR number) |
      | feature_branch | (PR branch) |
      | base_branch | main |
    And a background request to POST /api/v1/github/pr caches the diff JSON
    And ground truth (planted bugs + design trade-offs) is loaded from the exercise case definition

  Scenario: Slopify repo is always available in the repo dropdown
    Given the recruiter clicks "ADD_CHALLENGE" and selects "Code Review"
    Then the repo dropdown pre-populates with the org's slopify repo
    And the recruiter cannot remove the slopify repo from the list
    And the recruiter can still add additional repos via "Add repo" input

  Scenario: Add challenge from arbitrary GitHub PR (legacy)
    Given the recruiter is on StageDetailPage
    When the recruiter clicks "ADD_CHALLENGE"
    And adds a custom repo URL and selects PR #42
    Then a CODE_REVIEW challenge is created with githubRepoUrl, githubPrNumber, githubPrTitle
    And a background request to POST /api/v1/github/pr caches the diff on the challenge record
    And ground truth must be manually annotated (no exercise case definition exists)
```

> **Note on challenge creation model change (see [ADR-024](../docs/decisions/current/ADR-024-multi-turn-agentic-code-review.md)):**
>
> The slopify repo is the primary source for CODE_REVIEW challenges. Each PR on slopify is a prepared exercise with planted bugs and design trade-offs defined in the research system (`research/code-review-arena/golden/cases.json`). When a recruiter selects a slopify PR, the ground truth is automatically loaded — no manual annotation needed.
>
> Arbitrary GitHub PRs are still supported but require manual ground truth annotation and will only support single-turn scoring (deterministic, per ADR-021). Multi-turn agentic conversation is only available for prepared slopify exercises where ground truth includes design trade-offs and implementer persona configuration.

### 2.5 Recruiter configures challenge settings (type, instructions, config)

```gherkin
Feature: Challenge Editor

  Scenario: Edit QUIZ_MCQ challenge
    Given the recruiter opens a QUIZ_MCQ challenge in the editor
    When the recruiter updates the question text and answer options
    And clicks "SAVE"
    Then the config JSON is updated with the new options
    And serverConfig stores the correctOptionId

  Scenario: Clone challenge
    Given the recruiter is editing an existing challenge
    When the recruiter clicks "CLONE"
    Then a new challenge is created with title "(original) (Clone)"
    And the recruiter is navigated to the new challenge's editor page

  Scenario: Create new challenge from scratch
    Given the recruiter navigates to /pipeline/:id/challenges/NEW_CODE_IMPLEMENTATION
    When the page loads
    Then a blank CODE_IMPLEMENTATION editor is shown with starter code template
    And no API call is made until the recruiter clicks "SAVE"
    And saving creates a new challenge via POST /api/v1/stages/:stageId/challenges
```

### 2.5.1 Code challenge content editor

> **Current state:** The CODE_IMPLEMENTATION content editor tab is a stub — a placeholder message saying "configured with templates." The tab exists but has no editing capability.
>
> **Goal:** A two-panel content editor that lets recruiters author code challenges with description, boilerplate code, and test files. Pre-existing challenges from the challenge library are **locked** unless the recruiter clicks **CLONE**, which creates an editable copy.
>
> **Future:** The follow-up agent should be able to programmatically create code challenges using the same data model, so it can generate assessment exercises based on what it's following up on.

#### Layout

The CONTENT_EDITOR tab for code challenges uses a **two-panel layout**:

```
┌─────────────────────────────────┬─────────────────────────────────┐
│          LEFT PANEL             │          RIGHT PANEL            │
│                                 │                                 │
│  DESCRIPTION (markdown)         │  FILES                          │
│                                 │  ┌─────────────────────────────┐│
│  The problem statement that     │  │ [App.js] [styles.css] [+]   ││
│  candidates see. Supports       │  ├─────────────────────────────┤│
│  markdown with code blocks,     │  │                             ││
│  lists, and formatting.         │  │  // Boilerplate code        ││
│                                 │  │  // that candidates start   ││
│                                 │  │  // with                    ││
│                                 │  │                             ││
│                                 │  ├─────────────────────────────┤│
│                                 │  │ [test.js] (hidden from      ││
│                                 │  │  candidate — validation     ││
│                                 │  │  tests that run on submit)  ││
│                                 │  └─────────────────────────────┘│
│                                 │                                 │
│  [PREVIEW]  ← button, not tab  │                                 │
└─────────────────────────────────┴─────────────────────────────────┘
```

- **Left panel:** Markdown editor for the problem description (what the candidate sees)
- **Right panel:** File editor with tabs. Each file has a name and content. Files can be added/removed.
- **Test file:** A special file (e.g. `test.js`) that contains validation tests. May or may not be visible to the candidate (configurable). Runs on submit to verify correctness.
- **Preview button:** Opens a preview of the full candidate view (description + code workspace). This is a button, NOT a tab — it opens in overlay/modal.

#### Locked vs editable content

```gherkin
Feature: Code Challenge Content Editor

  Scenario: Edit content of a new code challenge
    Given the recruiter creates a new CODE_IMPLEMENTATION challenge
    When the CONTENT_EDITOR tab is selected
    Then the left panel shows an empty markdown editor for the description
    And the right panel shows a file editor with a single starter file
    And both panels are editable

  Scenario: Pre-existing challenge content is locked
    Given the recruiter selects a pre-existing challenge from the challenge library
    When the CONTENT_EDITOR tab is selected
    Then the description panel is read-only (not editable)
    And the file editor is read-only (not editable)
    And a banner reads "This challenge is from the library. Clone to edit."
    And a CLONE button is visible

  Scenario: Clone unlocks content for editing
    Given the recruiter is viewing a locked pre-existing challenge
    When the recruiter clicks "CLONE"
    Then a new challenge is created with "(Clone)" appended to the title
    And the recruiter is navigated to the new challenge's editor page
    And both the description and file editor are now editable

  Scenario: Add and remove files in the editor
    Given the recruiter is editing a code challenge
    When the recruiter clicks the [+] button in the file tab bar
    Then a new file tab appears with a default name
    And the recruiter can rename the file and add content
    When the recruiter clicks the [x] on a file tab
    Then the file is removed (with confirmation if it has content)

  Scenario: Create a test file
    Given the recruiter is editing a code challenge
    When the recruiter adds a new file named "test.js"
    And marks it as a test file via the file settings
    Then the file is stored in serverConfig (not config)
    And a toggle controls whether the test file is visible to candidates

  Scenario: Preview the candidate view
    Given the recruiter has authored a description and boilerplate files
    When the recruiter clicks the "PREVIEW" button
    Then an overlay shows the candidate's view of the challenge
    And the preview includes the rendered description and the code workspace
    And the preview is read-only (no editing)
    And the recruiter can close the preview to return to editing

  Scenario: Save code challenge content
    Given the recruiter has edited the description and files
    When the recruiter clicks "SAVE_CHANGES"
    Then the description is stored in config.description
    And each file is stored in config.files as an array of { name, content }
    And test files are stored in serverConfig.testFiles
    And the challenge is persisted via PUT /api/v1/challenges/:challengeId
```

#### Data model for code challenge content

```typescript
// config (sent to candidate)
interface CodeChallengeConfig {
  description: string;                    // Markdown problem statement
  files: Array<{
    name: string;                         // e.g. "App.js", "styles.css"
    content: string;                      // Boilerplate/starter code
    language: string;                     // e.g. "javascript", "html", "css"
  }>;
  visibleTestFile?: {                     // Test file shown to candidate (optional)
    name: string;
    content: string;
    language: string;
  };
}

// serverConfig (NEVER sent to candidate)
interface CodeChallengeServerConfig {
  testFiles: Array<{                      // Validation tests run on submit
    name: string;
    content: string;
    language: string;
  }>;
  scoringRubric?: string;                 // Recruiter-authored scoring notes
}
```

### 2.6 Recruiter invites a candidate (generates invite link)

```gherkin
Feature: Candidate Invite

  Scenario: Add candidate to ACTIVE pipeline
    Given the recruiter is on an ACTIVE pipeline overview
    When the recruiter clicks "ADD_CANDIDATE"
    And fills in name "Jane Doe" and email "jane@example.com"
    And submits the form
    Then a candidate record is created with a UUID inviteToken
    And the candidate appears in the first stage column with status INVITED
    And the invite link /assess/:inviteToken is copyable

  Scenario: Copy invite link
    Given a candidate "Jane Doe" exists with inviteToken "abc-123"
    When the recruiter clicks the copy button on Jane's card
    Then the clipboard contains "https://pipe.dev/assess/abc-123"
    And a "Copied" confirmation appears for 2 seconds

  Scenario: Add candidate with CV upload
    Given the recruiter is on an ACTIVE pipeline overview
    When the recruiter clicks "ADD_CANDIDATE"
    And fills in name "Jane Doe" and email "jane@example.com"
    And uploads a PDF file "jane-resume.pdf"
    And submits the form
    Then a candidate record is created with status INVITED
    And the file is uploaded to R2 via a presigned PUT URL
    And a candidate_media record is created with type RESUME
    And the R2 key uses the convention "candidate-documents/{candidateId}/{ulid}.pdf"
    And the candidate card appears in the first stage column

  Scenario: CV upload rejects invalid file types
    Given the recruiter is on the ADD_CANDIDATE modal
    When the recruiter selects a .txt file
    Then an error message "Only .pdf and .docx files are supported." is shown
    And the submit button remains enabled (file is optional)

  Scenario: Candidate creation succeeds even if CV upload fails
    Given the recruiter fills in name and email and attaches a PDF
    When the form is submitted and the R2 upload fails
    Then the candidate is still created with status INVITED
    And an error toast indicates the CV upload failed
    And the candidate card appears without a resume indicator

  # NOTE: The R2 presigned URL infrastructure (aws4fetch signing, bucket config,
  # key conventions) is shared with Phase 3's candidate-side media uploads.
  # Phase 2 adds the recruiter-authenticated upload path (Clerk JWT);
  # Phase 3 adds the candidate-authenticated path (session JWT).
  # Both write to the same R2 bucket ("pipe-assets") and candidate_media table.
```

### 2.6b Recruiter publishes pipeline (DRAFT → ACTIVE)

```gherkin
Feature: Publish Pipeline

  Scenario: Publish DRAFT pipeline with stages
    Given the recruiter is on a DRAFT pipeline with 2 stages
    When the recruiter clicks "PUBLISH_PIPELINE"
    Then a PATCH /api/v1/pipelines/:id is sent with { status: "ACTIVE" }
    And the status badge changes from DRAFT to ACTIVE
    And the PUBLISH_PIPELINE button is replaced by ADD_CANDIDATE

  Scenario: Publish blocked when pipeline has no stages
    Given the recruiter is on a DRAFT pipeline with 0 stages
    Then the PUBLISH_PIPELINE button is disabled
    And hovering shows "Add at least 1 stage before publishing"
```

### 2.7 Recruiter views candidate status across stages

```gherkin
Feature: Candidate Status

  Scenario: Candidate moves through stages
    Given candidate "Jane" has currentStageId set to stage 2
    When the recruiter views the overview
    Then Jane's card appears in the stage 2 column
    And her assessment score is the average of all her assessment scores

  Scenario: Drag candidate to different stage
    Given the pipeline is ACTIVE
    When the recruiter drags Jane's card from "Technical Screen" to "Final Round"
    Then a PATCH /api/v1/candidates/:id is sent with { currentStageId: finalRoundId }
    And Jane's card moves to the "Final Round" column
```

### 2.8 Recruiter deletes a stage

```gherkin
Feature: Delete Stage

  Scenario: Delete stage from DRAFT pipeline
    Given a DRAFT pipeline has 3 stages
    When the recruiter clicks the delete button on "Technical Screen"
    And confirms the deletion dialog
    Then a DELETE /api/v1/stages/:stageId is sent
    And the stage and its challenges are cascade-deleted in D1
    And the remaining stages are re-ordered

  Scenario: Cannot delete stage from ACTIVE pipeline
    Given an ACTIVE pipeline
    Then no delete buttons are visible on stage cards
```

### 2.9 Recruiter fetches a GitHub PR for code review challenge

```gherkin
Feature: GitHub PR Fetch

  Scenario: Fetch PR diff for code review challenge
    Given the recruiter is creating a CODE_REVIEW challenge
    When the recruiter enters repo URL "https://github.com/owner/repo" and PR number 42
    Then the Worker fetches the PR from GitHub API
    And returns { success: true, data: { diff: {...}, metadata: {...} } }
    And the diff is cached on the challenge record (cachedDiffJson, cachedMetadata, diffCachedAt)

  Scenario: GitHub API rate limit
    Given the GitHub token is rate-limited
    When the recruiter attempts to fetch a PR
    Then a 429 status is returned with a retry-after header
    And the UI displays "GitHub rate limit exceeded. Try again in X minutes."

  Scenario: Invalid repository URL
    Given the recruiter enters "not-a-url" as the repo URL
    Then a 400 status is returned with message "Invalid GitHub repository URL"
```

---

## 3. Acceptance Criteria

1. **Parity**: All current OverviewPage, StageDetailPage, and ChallengeEditorPage functionality works identically on Cloudflare.
2. **Performance**: OverviewPage loads in a single API round-trip (server-joined data), not N+1 calls.
3. **Auth**: All Worker routes verify Clerk JWT. Unauthorized requests return 401.
4. **Data integrity**: Stage and challenge ordering is atomic (batch update in a single D1 transaction).
5. **GitHub PR fetch**: Works via Worker with server-side GitHub token (never exposed to client).
6. **Drag-and-drop**: Stage reordering (DRAFT pipelines) and candidate movement (ACTIVE pipelines) persist correctly.
7. **Challenge CRUD**: Create, read, update, delete, clone all work for every challenge type (CODE_REVIEW, CODE_IMPLEMENTATION, QUIZ_MCQ, QUIZ_SHORT_ANSWER, FOLLOW_UP).
8. **Email templates**: Stage notification templates (INVITATION, SUCCESS, FAILURE) save and load as JSON.
9. **No Amplify imports**: Zero references to `aws-amplify`, `generateClient`, or `@aws-amplify` in migrated pages.
10. **Type safety**: All API responses have TypeScript types. No `any` in new code.
11. **BDD tests**: All scenarios from Section 2 have passing Playwright tests.
12. **Backward compat**: Existing data migrated from DynamoDB to D1 is accessible without loss.

---

## 4. D1 Schema

All tables use ULIDs as primary keys (sortable, no coordination). Timestamps are ISO 8601 strings stored as TEXT.

> **Schema evolution strategy:** Phase 1 created minimal `stages` and `challenges` tables. Phase 2 extends them via `ALTER TABLE` migrations — **not** `CREATE TABLE` redefinitions which would fail on existing tables or lose data. The SQL below is split into: (a) `ALTER TABLE` statements for existing tables, (b) `CREATE TABLE` statements for new tables only.

```sql
-- ============================================================
-- Phase 2 D1 Schema — migration/sql/0002_recruiter_core.sql
-- Assumes Phase 1 created: pipelines, stages, challenges
-- ============================================================

-- ── Extend existing tables ──────────────────────────────────

-- Add columns to stages (Phase 1 created the table with minimal columns)
ALTER TABLE stages ADD COLUMN owner_id TEXT;
-- Backfill owner_id from pipeline: UPDATE stages SET owner_id = (SELECT clerk_user_id FROM pipelines WHERE pipelines.id = stages.pipeline_id);
ALTER TABLE stages ADD COLUMN video_config TEXT;
ALTER TABLE stages ADD COLUMN scheduling_event_type_id TEXT;
ALTER TABLE stages ADD COLUMN notification_templates TEXT;
-- Note: SQLite ALTER TABLE only supports ADD COLUMN. Renaming sort_order -> "order"
-- requires creating a new table + migrating data. Keep using sort_order from Phase 1
-- and alias as "order" in queries, OR do a full table migration here.

-- Add columns to challenges (Phase 1 created the table with minimal columns)
ALTER TABLE challenges ADD COLUMN owner_id TEXT;
-- Note: code_artifact_id is added AFTER code_artifacts table is created (see below)
ALTER TABLE challenges ADD COLUMN github_repo_url TEXT;
ALTER TABLE challenges ADD COLUMN github_pr_number INTEGER;
ALTER TABLE challenges ADD COLUMN github_pr_title TEXT;
ALTER TABLE challenges ADD COLUMN github_pr_description TEXT;
ALTER TABLE challenges ADD COLUMN cached_diff_json TEXT;
ALTER TABLE challenges ADD COLUMN cached_metadata TEXT;
ALTER TABLE challenges ADD COLUMN diff_cached_at TEXT;
ALTER TABLE challenges ADD COLUMN ground_truth_annotations TEXT;
ALTER TABLE challenges ADD COLUMN ground_truth TEXT;
ALTER TABLE challenges ADD COLUMN practice_repo TEXT;
ALTER TABLE challenges ADD COLUMN pr_number INTEGER;
ALTER TABLE challenges ADD COLUMN feature_branch TEXT;
ALTER TABLE challenges ADD COLUMN base_branch TEXT;
ALTER TABLE challenges ADD COLUMN repo_s3_key TEXT;
ALTER TABLE challenges ADD COLUMN repo_version INTEGER;
ALTER TABLE challenges ADD COLUMN repo_branch TEXT;
ALTER TABLE challenges ADD COLUMN repo_base_branch TEXT;
ALTER TABLE challenges ADD COLUMN repo_metadata_s3_key TEXT;

CREATE INDEX IF NOT EXISTS idx_challenges_practice_repo ON challenges(practice_repo, pr_number);

-- ── New tables ──────────────────────────────────────────────

-- Candidates belong to a pipeline.
CREATE TABLE candidates (
  id              TEXT PRIMARY KEY,          -- ULID
  pipeline_id     TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  owner_id        TEXT NOT NULL,             -- Clerk user ID (denormalized for auth)
  title           TEXT NOT NULL,
  description     TEXT,
  "order"         INTEGER NOT NULL DEFAULT 0,
  time_limit      INTEGER,                   -- Minutes, NULL = untimed
  mode            TEXT NOT NULL DEFAULT 'ASYNC' CHECK (mode IN ('ASYNC', 'LIVE_VIDEO')),
  video_config    TEXT,                       -- JSON: { recordingEnabled: boolean }
  scheduling_event_type_id TEXT,
  notification_templates   TEXT,              -- JSON array: [{ trigger, subject, body }]
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_stages_pipeline ON stages(pipeline_id, "order");

-- Challenges belong to a stage. Ordered by `order` column.
CREATE TABLE challenges (
  id                    TEXT PRIMARY KEY,    -- ULID
  stage_id              TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  owner_id              TEXT NOT NULL,       -- Clerk user ID
  type                  TEXT NOT NULL CHECK (type IN (
                          'CODE_REVIEW', 'CODE_IMPLEMENTATION',
                          'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER', 'FOLLOW_UP'
                        )),
  "order"               INTEGER NOT NULL DEFAULT 0,
  title                 TEXT NOT NULL,
  instructions          TEXT,
  config                TEXT,                -- JSON: public challenge-specific settings
  server_config         TEXT,                -- JSON: private answer keys, scoring rubrics

  -- Code artifact link (optional)
  code_artifact_id      TEXT REFERENCES code_artifacts(id) ON DELETE SET NULL,

  -- GitHub PR fields (CODE_REVIEW)
  github_repo_url       TEXT,
  github_pr_number      INTEGER,
  github_pr_title       TEXT,
  github_pr_description TEXT,
  cached_diff_json      TEXT,                -- JSON: structured diff
  cached_metadata       TEXT,                -- JSON: PR metadata snapshot
  diff_cached_at        TEXT,                -- ISO 8601

  -- Ground truth (owner-only, scoring)
  ground_truth_annotations TEXT,             -- JSON
  ground_truth             TEXT,             -- JSON (newer format)

  -- Practice repo fields
  practice_repo         TEXT,
  pr_number             INTEGER,
  feature_branch        TEXT,
  base_branch           TEXT,

  -- Repo-backed fields
  repo_s3_key           TEXT,
  repo_version          INTEGER,
  repo_branch           TEXT,
  repo_base_branch      TEXT,
  repo_metadata_s3_key  TEXT,

  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_challenges_stage ON challenges(stage_id, "order");
CREATE INDEX idx_challenges_practice_repo ON challenges(practice_repo, pr_number);

-- Candidates belong to a pipeline.
CREATE TABLE candidates (
  id                  TEXT PRIMARY KEY,      -- ULID
  pipeline_id         TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  owner_id            TEXT NOT NULL,         -- Clerk user ID
  name                TEXT,
  email               TEXT,
  invite_token        TEXT NOT NULL UNIQUE,  -- UUID, used in /assess/:token URL
  status              TEXT NOT NULL DEFAULT 'INVITED' CHECK (status IN ('INVITED', 'IN_PROGRESS', 'COMPLETED')),
  current_stage_id    TEXT REFERENCES stages(id) ON DELETE SET NULL,

  -- CV / Profile
  skills              TEXT,                  -- JSON array of strings
  years_of_experience INTEGER,
  current_role        TEXT,
  education           TEXT,                  -- JSON array of strings
  resume_s3_key       TEXT,                  -- Deprecated: use candidate_media

  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_candidates_pipeline ON candidates(pipeline_id);
CREATE INDEX idx_candidates_email ON candidates(email);
CREATE UNIQUE INDEX idx_candidates_invite_token ON candidates(invite_token);

-- Assessments: one per candidate per stage.
CREATE TABLE assessments (
  id                TEXT PRIMARY KEY,        -- ULID
  candidate_id      TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  stage_id          TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  owner_id          TEXT NOT NULL,           -- Clerk user ID
  status            TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'REVIEWED')),
  score             REAL,                    -- 0-100, aggregate
  feedback          TEXT,
  started_at        TEXT,
  completed_at      TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_assessments_candidate_stage ON assessments(candidate_id, stage_id);

-- Challenge submissions: one per assessment per challenge.
CREATE TABLE challenge_submissions (
  id                      TEXT PRIMARY KEY,  -- ULID
  assessment_id           TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  challenge_id            TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
  owner_id                TEXT NOT NULL,     -- Clerk user ID
  submission              TEXT,              -- JSON: candidate's answers
  score                   REAL,              -- 0-100
  feedback                TEXT,
  submitted_at            TEXT,
  scored_at               TEXT,

  -- CODE_REVIEW specific
  code_review_annotations TEXT,              -- JSON array
  code_review_summary     TEXT,

  -- Follow-up
  follow_up_questions_json TEXT,             -- JSON

  created_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_submissions_assessment ON challenge_submissions(assessment_id, challenge_id);

-- Code artifacts: shared code snippets linked to pipelines.
CREATE TABLE code_artifacts (
  id            TEXT PRIMARY KEY,            -- ULID
  pipeline_id   TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  owner_id      TEXT NOT NULL,
  title         TEXT,
  language      TEXT,
  code          TEXT,
  ground_truth  TEXT,                        -- JSON (legacy)
  server_config TEXT,                        -- JSON (private)
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_code_artifacts_pipeline ON code_artifacts(pipeline_id);

-- Now that code_artifacts exists, add the FK column to challenges
ALTER TABLE challenges ADD COLUMN code_artifact_id TEXT REFERENCES code_artifacts(id) ON DELETE SET NULL;

-- Scheduled interviews
CREATE TABLE scheduled_interviews (
  id                    TEXT PRIMARY KEY,    -- ULID
  candidate_id          TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  pipeline_id           TEXT NOT NULL REFERENCES pipelines(id) ON DELETE CASCADE,
  stage_id              TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  owner_id              TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'INVITED' CHECK (status IN (
                          'INVITED', 'SCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW'
                        )),
  scheduled_at          TEXT,
  meeting_url           TEXT,
  scheduling_provider   TEXT CHECK (scheduling_provider IN ('CALENDLY', 'CAL_COM', 'MANUAL')),
  scheduling_url        TEXT,
  external_event_id     TEXT,
  recruiter_notes       TEXT,
  sync_source           TEXT CHECK (sync_source IN ('MANUAL', 'WEBHOOK')),
  last_synced_at        TEXT,
  invite_link_sent_at   TEXT,
  email_sent_at         TEXT,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_interviews_pipeline ON scheduled_interviews(pipeline_id);
CREATE INDEX idx_interviews_external_event ON scheduled_interviews(external_event_id);
CREATE INDEX idx_interviews_candidate_status ON scheduled_interviews(candidate_id, status);

-- Candidate media: resumes, recordings, attachments.
CREATE TABLE candidate_media (
  id            TEXT PRIMARY KEY,            -- ULID
  candidate_id  TEXT NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  owner_id      TEXT NOT NULL,
  type          TEXT NOT NULL CHECK (type IN ('RESUME', 'VIDEO_RECORDING', 'AUDIO_RECORDING', 'ATTACHMENT')),
  s3_key        TEXT NOT NULL,               -- R2 object key
  filename      TEXT NOT NULL,
  mime_type     TEXT,
  stage_id      TEXT REFERENCES stages(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX idx_candidate_media_candidate ON candidate_media(candidate_id);

-- Trigger-like update for updated_at (D1 does not support triggers;
-- Workers must set updated_at explicitly on every UPDATE).
```

---

## 5. Workers API Routes

All routes are prefixed with `/api/v1`. All recruiter routes require Clerk JWT in `Authorization: Bearer <token>` header.

### Middleware

```typescript
// workers/src/middleware/auth.ts
import { Hono } from 'hono';
import { verifyClerkJwt } from '../lib/clerk';

export function clerkAuth(): MiddlewareHandler {
  return async (c, next) => {
    const header = c.req.header('Authorization');
    if (!header?.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized' }, 401);
    }
    const token = header.slice(7);
    const claims = await verifyClerkJwt(token, c.env.CLERK_PUBLISHABLE_KEY);
    if (!claims) {
      return c.json({ error: 'Invalid token' }, 401);
    }
    c.set('userId', claims.sub);
    await next();
  };
}
```

### Route table

| Method | Route | Description | D1 Query |
|--------|-------|-------------|----------|
| **Stages** | | | |
| `GET` | `/pipelines/:pipelineId/overview` | Full overview data (pipeline + stages + candidates + scores + interviews) | Single joined query |
| `POST` | `/pipelines/:pipelineId/stages` | Create stage | INSERT into stages |
| `PATCH` | `/pipelines/:pipelineId/stages/reorder` | Batch reorder stages | Transaction: UPDATE order for each |
| `GET` | `/stages/:stageId` | Stage detail with challenges | JOIN stages + challenges |
| `PATCH` | `/stages/:stageId` | Update stage (title, timeLimit, mode, templates) | UPDATE stages |
| `DELETE` | `/stages/:stageId` | Delete stage (cascade challenges) | DELETE with CASCADE |
| **Challenges** | | | |
| `POST` | `/stages/:stageId/challenges` | Create challenge | INSERT into challenges |
| `PATCH` | `/stages/:stageId/challenges/reorder` | Batch reorder challenges | Transaction: UPDATE order for each |
| `GET` | `/challenges/:challengeId` | Get challenge for editor | SELECT from challenges |
| `PUT` | `/challenges/:challengeId` | Full update challenge | UPDATE challenges |
| `DELETE` | `/challenges/:challengeId` | Delete challenge | DELETE |
| `POST` | `/challenges/:challengeId/clone` | Clone challenge | INSERT (copy of source) |
| **Pipelines** | | | |
| `PATCH` | `/pipelines/:pipelineId` | Update pipeline (status, title) | UPDATE pipelines |
| **Candidates** | | | |
| `POST` | `/pipelines/:pipelineId/candidates` | Create candidate with invite token | INSERT into candidates |
| `PATCH` | `/candidates/:candidateId` | Update candidate (currentStageId, status) | UPDATE candidates |
| `POST` | `/candidates/:candidateId/reset` | Reset candidate (unclaim token, delete submissions) | Transaction |
| **Candidate Media (R2)** | | | |
| `POST` | `/candidates/:candidateId/media/upload-url` | Generate R2 presigned PUT URL (recruiter auth, `aws4fetch` signing) | R2 presigned PUT to `pipe-assets` bucket |
| `POST` | `/candidates/:candidateId/media` | Create candidate_media record after successful upload | INSERT into candidate_media |
| `GET` | `/candidates/:candidateId/media` | List media for a candidate | SELECT from candidate_media |
| `POST` | `/candidates/:candidateId/media/:mediaId/download-url` | Generate R2 presigned GET URL for playback/download | R2 presigned GET |
| | | *Note: Phase 3 adds `/rpc/generate-upload-url` (candidate auth) and `/rpc/get-media-url` (recruiter auth) using the same R2 bucket and signing infrastructure. See `phase-3-candidate-flow.md` §7.* | |
| **GitHub** | | | |
| `POST` | `/github/pr` | Fetch GitHub PR diff + metadata | External GitHub API call |
| `POST` | `/github/prs` | List PRs for a repository | External GitHub API call |
| **Interviews** | | | |
| `POST` | `/pipelines/:pipelineId/interviews` | Create scheduled interview | INSERT into scheduled_interviews |
| `GET` | `/pipelines/:pipelineId/interviews` | List interviews for pipeline | SELECT from scheduled_interviews |

### Overview route (the big join)

```typescript
// workers/src/routes/overview.ts
// Replaces ~20 individual Amplify calls with a single Worker response.

app.get('/api/v1/pipelines/:pipelineId/overview', clerkAuth(), async (c) => {
  const userId = c.get('userId');
  const { pipelineId } = c.req.param();

  const db = c.env.DB;

  // 1. Pipeline (with ownership check)
  const pipeline = await db
    .prepare('SELECT * FROM pipelines WHERE id = ? AND owner_id = ?')
    .bind(pipelineId, userId)
    .first();

  if (!pipeline) return c.json({ error: 'Pipeline not found' }, 404);

  // 2. Stages with challenge counts
  const stages = await db
    .prepare(`
      SELECT s.*,
        (SELECT COUNT(*) FROM challenges c WHERE c.stage_id = s.id) AS challenge_count
      FROM stages s
      WHERE s.pipeline_id = ?
      ORDER BY s."order" ASC
    `)
    .bind(pipelineId)
    .all();

  // 3. Candidates with average assessment score
  const candidates = await db
    .prepare(`
      SELECT
        cand.*,
        (SELECT AVG(a.score) FROM assessments a WHERE a.candidate_id = cand.id AND a.score IS NOT NULL) AS avg_score
      FROM candidates cand
      WHERE cand.pipeline_id = ?
      ORDER BY cand.created_at ASC
    `)
    .bind(pipelineId)
    .all();

  // 4. Upcoming interviews
  const interviews = await db
    .prepare(`
      SELECT * FROM scheduled_interviews
      WHERE pipeline_id = ? AND status IN ('SCHEDULED', 'INVITED')
      ORDER BY scheduled_at ASC
    `)
    .bind(pipelineId)
    .all();

  return c.json({
    pipeline,
    stages: stages.results,
    candidates: candidates.results.map((cand: Record<string, unknown>) => ({
      ...cand,
      score: cand.avg_score != null ? Math.round(cand.avg_score as number) : null,
      skills: cand.skills ? JSON.parse(cand.skills as string) : [],
      education: cand.education ? JSON.parse(cand.education as string) : [],
    })),
    interviews: interviews.results,
  });
});
```

### Stage reorder (transactional)

```typescript
app.patch('/api/v1/pipelines/:pipelineId/stages/reorder', clerkAuth(), async (c) => {
  const userId = c.get('userId');
  const { pipelineId } = c.req.param();
  const body = await c.req.json<{ stages: { id: string; order: number }[] }>();

  const db = c.env.DB;

  // Ownership check
  const pipeline = await db
    .prepare('SELECT id FROM pipelines WHERE id = ? AND owner_id = ?')
    .bind(pipelineId, userId)
    .first();
  if (!pipeline) return c.json({ error: 'Pipeline not found' }, 404);

  // Batch update in transaction
  const stmts = body.stages.map((s) =>
    db
      .prepare('UPDATE stages SET "order" = ?, updated_at = ? WHERE id = ? AND pipeline_id = ?')
      .bind(s.order, new Date().toISOString(), s.id, pipelineId)
  );

  await db.batch(stmts);
  return c.json({ success: true });
});
```

### Challenge CRUD

```typescript
// POST /api/v1/stages/:stageId/challenges
app.post('/api/v1/stages/:stageId/challenges', clerkAuth(), async (c) => {
  const userId = c.get('userId');
  const { stageId } = c.req.param();
  const body = await c.req.json<CreateChallengeInput>();

  const db = c.env.DB;

  // Verify stage ownership through pipeline chain
  const stage = await db
    .prepare(`
      SELECT s.id, s.pipeline_id FROM stages s
      JOIN pipelines p ON p.id = s.pipeline_id
      WHERE s.id = ? AND p.owner_id = ?
    `)
    .bind(stageId, userId)
    .first();
  if (!stage) return c.json({ error: 'Stage not found' }, 404);

  const id = generateUlid();
  const now = new Date().toISOString();

  await db
    .prepare(`
      INSERT INTO challenges (
        id, stage_id, owner_id, type, "order", title, instructions,
        config, server_config, github_repo_url, github_pr_number,
        github_pr_title, github_pr_description, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .bind(
      id, stageId, userId, body.type, body.order ?? 0, body.title,
      body.instructions ?? null,
      body.config ? JSON.stringify(body.config) : null,
      body.serverConfig ? JSON.stringify(body.serverConfig) : null,
      body.githubRepoUrl ?? null, body.githubPrNumber ?? null,
      body.githubPrTitle ?? null, body.githubPrDescription ?? null,
      now, now
    )
    .run();

  return c.json({ id, stageId, type: body.type, title: body.title }, 201);
});
```

### GitHub PR fetch

```typescript
// POST /api/v1/github/pr
app.post('/api/v1/github/pr', clerkAuth(), async (c) => {
  const { repoUrl, prNumber, skipCache } = await c.req.json<{
    repoUrl: string;
    prNumber: number;
    skipCache?: boolean;
  }>();

  // Validate repo URL
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) return c.json({ error: 'Invalid GitHub repository URL' }, 400);
  const [, owner, repo] = match;

  const ghToken = c.env.GITHUB_TOKEN;
  if (!ghToken) return c.json({ error: 'GitHub integration not configured' }, 500);

  // Fetch PR metadata
  const prRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `token ${ghToken}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'pipe-workers',
    },
  });

  if (prRes.status === 403) {
    const retryAfter = prRes.headers.get('retry-after');
    return c.json(
      { error: 'GitHub rate limit exceeded', retryAfter },
      429
    );
  }
  if (!prRes.ok) return c.json({ error: `GitHub API error: ${prRes.status}` }, 502);

  const prData = await prRes.json();

  // Fetch diff
  const diffRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${prNumber}`, {
    headers: {
      Authorization: `token ${ghToken}`,
      Accept: 'application/vnd.github.v3.diff',
      'User-Agent': 'pipe-workers',
    },
  });
  const rawDiff = await diffRes.text();

  // Parse diff into structured format
  const diff = parseDiffToStructured(rawDiff);

  const metadata = {
    author: prData.user?.login,
    avatar: prData.user?.avatar_url,
    createdAt: prData.created_at,
    state: prData.state,
    labels: prData.labels?.map((l: { name: string }) => l.name) ?? [],
    reviewers: prData.requested_reviewers?.map((r: { login: string }) => r.login) ?? [],
    title: prData.title,
    description: prData.body,
  };

  return c.json({
    success: true,
    data: { diff, metadata },
  });
});
```

---

## 5b. R2 Storage: S3 → R2 Migration

Phase 2 introduces the first R2 usage (recruiter CV upload). This establishes the shared infrastructure that Phase 3 extends for candidate-side video/audio/resume uploads.

### What moves

| Amplify (S3) | Cloudflare (R2) |
|---|---|
| `pipeAssets` S3 bucket | `pipe-assets` R2 bucket |
| `useStorage().upload()` (Amplify SDK) | Presigned R2 PUT URL via Worker route |
| `getUrl()` (Amplify SDK) | Presigned R2 GET URL via Worker route |
| `generateMediaUploadUrl` Lambda | `POST /api/v1/candidates/:id/media/upload-url` (Phase 2, Clerk auth) |
| | `POST /rpc/generate-upload-url` (Phase 3, candidate session JWT auth) |
| DynamoDB `CandidateMedia` model | D1 `candidate_media` table (Section 4) |
| S3 path: `candidate-documents/{candidateId}/{filename}` | R2 key: `candidate-documents/{candidateId}/{ulid}.{ext}` |
| S3 path: `candidate-recordings/{candidateId}/{stageId}.webm` | R2 key: `candidate-submissions/{candidateId}/{ulid}.webm` (Phase 3) |

### R2 key conventions (from ADR-022 + PLAN.md)

```
candidate-documents/{candidateId}/{ulid}.pdf      RESUME, ATTACHMENT (recruiter upload)
candidate-submissions/{candidateId}/{ulid}.webm   VIDEO_RECORDING, AUDIO_RECORDING (Phase 3)
```

- Keys use **opaque ULIDs**, not filenames or internal IDs (security: presigned URLs expose the key path)
- Original filename is stored in the `candidate_media.filename` column, not in the R2 key
- All media types share the `pipe-assets` bucket

### Presigned URL signing (shared infrastructure)

Both Phase 2 (recruiter auth) and Phase 3 (candidate auth) use `aws4fetch` to sign R2 requests:

```typescript
import { AwsClient } from 'aws4fetch';

const r2 = new AwsClient({
  accessKeyId: c.env.R2_ACCESS_KEY_ID,
  secretAccessKey: c.env.R2_SECRET_ACCESS_KEY,
});

// Generate presigned PUT URL (5-minute expiry)
const url = new URL(`/${c.env.R2_BUCKET_NAME}/${r2Key}`,
  `https://${c.env.CF_ACCOUNT_ID}.r2.cloudflarestorage.com`);
url.searchParams.set('X-Amz-Expires', '300');
const signed = await r2.sign(new Request(url, { method: 'PUT' }), { aws: { signQuery: true } });
```

### Wrangler bindings required

```jsonc
// wrangler.jsonc
{
  "r2_buckets": [{ "binding": "R2_BUCKET", "bucket_name": "pipe-assets" }]
}
// Secrets (via wrangler secret put):
// R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, CF_ACCOUNT_ID
```

### Upload flow (recruiter-side, Phase 2)

1. Frontend calls `POST /api/v1/candidates/:id/media/upload-url` with `{ filename, mimeType, mediaType }`
2. Worker validates Clerk JWT, generates ULID key, signs R2 PUT URL, creates `candidate_media` record with status `PENDING`
3. Frontend PUTs file directly to the presigned R2 URL
4. Frontend calls `POST /api/v1/candidates/:id/media` to confirm upload → status changes to `UPLOADED`
5. (Optional) Worker triggers CV parsing for `RESUME` type

### Data migration: S3 → R2

Existing S3 objects under `candidate-documents/` and `candidate-recordings/` need to be copied to R2. R2 is S3-compatible, so `aws s3 sync` or `rclone` works directly. DynamoDB `CandidateMedia` records migrate to D1 `candidate_media` with `s3_key` values unchanged (same key convention).

---

## 6. Task List

### 6.1 D1 Schema & Migrations

- [ ] **T2-01**: Write D1 migration `0002_phase2_tables.sql` with all tables from Section 4
- [ ] **T2-02**: Write seed script for dev environment (sample pipeline with stages, challenges, candidates)
- [ ] **T2-03**: Write DynamoDB-to-D1 migration script for existing data (Stage, Challenge, Candidate, Assessment, ChallengeSubmission, CodeArtifact, ScheduledInterview, CandidateMedia)

### 6.2 Worker Routes

- [x] **T2-04**: Implement `GET /pipelines/:pipelineId/overview` (the big join route)
- [x] **T2-05**: Implement `POST /pipelines/:pipelineId/stages` (create stage)
- [x] **T2-06**: Implement `PATCH /pipelines/:pipelineId/stages/reorder` (batch reorder)
- [x] **T2-07**: Implement `GET /stages/:stageId` (stage detail with challenges)
- [ ] **T2-08**: Implement `PATCH /stages/:stageId` (update stage settings)
- [x] **T2-09**: Implement `DELETE /stages/:stageId` (cascade delete)
- [x] **T2-10**: Implement `POST /stages/:stageId/challenges` (create challenge)
- [ ] **T2-11**: Implement `PATCH /stages/:stageId/challenges/reorder` (batch reorder)
- [x] **T2-12**: Implement `GET /challenges/:challengeId` (editor fetch)
- [x] **T2-13**: Implement `PUT /challenges/:challengeId` (full update)
- [ ] **T2-14**: Implement `DELETE /challenges/:challengeId`
- [x] **T2-15**: Implement `POST /challenges/:challengeId/clone`
- [x] **T2-16**: Implement `POST /pipelines/:pipelineId/candidates` (create with invite token)
- [x] **T2-17**: Implement `PATCH /candidates/:candidateId` (move stage, update status)
- [ ] **T2-18**: Implement `POST /candidates/:candidateId/reset` (transactional reset)
- [x] **T2-19**: Implement `POST /github/pr` (fetch PR diff + metadata)
- [ ] **T2-20**: Implement `POST /github/prs` (list PRs)
- [ ] **T2-21**: Implement `POST /pipelines/:pipelineId/interviews` (create scheduled interview)
- [ ] **T2-22**: Implement `GET /pipelines/:pipelineId/interviews` (list interviews)
- [x] **T2-22b**: Implement `PATCH /pipelines/:pipelineId` (update status/title, DRAFT→ACTIVE requires ≥1 stage)
- [ ] **T2-23a**: Create R2 bucket `pipe-assets` + configure `aws4fetch` signing in Worker
- [ ] **T2-23b**: Implement `POST /candidates/:candidateId/media/upload-url` (R2 presigned PUT URL, Clerk auth)
- [ ] **T2-23c**: Implement `POST /candidates/:candidateId/media` (confirm upload, create candidate_media record)
- [ ] **T2-23d**: Implement `GET /candidates/:candidateId/media` (list candidate media)
- [ ] **T2-23e**: Implement `POST /candidates/:candidateId/media/:mediaId/download-url` (R2 presigned GET URL)
- [ ] **T2-23f**: Add R2 secrets to wrangler config (`R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `CF_ACCOUNT_ID`)

### 6.3 Frontend Hooks (Provider Abstraction)

- [x] **T2-23**: Create `useOverviewData(pipelineId)` hook calling `/pipelines/:id/overview`
- [x] **T2-24**: Create `useStageDetail(stageId)` hook calling `/stages/:id`
- [x] **T2-25**: Create `useEditorChallengeV2(challengeId)` hook replacing `useEditorChallenge.ts`
- [x] **T2-26**: Create `useStageMutations()` hook (create, reorder, update, delete)
- [x] **T2-27**: Create `useChallengeMutations()` hook (create, reorder, update, delete, clone)
- [x] **T2-28**: Create `useCandidateMutations()` hook (create, move, reset)
- [ ] **T2-29**: Create `useGitHubPR()` hook (fetch PR, list PRs)
- [ ] **T2-30**: Create `useInterviews(pipelineId)` hook

### 6.4 Page Migration

- [x] **T2-31**: Migrate `OverviewPage.tsx` to use `useOverviewData` + mutation hooks
- [x] **T2-32**: Migrate `StageDetailPage.tsx` to use `useStageDetail` + mutation hooks
- [x] **T2-33**: Migrate `ChallengeEditorPage.tsx` to use `useEditorChallengeV2`
- [ ] **T2-34**: Migrate `CandidateIntakeModal.tsx` to use `useCandidateMutations`
- [ ] **T2-34b**: Migrate CV upload in `CandidateIntakeModal.tsx` from Amplify `useStorage` to R2 presigned URL flow
- [ ] **T2-35**: Remove all `generateClient<Schema>()` calls from migrated files

### 6.5 Type Definitions

- [ ] **T2-36**: Define shared API types in `workers/src/types/`:
  ```typescript
  // workers/src/types/stage.ts
  export interface Stage {
    id: string;
    pipelineId: string;
    title: string;
    description: string | null;
    order: number;
    timeLimit: number | null;
    mode: 'ASYNC' | 'LIVE_VIDEO';
    videoConfig: Record<string, unknown> | null;
    schedulingEventTypeId: string | null;
    notificationTemplates: NotificationTemplate[];
    challengeCount?: number;
    createdAt: string;
    updatedAt: string;
  }

  export interface NotificationTemplate {
    trigger: 'INVITATION' | 'SUCCESS' | 'FAILURE';
    subject: string;
    body: string;
  }

  // workers/src/types/challenge.ts
  export type ChallengeType =
    | 'CODE_REVIEW'
    | 'CODE_IMPLEMENTATION'
    | 'QUIZ_MCQ'
    | 'QUIZ_SHORT_ANSWER'
    | 'FOLLOW_UP';

  export interface Challenge {
    id: string;
    stageId: string;
    type: ChallengeType;
    order: number;
    title: string;
    instructions: string | null;
    config: Record<string, unknown> | null;
    serverConfig: Record<string, unknown> | null;
    githubRepoUrl: string | null;
    githubPrNumber: number | null;
    githubPrTitle: string | null;
    githubPrDescription: string | null;
    cachedDiffJson: unknown | null;
    cachedMetadata: unknown | null;
    diffCachedAt: string | null;
    groundTruthAnnotations: unknown | null;
    createdAt: string;
    updatedAt: string;
  }

  export interface CreateChallengeInput {
    type: ChallengeType;
    title: string;
    order?: number;
    instructions?: string;
    config?: Record<string, unknown>;
    serverConfig?: Record<string, unknown>;
    githubRepoUrl?: string;
    githubPrNumber?: number;
    githubPrTitle?: string;
    githubPrDescription?: string;
  }

  // workers/src/types/candidate.ts
  export interface Candidate {
    id: string;
    pipelineId: string;
    name: string | null;
    email: string | null;
    inviteToken: string;
    status: 'INVITED' | 'IN_PROGRESS' | 'COMPLETED';
    currentStageId: string | null;
    score: number | null;      // Computed, not stored
    skills: string[];
    yearsOfExperience: number | null;
    currentRole: string | null;
    education: string[];
    createdAt: string;
    updatedAt: string;
  }

  // workers/src/types/overview.ts
  export interface OverviewResponse {
    pipeline: Pipeline;
    stages: (Stage & { challengeCount: number })[];
    candidates: Candidate[];
    interviews: ScheduledInterview[];
  }
  ```

- [ ] **T2-37**: Copy shared types to `src/types/api/` for frontend consumption

---

## 7. BDD Test Specifications

All tests use Playwright. Tests run against the Cloudflare Workers dev server (`wrangler dev`) with a seeded D1 database.

### 7.1 Overview Page Tests

```typescript
// e2e/overview-page.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Pipeline Overview', () => {
  test.beforeEach(async ({ page }) => {
    // Authenticate via Clerk test session
    await page.goto('/');
    await clerkLogin(page);
  });

  test('displays pipeline with stages and candidates', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id');
    await expect(page.getByText('PIPELINE_OVERVIEW')).toBeVisible();
    await expect(page.getByText('Senior Frontend Engineer')).toBeVisible();

    // Verify stage columns
    const stageCards = page.getByTestId('stage-card');
    await expect(stageCards).toHaveCount(2);

    // Verify candidates in correct stage
    await expect(page.getByText('JANE DOE')).toBeVisible();
    await expect(page.getByText('jane@example.com')).toBeVisible();
  });

  test('adds a new stage to DRAFT pipeline', async ({ page }) => {
    await page.goto('/pipeline/draft-pipeline-id');
    page.on('dialog', (dialog) => dialog.accept('New Stage'));
    await page.getByText('ADD_STAGE').click();
    await expect(page.getByText('NEW STAGE')).toBeVisible();
  });

  test('reorders stages via drag-and-drop', async ({ page }) => {
    await page.goto('/pipeline/draft-pipeline-id');

    const stages = page.getByTestId('stage-card');
    const firstStage = stages.nth(0);
    const lastStage = stages.nth(2);

    // Drag last stage to first position
    await lastStage.dragTo(firstStage);

    // Verify new order persisted
    await page.reload();
    const reorderedStages = page.getByTestId('stage-card');
    await expect(reorderedStages.nth(0)).toContainText('Final');
  });

  test('copies candidate invite link', async ({ page }) => {
    await page.goto('/pipeline/active-pipeline-id');

    const copyButton = page.getByTitle('Copy assessment link').first();
    await copyButton.click();

    // Clipboard check
    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('/assess/');
  });

  test('deletes stage from DRAFT pipeline', async ({ page }) => {
    await page.goto('/pipeline/draft-pipeline-id');

    const stageCount = await page.getByTestId('stage-card').count();
    page.on('dialog', (dialog) => dialog.accept());

    await page.getByTitle('Delete this stage').first().click();

    await expect(page.getByTestId('stage-card')).toHaveCount(stageCount - 1);
  });

  test('moves candidate between stages via drag-and-drop', async ({ page }) => {
    await page.goto('/pipeline/active-pipeline-id');

    const janeDoe = page.getByText('JANE DOE');
    const finalRoundColumn = page.getByText('FINAL ROUND').locator('..');

    await janeDoe.dragTo(finalRoundColumn);

    // Verify candidate moved
    await page.reload();
    // Jane should now be in the Final Round column
  });

  test('publishes DRAFT pipeline and shows ADD_CANDIDATE', async ({ page }) => {
    await page.goto('/pipeline/draft-pipeline-id');

    await expect(page.getByTestId('pipeline-status-badge')).toContainText('DRAFT');
    await page.getByText('PUBLISH_PIPELINE').click();

    await expect(page.getByTestId('pipeline-status-badge')).toContainText('ACTIVE');
    await expect(page.getByText('PUBLISH_PIPELINE')).not.toBeVisible();
    await expect(page.getByText('ADD_CANDIDATE')).toBeVisible();
  });

  test('uploads CV during candidate creation', async ({ page }) => {
    await page.goto('/pipeline/active-pipeline-id');
    await page.getByText('ADD_CANDIDATE').click();

    // Fill in basic info
    await page.locator('input[placeholder="E.g. John Doe"]').fill('Jane Doe');
    await page.locator('input[placeholder="john@example.com"]').fill('jane@example.com');

    // Upload a PDF file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'jane-resume.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('fake pdf content'),
    });

    await expect(page.getByText('jane-resume.pdf')).toBeVisible();

    await page.getByText('INITIATE_INTAKE').click();

    // Candidate should be created
    await expect(page.getByText('JANE DOE')).toBeVisible({ timeout: 10_000 });
  });

  test('rejects invalid file types for CV upload', async ({ page }) => {
    await page.goto('/pipeline/active-pipeline-id');
    await page.getByText('ADD_CANDIDATE').click();

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a resume'),
    });

    await expect(page.getByText('Only .pdf and .docx files are supported.')).toBeVisible();
  });
});
```

### 7.2 Stage Detail Tests

```typescript
// e2e/stage-detail.spec.ts
test.describe('Stage Detail', () => {
  test('displays challenges in order', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id/stages/test-stage-id');

    await expect(page.getByText('CHALLENGES')).toBeVisible();
    const challengeCards = page.locator('[data-testid="challenge-card"]');
    await expect(challengeCards).toHaveCount(3);
  });

  test('adds challenge from library', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id/stages/test-stage-id');
    await page.getByText('ADD_CHALLENGE').click();

    // Select from library
    await page.getByText('CODE_IMPLEMENTATION').first().click();
    await page.getByText('SELECT').click();

    // New challenge appears
    await expect(page.locator('[data-testid="challenge-card"]')).toHaveCount(4);
  });

  test('reorders challenges via drag-and-drop', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id/stages/test-stage-id');

    const challenges = page.locator('[data-testid="challenge-card"]');
    const first = challenges.nth(0);
    const last = challenges.nth(2);

    await last.dragTo(first);

    // Verify order update was sent
    await page.reload();
    // Verify new order
  });

  test('updates stage settings (time limit, mode)', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id/stages/test-stage-id');

    // Set time limit
    const timeLimitInput = page.getByPlaceholder('Untimed');
    await timeLimitInput.fill('45');

    // Verify persisted
    await page.reload();
    await expect(page.getByPlaceholder('Untimed')).toHaveValue('45');
  });

  test('saves email notification template', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id/stages/test-stage-id');

    await page.getByText('INVITATION').click();
    await page.locator('input[placeholder]').last().fill('Welcome to the assessment');
    await page.getByText('SAVE_TEMPLATE').click();

    // Green dot should appear
    await expect(page.locator('text=INVITATION').locator('..').getByText('\u25CF')).toBeVisible();
  });
});
```

### 7.3 Challenge Editor Tests

```typescript
// e2e/challenge-editor.spec.ts
test.describe('Challenge Editor', () => {
  test('loads existing CODE_IMPLEMENTATION challenge', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id/challenges/test-challenge-id');

    await expect(page.getByText('Binary Search')).toBeVisible();
    // Editor should show starter code
  });

  test('saves challenge with updated title and config', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id/challenges/test-challenge-id');

    // Update title
    const titleInput = page.locator('input[value="Binary Search"]');
    await titleInput.fill('Binary Search v2');
    await page.getByText('SAVE').click();

    // Verify save succeeded
    await page.reload();
    await expect(page.locator('input')).toHaveValue('Binary Search v2');
  });

  test('clones challenge', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id/challenges/test-challenge-id');
    await page.getByText('CLONE').click();

    // Should navigate to new challenge
    await expect(page.url()).not.toContain('test-challenge-id');
    await expect(page.getByDisplayValue(/Clone/)).toBeVisible();
  });

  test('creates new challenge from NEW_ prefix', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id/challenges/NEW_CODE_IMPLEMENTATION');

    // Blank editor with starter template
    await expect(page.getByText('New code implementation')).toBeVisible();

    // Save creates a new record
    await page.getByText('SAVE').click();

    // URL should change to real challenge ID
    await expect(page.url()).not.toContain('NEW_');
  });

  test('fetches GitHub PR for CODE_REVIEW challenge', async ({ page }) => {
    await page.goto('/pipeline/test-pipeline-id/challenges/code-review-challenge-id');

    // Should show cached PR data
    await expect(page.getByText('PR #42')).toBeVisible();
  });
});
```

### 7.4 API Route Tests (Worker-level)

```typescript
// workers/test/routes/overview.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestApp, seedTestData, getAuthHeaders } from '../helpers';

describe('GET /api/v1/pipelines/:id/overview', () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(async () => {
    app = createTestApp();
    await seedTestData(app.db);
  });

  it('returns pipeline with stages, candidates, and interviews', async () => {
    const res = await app.fetch('/api/v1/pipelines/test-pipeline-id/overview', {
      headers: getAuthHeaders('recruiter-user-id'),
    });

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.pipeline.title).toBe('Senior Frontend Engineer');
    expect(body.stages).toHaveLength(2);
    expect(body.stages[0].challengeCount).toBeGreaterThanOrEqual(0);
    expect(body.candidates).toHaveLength(3);
    expect(body.candidates[0]).toHaveProperty('score');
    expect(body.candidates[0]).toHaveProperty('inviteToken');
  });

  it('returns 401 without auth header', async () => {
    const res = await app.fetch('/api/v1/pipelines/test-pipeline-id/overview');
    expect(res.status).toBe(401);
  });

  it('returns 404 for pipeline owned by another user', async () => {
    const res = await app.fetch('/api/v1/pipelines/test-pipeline-id/overview', {
      headers: getAuthHeaders('other-user-id'),
    });
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/v1/pipelines/:id/stages/reorder', () => {
  it('atomically reorders stages', async () => {
    const res = await app.fetch('/api/v1/pipelines/test-pipeline-id/stages/reorder', {
      method: 'PATCH',
      headers: {
        ...getAuthHeaders('recruiter-user-id'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        stages: [
          { id: 'stage-2', order: 0 },
          { id: 'stage-1', order: 1 },
        ],
      }),
    });

    expect(res.status).toBe(200);

    // Verify order in DB
    const stages = await app.db
      .prepare('SELECT id, "order" FROM stages WHERE pipeline_id = ? ORDER BY "order"')
      .bind('test-pipeline-id')
      .all();

    expect(stages.results[0].id).toBe('stage-2');
    expect(stages.results[1].id).toBe('stage-1');
  });
});

describe('POST /api/v1/stages/:stageId/challenges', () => {
  it('creates challenge with correct order', async () => {
    const res = await app.fetch('/api/v1/stages/test-stage-id/challenges', {
      method: 'POST',
      headers: {
        ...getAuthHeaders('recruiter-user-id'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'CODE_IMPLEMENTATION',
        title: 'Binary Search',
        instructions: 'Implement binary search',
        order: 0,
        config: { starterCode: 'function search() {}', language: 'javascript' },
        serverConfig: { testCode: 'assert(search([1,2,3], 2) === 1)' },
      }),
    });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBeDefined();
    expect(body.type).toBe('CODE_IMPLEMENTATION');
  });

  it('rejects invalid challenge type', async () => {
    const res = await app.fetch('/api/v1/stages/test-stage-id/challenges', {
      method: 'POST',
      headers: {
        ...getAuthHeaders('recruiter-user-id'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: 'INVALID_TYPE',
        title: 'Bad challenge',
      }),
    });

    expect(res.status).toBe(400);
  });
});

describe('POST /api/v1/github/pr', () => {
  it('returns structured diff and metadata', async () => {
    const res = await app.fetch('/api/v1/github/pr', {
      method: 'POST',
      headers: {
        ...getAuthHeaders('recruiter-user-id'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repoUrl: 'https://github.com/owner/repo',
        prNumber: 42,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.diff).toBeDefined();
    expect(body.data.metadata.author).toBeDefined();
  });

  it('returns 400 for invalid repo URL', async () => {
    const res = await app.fetch('/api/v1/github/pr', {
      method: 'POST',
      headers: {
        ...getAuthHeaders('recruiter-user-id'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        repoUrl: 'not-a-url',
        prNumber: 42,
      }),
    });

    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/v1/stages/:stageId', () => {
  it('cascade deletes challenges', async () => {
    const res = await app.fetch('/api/v1/stages/test-stage-id', {
      method: 'DELETE',
      headers: getAuthHeaders('recruiter-user-id'),
    });

    expect(res.status).toBe(200);

    // Verify challenges also deleted
    const challenges = await app.db
      .prepare('SELECT id FROM challenges WHERE stage_id = ?')
      .bind('test-stage-id')
      .all();

    expect(challenges.results).toHaveLength(0);
  });
});

describe('POST /api/v1/candidates/:id/reset', () => {
  it('unclaims token and deletes submissions in transaction', async () => {
    const res = await app.fetch('/api/v1/candidates/test-candidate-id/reset', {
      method: 'POST',
      headers: getAuthHeaders('recruiter-user-id'),
    });

    expect(res.status).toBe(200);

    const candidate = await app.db
      .prepare('SELECT invite_token, status FROM candidates WHERE id = ?')
      .bind('test-candidate-id')
      .first();

    expect(candidate.invite_token).not.toContain('CLAIMED::');
    expect(candidate.status).toBe('INVITED');

    // Submissions deleted
    const submissions = await app.db
      .prepare(`
        SELECT cs.id FROM challenge_submissions cs
        JOIN assessments a ON a.id = cs.assessment_id
        WHERE a.candidate_id = ?
      `)
      .bind('test-candidate-id')
      .all();

    expect(submissions.results).toHaveLength(0);
  });
});
```

---

## 8. Definition of Done

Phase 2 is complete when ALL of the following are true:

- [ ] All D1 tables from Section 4 are deployed to Cloudflare D1 (dev + staging)
- [ ] All Worker routes from Section 5 are implemented and deployed
- [ ] OverviewPage loads pipeline data in a single API call (no N+1)
- [ ] StageDetailPage loads stage + challenges in a single API call
- [ ] ChallengeEditorPage loads, saves, and clones challenges via Workers
- [ ] Drag-and-drop reordering works for stages (DRAFT) and candidates (ACTIVE)
- [ ] Challenge CRUD works for all 5 types: CODE_REVIEW, CODE_IMPLEMENTATION, QUIZ_MCQ, QUIZ_SHORT_ANSWER, FOLLOW_UP
- [ ] GitHub PR fetch works via Worker with server-side token
- [ ] Candidate creation generates a UUID invite token and copyable link
- [ ] Candidate reset (unclaim token + delete submissions) works transactionally
- [ ] Email notification templates save and load on stages
- [ ] All Clerk JWT auth checks return 401 for missing/invalid tokens
- [ ] All ownership checks return 404 for resources owned by other users
- [ ] Zero references to `aws-amplify` or `generateClient` in migrated page files
- [ ] All BDD Playwright tests from Section 7 pass
- [ ] All Worker-level Vitest tests from Section 7.4 pass
- [ ] TypeScript strict mode passes (`npx tsc --noEmit`)
- [ ] Existing DynamoDB data can be migrated to D1 via the migration script (T2-03)
- [ ] No regressions in Phase 1 functionality (ListingPage, Pipeline Create)
