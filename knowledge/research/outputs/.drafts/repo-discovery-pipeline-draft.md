# Base Repo Discovery for the Hybrid AIG Content Pipeline

**Synthesis of R1 (discovery tools), R2 (quality criteria), R3 (role-to-repo matching)** · 2026-04-09

---

## Executive summary

PIPE's hybrid AIG pipeline needs real open-source repos as code skeletons — matched to the role a recruiter defined, at the right complexity for the seniority level, and with a working test suite for execution-based ground truth. The research converges on a **four-stage pipeline**: discover repos by dependency (not just language), verify quality via benchmark-derived criteria, match complexity to seniority, and curate manually for niche stacks.

Three key findings change the plan:

1. **Discovery should be dependency-first, not language-first.** Libraries.io `dependent_repositories` and Sourcegraph manifest search find repos that actually use React/Django/Spring — not just repos tagged "JavaScript." GitHub topics are a supplement, not the primary signal.

2. **specfy/stack-analyser is the single most useful tool.** Open-source TypeScript library that detects 700+ technologies via manifest parsing + file pattern matching. Used in production (getstack.dev, 50k repos/week). PIPE should adopt it directly rather than building custom parsers.

3. **Repo quality for assessment has a well-established benchmark.** SWE-Bench, Multi-SWE-bench, and SWE-Bench++ converge on concrete thresholds: ≥500 stars, ≥6 months active maintenance, CI/CD present, deterministic test suite, ≥10k LOC, permissive license. These are directly portable as PIPE's quality filters.

No existing assessment platform does what PIPE does — HackerRank maps JDs to a fixed question bank; CodeSignal uses static certified assessments. None derive assessments dynamically from open-source codebases matched to a role. PIPE's approach is genuinely differentiated.

---

## Part 1 — The discovery pipeline

### 1.1 The problem with the current plan

STRATEGY.md CR-13 says "scrape → AIG template → variant generation → execution verification → tag → bank." The scrape step references SEART GHS + GitHub API, but SEART GHS only supports Java and Python (JS/TS on roadmap), cannot filter by framework, and provides batch downloads via email — not a programmatic pipeline. The GitHub Search API has no `dependency:` qualifier and caps at 1,000 results per query.

The actual need is: given a role description that says "Senior Frontend Engineer — React/TypeScript," find repos that **actually use React and TypeScript** and are suitable as assessment skeletons.

### 1.2 Dependency-first discovery

The right primary signal is **what packages a repo declares in its manifest** — not its language tag or topic.

**Libraries.io `dependent_repositories`** [R1-S9] is the highest-leverage discovery endpoint. A single call:
```
GET https://libraries.io/api/npm/react/dependent_repositories?api_key=KEY
```
returns GitHub repos that list `react` as a dependency in their `package.json`. This works across 36+ package managers (npm, PyPI, Maven, Cargo, etc.). Rate limit: 60 req/min, free. For bulk queries, Libraries.io's BigQuery public dataset enables unlimited SQL against 311M+ dependency rows [R1-S10].

**Sourcegraph stream search** [R1-S13][R1-S14] catches repos that Libraries.io misses (very new repos, or repos using unpublished packages):
```
file:package.json "react": repo:has.commit.after(2024-01-01) lang:TypeScript
```
Searches actual file contents across 2M+ indexed repos. No per-minute rate limit on streaming; no hard 1,000-result cap.

**GitHub topic search** [R1-S5] is the fast path for well-tagged repos:
```
topic:react language:typescript stars:>500 pushed:>2024-01-01 license:mit
```
Good precision but imperfect recall — topic tags are user-applied and inconsistent.

**GitHub GraphQL dependency graph** [R1-S7] is a **verifier**, not a discoverer. Given a known repo, it returns all declared packages + versions + package managers. Useful for confirming a candidate repo's full stack profile after discovery.

### 1.3 The role of SEART GHS

SEART GHS [R1-S1][R1-S2] currently supports Java and Python only (JS/TS on roadmap). It filters by language, stars, commits, contributors, and license — but not by framework. No documented REST API; batch web form → email download.

