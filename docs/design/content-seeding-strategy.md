# Content Seeding Strategy

**Date:** 2026-02-27
**Status:** Active — being implemented
**Goal:** Give recruiters a rich challenge library that makes Pipe genuinely useful on first login.

---

## Current State

| Type | Count | File |
|---|---|---|
| CODE_REVIEW snippets | 3 | `src/content/codeReviewSnippets.ts` |
| QUIZ_MCQ questions | 10 | `src/content/quizQuestions.ts` |
| Pipeline presets | 2 (DEFAULT, BLANK) | `src/lib/pipelinePresets.ts` |
| CODE_IMPLEMENTATION problems | 0 | — |
| QUIZ_SHORT_ANSWER prompts | 0 | — |

This is enough to demo the product, but not enough to make it sticky. A recruiter who opens the Challenge Picker and sees 3 templates will think the product is half-baked.

---

## The Target

A recruiter building a pipeline for "Senior Frontend Engineer" should be able to assemble a complete, professional-looking assessment in under 5 minutes by selecting from pre-built templates — without writing a single question themselves.

**Target library size (MVP):**

| Type | Target | Why |
|---|---|---|
| CODE_REVIEW | 15 | Cover JS/TS/Python, all 4 bug types |
| QUIZ_MCQ | 50 | Cover React, TS, JS, Node, CSS, algorithms |
| QUIZ_SHORT_ANSWER | 15 | Cover architecture, trade-offs, debugging reasoning |
| CODE_IMPLEMENTATION | 10 | Cover utility fns, React hooks, DS problems |
| **Total** | **90** | Rich enough that picker never feels empty |

---

## Architecture Decision: Static First, DynamoDB Later

There are three ways to get content into the app:

**Option A — Static TypeScript files (chosen for MVP)**
- Content lives in `src/content/challengeLibrary.ts`
- Zero latency — no network round trip on Challenge Picker open
- Version-controlled — content changes are code reviews
- Simple to seed: `pipelinePresets.ts` imports from it
- Limitation: Content is the same for all users; no per-recruiter customization

**Option B — DynamoDB `ChallengeTemplate` records**
- Content is fetched from AppSync
- Enables per-org libraries, recruiter-created templates, sharing
- Requires new data model (`ChallengeTemplate` global model) + seed script
- Higher operational complexity for MVP

**Option C — AI-generated per job description**
- `questionAgent` Lambda generates challenges when recruiter describes role
- Maximum relevance, no manual authoring
- Requires solid library as baseline/fallback; post-MVP quality bar

**Decision:** Static files for MVP (Option A). Design the format so it's easy to migrate to Option B later.

---

## File Structure

```
src/content/
├── codeReviewSnippets.ts      # Existing — keep, migrated into library
├── quizQuestions.ts           # Existing — keep, migrated into library
└── challengeLibrary.ts        # NEW — comprehensive template library

src/lib/
└── pipelinePresets.ts         # Updated to use challengeLibrary
```

The `challengeLibrary.ts` file exports:
- A `ChallengeTemplate` type aligned with the Phase 7 data model
- Named arrays per category (for the Challenge Picker filter UI)
- A flat `ALL_CHALLENGE_TEMPLATES` array for search

---

## Challenge Template Format

```typescript
interface ChallengeTemplate {
  id: string;               // Stable ID (never change after seeding)
  type: ChallengeType;
  title: string;            // Short — shown in picker list
  description: string;      // One sentence — shown below title in picker
  tags: string[];           // e.g. ['security', 'javascript', 'auth']
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  topic: string;            // Category header in picker: 'React', 'Security', etc.
  estimatedMinutes: number; // Time estimate for the candidate
  instructions: string;     // Markdown shown to candidate above challenge
  config: unknown;          // Typed per challenge type (CodeReviewConfig, etc.)

  // For CODE_REVIEW and CODE_IMPLEMENTATION — inline artifact:
  codeArtifact?: {
    title: string;
    language: string;
    code: string;
    groundTruth?: Bug[];    // For CODE_REVIEW answer key
  };
}
```

The `config` field and optional `codeArtifact` have enough information to:
1. Render the challenge immediately from static data
2. Seed a `Challenge` + `CodeArtifact` record pair into DynamoDB if/when needed

---

## Content Categories

### CODE_REVIEW (target: 15)

