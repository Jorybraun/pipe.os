# Challenge Design Authoring System — Research Brief

**Date:** 2026-04-09
**Scope:** MCQ, Code Implementation, Long-form text/video. Excludes Code Review and Follow-up.
**Sources:** 92 across three research dimensions (AI generation, architecture, UX/competitive)

---

## Executive Summary

Pipe needs a challenge authoring system that bridges three modes: **AI-generated challenges from job descriptions**, **curated template packs by role** (FRONTEND, FULLSTACK, BACKEND, DATA_ENGINEERING), and **recruiter-authored custom challenges**. The current system has a hardcoded template library (~50 items in TypeScript), a minimal preset system (DEFAULT + BLANK), and no connection between role discovery output and challenge creation.

This brief synthesizes research across AI generation pipelines, data architecture, multi-language code execution, UX patterns, and competitive landscape to produce an actionable design for the authoring system. Key findings:

1. **AI generation requires multi-agent validation, not single-pass prompting.** A generate-then-validate pipeline with separate agents for content review, linguistic evaluation, and bias assessment catches ~40% of quality issues that single models miss. Chain-of-Thought prompting with in-context learning produces the highest-quality MCQs.

2. **Template packs should be immutable, versioned, and metadata-driven.** Modeled after IMS QTI item banking standards. Challenges are atomic units; packs are versioned compositions. When assigned to a pipeline, the pack version is snapshotted — later updates don't affect live interviews.

3. **Multi-language code execution requires an external service.** Cloudflare Workers cannot run arbitrary user code. Judge0 CE (open-source, 60+ languages, self-hostable) is the recommended execution backend. MVP language set: Python + JavaScript/TypeScript (covers 51% of job market demand across all role types).

4. **UX should follow a 4-step wizard with three content sources.** Competitive analysis of 8 platforms confirms: wizard flows (3-5 steps), role-based library browsing, and right-sidebar drawer editing are table-stakes. **Batch generation** (multiple difficulty levels + language variants in one flow) and **visible confidence scores** on AI-generated content are unmet market gaps that Pipe can own.

---

## Part 1: AI-Powered Challenge Generation Pipeline

### 1.1 JD-to-Challenge Mapping

The role discovery system already produces a `CandidatePersona` (seniority, mustHaveSkills, niceToHaveSkills, archetype) and `GeneratedJobDescription`. The authoring system should consume these to generate targeted challenges.

**Skill extraction:** Fine-tuned Skill-LLM achieves 64.8% F1 on extracting testable skills from job descriptions, outperforming traditional NER approaches. For Pipe's use case, the role discovery persona already provides structured skill lists — the generation pipeline should consume `mustHaveSkills` and `niceToHaveSkills` directly rather than re-parsing the JD.

**Skill-to-challenge-type routing via Bloom's Taxonomy:**

| Bloom's Level | Challenge Type | Example |
|---------------|---------------|---------|
| Remember / Understand | MCQ | "What does `useEffect` cleanup return?" |
| Apply / Analyze | Code Implementation | "Build a debounce hook with cancellation" |
| Evaluate / Create | Long-form text/video | "Describe how you'd architect a real-time collaboration feature" |

This mapping is implicit in the assessment literature but must be made explicit in Pipe's generation prompts. Each skill from the persona gets classified by cognitive level, then routed to the appropriate challenge type.

### 1.2 Generation Architecture: Multi-Agent Pipeline

Single-pass LLM generation produces items with factual errors, ambiguous wording, and poor distractors. Research converges on a **multi-agent generate-then-validate** pattern:

```
[1. Generator Agent]     → Raw challenge items (MCQ, code, or text prompt)
       ↓
[2. Content Reviewer]    → Factual accuracy, technical correctness
       ↓
[3. Linguistic Evaluator] → Clarity, ambiguity, reading level
       ↓
[4. Difficulty Calibrator] → Bloom's level check, estimated difficulty
       ↓
[5. Human Review Queue]  → Recruiter approves/edits/rejects
```

