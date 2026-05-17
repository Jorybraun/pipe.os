# Base Repo Discovery for the Hybrid AIG Content Pipeline

**Synthesis of R1 (discovery tools), R2 (quality criteria), R3 (role-to-repo matching)** · 2026-04-09

---

## Executive summary

PIPE's hybrid AIG pipeline needs real open-source repos as code skeletons — matched to the role a recruiter defined, at the right complexity for the seniority level, and with a working test suite for execution-based ground truth. The research converges on a **four-stage pipeline**: discover repos by dependency (not just language), verify quality via benchmark-derived criteria, match complexity to seniority, and curate manually for niche stacks.

Three key findings change the plan:

1. **Discovery should be dependency-first, not language-first.** Libraries.io `dependent_repositories` and Sourcegraph manifest search find repos that actually use React/Django/Spring — not just repos tagged "JavaScript." GitHub topics are a supplement, not the primary signal.

2. **specfy/stack-analyser is the single most useful tool.** Open-source TypeScript library that detects 700+ technologies via manifest parsing + file pattern matching. Used in production (getstack.dev, 50k repos/week). PIPE should adopt it directly rather than building custom parsers.

3. **Repo quality for assessment has a well-established benchmark.** Multiple benchmarks converge on quality filters — though with different star thresholds: SWE-bench selects by PyPI popularity (no star filter), SWE-Bench++ uses >100 stars, Multi-SWE-bench uses >500 stars. All agree on: active maintenance, CI/CD present, deterministic test suite, permissive license. PIPE should adopt ≥500 stars as its floor (Multi-SWE-bench threshold), with the other criteria as hard requirements.