**Verdict:** Useful for bootstrapping Java/Python backend corpora. Not useful for frontend or polyglot roles until JS/TS support ships. Requires a downstream dependency scan after download.

### 1.4 Recommended discovery flow

```
Role Discovery persona → {mustHaveSkills, niceToHaveSkills, seniority, domain}
    ↓
For each must-have package (e.g., "react", "next", "prisma"):
    Libraries.io dependent_repositories → candidate repo list
    ↓
Quality pre-filter (GitHub API):
    stars ≥ 500, pushed > freshness gate, archived:false, fork:false, license:mit|apache-2.0|bsd-*
    ↓
Stack verification (GitHub GraphQL dependency graph):
    Confirm ALL must-have packages present in manifests
    ↓
Complexity scoring (scc or lizard on cloned repo):
    SLOC, mean cyclomatic complexity, file count, dependency count
    ↓
Seniority match:
    Compare complexity profile against seniority band thresholds
    ↓
Test suite validation:
    Clone → run tests → triple-execution flakiness check
    ↓
Human review (10% sample):
    Recruiter or PIPE team confirms suitability
    ↓
Accepted into item bank → AIG bug planting
```

---

## Part 2 — Repo quality criteria

### 2.1 What the benchmarks agree on

Every major benchmark (SWE-Bench, Multi-SWE-bench, SWE-Bench++, FEA-Bench, CrossCodeEval, Qodo) independently converged on similar quality filters. The consensus:

| Signal | Threshold | Evidence |
|---|---|---|
| GitHub stars | ≥500 (general) or ≥2,000 (senior track) | Multi-SWE-bench [R2-S4], RepoCod [R2-S7] |
| Active maintenance | Commits within 6 months | Multi-SWE-bench [R2-S4] |
| CI/CD present | GitHub Actions or equivalent | Multi-SWE-bench [R2-S4] |
| Test suite | Exists, executable, deterministic | Universal across all benchmarks |
| Test determinism | Triple-execution flakiness detection | SWE-Bench++ [R2-S5] |
| Codebase size | ≥10k LOC | SWE-Bench++ [R2-S5] |
| File count | 10–50 source files (for cross-file tasks) | CrossCodeEval [R2-S8] |
| Permissive license | MIT, Apache-2.0, BSD | CrossCodeEval [R2-S8], FEA-Bench [R2-S6] |
| Temporal freshness | Post-training-cutoff (currently ≥2024-07-01) | CrossCodeEval [R2-S8], RepoMasterEval [R2-S11] |
| PRs modify test files | At least one test transitions fail→pass | SWE-Bench [R2-S1], SWE-Bench++ [R2-S5] |

### 2.2 Anti-patterns (what makes a repo BAD)

1. **No test suite** — universal disqualifier. No tests = no execution-based ground truth for planted bugs.
2. **Flaky tests** — SWE-Bench++ found this is the #1 downstream failure cause [R2-S5].
3. **Complex non-standard build systems** — C++ repos yielded only 9.5% usable instances vs. 41% for Python [R2-S5].
4. **Excessive domain specificity** — SWE-bench's astronomy/data-science skew is its most-cited limitation [R2-S3]. Repos requiring deep domain knowledge measure domain familiarity, not engineering judgment.
5. **Too simple** (<10 files) — lacks cross-file reasoning challenges [R2-S8].
6. **Too complex** (>50 files for junior, >100 for senior) — navigation overhead dominates signal [R2-S8].
7. **Training data contamination** — popular pre-2024 repos are memorized by LLMs and possibly by candidates using AI to prep [R2-S3][R2-S8].
8. **Abandoned repos** — stale dependencies, test regressions, accumulated debt [R2-S4].
9. **PRs with reverts or immediate hotfixes** — corrupted baseline [R2-S12].

---

## Part 3 — Role-to-repo matching

### 3.1 The input is already structured

PIPE's Role Discovery agent already produces structured output: `mustHaveSkills`, `niceToHaveSkills`, domain, seniority. This maps directly to repo search filters without needing a separate JD parsing step [R3-S20]. For raw JDs (e.g., recruiter pastes a JD without using Role Discovery), LLM extraction-style prompting produces structured skill lists competitively with fine-tuned models [R3-S20].