**For Pipe's model routing:**

| Agent | Model | Rationale |
|-------|-------|-----------|
| Generator (MCQ) | Gemma 4 26B | Structured JSON output, cheap on Workers AI binding |
| Generator (Code Implementation) | Qwen 2.5-Coder 32B | Code-tuned, understands syntax trees and test patterns |
| Generator (Long-form prompts) | Gemma 4 26B | Text generation, structured output |
| Content Reviewer | Different model family from generator | Independent perspective catches generator blind spots |
| Linguistic Evaluator | Gemma 4 12B | Lightweight classification task |
| Difficulty Calibrator | Gemma 4 12B | Bloom's level classification |
| Gold-standard templates (offline, one-time) | Claude Opus 4.6 | Highest quality for seed templates that get reused thousands of times |

**Critical constraint:** The content reviewer MUST be a different model family from the generator (same principle as the consistency classifier in the code review system per ADR-032). Gemma reviewing Qwen output provides independent validation; Qwen reviewing Qwen output is echo-chamber validation.

### 1.3 Prompt Engineering for Challenge Generation

**MCQ generation (highest evidence):**
- Use Chain-of-Thought with skill descriptions + example questions (PS4 pattern) — 78% of items rated high-quality, 65.56% match intended Bloom's levels
- Include in-context learning: select 3-5 textually similar example MCQs via embedding similarity
- Request misconception-based distractors: "Articulate common developer misconceptions about [skill], then instantiate each as a plausible wrong answer"
- Including the correct answer in the prompt improves distractor alignment by 8%
- CoT reduces accidental correct distractors from 39% to 2%

**Code Implementation generation:**
- Use test-driven generation: specify function signature + expected behavior → generate starter code + test suite
- TestGen-LLM pattern: add tests incrementally to a human-validated baseline
- Cyclomatic complexity and edge case coverage require expert review — don't trust the model alone

**Long-form text/video prompt generation:**
- Generate situational prompts that map to the role's key competencies
- Include evaluation rubric alongside the prompt (what a strong answer looks like)
- Less evidence in the literature; lean on the culture interview agent patterns from ADR-029

### 1.4 Quality Gates

Each generated challenge passes through these gates before entering the library:

1. **Syntax/logic validation** — code compiles, JSON is valid, MCQ has exactly one correct answer
2. **Factual accuracy review** — technical claims are correct (validated by reviewer agent)
3. **Bloom's level alignment** — challenge tests at the intended cognitive level
4. **Distractor efficiency** — each MCQ distractor should be selected by >5% of respondents (validated post-deployment via IRT)
5. **Bias screening** — no cultural assumptions, gender-coded language, or background-specific knowledge
6. **Human approval** — recruiter or admin reviews and publishes

### 1.5 Difficulty Calibration

**Pre-deployment (estimated):** Generator assigns difficulty based on Bloom's level and skill complexity. Calibration agent cross-checks against existing templates at similar difficulty.

**Post-deployment (measured via IRT):**
- Track actual difficulty index (p-value): easy >= 0.85, moderate 0.51-0.84, hard <= 0.50
- Track discrimination index: poor <= 0.20, acceptable 0.21-0.24, good 0.25-0.34, excellent >= 0.35
- Track distractor efficiency: functional if >5% selection rate per wrong answer
- Use Rasch model (1PL) for parameter estimation once sufficient response data accumulates
- Target: item pool 2-4x larger than any single assessment to enable adaptive selection

---

## Part 2: Template Pack Architecture

### 2.1 Data Model

Template packs follow the IMS QTI item banking pattern: **challenges are immutable atomic units; packs are versioned compositions.**

**New D1 tables:**