No existing assessment platform does what PIPE does — based on publicly available vendor documentation as of April 2026, HackerRank maps JDs to a fixed question bank; CodeSignal uses static certified assessments. None derive assessments dynamically from open-source codebases matched to a role (internal pipelines may differ). PIPE's approach is genuinely differentiated.

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
Searches actual file contents across 2M+ indexed repos. No documented per-minute rate limit on streaming; no hard 1,000-result cap.

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
| GitHub stars | ≥500 (Multi-SWE-bench threshold [R2-S4]); SWE-Bench++ uses >100 [R2-S5]; SWE-bench uses PyPI popularity, no star filter [R2-S1] | Multi-SWE-bench [R2-S4], SWE-Bench++ [R2-S5] |
| Active maintenance | Commits within 6 months | Multi-SWE-bench [R2-S4] |
| CI/CD present | GitHub Actions or equivalent | Multi-SWE-bench [R2-S4] |
| Test suite | Exists, executable, deterministic | Universal across all benchmarks |
| Test determinism | Triple-execution flakiness detection | SWE-Bench++ [R2-S5] |
| Codebase size | ≥10k LOC | SWE-Bench++ [R2-S5] |
| File count | 10–50 source files (for cross-file tasks) | CrossCodeEval [R2-S8] |
| Permissive license | MIT, Apache-2.0, BSD | CrossCodeEval [R2-S8], FEA-Bench [R2-S6] |
| Temporal freshness | Post-training-cutoff (principle: CrossCodeEval [R2-S8], RepoMasterEval [R2-S11]; specific date 2024-07-01 is PIPE's own gate from parent research) | CrossCodeEval [R2-S8], RepoMasterEval [R2-S11] |
| PRs modify test files | At least one test transitions fail→pass | SWE-Bench [R2-S1], SWE-Bench++ [R2-S5] |

### 2.2 Anti-patterns (what makes a repo BAD)

1. **No test suite** — universal disqualifier. No tests = no execution-based ground truth for planted bugs.
2. **Flaky tests** — SWE-Bench++ explicitly triple-executes to detect flakiness, treating it as disqualifying [R2-S5].
3. **Complex non-standard build systems** — C++ repos yielded only 9.5% usable instances vs. 41% for Python [R2-S5].
4. **Excessive domain specificity** — SWE-bench's astronomy/data-science skew is its most-cited limitation [R2-S3]. Repos requiring deep domain knowledge measure domain familiarity, not engineering judgment.
5. **Too simple** (<10 files) — lacks cross-file reasoning challenges [R2-S8].
6. **Too complex** (>50 source files per CrossCodeEval [R2-S8]) — navigation overhead dominates signal. Senior-level ceiling is unquantified in the literature; PIPE should calibrate empirically.
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

---

## Sources

### R1 — Discovery Tools and APIs

1. **[R1-S1] SEART GitHub Search web tool** — seart-ghs.si.usi.ch (live tool, accessed 2026-04-09): https://seart-ghs.si.usi.ch/ [dead link — SSL certificate error, could not verify]

2. **[R1-S2] Dabic, O., Tufano, R., Bavota, G. — "SEART Data Hub: Streamlining Large-Scale Source Code Mining and Pre-Processing"** — ICSME 2024 Tool Demo Track; arXiv:2409.18658 (2024): https://arxiv.org/abs/2409.18658 [verified]

3. **[R1-S3] seart-group/ghs GitHub repository** — open-source codebase and README: https://github.com/seart-group/ghs [not spot-checked]

4. **[R1-S4] GitHub Docs — REST API endpoints for search** (apiVersion=2022-11-28): https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28 [verified]

5. **[R1-S5] GitHub Docs — Searching for repositories** (full qualifier reference): https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories [not spot-checked]

6. **[R1-S6] GitHub Docs — Rate limits for the REST API**: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api [not spot-checked]

7. **[R1-S7] Simon Willison — "Accessing repository dependencies in the GitHub GraphQL API"** (TIL blog): https://til.simonwillison.net/github/dependencies-graphql-api [verified]

8. **[R1-S8] Libraries.io homepage** — package count and manager coverage: https://libraries.io/ [not spot-checked]

9. **[R1-S9] Libraries.io API documentation** — endpoint reference including `dependent_repositories`: https://libraries.io/api [verified]

10. **[R1-S10] Nesbitt, A. — "Our second Libraries.io open data release has arrived"** (Medium): https://medium.com/libraries-io/our-second-libraries-io-open-data-release-has-arrived-703422b1ad88 [verified]

11. **[R1-S11] deps.dev BigQuery dataset documentation** — table schema and ecosystem coverage: https://docs.deps.dev/bigquery/v1/ [not spot-checked]

12. **[R1-S12] deps.dev REST API v3alpha reference** — endpoint listing: https://docs.deps.dev/api/v3alpha/ [not spot-checked]

13. **[R1-S13] Sourcegraph — Search Query Language Reference**: https://sourcegraph.com/docs/code-search/queries [verified]

14. **[R1-S14] Sourcegraph — Stream API documentation**: https://docs.sourcegraph.com/api/stream_api [verified — redirects to https://sourcegraph.com/docs/api/stream_api]

15. **[R1-S15] Sourcegraph — GraphQL API documentation**: https://sourcegraph.com/docs/api/graphql [not spot-checked]

16. **[R1-S16] Sourcegraph — Pricing plans changelog (Oct 2025)**: https://sourcegraph.com/changelog/introducing-pricing-plans-and-major-updates-for-deep-search [not spot-checked]

17. **[R1-S17] Mockus, A. et al. — "World of Code: Enabling a Research Workflow for Mining and Analyzing the Universe of Open Source VCS Data"** — Empirical Software Engineering (Springer, 2021): https://link.springer.com/article/10.1007/s10664-020-09905-9 [not spot-checked]

18. **[R1-S18] npm Registry API documentation** — search and package endpoints: https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md [not spot-checked]

19. **[R1-S19] npm/registry-issue-archive — Issue #231: API to list package dependents**: https://github.com/npm/registry-issue-archive/issues/231 [not spot-checked]

20. **[R1-S20] EvanLi/Github-Ranking** — daily auto-updated top repo lists by language: https://github.com/EvanLi/Github-Ranking [not spot-checked]

### R2 — Repo Quality Criteria

21. **[R2-S1] Jimenez et al. — "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?"** (ICLR 2024): https://arxiv.org/abs/2310.06770 [verified]

22. **[R2-S2] SWE-bench ar5iv full text** (readable HTML): https://ar5iv.labs.arxiv.org/html/2310.06770 [not spot-checked]

23. **[R2-S3] "What skills does SWE-bench Verified evaluate?"** — Epoch AI: https://epoch.ai/blog/what-skills-does-swe-bench-verified-evaluate/ [not spot-checked]

24. **[R2-S4] "Multi-SWE-bench: A Multilingual Benchmark for Issue Resolving"** — ByteDance Seed (2025): https://arxiv.org/pdf/2504.02605 [verified — PDF loads]

25. **[R2-S5] "SWE-Bench++: A Framework for the Scalable Generation of Software Engineering Benchmarks from Open-Source Repositories"** (2025): https://arxiv.org/html/2512.17419v1 [verified]

26. **[R2-S6] "FEA-Bench: A Benchmark for Evaluating Repository-Level Code Generation for Feature Implementation"** — Microsoft Research (ACL 2025): https://arxiv.org/html/2503.06680v2 [not spot-checked]

27. **[R2-S7] "Can Language Models Replace Programmers for Coding? RepoCod Says 'Not Yet'"** — Purdue University (ACL 2025): https://arxiv.org/html/2410.21647 [not spot-checked]

28. **[R2-S8] "CrossCodeEval: A Diverse and Multilingual Benchmark for Cross-File Code Completion"** — Amazon Science (NeurIPS 2023): https://github.com/amazon-science/cceval [not spot-checked]

29. **[R2-S9] "RepoBench: Benchmarking Repository-Level Code Auto-Completion Systems"** (ICLR 2024): https://arxiv.org/abs/2306.03091 [not spot-checked]

30. **[R2-S10] "ExecRepoBench: Multi-level Executable Code Completion Evaluation"** (2024): https://arxiv.org/abs/2412.11990 [not spot-checked]

31. **[R2-S11] "RepoMasterEval: Evaluating Code Completion via Real-World Repositories"** (2024): https://arxiv.org/abs/2408.03519 [not spot-checked]

32. **[R2-S12] "How Qodo Built a Real-World Benchmark for AI Code Review"** — Qodo (2024): https://www.qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review/ [not spot-checked]

33. **[R2-S13] "What makes a good code review benchmark for AI tools?"** — Qodo (2024): https://www.qodo.ai/blog/what-makes-a-good-code-review-benchmark-for-ai-tools/ [not spot-checked]

34. **[R2-S14] "DevBench: A Comprehensive Benchmark for Software Development"** (2024): https://arxiv.org/html/2403.08604v1 [not spot-checked]

35. **[R2-S15] "Using a Code Review Assessment to Assess Software Engineering Talent"** — Hatchways (2024): https://www.hatchways.io/blog/code-review-assessment-to-assess-engineers [not spot-checked]

36. **[R2-S16] "Interviews in the Age of AI: Ditch Leetcode — Try Code Reviews Instead"** — Charles Chen (Medium, 2024): https://chrlschn.medium.com/interviews-in-the-age-of-ai-ditch-leetcode-try-code-reviews-instead-9639d7bfd9d4 [not spot-checked]

37. **[R2-S17] "Show HN: CodeRev.app — Code Review as Interview"** — Hacker News discussion (2024): https://news.ycombinator.com/item?id=39428766 [not spot-checked]

38. **[R2-S18] "SWE-bench Verified Explained: What the Coding Agent Leaderboard Actually Measures"** — Groundy (2024): https://groundy.com/articles/swe-bench-verified-explained-what-the-coding-agent-leaderboard-actually-measures-and-what-it-misses/ [not spot-checked]

### R3 — Role-to-Repo Matching

39. **[R3-S1] GitHub Dependency Graph — how it recognizes dependencies** (GitHub Docs, 2024): https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-graph-data [not spot-checked]

40. **[R3-S2] Simon Willison — "Accessing repository dependencies in the GitHub GraphQL API"** (TIL blog, 2023): https://til.simonwillison.net/github/dependencies-graphql-api [verified — same URL as R1-S7]

41. **[R3-S3] Dependency graph supported package ecosystems** (GitHub Docs, 2024): https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems [not spot-checked]

42. **[R3-S4] REST API endpoints for dependency submission** (GitHub Docs, 2024): https://docs.github.com/en/rest/dependency-graph/dependency-submission [not spot-checked]

43. **[R3-S5] "OWASP Dependency Check: How It Works"** — Mend.io (2024): https://www.mend.io/blog/owasp-dependency-check/ [not spot-checked]

44. **[R3-S6] Dependency scanning** — GitLab Docs (2024): https://docs.gitlab.com/user/application_security/dependency_scanning/ [not spot-checked]

45. **[R3-S7] depcheck** — npm package documentation (2024): https://www.npmjs.com/package/depcheck [not spot-checked]

46. **[R3-S8] specfy/stack-analyser: Extract +700 technologies from any repository** (GitHub, 2024–2026): https://github.com/specfy/stack-analyser [verified]

47. **[R3-S9] getStack — Technology Trends** — getstack.dev (2024–2025): https://getstack.dev [not spot-checked]

48. **[R3-S10] Getting Started: Project Structure** — Next.js official docs (2024): https://nextjs.org/docs/app/getting-started/project-structure [not spot-checked]

49. **[R3-S11] Workspace and project file structure** — Angular official docs (2024): https://angular.dev/reference/configs/file-structure [not spot-checked]

50. **[R3-S12] Django settings** — Django official docs (2024): https://docs.djangoproject.com/en/6.0/topics/settings/ [not spot-checked]

51. **[R3-S13] "StackShare Introduces The Tech Stack File — Universal Standard"** — BusinessWire (2023): https://www.businesswire.com/news/home/20231108514442/en/StackShare-Introduces-The-Tech-Stack-File---The-Universal-Standard-for-Tech-Stack-Data-to-Power-New-AI-Capabilities-and-Partner-Ecosystem [not spot-checked]

52. **[R3-S14] About repository languages** — GitHub Docs (2024): https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-repository-languages [not spot-checked]

53. **[R3-S15] src-d/enry: A faster file programming language detector** (GitHub, 2024): https://github.com/src-d/enry [not spot-checked]

54. **[R3-S16] linguist crate** — crates.io (2024): https://crates.io/crates/linguist [not spot-checked]

55. **[R3-S17] boyter/scc: Sloc, Cloc and Code** (GitHub, 2024): https://github.com/boyter/scc [verified]

56. **[R3-S18] terryyin/lizard: Code complexity analyser** (GitHub, 2024): https://github.com/terryyin/lizard [verified]

57. **[R3-S19] BuiltWith vs Wappalyzer vs DetectZeStack** — DEV Community (2024): https://dev.to/mikel_7c461a5ca8fe80a526e/builtwith-vs-wappalyzer-vs-detectzestack-which-tech-detection-tool-is-right-for-you-1gcb [not spot-checked]

58. **[R3-S20] "Skill-LLM: Repurposing General-Purpose LLMs for Skill Extraction"** — arXiv:2410.12052 (2024): https://arxiv.org/abs/2410.12052 [verified]

59. **[R3-S21] "Extracting skills from content to fuel the LinkedIn Skills Graph"** — LinkedIn Engineering (2023): https://engineering.linkedin.com/blog/2023/extracting-skills-from-content-to-fuel-the-linkedin-skills-graph [not spot-checked]

60. **[R3-S22] "LinkedIn: Building and Deploying LLMs for Skills Extraction at Scale"** — ZenML LLMOps Database (2023): https://www.zenml.io/llmops-database/building-and-deploying-large-language-models-for-skills-extraction-at-scale [not spot-checked]

61. **[R3-S23] "ESCOX: A tool for skill and occupation extraction using LLMs"** — ScienceDirect (2025): https://www.sciencedirect.com/science/article/pii/S2665963825000326 [not spot-checked]

62. **[R3-S24] "Job Description Parsing 101: Everything You Need to Know"** — Recrew.ai (2024): https://www.recrew.ai/blog/job-description-parsing-101 [not spot-checked]

63. **[R3-S25] Pfeiffer et al. — "Automatically Assessing Complexity of Contributions to Git Repositories"** — QUATIC 2021 (SpringerLink): https://link.springer.com/chapter/10.1007/978-3-030-85347-1_9 [not spot-checked]

64. **[R3-S26] Code metrics — Cyclomatic complexity** — Microsoft Learn (2024): https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-cyclomatic-complexity?view=visualstudio [not spot-checked]

65. **[R3-S27] "Seniority level in software engineering and how to assess it"** — madewithlove.com (2024): https://madewithlove.com/blog/seniority-level-in-software-engineering-and-how-to-assess-it/ [not spot-checked]

66. **[R3-S28] "Software Engineer Qualification Levels: Junior, Middle, and Senior"** — AltexSoft (2024): https://www.altexsoft.com/blog/software-engineer-qualification-levels-junior-middle-and-senior/ [not spot-checked]

67. **[R3-S29] "Levels of Seniority"** — roadmap.sh (2024): https://roadmap.sh/guides/levels-of-seniority [not spot-checked]

68. **[R3-S30] Technology | 2025 Stack Overflow Developer Survey**: https://survey.stackoverflow.co/2025/technology [not spot-checked]

69. **[R3-S31] "Pushing test coverage from unsupported languages like Rust or Elixir"** — Sonar Community (2024): https://community.sonarsource.com/t/pushing-test-coverage-from-unsupported-languages-like-rust-or-elixir/37892 [not spot-checked]

70. **[R3-S32] HackerRank vs CodeSignal: Coding Assessment Platform Comparison** — HackerRank (2025): https://www.hackerrank.com/writing/hackerrank-vs-codesignal-coding-assessment-platform-comparison [not spot-checked]

71. **[R3-S33] "Would you still pick Elixir in 2026?"** — GitHub issue, dwyl/learn-elixir (2026): https://github.com/dwyl/learn-elixir/issues/102 [not spot-checked]

72. **[R3-S34] "Generate Technical Assessment Interviews from Job Descriptions with AI"** — HackerRank (2025): https://www.hackerrank.com/writing/generate-technical-assessment-interviews-from-job-descriptions-with-ai-2025 [not spot-checked]

73. **[R3-S35] "New Role-based Developer Skill Assessments"** — HackerRank Blog (2024): https://blog.hackerrank.com/new-role-based-assessments/ [not spot-checked]

74. **[R3-S36] Technical Assessments** — CodeSignal Skills Platform (2025): https://codesignal.com/technical-assessments/ [not spot-checked]

75. **[R3-S37] Codility: Online Coding Tests & Technical Interviews** (2025): https://www.codility.com/ [not spot-checked]

76. **[R3-S38] "Your Guide to Technical Interviews"** — Karat (2025): https://karat.com/guide-to-technical-interviews/ [not spot-checked]

---

## Verifier notes

### Citation correctness

All inline citation markers `[R1-S*]`, `[R2-S*]`, `[R3-S*]` were verified against their respective research files. All citations correctly match the claims they support, with one note:

- **[R3-S20] in Section 3.1 (partial stretch):** The citation is used to support two adjacent claims: (a) "LLM extraction-style prompting produces structured skill lists competitively with fine-tuned models" — this is directly and accurately sourced from R3-S20 (Skill-LLM paper). (b) "PIPE's Role Discovery agent already produces structured output... This maps directly to repo search filters without needing a separate JD parsing step" — this is an internal architectural inference, not drawn from R3-S20 or any other source. The citation [R3-S20] applies only to claim (a). Claim (b) is `[unsourced — flagged for lead]` (internal design assertion requiring no external source, but should not appear to be sourced from the Skill-LLM paper).

### Unsourced claims

- **Section 3.1, sentence: "PIPE's Role Discovery agent already produces structured output: `mustHaveSkills`, `niceToHaveSkills`, domain, seniority. This maps directly to repo search filters without needing a separate JD parsing step"** — This is an internal system design statement, not externally sourced. Currently carries `[R3-S20]` which covers only the adjacent LLM extraction claim. `[unsourced — flagged for lead]` for the architectural assertion itself. (Low risk: this is a factual statement about PIPE's own system design, verifiable internally.)

### Dead links

- **[R1-S1] https://seart-ghs.si.usi.ch/** — SSL certificate verification failed during spot-check (2026-04-09). The site may be live but has a certificate issue. The research file itself describes accessing this as a live tool "accessed 2026-04-09" — the R1 researcher was able to load it. Recommend re-checking directly. Marked `[dead link]` in sources above pending re-verification.

### URL redirects (not dead)

- **[R1-S14] https://docs.sourcegraph.com/api/stream_api** — returns HTTP 302 redirect to `https://sourcegraph.com/docs/api/stream_api`. Final URL resolves correctly. Not a dead link; redirect URL is the canonical current location.

### Additional findings not used in the draft

The following research findings are present in the source files but do not appear in the draft. Listed for the lead's review:

- **R1: World of Code (WoC)** [R1-S17] — 173M repos, 250TB infrastructure, free for academics, requires SSH access application. Not recommended for PIPE (over-engineered, gated on academic access), but documented in R1. Draft correctly omits it from the recommended pipeline.
- **R1: npm Registry API** [R1-S18][R1-S19] — Limited utility for assessment discovery; npm has no dependents endpoint. Draft's tool comparison table omits npm registry as a row (only mentions deps.dev). Not an error — npm registry is correctly assessed as low-utility in R1 and the draft's table focuses on recommended tools.
- **R2: RepoBench** [R2-S9] — 32–128 file range for training set, deduplication against Stack v2. Not cited in draft; the draft uses CrossCodeEval's 10–50 file filter instead, which is more relevant to assessment (not training) use. Not an error.
- **R2: DevBench** [R2-S14] — 22 repos, 45–99% test coverage, 2–7 files, domain diversity. Not cited in draft. Draft correctly focuses on benchmarks with explicit selection criteria that map to PIPE's filters.
- **R2: Practitioner sources (R2-S15 through R2-S18)** — Seven approaches to review material (Au Naturel, Bug Hunter, etc.); real codebases > synthetic exercises; monoculture warning. These findings are present in R2 but not surfaced in the draft. The lead should consider whether the Bug Hunter framework (R2-S16) and monoculture warning (R2-S18) are relevant to the AIG bug-planting pipeline design.
- **R3: LinkedIn production skill extraction system** [R3-S21][R3-S22] — Two-tower BERT model, 39k-skill taxonomy, 80% model size reduction via knowledge distillation. Not cited in draft. R3 correctly notes this is "production-grade" overkill for PIPE MVP; LLM extraction is faster to build.
- **R3: ESCO taxonomy** [R3-S23] — 13,890 skills, 3,008 occupations; LLM-direct linking challenged by hallucinations. Not cited in draft. R3 recommends against ESCO for PIPE MVP; draft correctly omits it.
- **R3: StackShare techstack.yml** [R3-S13] — Self-declared YAML standard, auto-generated via GitHub App. R3 flags this as worth checking during repo discovery. Draft does not mention it; the lead may want to add a check for `techstack.yml` as an optional fast-path in the discovery pipeline.
- **R3: Platforms comparison (HackerRank, CodeSignal, Codility, Karat)** [R3-S34 through R3-S38] — None of existing platforms do dynamic repo-based assessment generation. The draft's executive summary references this finding ("No existing assessment platform does what PIPE does") without citing the platform sources. The claim is well-supported by R3-S34 through R3-S38 and could optionally receive those citations for completeness.