### 3.2 Tech stack detection: specfy/stack-analyser

**specfy/stack-analyser** [R3-S8] is an open-source TypeScript NPM package that detects 700+ technologies by combining:
- **Manifest parsing** — package.json, requirements.txt, go.mod, Cargo.toml, docker-compose.yml, etc.
- **File pattern matching** — next.config.js → Next.js, angular.json → Angular, manage.py → Django, etc.

Output: structured JSON with detected technologies, dependency arrays (name, version, package manager), and inter-component edges.

Used in production by getstack.dev to analyze 50k+ repos weekly [R3-S9].

**For PIPE:** Run stack-analyser on cloned repos to produce a tech stack profile. Compare against the role's `mustHaveSkills`. Score: what percentage of must-have technologies are present?

### 3.3 Zero-clone path: GitHub GraphQL dependency graph

For repos that haven't been cloned yet, the GitHub GraphQL `dependencyGraphManifests` API [R3-S2][R3-S3] returns named packages, versions, and package managers for any public repo. Covers 18+ ecosystems (npm, pip, Cargo, Go modules, Maven, NuGet, etc.). This enables stack verification before deciding to clone.

### 3.4 Seniority-to-complexity mapping

No published study maps quantitative thresholds to seniority for assessment purposes. The following heuristics are derived from benchmark criteria and practitioner frameworks — **these must be calibrated empirically with PIPE's own labeled corpus**:

| Seniority | SLOC | Mean CCN | File count | Stack profile |
|---|---|---|---|---|
| Junior (0–2 yr) | 1k–10k | <5 | 5–15 | 1–2 primary deps, no infra complexity |
| Mid (2–5 yr) | 10k–50k | 5–10 | 15–30 | Multiple integrations (API + auth + data), some testing |
| Senior (5+ yr) | 50k+ | 10–15 hotspots | 30–50 | Full stack, design patterns, extensive tests, CI/CD |
| Staff+ | — | — | 50+ | Monorepo, cross-cutting concerns, platform patterns |

Tools: `scc` [R3-S17] (Go, JSON output, LOC + approximate cyclomatic complexity) or `lizard` [R3-S18] (Python, per-function CCN, 25+ languages).

### 3.5 Niche stack coverage

For stacks where the automated pipeline returns <N quality repos (Elixir, Rust embedded, Kotlin Multiplatform, Zig, Clojure):

1. **Curated fallback list** — manually reviewed and approved repos per niche language.
2. **Synthetic seed repos** — generate a realistic codebase via Claude Opus, then apply AIG on top. Extends the ADR-034 challenge authoring pattern.
3. **Language-transfer assessment** — assess language-agnostic patterns (concurrency model, error handling, ownership) even from simpler repos.
4. **Explicit tier** — Tier 1 (automated: React/TS, Python/Django, Java/Spring, Go) vs. Tier 2 (curated: everything else). System degrades gracefully.

---

## Part 4 — Practical architecture

### 4.1 The pipeline as a script

```
scripts/discover-repos.ts
    Input:  Role Discovery persona JSON
    Output: Candidate repo list with quality scores

    Steps:
    1. Extract must-have packages from persona.mustHaveSkills
    2. Query Libraries.io dependent_repositories for each package
    3. Intersect results (repos that depend on ALL must-have packages)
    4. Filter via GitHub API: stars, pushed date, license, archived, fork
    5. For top N candidates, query GitHub GraphQL dependency graph
    6. Score: stack match % + stars + recency
    7. Output ranked list to stdout / D1 table

scripts/assess-repo-quality.ts
    Input:  Candidate repo URL
    Output: Quality report JSON

    Steps:
    1. Clone repo (shallow, latest commit)
    2. Run specfy/stack-analyser → tech stack JSON
    3. Run scc → SLOC, CCN, file count
    4. Check for test suite (file pattern: *test*, *spec*, pytest.ini, jest.config)
    5. Check for CI/CD (.github/workflows/, .circleci/, Jenkinsfile)
    6. Triple-execute test suite for flakiness
    7. Output quality report with pass/fail per criterion
```

### 4.2 What changes in STRATEGY.md