```sql
-- Reusable challenge definitions (immutable after publish)
CREATE TABLE challenge_templates (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER')),
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('JUNIOR', 'MID', 'SENIOR')),
  primary_skill TEXT NOT NULL,
  secondary_skills TEXT,          -- JSON array: ["testing", "debugging"]
  bloom_level TEXT,               -- remember|understand|apply|analyze|evaluate|create
  estimated_minutes INTEGER,
  config TEXT NOT NULL,            -- JSON: type-specific public config
  server_config TEXT,              -- JSON: answer keys, rubrics (never sent to client)
  source TEXT NOT NULL CHECK (source IN ('SYSTEM', 'AI_GENERATED', 'USER_CREATED')),
  is_published INTEGER DEFAULT 0,
  created_by TEXT,                 -- Clerk user ID (NULL for system templates)
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

-- Language variants for code challenges
CREATE TABLE challenge_language_variants (
  id TEXT PRIMARY KEY,
  challenge_template_id TEXT NOT NULL REFERENCES challenge_templates(id),
  language TEXT NOT NULL,          -- 'javascript', 'typescript', 'python'
  starter_code TEXT NOT NULL,
  test_suite TEXT NOT NULL,
  test_framework TEXT NOT NULL,    -- 'jest', 'vitest', 'pytest', 'unittest'
  test_command TEXT NOT NULL,      -- 'npx jest', 'python -m pytest'
  solution_code TEXT,              -- Reference solution (server-side only)
  UNIQUE(challenge_template_id, language)
);

-- Template pack definitions (versioned, immutable after publish)
CREATE TABLE template_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  role_type TEXT NOT NULL CHECK (role_type IN (
    'FRONTEND', 'BACKEND', 'FULLSTACK', 'DATA_ENGINEERING', 'DEVOPS', 'MOBILE', 'CUSTOM'
  )),
  seniority TEXT NOT NULL CHECK (seniority IN ('JUNIOR', 'MID', 'SENIOR', 'ANY')),
  version INTEGER NOT NULL DEFAULT 1,
  skills TEXT NOT NULL,             -- JSON array of skill tags
  supported_languages TEXT,         -- JSON array: ["javascript", "python"]
  source TEXT NOT NULL CHECK (source IN ('SYSTEM', 'USER_CREATED')),
  is_published INTEGER DEFAULT 0,
  created_by TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(id, version)
);

-- Pack composition: which challenges in what order
CREATE TABLE template_pack_items (
  template_pack_id TEXT NOT NULL,
  template_pack_version INTEGER NOT NULL,
  challenge_template_id TEXT NOT NULL REFERENCES challenge_templates(id),
  sort_order INTEGER NOT NULL,
  weight REAL DEFAULT 1.0,          -- Relative scoring weight
  is_required INTEGER DEFAULT 1,    -- Required vs optional challenge
  PRIMARY KEY (template_pack_id, template_pack_version, challenge_template_id),
  FOREIGN KEY (template_pack_id, template_pack_version)
    REFERENCES template_packs(id, version)
);
```

**Key design decisions:**

1. **Challenges and packs are separate entities.** A challenge can belong to multiple packs. This avoids duplication and enables library-style browsing.

2. **Immutability after publish.** Once `is_published = 1`, the challenge template or pack version cannot be modified. Edits create a new version. This ensures fairness — candidates in the same pipeline always see the same content.

3. **Language variants are first-class.** Code challenges store per-language starter code, test suites, and test commands. MCQs and long-form challenges don't need language variants (they're language-agnostic at the content level).

4. **Source tracking.** Every challenge and pack tracks whether it was created by the system, generated by AI, or authored by a user. This enables filtering and quality analytics.

### 2.2 Integration with Existing Schema

The existing `challenges` table (pipeline-specific instances) remains. When a recruiter selects a template pack for a stage, the system **expands** the pack into concrete challenge rows:

```
template_packs → template_pack_items → challenge_templates
                                            ↓ (expand into)
                              stages → challenges (existing table)
```

This mirrors the existing `expandPreset()` pattern in `workers/api/src/lib/presets.ts`. The existing preset system becomes a thin wrapper: `DEFAULT` and `BLANK` presets map to template packs.

