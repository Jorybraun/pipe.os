# Research: Challenge Authoring System for Pipe

## Context

This research supports Pipe's transition from a hardcoded challenge library (~50 templates in `src/content/challengeLibrary.ts`) to a sustainable template pack system with multi-language code support. Current state: D1 schema stores challenge type, config (JSON), and server_config (JSON), but lacks template pack composition, versioning, and multi-language execution.

---

## Key Findings

### 1. Template Pack Architecture

#### 1.1 Item Banking and Question Pool Standards

The **IMS Question and Test Interoperability (QTI) v3.0 specification** defines the industry standard for exchanging assessment content across platforms, enabling item banking without vendor lock-in [S1][S2]. QTI standardizes the concept of:

- **Item pools** as groups of related items transported with collective metadata (role, skill, difficulty) [S2]
- **Content packages** that include items, tests, and metadata as importable/exportable units
- **Item composition** allowing challenges to belong to multiple banks without duplication [S2]

**Assessment platforms using this model:**
- **TAO (test & assessment platform)** implements QTI v2.2 certification, allowing import/export in QTI, RDF, and CSV formats [S22]
- **Moodle** structures question banks with separate tables for question definitions (stored once) and question engine (stores attempt data separately) [S15]
- **Smarter Balanced** uses metadata from LRMI (Learning Resource Metadata Initiative) and CEDS (Common Education Data Standards) for item tagging [S19]

**Key pattern for Pipe:** Question/challenge definitions are immutable artifacts. Metadata (role, skills, difficulty, language) is stored separately, enabling reuse across multiple template packs and pipelines without duplication.

#### 1.2 Platform-Specific Pack Organization

**HackerRank, Codility, and LeetCode** organize challenges by:
- **Role-based libraries** (frontend, backend, fullstack, data science, DevOps) [S2]
- **Difficulty tiers** (easy, medium, hard)
- **Skill tags** (algorithms, data structures, system design, etc.)
- **Industry-specific certifications** and assessment suites [S2]

**CodeSignal** supports:
- 45+ programming languages per assessment [S5]
- Framework restrictions (can limit to specific languages per challenge)
- 628,000+ language variations per question to minimize cheating [S5]

**Inference:** Pipe should model template packs with metadata: role type (FRONTEND, BACKEND, FULLSTACK, DATA_ENGINEERING), seniority range (junior, mid, senior), skills covered (array of tags), and supported languages (array).

#### 1.3 Versioning Strategy for Immutability

Research on template/configuration versioning across platforms converges on a pattern:
- **Templates are immutable after release** [S3]
- **New versions are created, never in-place modifications** [S3]
- **Version numbers track configuration changes uniquely** [S3]
- **Governance requires: clear versioning policy (dev vs prod) + test suite for each template** [S3]

**Specific example:** AWS EC2 Launch Templates are immutable—modifications create a new version with an incremented version number, enabling rollback and audit trail [S3].

**For Pipe's interviews:** When a template pack is assigned to a pipeline, the pack version is snapshot at that time. Later updates to the pack do not affect live candidate sessions. (Non-functional detail for database design: store `template_pack_id` + `template_pack_version` on the stage/session.)

#### 1.4 Database Schema Patterns

**Moodle's approach:**
- `mdl_question` table stores the challenge definition once (id, name, type, questiontext, generalfeedback, etc.)
- `mdl_question_versions` table tracks versions for audit/rollback
- `mdl_quiz_question` table links questions to specific quizzes (composition, order)
- `mdl_question_attempts` table stores per-attempt data (immutable, never the question itself) [S15]

**TAO's approach:**
- Uses QTI XML as the canonical format
- Stores metadata in RDF (Resource Description Framework) for flexible querying
- Question (item) definitions separate from test/assessment composition [S22]

**Inference for Pipe's D1 schema:**
- Challenges table: immutable, versioned (`id`, `template_pack_id`, `template_pack_version`, `type`, `title`, `instructions`, `config` (JSON), `created_at`)
- TemplatePack table: (`id`, `name`, `role_type`, `seniority_range`, `skills` (JSON array), `supported_languages` (JSON array), `version`, `created_at`, `is_published`)
- StageChallenge table: link stage to specific challenge + pack version (captures snapshot at assignment time)