CR-13's action should be updated from:
> "Build: scrape → AIG template → variant generation → execution verification → tag → bank"

to:
> "Build: role-matched repo discovery (Libraries.io + GitHub API + stack-analyser) → quality assessment → AIG template → variant generation → execution verification → tag → bank"

The "scrape" step is not a generic GitHub scraper — it's a targeted, dependency-aware discovery pipeline driven by the role persona.

### 4.3 Integration with existing PIPE systems

- **Role Discovery agent** → produces the persona that drives discovery
- **CodeReviewPicker** (current UI) → should show repos from the discovery pipeline, not arbitrary GitHub repos
- **AIG pipeline** (Phase 3) → receives quality-assessed repos as skeletons
- **D1 item bank** → stores discovered repos with quality scores and stack profiles
- **Rolling freshness gate** → Libraries.io queries already filter by recency; advance quarterly

---

## Part 5 — What this means for the current UI

The existing `CodeReviewPicker` in `StageConfigPanel.tsx` shows a hardcoded list of repos (`interview-monorepo`, `slopify`) and lets recruiters browse arbitrary GitHub PRs. This should evolve to:

1. **Phase 1 (now):** Show repos from a curated seed list matched to the role's tech stack. The recruiter picks repos, not PRs — each repo becomes a skeleton for the AIG pipeline.
2. **Phase 3 (weeks 9–12):** Replace the seed list with the automated discovery pipeline. The system recommends repos based on the role persona; the recruiter confirms.

The PR-picking UX goes away entirely. The recruiter never manually browses PRs — the pipeline discovers repos, the AIG system plants bugs, and the recruiter reviews the generated assessment.

---

## Open questions

1. **Libraries.io freshness SLA.** How stale can `dependent_repositories` data be? No SLA documented. Mitigation: cross-check via GitHub API `pushed` date.

2. **Seniority thresholds need empirical calibration.** The SLOC/CCN/file-count bands above are educated guesses. PIPE needs a corpus of human-labeled repos to tune them.

3. **GitHub GraphQL dependency graph coverage rate.** What percentage of public repos have a fully populated graph? Repos with unusual layouts or private registries may have gaps.

4. **specfy/stack-analyser accuracy.** No published precision/recall benchmark for its 700-technology detection. Likely good (production use at getstack.dev) but edge cases are unknown.

5. **Legal: GitHub ToS for commercial assessment.** The parent research (R1) flagged that GitHub ToS doesn't clearly authorize using collected code as commercial assessment material. Permissive repo licenses cover the code itself; the collection method is the gray area. Legal review recommended before launch.

6. **Multi-package intersection performance.** A "Senior React/TypeScript/GraphQL" role needs repos that use ALL three. Libraries.io queries are per-package — intersection must be done client-side. For large result sets this could be slow. May need BigQuery for cross-package joins.

---

## Tool comparison summary

| Tool | What it finds | Framework-level? | API? | Rate limit | Cost | Best for |
|---|---|---|---|---|---|---|
| Libraries.io | Repos depending on a package | Yes (via manifest) | REST, 60/min | 60 req/min | Free | Primary discovery |
| GitHub Search API | Repos by language, topic, stars, date | Partial (topic tags) | REST, 30/min | 30 req/min search | Free | Quality pre-filter |
| GitHub GraphQL dep graph | A known repo's dependencies | Yes (per-repo) | GraphQL, 5k/hr | 5k req/hr | Free | Stack verification |
| Sourcegraph | Repos containing specific file content | Yes (file search) | Stream API | No hard limit | Free (public) | Catching untagged repos |
| specfy/stack-analyser | 700+ technologies from a cloned repo | Yes (manifest + patterns) | NPM library | N/A (local) | Free (OSS) | Full stack profiling |
| scc / lizard | LOC, cyclomatic complexity, file count | No | CLI (JSON) | N/A (local) | Free (OSS) | Complexity scoring |
| SEART GHS | Repos by language, stars, license | No | Batch (email) | Async | Free | Java/Python bulk |
| deps.dev (Google) | Package dependency graphs | Yes (per-package) | REST + BigQuery | Undocumented | Free + BQ costs | Cross-package joins |