**New columns on existing `stages` table:**
```sql
ALTER TABLE stages ADD COLUMN template_pack_id TEXT;
ALTER TABLE stages ADD COLUMN template_pack_version INTEGER;
```

These columns record which pack (and version) was used to populate the stage, enabling audit and "update to latest pack version" flows.

### 2.3 Default Template Packs

**MVP seed packs (system-created):**

| Pack | Role | Seniority | Challenges |
|------|------|-----------|------------|
| Frontend Junior | FRONTEND | JUNIOR | 3 MCQ (HTML/CSS, JS basics, React fundamentals) + 1 Implementation (build a component) + 1 Long-form (describe your approach to accessibility) |
| Frontend Mid | FRONTEND | MID | 3 MCQ (advanced React, state management, performance) + 1 Implementation (build a custom hook with tests) + 1 Long-form (architecture a feature) |
| Frontend Senior | FRONTEND | SENIOR | 2 MCQ (system design, build tooling) + 2 Implementation (complex component + performance optimization) + 1 Long-form (technical leadership scenario) |
| Backend Junior | BACKEND | JUNIOR | 3 MCQ (HTTP, data structures, SQL basics) + 1 Implementation (REST endpoint) + 1 Long-form (debugging approach) |
| Backend Mid | BACKEND | MID | 3 MCQ (concurrency, caching, API design) + 1 Implementation (data pipeline) + 1 Long-form (system design trade-offs) |
| Fullstack Junior | FULLSTACK | JUNIOR | Mix of frontend + backend junior challenges |
| Fullstack Mid | FULLSTACK | MID | Mix of frontend + backend mid challenges |

**Generation strategy:** Use Claude Opus 4.6 to generate the gold-standard seed templates (one-time, high-quality investment). Then use cheaper models for variant generation.

---

## Part 3: Multi-Language Code Support

### 3.1 Execution Architecture

Cloudflare Workers cannot execute arbitrary user code. The system needs an external execution service.

**Recommended: Judge0 CE**
- Open-source, self-hostable, 60+ languages
- Configurable resource limits: CPU 2-15s, memory 128-256MB, wall-clock 5-20s
- REST API with synchronous mode (`wait=true`)
- Free tier via RapidAPI for development; self-host for production
- Multi-file support via Base64-encoded ZIP

**Execution flow:**
```
Candidate submits code
       ↓
Worker receives submission
       ↓
Worker retrieves challenge + language variant from D1
       ↓
Worker constructs payload: candidate code + test suite + test command
       ↓
Worker calls Judge0 API with language ID + source + stdin
       ↓
Judge0 returns: status, stdout, stderr, time, memory
       ↓
Worker stores result in candidate_responses table
       ↓
Scoring pipeline evaluates (test pass/fail + code quality)
```

### 3.2 MVP Language Set

| Language | Job Market Share | Role Coverage | MVP? |
|----------|-----------------|---------------|------|
| JavaScript/TypeScript | 31% | Frontend, Fullstack, Backend | Yes |
| Python | 20% | Backend, Data, Fullstack | Yes |
| Java | 15% | Backend, Enterprise | Phase 2 |
| Go | 5% | Backend, DevOps | Phase 2 |
| Rust | 3% | Systems, Performance | Phase 2 |

**Launch with Python + JavaScript/TypeScript.** These two cover all four MVP role types and represent 51% of hiring demand.

### 3.3 Per-Language Test Harness Strategy

For MVP, store per-language test suites directly in `challenge_language_variants`:

```json
{
  "javascript": {
    "starter_code": "export function debounce(fn, ms) {\n  // your code here\n}",
    "test_suite": "import { debounce } from './solution';\n\ndescribe('debounce', () => {\n  test('delays execution', async () => { ... });\n});",
    "test_framework": "jest",
    "test_command": "npx jest --forceExit"
  },
  "python": {
    "starter_code": "def debounce(fn, ms):\n    # your code here\n    pass",
    "test_suite": "import unittest\nfrom solution import debounce\n\nclass TestDebounce(unittest.TestCase):\n    def test_delays_execution(self): ...",
    "test_framework": "unittest",
    "test_command": "python -m pytest -v"
  }
}
```