---

### 2. Multi-Language Code Support

#### 2.1 Serverless Code Execution Platforms

**Cloudflare Workers (Pipe's stack):**
- Direct support: JavaScript, TypeScript, Python, Rust [S16]
- Via WebAssembly: C, C++, Kotlin, Go [S16]
- **Critical limitation:** Workers cannot natively execute arbitrary user code in multiple languages. The platform is designed for deploying Pipe's *own* code, not evaluating candidate submissions in real-time.

**Alternative external APIs (all suitable for Pipe):**

**Judge0 CE (open-source):**
- 60+ languages (C, C++, C#, Python 2.7/3.8+, Java, JavaScript, TypeScript, Ruby, Go, Rust, Haskell, PHP, Bash, etc.) [S6][S18]
- Configurable resource limits: CPU time (2–15s default), memory (128–256MB), wall-clock (5–20s), max threads (60–120) [S18]
- REST API with synchronous mode (`wait=true`) for immediate results [S18]
- Free basic tier via RapidAPI; self-hostable open-source [S6][S18]
- Multi-file program support via Base64-encoded ZIP archive [S18]

**Sphere Engine:**
- 80+ languages (C++, C#, Go, Haskell, Java, Kotlin, Node.js, PHP, Python, Ruby, Scala, Swift, etc.) [S14]
- REST API with isolated execution mode (separate sandbox per stage) [S14]
- Multi-file support in Containers module [S14]
- Commercial licensing; no free tier noted [S14]

**Piston API:**
- High-performance code execution engine [S9]
- **Critical limitation:** As of Feb 15, 2026, no longer freely available to the public. Authorization restricted to non-commercial/educational/low-volume use [S9]

**Inference for Pipe:** Judge0 CE is the best choice—open-source, self-hostable, 60+ languages, free tier via RapidAPI, and actively maintained. Pair with Pipe's D1 as the ground truth for starter code, test suites, and expected outputs.

#### 2.2 WebAssembly-Based Browser Execution (Client-Side)

**Pyodide (Python on WebAssembly):**
- Compiles CPython to WebAssembly, enabling Python execution directly in browsers [S7]
- Includes NumPy, Pandas, SciPy, Matplotlib, and other scientific libraries via micropip package manager [S7]
- Bidirectional Python-JavaScript bridge for seamless interop [S7]
- Performance: near-native execution speed within browser sandbox; constrained by memory and Wasm overhead [S7]
- **Limitations:** Browser memory sandbox, dependent on precompiled packages, network latency for package loading, limited system-level operations [S7][S17]

**Use case for Pipe:** Suitable for Python-only practice challenges or low-stakes quizzes where candidates want client-side execution. Not recommended for production interviews (no audit trail, no resource enforcement, browser-dependent). Pyodide adds complexity without serving Pipe's hiring use case.

#### 2.3 Language-Specific Starter Templates and Test Frameworks

**Qualified.io's Language Generator pattern:**
- Single YAML configuration specifies function signature, parameters, return type, and test cases in language-agnostic format [S21][S24]
- Generator automatically produces language-specific boilerplate and test suites for all supported languages [S21]
- Test structure maps to language-native frameworks: Jest/Mocha for JavaScript, pytest for Python, NUnit for C#, JUnit for Java [S21][S24]
- **Limitations:** Supports only primitive types (string, integer, boolean, arrays of these); not suited for complex objects, classes, or mixed-type collections [S21]

**HackerRank's approach:**
- Uses a Domain-Specific Language (DSL) for "Code stubs" that generate language-specific boilerplate automatically [S13]
- Template provides input parsing, function signature, and output formatting [S13]
- Challenge creators specify once; platform generates per language [S13]

**Testing framework landscape:**
- **JavaScript:** Jest (built-in assertions, mocking, snapshot testing, parallel execution; 40.9K GitHub stars, 19M weekly NPM downloads) vs. Mocha (flexible, requires external libraries for assertions/mocking; 21.8K stars, 7M downloads) [S23]
- **Python:** unittest (standard library, built-in to all Python installations)
- **Java:** JUnit (de facto standard for unit testing)
- **Other:** Go (testing package, built-in), Rust (assert! macros + test module), C++ (Catch2, Google Test) [S23]

**Inference for Pipe:** 
1. For simple algorithmic challenges (primitives only), build a YAML-based code generator similar to Qualified.io. Map single source to Jest/pytest/JUnit/etc. per language.
2. For complex/real-world challenges (classes, multi-file, external libraries), rely on platform-provided test suites stored in D1 config per language.
3. Each challenge's `config.languages` field lists supported languages; `config.files` field stores per-language starter code and test suite templates.

---

### 3. Language Coverage Priorities

#### 3.1 Most Requested Languages in Technical Hiring (2024–2025)

**Ranked by job market demand:**
1. **JavaScript/TypeScript** — 651K job offers (~31% of all coding roles), Jan 2023–Sept 2024 [S8]
2. **Python** — 408K offers (~20%), second most in-demand [S8]
3. **Java** — ~15% of market demand [S8]
4. **C#** — 246K+ offers (~12%), stable across 2023–2024 [S8]
5. **PHP** — ~10% of market demand [S8]

**Interview-specific findings:** Python is considered the "clear winner" for coding interview preparation, with Java and C++ remaining staples for backend/finance/performance-critical roles [S8].

#### 3.2 Language Set by Role Type

**Frontend Engineer:**
- **Required:** JavaScript/TypeScript, React (or Vue/Angular) [S11]
- **Optional:** Python for build tools, some shell scripting [S11]

**Backend Engineer:**
- **Required:** One of Python, Java, Node.js/TypeScript, Go, C#, or Rust [S11]
- **Required:** SQL (relational) + at least one NoSQL (Redis, MongoDB, DynamoDB) [S11]

**Fullstack Engineer:**
- **Required:** JavaScript/TypeScript (frontend) + one backend language (Python/Java/Node.js/Go) [S11]
- **Recommended:** Node.js/TypeScript to avoid learning two languages [S11]
- **Note:** Small teams (<10 engineers) prefer fullstack hires; large teams separate frontend and backend [S11]

**Data Engineering:**
- **Required:** Python, SQL (DDL/DML/advanced queries) [S11]
- **Optional:** Scala (for Spark), Java (for Hadoop) [S11]
- **Often tested:** Data pipeline design, ETL, schema optimization [S11]

**Inference for Pipe's MVP template packs:**

| Role | Minimum Languages | Stretch |
|---|---|---|
| **FRONTEND** | JavaScript/TypeScript | TypeScript only (test with both) |
| **BACKEND** | Python, Java | Rust, Go |
| **FULLSTACK** | JavaScript/TypeScript, Python | Node.js/TypeScript option |
| **DATA_ENGINEERING** | Python, SQL | Scala |

**Recommendation:** Launch with **Python + JavaScript/TypeScript** as the core dual-language foundation. All role packs support these two. Add Java for backend-heavy packs in Phase 2.

---

### 4. Test Blueprint and Content Coverage

#### 4.1 Assessment Blueprint Standards

A **test blueprint** (or Table of Specifications) defines:
- Content areas and topics to cover [S20]
- Relative emphasis per topic (percentage of items) [S20]
- Depth of Knowledge (DOK) levels per item [S20]
- Cognitive complexity distribution (e.g., remember/understand/apply per Bloom's taxonomy) [S19][S20]

**Standardized assessments use blueprints for validity:**
- SAT, GRE, GMAT: design item pools 2–4× larger than the final test set to ensure statistical reliability and coverage [S27]
- Multistage tests (MSTs) and computerized adaptive tests (CATs) verify blueprints using computer simulations before deployment [S27]
- Item difficulty distribution: most items at 60–70% difficulty (P-value); fewer extremely easy/hard items [S27]

**For Pipe's interviews:** A template pack should include a blueprint mapping challenges to skills/competencies and specifying relative weight (e.g., "System Design 40%, Algorithms 30%, Debugging 30%").

#### 4.2 Item Metadata Standards

Critical metadata fields [S19][S20]:
- **Identifier** — unique challenge ID
- **PrimaryStandard** — main skill being tested (e.g., "Async/Await Patterns")
- **SecondaryStandard(s)** — additional skills (e.g., "Error Handling", "Testing")
- **Difficulty** — Bloom's level (remember, understand, apply, analyze, evaluate, create) [S19]
- **DOK (Depth of Knowledge)** — 1 (recall) to 4 (extended thinking) [S20]
- **Role Applicability** — which role types benefit from this challenge [S19]
- **Language Support** — array of languages [custom to Pipe]

**Smarter Balanced, TAO, and IMS standards converge on these fields** [S19][S22].

---

### 5. Data Modeling Recommendations for Pipe

#### 5.1 Core Tables (D1 SQLite)

```sql
-- Template pack definition (immutable versions)
CREATE TABLE template_packs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role_type TEXT NOT NULL CHECK (role_type IN ('FRONTEND', 'BACKEND', 'FULLSTACK', 'DATA_ENGINEERING')),
  seniority_range TEXT NOT NULL CHECK (seniority_range IN ('JUNIOR', 'MID', 'SENIOR')),
  version INTEGER NOT NULL,
  description TEXT,
  skills JSON NOT NULL,  -- ["async-patterns", "error-handling", "testing"]
  supported_languages JSON NOT NULL,  -- ["javascript", "typescript", "python"]
  is_published BOOLEAN DEFAULT FALSE,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(id, version)
);

-- Challenge definition (immutable, referenced by multiple packs)
CREATE TABLE challenges (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('CODE_IMPLEMENTATION', 'QUIZ_MCQ', 'QUIZ_SHORT_ANSWER', 'CODE_REVIEW')),
  title TEXT NOT NULL,
  instructions TEXT NOT NULL,
  difficulty TEXT NOT NULL CHECK (difficulty IN ('JUNIOR', 'MID', 'SENIOR')),
  primary_skill TEXT,
  secondary_skills JSON,  -- ["testing", "debugging"]
  config JSON NOT NULL,   -- Type-specific: CODE_IMPLEMENTATION has files, testCommand, etc.
  server_config JSON,     -- Language-specific test harness, expected outputs, etc.
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Challenge language variants
CREATE TABLE challenge_language_variants (
  challenge_id TEXT NOT NULL,
  language TEXT NOT NULL,
  starter_code TEXT NOT NULL,
  test_framework TEXT NOT NULL,  -- "jest", "pytest", "junit", etc.
  test_template TEXT NOT NULL,
  PRIMARY KEY (challenge_id, language),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id)
);

-- Template pack composition (which challenges, in what order)
CREATE TABLE template_pack_challenges (
  template_pack_id TEXT NOT NULL,
  template_pack_version INTEGER NOT NULL,
  challenge_id TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  PRIMARY KEY (template_pack_id, template_pack_version, challenge_id),
  FOREIGN KEY (template_pack_id, template_pack_version) REFERENCES template_packs(id, version),
  FOREIGN KEY (challenge_id) REFERENCES challenges(id)
);

-- Stage references a specific template pack version (snapshot)
CREATE TABLE stages (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  name TEXT NOT NULL,
  template_pack_id TEXT NOT NULL,
  template_pack_version INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_pack_id, template_pack_version) REFERENCES template_packs(id, version)
);
```

#### 5.2 Challenge Config Schema (JSON)

**For CODE_IMPLEMENTATION:**
```json
{
  "languages": ["javascript", "typescript", "python"],
  "files": {
    "javascript": {
      "starter_code": "function solution(arr) { ... }",
      "test_suite": "describe('solution', () => { ... })",
      "test_framework": "jest",
      "entry_point": "solution",
      "test_command": "jest"
    },
    "python": {
      "starter_code": "def solution(arr): ...",
      "test_suite": "class TestSolution(unittest.TestCase): ...",
      "test_framework": "unittest",
      "entry_point": "solution",
      "test_command": "python -m pytest"
    }
  },
  "resource_limits": {
    "cpu_time_seconds": 5,
    "memory_mb": 256,
    "execution_timeout_seconds": 10
  }
}
```

**For QUIZ_MCQ:**
```json
{
  "question": "What is async/await?",
  "options": ["A", "B", "C", "D"],
  "correct_answer": "A",
  "explanation": "..."
}
```

#### 5.3 Integration with Code Execution (Judge0)

When a candidate submits code:
1. Worker retrieves challenge + language variant from D1
2. Constructs submission: starter code + candidate edits + test suite
3. Sends to Judge0 API with language ID, source code, and stdin (if needed)
4. Judge0 returns result (success/failure, output, runtime, memory used)
5. Worker stores attempt in candidate_attempts table
6. Scoring agent uses attempt result + rubric to assign points

---

### 6. Pack Composition and User-Created Packs

**System Default Packs (Pipe-authored):**
- FRONTEND_JUNIOR, FRONTEND_MID, FRONTEND_SENIOR
- BACKEND_JUNIOR, BACKEND_MID, BACKEND_SENIOR
- FULLSTACK_JUNIOR, FULLSTACK_MID, FULLSTACK_SENIOR
- DATA_ENGINEERING_JUNIOR, DATA_ENGINEERING_MID (stretch)

**User-Created Packs (recruiter-authored):**
- Recruiters can duplicate a system pack or start blank
- Drag-and-drop reorder challenges, add/remove challenges from the library
- Cannot modify individual challenges (immutable); can only compose new pack versions
- Versioning: each save creates a new version; pack must be "published" before use in pipelines

**Constraint:** Once a pack is used in a live pipeline (candidate invited), that version is locked. Subsequent pack changes do not affect in-flight interviews.

---

## Open Questions / Gaps

1. **Generator complexity:** Build the Qualified.io-style YAML generator, or hardcode per-language test templates in config and let challenge authors provide variants manually? (Generator is ~2–3 weeks of work for comprehensive multi-language support; hardcoding is faster to MVP.)

2. **Private vs. public packs:** Should recruiters be able to share custom packs with other recruiters? Requires pack versioning on the API side + pack ownership model.

3. **Branching/rollback:** If a recruiter publishes a pack, realizes a challenge has a bug, and wants to revert, should they roll back to the previous version or create a patch? (Recommend: create patch version; previous version becomes archived but accessible for audit.)

4. **Complex language support (Rust, Go, Scala):** These require specialized test runners and are lower-demand in hiring. Defer beyond MVP.

5. **Scoring per language:** Is JavaScript solution expected to solve the same problem as Python? Should difficulty/rubrics differ? (Recommend: challenge is role/skill agnostic; candidate picks language; scoring is identical per language.)

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | IMS QTI v3.0 defines interoperable assessment content exchange standard | [1EdTech QTI v3 Overview](https://www.imsglobal.org/spec/qti/v3p0/oview) | 2024 | Vendor standard | High |
| S2 | QTI enables item pools with metadata for role/skill/difficulty tagging | [IMS QTI Wikipedia](https://en.wikipedia.org/wiki/QTI) + [Assess.com QTI Overview](https://assess.com/question-and-test-interoperability-qti/) | 2024 | Educational standard | High |
| S3 | Templates are immutable post-release; new versions created, never in-place modifications | [Design for Scale: Immutability & Versioning](https://jinpeng007.substack.com/p/design-for-scale-6-immutability-versioning) | 2024 | Engineering blog | Medium |
| S4 | Governance of templates scales only with clear versioning policy + test suite per template | Design for Scale blog (S3) | 2024 | Engineering blog | Medium |
| S5 | CodeSignal supports 45+ languages per assessment; 628K+ variations per question | [CodeSignal Framework Docs](https://support.codesignal.com/hc/en-us/articles/10656138860823-What-languages-environments-are-available-per-framework) | 2026 | Vendor documentation | High |
| S6 | Judge0 CE supports 60+ languages; open-source, self-hostable, free tier via RapidAPI | [Judge0 GitHub](https://github.com/judge0/judge0) + [Judge0 CE RapidAPI](https://rapidapi.com/judge0-official/api/judge0-ce) | 2026 | Open-source documentation | High |
| S7 | Pyodide compiles CPython to WebAssembly for browser-based Python execution; includes NumPy, Pandas, SciPy | [Pyodide Documentation](https://pyodide.com/) | 2025 | Project documentation | High |
| S8 | JavaScript/TypeScript (31% of jobs), Python (20%), Java (15%), C# (12%), PHP (10%) most requested 2023–2024 | [Statista & Devjobs Scanner](https://www.statista.com/statistics/1296727/programming-languages-demanded-by-recruiters/) | 2024 | Hiring market data | High |
| S9 | Piston API no longer freely available as of Feb 15, 2026; restricted to non-commercial/educational use | [Piston GitHub](https://github.com/engineer-man/piston) + search results | 2026 | Project status | High |
| S10 | Qualified.io Language Generator: single YAML config generates boilerplate + test suites per language | [Qualified Language Generator Docs](https://docs.qualified.io/reference/features/challenges/code/language-generator/) | 2026 | Vendor documentation | High |
| S11 | Frontend requires JavaScript/TypeScript + framework; Backend requires one backend language + SQL; Fullstack prefers Node.js/TS | [GitLab Handbook, Roadmap.sh, Medium](https://handbook.gitlab.com/job-families/engineering/development/fullstack/) | 2026 | Industry job descriptions | High |
| S12 | HackerRank organizes challenges by role (data science, DevOps, fullstack); Codility by skill; LeetCode by difficulty | [Whizzteams Comparison](https://www.whizzteams.com/blog/best-technical-assessment-platforms) | 2024 | Assessment platform comparison | Medium |
| S13 | HackerRank uses DSL-based code stubs to auto-generate language-specific boilerplate | [Dev.to HackerRank Contest Tutorial](https://dev.to/themysterysolver/how-to-create-a-hackerrank-contest-2fk) | 2024 | Community tutorial | Medium |
| S14 | Sphere Engine: 80+ languages, REST API, multi-file support, isolated execution mode | [Sphere Engine Docs](https://sphere-engine.com) | 2025 | Vendor documentation | High |
| S15 | Moodle question bank: separate tables for question definitions (once) and attempts (immutable); supports versioning | [Moodle Question DB Structure](https://docs.moodle.org/dev/Question_database_structure) | 2024 | LMS documentation | High |
| S16 | Cloudflare Workers: JavaScript, TypeScript, Python, Rust natively; C, C++, Kotlin, Go via WASM | [Cloudflare Workers Languages Docs](https://developers.cloudflare.com/workers/languages/) | 2026 | Cloud platform documentation | High |
| S17 | Pyodide: near-native speed; limitations: browser memory sandbox, precompiled packages, network latency | [Pyodide How-It-Works](https://pyodide.com/how-does-pyodide-work/) | 2025 | Project documentation | High |
| S18 | Judge0: 60+ languages, configurable CPU (2–15s), memory (128–256MB), wall-clock (5–20s) limits, multi-file support | [Judge0 API Docs](https://ce.judge0.com/) | 2026 | API documentation | High |
| S19 | Assessment metadata: Identifier, PrimaryStandard, SecondaryStandard(s), Difficulty (Bloom's level), DOK, Role Applicability | [TAO & Smarter Balanced on metadata](https://www.taotesting.com/blog/using-test-item-metadata-to-connect-assessment-to-learning/) | 2024 | Assessment standards | High |
| S20 | Test blueprint defines content areas, emphasis %, DOK levels, cognitive complexity; validity requirement | [NCES Rapid Blueprinting](https://pmc.ncbi.nlm.nih.gov/articles/PMC11055819/) + [Assess.com](https://assess.com/test-blueprints-specifications/) | 2024–2025 | Assessment research + vendor guidance | High |
| S21 | Qualified Language Generator: YAML config → language-specific boilerplate; supports primitive types; limits complex objects | [Qualified Docs](https://docs.qualified.io/reference/features/challenges/code/language-generator/) | 2026 | Vendor documentation | High |
| S22 | TAO: QTI v2.2 certified; import/export QTI, RDF, CSV; API support for programmatic access | [TAO User Guide](https://www.taotesting.com/user-guide/managing-test-materials/importing-items/) | 2024 | LMS documentation | High |
| S23 | Jest (JavaScript): 40.9K stars, 19M weekly downloads, built-in mocking/assertions. Mocha: 21.8K stars, 7M downloads, requires external libs. | [Jest Docs](https://jestjs.io/) + [Raygun framework comparison](https://raygun.com/blog/javascript-unit-testing-frameworks/) | 2024–2025 | Testing framework docs + analysis | High |
| S24 | Qualified Language Generator: maps describe/it structure to Mocha (JS), pytest (Python), NUnit (C#), JUnit (Java) | [Qualified blog](https://www.qualified.io/blog/posts/create-coding-assessments-in-multiple-languages-with-the-push-of-a-button) | 2025 | Vendor blog | High |
| S25 | SAT/GRE/GMAT: item pool 2–4× larger than final test; blueprints verified via simulation; most items at 60–70% P-value difficulty | [Pearson CAT Research](https://www.pearsonassessments.com/content/dam/school/global/clinical/us/assets/testnav/research-report-cat-for-k-12-assessments.pdf) + [PMC MST design](https://pmc.ncbi.nlm.nih.gov/articles/PMC7425329/) | 2024–2025 | Psychometrics research | High |
| S26 | UiPath Automation Hub: assessments versioned; can copy existing, start fresh, or reuse via download/upload | [UiPath Docs](https://docs.uipath.com/automation-hub/automation-cloud/latest/user-guide/new-customize-assessments) | 2024 | Platform documentation | Medium |
| S27 | Frontend: JS/TS + framework; Backend: one of Python/Java/Node/Go + SQL; Fullstack: JS/TS + Python/Java; Data: Python + SQL | [Roadmap.sh job descriptions](https://roadmap.sh/backend/job-description) | 2025 | Industry consensus | High |

---

## Direct Implications for Pipe

1. **Adopt immutable versioning from day one:** Once a template pack is published and assigned to a pipeline, lock that version. Future updates create new pack versions, never modify in-place. Store `template_pack_version` on stages.

2. **Launch with Python + JavaScript/TypeScript only:** These two languages cover all four role types (frontend, backend, fullstack, data) and represent 51% of job market demand. Go live without Java/Go/Rust complexity.

3. **Use Judge0 CE for code execution:** Open-source, 60+ languages, self-hostable, configurable resource limits. Integrate as external API; Workers cannot natively evaluate arbitrary code.

4. **Build metadata-driven challenge composition, not hardcoded library:** Move from `challengeLibrary.ts` constant to D1 tables: challenges (immutable), challenge_language_variants, template_packs (versioned compositions). This enables recruiter-created custom packs and future scaling.

5. **Generate language-specific test harnesses from single source:** If launching MVP quickly, store YAML per challenge in D1; build a lightweight Qualified.io-style generator. (If time is short, hardcode per-language variants in config JSON and let challenge authors provide both at once—slower to create packs, but simpler implementation.)

6. **Include metadata in challenge definitions:** Difficulty (junior/mid/senior), primary_skill, secondary_skills. Use these for pack blueprinting and candidate feedback post-interview.

7. **Snapshot pack at stage assignment:** When a recruiter assigns a template pack to a stage/pipeline, record the pack ID and version. Subsequent pack updates do not affect live candidate sessions—critical for fairness and audit compliance.

---

## Sources

- [1EdTech Question & Test Interoperability v3.0 Overview](https://www.imsglobal.org/spec/qti/v3p0/oview)
- [IMS QTI — Wikipedia](https://en.wikipedia.org/wiki/QTI)
- [Assessment Systems: Question and Test Interoperability (QTI) Overview](https://assess.com/question-and-test-interoperability-qti/)
- [Design for Scale: Immutability, Versioning and Idempotent Change](https://jinpeng007.substack.com/p/design-for-scale-6-immutability-versioning)
- [CodeSignal: What languages/environments are available per framework?](https://support.codesignal.com/hc/en-us/articles/10656138860823-What-languages-environments-are-available-per-framework)
- [Judge0 CE — GitHub](https://github.com/judge0/judge0)
- [Judge0 CE RapidAPI](https://rapidapi.com/judge0-official/api/judge0-ce)
- [Pyodide Documentation — Run Python in Browser with WebAssembly](https://pyodide.com/)
- [Statista: Programming languages demanded by recruiters 2024](https://www.statista.com/statistics/1296727/programming-languages-demanded-by-recruiters/)
- [DevJobs Scanner: Top 8 Most Demanded Programming Languages in 2024](https://www.devjobsscanner.com/blog/top-8-most-demanded-programming-languages-in-2024/)
- [Piston GitHub — High Performance General Purpose Code Execution Engine](https://github.com/engineer-man/piston)
- [Qualified.io: Create coding assessments in multiple languages with the push of a button](https://www.qualified.io/blog/posts/create-coding-assessments-in-multiple-languages-with-the-push-of-a-button)
- [Qualified.io Docs: Classic Code Challenge Language Generator](https://docs.qualified.io/reference/features/challenges/code/language-generator/)
- [GitLab Handbook: Fullstack Engineers](https://handbook.gitlab.com/job-families/engineering/development/fullstack/)
- [Roadmap.sh: Backend Developer Job Description (2026 Template)](https://roadmap.sh/backend/job-description)
- [Whizzteams: Best Technical Assessment Platforms 2025](https://www.whizzteams.com/blog/best-technical-assessment-platforms)
- [Dev.to: How to create a HackerRank Contest?](https://dev.to/themysterysolver/how-to-create-a-hackerrank-contest-2fk)
- [Sphere Engine Documentation](https://sphere-engine.com)
- [Moodle: Question database structure](https://docs.moodle.org/dev/Question_database_structure)
- [Cloudflare Workers: Languages documentation](https://developers.cloudflare.com/workers/languages/)
- [Pyodide: How does Pyodide work?](https://pyodide.com/how-does-pyodide-work/)
- [Judge0 CE API Documentation](https://ce.judge0.com/)
- [TAO Testing: Using Test Item Metadata to Connect Assessment to Learning](https://www.taotesting.com/blog/using-test-item-metadata-to-connect-assessment-to-learning/)
- [NCES: Rapid Blueprinting: An Efficient Method for Designing Content of Assessments](https://pmc.ncbi.nlm.nih.gov/articles/PMC11055819/)
- [Assessment Systems: What are Test Blueprints & Specifications for Assessment?](https://assess.com/test-blueprints-specifications/)
- [Jest Documentation](https://jestjs.io/)
- [Raygun Blog: JavaScript unit testing frameworks in 2024](https://raygun.com/blog/javascript-unit-testing-frameworks/)
- [TAO User Guide: Importing items](https://www.taotesting.com/user-guide/managing-test-materials/importing-items/)
- [Pearson: Research Report on Computerized Adaptive Testing for K-12](https://www.pearsonassessments.com/content/dam/school/global/clinical/us/assets/testnav/research-report-cat-for-k-12-assessments.pdf)
- [PMC: The Optimal Item Pool Design in Multistage Computerized Adaptive Tests](https://pmc.ncbi.nlm.nih.gov/articles/PMC7425329/)
- [UiPath Automation Hub: Create an Assessment Blueprint](https://docs.uipath.com/automation-hub/automation-cloud/latest/user-guide/new-customize-assessments)