| Theme | Language | Primary Bug Types | Difficulty |
|---|---|---|---|
| JWT auth bypass | JavaScript | SECURITY (critical), LOGIC | intermediate |
| O(n²) data processing | TypeScript | PERFORMANCE, EDGE_CASE | intermediate |
| SQL injection + missing await | JavaScript | SECURITY, LOGIC | beginner |
| React useEffect memory leak | JavaScript | LOGIC, EDGE_CASE | intermediate |
| Stale closure in event listener | JavaScript | LOGIC | intermediate |
| Python rate limiter race condition | Python | LOGIC (race), EDGE_CASE (TZ) | advanced |
| XSS via dangerouslySetInnerHTML | JavaScript | SECURITY, EDGE_CASE | beginner |
| Shallow copy mutation | TypeScript | LOGIC | intermediate |
| Promise error swallowing | TypeScript | LOGIC, EDGE_CASE | intermediate |
| Node.js EventEmitter leak | JavaScript | PERFORMANCE, LOGIC | advanced |
| parseInt/sort gotchas | JavaScript | LOGIC, EDGE_CASE | beginner |
| Async class with missing checks | TypeScript | LOGIC, SECURITY | intermediate |
| React prop mutation + key misuse | JavaScript | LOGIC | beginner |
| Python dict mutation in loop | Python | LOGIC, PERFORMANCE | intermediate |
| CSRF + missing auth in REST handler | JavaScript | SECURITY | advanced |

### QUIZ_MCQ (target: 50)

| Topic | Count |
|---|---|
| React (hooks, rendering, patterns) | 12 |
| TypeScript (types, generics, utility types) | 10 |
| JavaScript (closures, async, prototypes, coercion) | 12 |
| CSS (specificity, box model, layout) | 6 |
| Node.js (event loop, streams, modules) | 5 |
| Algorithms & data structures (Big O, common patterns) | 5 |

### QUIZ_SHORT_ANSWER (target: 15)

Architecture and reasoning questions — manual scoring by recruiter.

Topics: accessibility, state management trade-offs, performance debugging, REST vs GraphQL, CSS architecture, testing strategy, code review approach.

### CODE_IMPLEMENTATION (target: 10)

Classic utility functions and React patterns that reveal how a developer thinks.

| Problem | Language | What it tests |
|---|---|---|
| Implement debounce | JavaScript | Closures, timers |
| Implement throttle | JavaScript | Closures, timers |
| Deep clone without JSON.parse | JavaScript | Recursion, type handling |
| Implement Promise.all | JavaScript | Promises, concurrent async |
| Implement memoize | TypeScript | Closures, generics |
| Flatten nested array | TypeScript | Recursion, reduce |
| Custom useLocalStorage hook | TypeScript/React | Hooks, side effects |
| Custom useDebounce hook | TypeScript/React | Hooks, refs |
| Implement event emitter | JavaScript | OOP, observer pattern |
| Binary search | TypeScript | Algorithms |

---

## Phase 2: DynamoDB Seeding (post-MVP)

Once the schema FK conflict is resolved and Phase 7 is deployed, write `scripts/seedChallengeLibrary.ts`:

```typescript
// scripts/seedChallengeLibrary.ts
import { generateClient } from 'aws-amplify/data';
import { ALL_CHALLENGE_TEMPLATES } from '../src/content/challengeLibrary';

// For each template:
// 1. Create a CodeArtifact record if template.codeArtifact is set
// 2. Create a Challenge record with type, config, codeArtifactId
// 3. Store IDs in a seed manifest for idempotency

async function seedLibrary() {
  // ... implementation
}
```

This is **not needed for MVP** — static library is sufficient. Write it when recruiters want to customize and save their own templates.

---

## Phase 3: AI Generation (post-MVP)

The `questionAgent` Lambda pattern already exists. Extend it:

1. `generateChallengeSet(jobDescription, challengeTypes[])` — sends job description + requested challenge types to Claude, receives a structured set of challenges back
2. Recruiter reviews AI proposals in the Challenge Picker before adding to their stage
3. Static library remains as the default fallback and quality baseline

This becomes the **AI-Driven** pipeline creation mode (`creationMode: 'AI_DRIVEN'`) already in the schema.

---

## Implementation Order

1. **[Now]** Write `src/content/challengeLibrary.ts` with 90 templates
2. **[Now]** Update `pipelinePresets.ts` DEFAULT preset to use richer library content
3. **[Now]** Update Challenge Picker to display library templates with search + filter
4. **[Phase 7 Step 5]** Write `scripts/seedChallengeLibrary.ts` for DynamoDB seeding
5. **[Post-MVP]** Add `questionAgent` extension for AI challenge generation