**Post-MVP:** Build a Qualified.io-style YAML generator that produces language-specific boilerplate from a single function signature definition. This reduces authoring effort for simple algorithmic challenges but doesn't cover complex multi-file challenges.

---

## Part 4: UX Strategy

### 4.1 Three Content Sources, One Flow

The authoring system provides three ways to add challenges to a pipeline:

1. **Generate from JD** — AI creates challenges from the role discovery output
2. **Pick from template pack** — Browse curated packs by role/seniority
3. **Create custom** — Build a challenge from scratch in the editor

All three produce the same output: challenge instances in the existing `challenges` table. The UX unifies them in a single flow.

### 4.2 Recommended Flow: 4-Step Wizard

```
┌─────────────────────────────────────────────────────┐
│ Step 1: SOURCE                                       │
│                                                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │ Generate  │  │ Template │  │  Custom  │           │
│  │ from JD   │  │  Pack    │  │  Create  │           │
│  └──────────┘  └──────────┘  └──────────┘           │
│                                                       │
│  (If Generate: role context is pre-loaded from        │
│   the pipeline's role discovery output)               │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Step 2: SELECT / CONFIGURE                           │
│                                                       │
│  Generate path:                                       │
│  ┌─────────────────────────────────────────┐         │
│  │ AI generates 5-8 challenges             │         │
│  │ Each shows confidence scores:            │         │
│  │   Topic Relevance: 0.87                  │         │
│  │   Role Fit: 0.76                         │         │
│  │   Clarity: 0.93                          │         │
│  │ [Accept] [Edit] [Regenerate] [Remove]    │         │
│  └─────────────────────────────────────────┘         │
│                                                       │
│  Template path:                                       │
│  ┌─────────────────────────────────────────┐         │
│  │ Left sidebar: role, seniority, type      │         │
│  │ Main area: pack cards with preview       │         │
│  │ Click pack → expands to show challenges  │         │
│  │ [Use This Pack] or cherry-pick items     │         │
│  └─────────────────────────────────────────┘         │
│                                                       │
│  Custom path:                                         │
│  ┌─────────────────────────────────────────┐         │
│  │ Pick challenge type (MCQ / Code / Text)  │         │
│  │ → Opens type-specific editor             │         │
│  └─────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Step 3: REFINE                                       │
│                                                       │
│  Right-sidebar drawer for per-challenge editing:      │
│  ┌──────────────┬──────────────────────────┐         │
│  │ Challenge    │  Edit Drawer              │         │
│  │ Preview      │  ┌──────────────────┐    │         │
│  │ (candidate   │  │ Title             │    │         │
│  │  view)       │  │ Instructions      │    │         │
│  │              │  │ Difficulty        │    │         │
│  │              │  │ Time limit        │    │         │
│  │              │  │ Language (code)   │    │         │
│  │              │  │ Scoring rubric    │    │         │
│  │              │  └──────────────────┘    │         │
│  └──────────────┴──────────────────────────┘         │
│                                                       │
│  Reorder challenges via drag-and-drop                 │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Step 4: REVIEW & PUBLISH                             │
│                                                       │
│  Summary: N challenges, estimated M minutes            │
│  Challenge list with type badges + difficulty          │
│  [Preview as Candidate] button                         │
│  [Save as Draft] [Publish to Pipeline]                │
└─────────────────────────────────────────────────────┘
```

### 4.3 Template Pack Browser UX

The template pack browser (Step 2, template path) follows competitive best practices:

**Primary dimension: Role type** (tabs or top-level filter)
- FRONTEND | BACKEND | FULLSTACK | DATA_ENGINEERING | CUSTOM

**Secondary filters** (left sidebar):
- Seniority: Junior / Mid / Senior
- Challenge type: MCQ / Code / Long-form
- Language: JavaScript / Python / (future: Java, Go)
- Skill: React, Node.js, SQL, etc.

**Pack card display:**
- Pack name + description
- Challenge count + estimated time
- Skill tags (chips)
- Supported languages
- "Preview" expands to show individual challenges
- "Use Pack" adds all challenges to the stage
- "Customize" lets recruiter cherry-pick individual challenges

### 4.4 AI Generation UX

When the recruiter chooses "Generate from JD":

1. System loads the pipeline's role context (persona + JD)
2. AI generates 5-8 challenges across types (mix of MCQ, Code, Long-form based on skill routing)
3. Each generated challenge displays:
   - Title + preview of instructions
   - Challenge type badge
   - **Confidence scores** (3 dimensions: Topic Relevance, Role Fit, Clarity)
   - Action buttons: Accept / Edit / Regenerate / Remove
4. Recruiter reviews, edits, and accepts challenges
5. Accepted challenges are added to the stage

**Confidence score display** (differentiator — no competitor does this):
```
Topic Relevance:  ███████░░  0.87
Role Fit:         █████░░░░  0.76  ⚠ Edit recommended
Clarity:          █████████  0.93
```

Thresholds: >= 0.85 green, 0.70-0.84 yellow, < 0.70 red.

### 4.5 Custom Challenge Editor

The existing per-type editors (MCQEditor, CodeImplEditor, ShortAnswerEditor) are reused. The authoring wizard routes to the appropriate editor based on the selected challenge type.

**Enhancement: Right-sidebar drawer** instead of full-page editor for inline editing within the wizard flow. The main canvas shows a candidate-view preview; the drawer shows the edit form.

### 4.6 Batch Generation (Post-MVP Differentiator)

No competitor offers batch challenge generation. Pipe can differentiate with:

```
[Batch Generation Panel]
┌─────────────────────────────────────────┐
│ Generate variants of "Debounce Hook"     │
│                                           │
│ Difficulty variants:                      │
│   [x] Junior   [x] Mid   [x] Senior     │
│                                           │
│ Language variants:                        │
│   [x] JavaScript  [x] Python             │
│   [ ] Java        [ ] Go                 │
│                                           │
│ → Will generate 3 × 2 = 6 variants       │
│                                           │
│ [Generate All]                            │
└─────────────────────────────────────────┘
```

Result: grid view of all variants with individual accept/reject.

---

## Part 5: Integration Plan

### 5.1 How This Fits the Existing System

| Existing Component | Change |
|-------------------|--------|
| `src/content/challengeLibrary.ts` | Migrate templates to `challenge_templates` D1 table. Keep TS file as build-time seed script. |
| `workers/api/src/lib/presets.ts` | Evolve to query `template_packs` table instead of hardcoded objects. `expandPreset()` becomes `expandPack()`. |
| `src/components/Pipeline/ChallengePicker.tsx` | Replace with template pack browser + AI generation entry point. |
| `src/pages/ChallengeEditorPage.tsx` | Reuse editors; wrap in wizard flow with drawer layout. |
| `workers/api/src/routes/cockpit/stages.ts` | Add `template_pack_id` + `template_pack_version` to stage creation. |
| `workers/api/src/routes/cockpit/challenges.ts` | Add routes for challenge template CRUD + pack management. |
| Role discovery output | Wire `persona.mustHaveSkills` into generation pipeline as input. |

### 5.2 New API Routes

```
# Template pack management
GET    /api/v1/template-packs                    # List packs (filterable)
GET    /api/v1/template-packs/:id                # Get pack with challenges
POST   /api/v1/template-packs                    # Create custom pack
POST   /api/v1/template-packs/:id/publish        # Publish pack version
POST   /api/v1/template-packs/:id/duplicate      # Duplicate pack for customization

# Challenge template management
GET    /api/v1/challenge-templates                # List templates (filterable)
GET    /api/v1/challenge-templates/:id            # Get template with variants
POST   /api/v1/challenge-templates                # Create custom template
PUT    /api/v1/challenge-templates/:id            # Update draft template
POST   /api/v1/challenge-templates/:id/publish    # Publish (makes immutable)

# Language variants
GET    /api/v1/challenge-templates/:id/variants   # List language variants
POST   /api/v1/challenge-templates/:id/variants   # Add language variant

# AI generation
POST   /api/v1/generate/challenges                # Generate from role context
POST   /api/v1/generate/variants                  # Generate difficulty/language variants

# Code execution (candidate-facing)
POST   /rpc/execute                               # Submit code for execution via Judge0
```

### 5.3 Implementation Phases

**Phase 1: Foundation (data model + migration)**
- D1 migrations for new tables
- Seed script to migrate `challengeLibrary.ts` templates into `challenge_templates` table
- Template pack CRUD API routes
- Challenge template CRUD API routes with language variant support

**Phase 2: Template Pack UX**
- Template pack browser component (role-based, filterable)
- Pack expansion into stages (replaces `expandPreset`)
- 4-step wizard shell (source → select → refine → review)
- Per-type editors in drawer layout

**Phase 3: AI Generation Pipeline**
- Generation endpoint wired to role context
- Multi-agent validation pipeline on Workers AI
- Confidence scoring display in generation UX
- Human review queue (accept/edit/regenerate/remove)

**Phase 4: Multi-Language + Execution**
- Judge0 integration (self-hosted or RapidAPI)
- Language variant management UI
- Candidate language selection at runtime
- Execution result handling + scoring

**Phase 5: Advanced Features (Post-MVP)**
- Batch variant generation
- IRT-based difficulty calibration from response data
- Pack versioning UI (update, rollback, diff)
- Pack sharing between organizations

---

## Part 6: Competitive Positioning

### 6.1 Table-Stakes (Must Have to Compete)

| Feature | Status in Pipe | Priority |
|---------|---------------|----------|
| Template library (300+ questions) | 50 hardcoded templates | Phase 1-2 |
| Custom challenge creation | Exists (editor) | Enhance in Phase 2 |
| Role-based browsing | Not present | Phase 2 |
| Multi-language code | Not present | Phase 4 |
| Scoring/rubrics | Partial (per challenge type) | Phase 2-3 |

### 6.2 Differentiators (Pipe Can Own)

| Feature | Competitor Status | Pipe's Advantage |
|---------|-------------------|------------------|
| AI generation from JD with confidence scores | TestGorilla has basic AI; no one shows confidence | First-class, research-backed |
| Batch variant generation (difficulty x language) | No competitor offers this | Major productivity win |
| Role discovery → challenge generation pipeline | No competitor has integrated role discovery | End-to-end coherence |
| Multi-agent validation with quality gates | No competitor is transparent about validation | Trust signal for recruiters |

---

## Open Questions

1. **Judge0 hosting:** Self-host on Fly.io/Railway, or use RapidAPI managed? Self-hosting gives control over latency and cost; managed reduces ops burden.

2. **Template library seeding:** Generate seed templates with Claude Opus (high-quality, one-time cost) or build manually? Recommendation: Opus for initial 50-100 templates, then cheaper models for variants.

3. **Candidate language choice:** Should candidates choose their language at runtime (like LeetCode), or should the recruiter lock the language per challenge? Recommendation: recruiter sets allowed languages, candidate picks from allowed set.

4. **Pack sizing for MVP:** 20 templates (minimal viable) vs 100+ (competitive)? Recommendation: 50-75 templates across 7 seed packs, generated via Opus.

5. **Confidence score calibration:** No published research on recruiter expectations for AI confidence scores. Need internal testing to set thresholds.

6. **Video/voice challenge execution:** Long-form text is straightforward (store response text). Voice and video responses require R2 storage + transcription pipeline. Scope separately.

7. **IRT calibration timeline:** Need ~100-200 responses per challenge to calibrate difficulty reliably. This is a post-launch feature that improves over time.

8. **Fairness validation:** Need to define Pipe-specific bias criteria for generated challenges (language diversity, background-agnostic problem framing, no cultural assumptions).
