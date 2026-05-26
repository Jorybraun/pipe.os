# Research: Repo Quality Criteria for Assessment Use + How Benchmarks Select Repos

_Research brief: R2. Completed 2026-04-09._

---

## Key Findings

### 1. SWE-Bench — Selection of 2,294 Task Instances (Jimenez et al. 2024, ICLR)

SWE-bench (peer-reviewed, ICLR 2024) constructs its benchmark through a three-stage pipeline applied to 12 popular open-source Python repositories [S1].

**Stage I — Repository selection.** The authors started from the top 100 most-downloaded PyPI packages, verified permissive licensing, and collected all pull requests via the GitHub API (approximately 90,000 PRs total). The stated rationale: "popular repositories tend to be better maintained, have clear contributor guidelines, and have better test coverage." [S1][S2]

**Stage II — Attribute-based filtering.** Candidate tasks were created from merged PRs satisfying two conditions: (a) the PR resolves a GitHub issue, and (b) the PR modifies the repository's test files — treating test changes as evidence that the fix is verifiable. [S1]

**Stage III — Execution-based filtering.** For each candidate, the test content was applied and test results logged before and after applying the code patch. Instances were discarded unless at least one test transitioned from fail → pass. Instances causing installation or runtime errors were also removed. Two-thirds of candidate tasks were filtered out at this stage. [S1][S2]

**The 12 repositories** (with task instance counts): django/django (850), sympy/sympy (386), scikit-learn/scikit-learn (229), sphinx-doc/sphinx (187), matplotlib/matplotlib (184), pytest-dev/pytest (119), pydata/xarray (110), astropy/astropy (95), pylint-dev/pylint (57), psf/requests (44), mwaskom/seaborn (22), pallets/flask (11). [S2]

**Known biases.** These repos skew toward data science and scientific computing, excluding web services and microservices. All are Python-only. Being among the most referenced Python codebases on the internet, they are likely well-represented in model training data, raising contamination concerns. Roughly 90% of tasks represent sub-one-hour fixes; only 3% require more than four hours. [S3]

---

### 2. Multi-SWE-bench — Multilingual Extension (ByteDance Seed, 2025)

Multi-SWE-bench [S4] extends the SWE-bench pipeline to 7 additional languages (Java, TypeScript, JavaScript, Go, Rust, C, C++) with 2,132 high-quality instances curated by 68 expert annotators.

**Repository-level selection criteria (explicit):**
- More than 500 GitHub stars (community engagement threshold)
- Continuous maintenance for at least six months
- CI/CD support via tools like GitHub Actions (automated build + test)

**Pipeline stages** mirror SWE-bench: repo selection → PR identification (merged, linked to issues) → environment reproducibility extraction → semantic transition filtering (test must change fail → pass). [S4]

---

### 3. SWE-Bench++ — Scalable Automated Pipeline (2025)

SWE-Bench++ [S5] automates the SWE-bench construction methodology across 3,971 repositories and 11 languages, producing 11,133 instances. It documents the automated repo-selection filters explicitly:

**Repository selection thresholds:**
- Active maintenance with recent commit activity
- More than 100 GitHub stars
- Recognizable testing framework present
- Codebase exceeding 10,000 lines of code (complexity floor)
- Merged PRs explicitly linked to issue reports
- PRs include edits or additions to test files

**Downstream quality filters (post-selection):**
- Environment reproducibility (Docker build succeeds)
- Test determinism: triple-execution flaky test detection
- Semantic alignment between issue descriptions and test coverage
- Oracle consistency validation

**Suitability anti-patterns identified by SWE-Bench++:**
- Complex, undocumented build systems (C++ yield: 9.5% vs Python: 41%)
- Non-standard test output formats
- Flaky or non-deterministic test suites
- Misalignment between stated issues and test coverage [S5]

---

### 4. FEA-Bench — Feature Addition Benchmark (Microsoft, ACL 2025)

FEA-Bench [S6] selects 83 repositories from approximately 8,000 PyPI packages after applying:

1. **License requirement** (any open-source license)
2. **More than 1,000 pull requests** (proxy for active maintenance and task density)
3. **Fast validation**: extract the first 20 PRs touching test files; retain repos where at least one passes tests with the default config
4. **pytest format standardization**: most repos use unified pytest format, which simplifies later execution
5. **Standard installation**: preference for `pip install -e .` (single-command environment setup)
6. **18 repos carried over from SWE-bench** (already validated, no re-testing needed)

**Key limitation identified by authors:** "High-quality and usable pull requests for new feature development are relatively scarce" — the scenario is constrained by the density of testable feature PRs per repo. [S6]

---

### 5. RepoCod — Real-World Function Generation (Purdue/ACL 2025)

RepoCod [S7] selects 11 projects from GitHub applying:
- Primary language Python ≥ 70%
- Minimum 2,000 GitHub stars ("popular repositories tend to be well-maintained")
- Snapshot at October 2024 (temporal freshness)

The 11 projects: astropy, datasets, flask, more-itertools, plotly.py, pylint, scikit-learn, seaborn, sphinx, sympy, xarray.

**Test suite quality assessment:** A three-step execution pipeline identifies relevant tests per function: (a) run all tests to establish a reference, (b) replace target function with an assertion failure, (c) re-run all tests and compare results. This reduces test execution time by 90% while ensuring each task has verified ground truth. [S7]

**Implicit suitability indicators:** established projects with substantial user bases, comprehensive test coverage, and functions with more than ten lines of docstrings. [S7]

---

### 6. CrossCodeEval — Multilingual Cross-File Benchmark (Amazon/NeurIPS 2023)

CrossCodeEval [S8] collects repositories from GitHub with explicit filters:

- **Permissive license** (MIT, Apache, etc.)
- **Not a fork** (original projects only)
- **Created between 2023-03-05 and 2023-06-15** (temporal separation from training data)
- **File count: 10–50 source code files** (size band — not too small, not too large)
- **Compressed size < 1 MB**
- **Stars ≥ 3** (minimal community engagement floor)
- **Four languages**: Python, Java, TypeScript, C#
- **No overlap with The Stack** (explicit data leakage prevention)

Resulting dataset: 6,703 Python, 4,650 TypeScript, 986 Java, 909 C# repositories. [S8]

**Design note on file count filter (10–50):** The lower bound (10 files) ensures genuine multi-file structure requiring cross-file reasoning. The upper bound (50 files) keeps complexity manageable. (Single-source claim — rationale inferred from filter design, not stated explicitly in paper abstract.) [S8]

---

### 7. RepoBench — Repository-Level Code Completion (ICLR 2024)

RepoBench [S9] collects Python and Java repositories from GitHub created between October 6 and December 31, 2023. For training data, repos must have between 32 and 128 Python or Java files. Resulting dataset: 10,345 Python and 14,956 Java repositories.

Key quality measure: deduplication against Stack v2 (by file content) to prevent training data memorization. [S9]

---

### 8. ExecRepoBench — Execution-Based Completion (2024)

ExecRepoBench [S10] draws 1,200 samples from 50 active Python repositories. Key criteria: continuously updated repositories with executable unit tests. Uses Pass@k metric (pass all unit tests) as ground truth. (Single source — selection criteria sparsely documented.) [S10]

---

### 9. RepoMasterEval — Active Repo Completion (2024)

RepoMasterEval [S11] selects active, continuously updated GitHub repositories to achieve realism. Key criterion: repositories from March 2023 onwards, providing temporal separation from training data with earlier cutoffs. Uses mutation testing and manual test case crafting to ensure test robustness for code snippets with low mutation scores. Completions are validated by re-executing all unit tests in the repository after reintegration of the generated code. [S11]

---

### 10. Qodo Code Review Benchmark (2024)

Qodo's production-grade code review benchmark [S12][S13] selects 8 repositories across TypeScript, Python, JavaScript, C, C#, Rust, and Swift.

**Repository-level criteria:**
- Production-grade, multi-component systems (server logic, frontend, DB, API layers)
- Cross-module architectural complexity reflecting enterprise PRs
- Language diversity across technology stacks (single-language: Redis/C, Tauri/Rust; polyglot: Dify/Python+Go, AspNetCore/C#+JavaScript)

**PR-level filters:**
- Minimum 3 files changed
- 50–15,000 lines changed (excludes trivial and monster PRs)
- Recently merged status
- Not reverted or followed by immediate hotfix commits ("clean" baseline code)
- Pre-injection compliance: no existing violations before defect injection

**Anti-patterns explicitly excluded:**
- PRs with post-merge reverts
- PRs followed by immediate fix commits
- Code containing compliance violations before injection [S12][S13]

---

### 11. DevBench — Full-Lifecycle Benchmark (2024)

DevBench [S14] curates 22 repositories from a GitHub dump across Python, C/C++, Java, and JavaScript. Selection criteria:

- Total lines of code constrained to keep complexity manageable for LLM evaluation
- Functional verification: annotators set up environments, ran existing tests, and developed additional ones where needed
- Test coverage: ranged from 45% to 99% across selected repos
- Multi-file structure: Python projects averaged 2.2 files; C/C++ and Java averaged 5–7 files
- Existing README files and functional code required
- Domain diversity: NLP, computer vision, deep learning, algorithms, APIs, databases, web services, utilities [S14]

---

## Quality Signals That Predict Assessment Suitability

The following signals emerge consistently across benchmarks and practitioner sources:

### Positive signals (repo WILL work as assessment material)

| Signal | Evidence source | Strength |
|---|---|---|
| Test suite exists and is executable (pytest/unittest) | SWE-bench, FEA-Bench, RepoCod, ExecRepoBench | Strong — universal requirement across all execution-based benchmarks |
| Test suite is deterministic (non-flaky) | SWE-Bench++ triple-execution filter | Strong — single source but well-motivated [S5] |
| At least one test transitions fail→pass per task | SWE-bench Stage III, FEA-Bench | Strong — operationally required for ground-truth validation [S1][S6] |
| ≥ 500 GitHub stars | Multi-SWE-bench explicit threshold | Moderate — proxy for maintenance quality [S4] |
| ≥ 2,000 GitHub stars | RepoCod explicit threshold | Moderate — stricter proxy [S7] |
| Active maintenance: commits within 6 months | Multi-SWE-bench | Moderate [S4] |
| CI/CD integration (GitHub Actions or equivalent) | Multi-SWE-bench | Moderate — ensures reproducibility [S4] |
| ≥ 1,000 merged PRs | FEA-Bench (task density proxy) | Moderate [S6] |
| Codebase ≥ 10,000 lines of code | SWE-Bench++ (complexity floor) | Moderate — ensures non-trivial structure [S5] |
| Standard install (`pip install -e .` or equivalent) | FEA-Bench | Moderate — operationally significant [S6] |
| Multi-file structure with cross-file dependencies | CrossCodeEval (10–50 file filter), DevBench | Moderate — necessary for repository-level tasks [S8][S14] |
| Permissive license | CrossCodeEval, RepoBench, FEA-Bench | Required for redistribution [S8][S9][S6] |
| Clear documentation and docstrings | RepoCod (≥10 docstring lines), SWE-bench rationale | Moderate [S7][S1] |
| Language diversity / multi-language support | Qodo benchmark | Moderate for broad applicability [S12] |
| Production-grade multi-component architecture | Qodo benchmark | High for code review specifically [S12] |
| Real merged PRs linked to GitHub issues | SWE-bench, Multi-SWE-bench, FEA-Bench, SWE-Bench++ | Strong — ensures fix is verifiable and purposeful [S1][S4][S6][S5] |
| PRs modify test files | SWE-bench Stage II, SWE-Bench++ | Strong — confirms testable ground truth [S1][S5] |
| Temporal freshness (created/updated after training cutoff) | CrossCodeEval, RepoMasterEval | Important for contamination prevention [S8][S11] |

### Complexity band calibration

- **Appropriate complexity floor:** ≥10 source files (CrossCodeEval lower bound), ≥10k LOC (SWE-Bench++). Repos below this lack multi-file reasoning challenges. [S5][S8]
- **Appropriate complexity ceiling:** ≤50 source files for cross-file completion tasks (CrossCodeEval upper bound). Beyond this, navigation overhead may dominate signal. [S8]
- **Task difficulty band:** Most SWE-bench tasks are sub-one-hour fixes for experienced engineers. Only 3% require >4 hours. For interview use, this maps roughly to: simple bug fixes (junior), architectural trade-offs and multi-file changes (senior). [S3]
- **Practitioner guidance:** "The challenge used for an entry-level developer should not be as difficult as the challenge used for a senior-level developer." Production-grade PRs with cross-module implications are appropriate for senior candidates; single-module, well-scoped issues for juniors. [S15][S16]

---

## Anti-Patterns — What Makes a Repo BAD for Assessment

### Structural anti-patterns

1. **Complex, non-standard build systems.** SWE-Bench++ found C++ repos yielded only 9.5% usable instances vs. 41% for Python, due to undocumented build complexity. Non-standard test output formats require custom parsing and introduce evaluation unreliability. [S5]

2. **Flaky or non-deterministic test suites.** SWE-Bench++ explicitly triple-executes to detect flakiness and discards affected instances. A repo with flaky tests cannot serve as execution-based ground truth. [S5]

3. **No test suite.** The universal requirement across all benchmarks. Repos lacking automated tests cannot provide verifiable ground truth for assessment. [S1][S4][S6]

4. **Single-file or near-trivial structure.** CrossCodeEval's lower bound of ≥10 files exists precisely to exclude repos too small for meaningful cross-file reasoning. DevBench selected repos with 2–7 files as the range for current LLM capability — going below 2 is toy territory. [S8][S14]

5. **Excessive size / impenetrable complexity.** CrossCodeEval caps at 50 files. Repos with hundreds of modules and complex plugin systems create navigation overhead that may dominate the signal. [S8]

6. **Training data contamination (popular but old).** Repos that are "among the most widely-referenced codebases on the internet" and have been static since before 2020 are likely memorized by LLMs, and the same concern applies for candidates who may have studied them. CrossCodeEval and RepoMasterEval both use post-training-cutoff repos to mitigate this. [S3][S8][S11]

7. **Abandoned or inactive repos.** Multi-SWE-bench requires ≥6 months of continuous maintenance. Abandoned repos have accumulated debt, stale dependencies, and test regressions that make them operationally unreliable. [S4]

8. **Excessive domain specificity.** SWE-bench's skew toward data science / scientific computing (numpy, sympy, astropy) is its most-cited limitation. Repos requiring deep domain knowledge (astronomy, financial math, biostatistics) measure domain familiarity, not general engineering skill. [S3]

9. **Single-language monoculture.** Using only Python repos (SWE-bench's known limitation) fails to assess language-agnostic engineering judgment. [S3]

10. **No linked issues (PRs with no issue context).** SWE-bench's Stage II filter requires PRs to resolve a named GitHub issue. PRs without issue context lack problem descriptions and cannot generate realistic assessment scenarios. [S1]

11. **PRs reverted or followed by immediate hotfixes.** Qodo's benchmark explicitly excludes these. They indicate the merged code itself was wrong, corrupting the "clean baseline" assumption. [S12]

12. **Trivial, surface-level bugs only.** Qodo's benchmark analysis notes that missing docstrings and formatting issues "add little signal." Assessment material should contain systemic, multi-file bugs that require genuine reasoning. [S13]

13. **Unreproducible environments.** SWE-Bench++ requires Docker build success. Repos with complex, pinned, or platform-specific dependencies that fail to install cleanly cannot be reliably used. [S5]

---

## Practitioner Perspective: Code Review Interview Material

Beyond benchmark construction, practitioner sources add context relevant to interview design [S16][S17][S18]:

- **Real codebases > synthetic code.** "Constructing example code for interviews produces worse insights than using your actual codebase." The best material comes from "actual problems that a team has been working on." [S17]
- **Seven approaches to review material:** (1) Au Naturel (unmodified production code), (2) Bug Hunter (code with intentional logical flaws from real past fixes), (3) Refactor & Redesign (pre-refactored code), (4) Performance-Oriented (optimization issues), (5) Test-Focused (code + unit tests), (6) Security Assessment (subtle vulnerabilities), (7) Best Practices (standards judgment for senior candidates). [S16]
- **Domain-specific knowledge risk.** Using auditing, logging, or compliance-heavy code may test domain familiarity rather than engineering judgment. [S17]
- **Monoculture warning.** Generic code review exercises risk "selecting candidates who think similarly to the publisher." Diversity of code styles and domains reduces this bias. [S18]
- **Time box:** Effective assessments complete in under one hour; signals include bug identification, communication clarity, attention to detail, and soft-skill delivery. [S15]

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| E1 | SWE-bench selects repos based on: popular (well-maintained, clear guidelines, good test coverage); construction pipeline: repo selection → attribute filtering → execution filtering | SWE-bench paper (Jimenez et al., ICLR 2024) | 2024 | Peer-reviewed | Strong |
| E2 | The 12 SWE-bench repos: django, sympy, scikit-learn, sphinx, matplotlib, pytest, xarray, astropy, pylint, requests, seaborn, flask — with instance counts | SWE-bench analysis / Groundy article | 2024 | Secondary analysis of benchmark | Strong |
| E3 | SWE-bench Stage II: PR must resolve a named GitHub issue AND modify test files | SWE-bench paper | 2024 | Peer-reviewed | Strong |
| E4 | SWE-bench Stage III: at least one test must transition fail→pass; install/runtime errors discard instance | SWE-bench paper | 2024 | Peer-reviewed | Strong |
| E5 | SWE-bench biases: Python-only, data-science skew, training data contamination, 90% tasks < 1 hour | Epoch AI analysis, Groundy article | 2024–2025 | Secondary analysis | Moderate |
| E6 | Multi-SWE-bench criteria: >500 stars, ≥6 months continuous maintenance, CI/CD integration | Multi-SWE-bench (ByteDance Seed) | 2025 | Peer-reviewed | Strong |
| E7 | SWE-Bench++ criteria: >100 stars, active commits, recognized test framework, >10k LOC, test-modifying PRs | SWE-Bench++ paper | 2025 | Peer-reviewed | Strong |
| E8 | SWE-Bench++ downstream quality: Docker reproducibility, triple-execution flakiness detection, semantic alignment | SWE-Bench++ paper | 2025 | Peer-reviewed | Strong |
| E9 | SWE-Bench++ anti-patterns: C++ yield 9.5% vs Python 41%, non-standard test output, flaky tests | SWE-Bench++ paper | 2025 | Peer-reviewed | Strong |
| E10 | FEA-Bench criteria: permissive license, >1,000 PRs, pytest format, pip install -e ., fast validation by test execution | FEA-Bench (Microsoft, ACL 2025) | 2025 | Peer-reviewed | Strong |
| E11 | RepoCod criteria: Python ≥70%, ≥2,000 stars, October 2024 snapshot; test pipeline trims irrelevant tests by 90% | RepoCod (Purdue, ACL 2025) | 2025 | Peer-reviewed | Strong |
| E12 | CrossCodeEval criteria: permissive license, not a fork, 2023-03-05 to 2023-06-15, 10–50 files, <1MB, ≥3 stars, no Stack overlap | CrossCodeEval (Amazon, NeurIPS 2023) | 2023 | Peer-reviewed | Strong |
| E13 | RepoBench data: Python/Java repos, created Oct–Dec 2023, 32–128 files for training set, deduplication against Stack v2 | RepoBench (ICLR 2024) | 2024 | Peer-reviewed | Moderate |
| E14 | ExecRepoBench: 50 active Python repos, execution-based Pass@k, continuously updated | ExecRepoBench | 2024 | Peer-reviewed | Moderate (single source) |
| E15 | RepoMasterEval: post-March-2023 repos for temporal separation, mutation testing for test robustness | RepoMasterEval | 2024 | Peer-reviewed | Moderate |
| E16 | Qodo benchmark: 8 repos, production-grade multi-component, ≥3 files changed, 50–15k lines, no reverts/hotfixes | Qodo engineering blog | 2024 | Vendor documentation | Moderate |
| E17 | Qodo: exclude PRs with subsequent reverts or immediate fix commits; exclude code with pre-existing violations | Qodo engineering blog | 2024 | Vendor documentation | Moderate |
| E18 | Qodo: trivial issues (missing docstrings, formatting) "add little signal"; systemic multi-file bugs preferred | Qodo blog: what makes a good benchmark | 2024 | Vendor documentation | Moderate |
| E19 | DevBench: 22 repos, LOC-constrained for LLM manageability, 45–99% test coverage, 2–7 files, domain diversity | DevBench paper | 2024 | Peer-reviewed | Moderate |
| E20 | Practitioner: real codebases > synthetic exercises; Bug Hunter approach (real past bugs) most effective | Medium (Charles Chen) / HN discussion | 2024 | Practitioner / anecdote | Low–Moderate |
| E21 | Domain-specific repos risk testing domain familiarity over engineering skill | HN discussion / practitioner sources | 2024 | Anecdote | Low (single source) |
| E22 | SWE-bench 90% tasks < 1 hour; 39% "trivial" (<15 min); only 3% > 4 hours | Epoch AI analysis | 2024 | Secondary analysis | Moderate |
| E23 | Entry-level assessments should differ in difficulty from senior-level; senior = multi-file architectural complexity | Hatchways / TechInterviewHandbook | 2024 | Practitioner guidance | Moderate |
| E24 | Monoculture warning: generic code review exercises risk selecting for thought similarity | HN discussion | 2024 | Anecdote | Low (single source) |

---

## Direct Implications for PIPE's Repo Discovery Pipeline

1. **Apply a tiered star-count filter by seniority.** Multi-SWE-bench uses 500 stars as the floor; RepoCod uses 2,000 stars. For PIPE, 500–1,000 stars is a reasonable floor for junior assessments; ≥2,000 stars for senior-track assessments where code quality expectations are higher.

2. **Test suite executability is non-negotiable.** Every benchmark surveyed requires a runnable, deterministic test suite. Without it, there is no execution-based ground truth for verifying planted bugs. Apply triple-execution flakiness detection (SWE-Bench++ pattern) before accepting a repo.

3. **File count banding should match seniority.** Junior assessments: 10–20 files (multi-file but navigable). Senior assessments: 20–50 files (genuine cross-module reasoning required). Repos above 50 source files risk navigation overhead dominating signal.

4. **Temporal freshness matters.** Repos created or last significantly updated before 2023 may be memorized by candidates who prepared using LLM coding assistants. Prefer repos updated within the past 12 months (post model training cutoffs).

5. **Exclude domain-heavy repos for general engineering roles.** Repos requiring deep scientific domain knowledge (astronomy, biostatistics, quantitative finance) measure domain familiarity, not general software engineering judgment. Repos in web services, APIs, databases, CLI tools, and utilities provide cleaner signal for most SWE roles.

6. **CI/CD presence is a strong proxy for overall quality.** Multi-SWE-bench explicitly requires it. A repo with no CI/CD likely has lower test reliability, dependency hygiene, and code review culture — all of which degrade assessment quality.

7. **PR history is as important as repo health.** The Qodo pattern — exclude PRs with reverts or immediate hotfixes — should be applied before selecting PRs for bug-planting. A reverted PR indicates the planted "clean" baseline was never actually clean.

---

## Open Questions / Gaps

1. **Optimal LOC band for PIPE's junior vs. senior tiers.** Benchmarks use 10k LOC as a floor (SWE-Bench++) but do not provide a senior-track upper bound. This requires internal calibration against actual candidate performance data.

2. **Language-specific yield rates.** SWE-Bench++ found C++ at 9.5% yield vs Python at 41%. PIPE should track yield rates per language during repo discovery to calibrate how many candidate repos need to be screened per viable assessment.

3. **Anti-contamination strategy.** CrossCodeEval and RepoMasterEval solve contamination by using post-training-cutoff repos. PIPE needs a clear policy for how to define and enforce a temporal freshness gate, especially as model training cutoffs advance.

4. **Docstring and documentation quality thresholds.** RepoCod uses ≥10 docstring lines as an implicit signal. No benchmark specifies a quantitative documentation threshold. Whether to encode this as a filter or a scoring dimension is an open internal decision.

5. **Single-language vs. polyglot repos.** Qodo's benchmark deliberately includes both. PIPE's role-to-repo matching (R3 territory) will determine whether polyglot repos add signal or noise for specific roles.

6. **Domain mapping.** This research does not cover which domains map to which seniority levels or roles — that is R3's scope.

---

## Sources

| ID | Title | Authors/Org | Year | Type | URL |
|---|---|---|---|---|---|
| S1 | SWE-bench: Can Language Models Resolve Real-World GitHub Issues? (ICLR 2024) | Jimenez et al. (Princeton) | 2024 | Peer-reviewed conference paper | https://arxiv.org/abs/2310.06770 |
| S2 | SWE-bench ar5iv full text (readable HTML version of paper) | Jimenez et al. | 2024 | Peer-reviewed (HTML render) | https://ar5iv.labs.arxiv.org/html/2310.06770 |
| S3 | What skills does SWE-bench Verified evaluate? | Epoch AI | 2024 | Secondary analysis | https://epoch.ai/blog/what-skills-does-swe-bench-verified-evaluate/ |
| S4 | Multi-SWE-bench: A Multilingual Benchmark for Issue Resolving | ByteDance Seed | 2025 | Peer-reviewed | https://arxiv.org/pdf/2504.02605 |
| S5 | SWE-Bench++: A Framework for the Scalable Generation of Software Engineering Benchmarks from Open-Source Repositories | — | 2025 | Peer-reviewed | https://arxiv.org/html/2512.17419v1 |
| S6 | FEA-Bench: A Benchmark for Evaluating Repository-Level Code Generation for Feature Implementation (ACL 2025) | Microsoft Research | 2025 | Peer-reviewed conference paper | https://arxiv.org/html/2503.06680v2 |
| S7 | Can Language Models Replace Programmers for Coding? RepoCod Says 'Not Yet' (ACL 2025) | Purdue University | 2025 | Peer-reviewed conference paper | https://arxiv.org/html/2410.21647 |
| S8 | CrossCodeEval: A Diverse and Multilingual Benchmark for Cross-File Code Completion (NeurIPS 2023) | Amazon Science | 2023 | Peer-reviewed conference paper | https://github.com/amazon-science/cceval |
| S9 | RepoBench: Benchmarking Repository-Level Code Auto-Completion Systems (ICLR 2024) | — | 2024 | Peer-reviewed conference paper | https://arxiv.org/abs/2306.03091 |
| S10 | ExecRepoBench: Multi-level Executable Code Completion Evaluation | — | 2024 | Peer-reviewed | https://arxiv.org/abs/2412.11990 |
| S11 | RepoMasterEval: Evaluating Code Completion via Real-World Repositories | — | 2024 | Peer-reviewed | https://arxiv.org/abs/2408.03519 |
| S12 | How Qodo Built a Real-World Benchmark for AI Code Review | Qodo | 2024 | Vendor engineering blog | https://www.qodo.ai/blog/how-we-built-a-real-world-benchmark-for-ai-code-review/ |
| S13 | What makes a good code review benchmark for AI tools? | Qodo | 2024 | Vendor engineering blog | https://www.qodo.ai/blog/what-makes-a-good-code-review-benchmark-for-ai-tools/ |
| S14 | DevBench: A Comprehensive Benchmark for Software Development | — | 2024 | Peer-reviewed | https://arxiv.org/html/2403.08604v1 |
| S15 | Using a Code Review Assessment to Assess Software Engineering Talent | Hatchways | 2024 | Practitioner blog | https://www.hatchways.io/blog/code-review-assessment-to-assess-engineers |
| S16 | Interviews in the Age of AI: Ditch Leetcode — Try Code Reviews Instead | Charles Chen (Medium) | 2024 | Practitioner essay | https://chrlschn.medium.com/interviews-in-the-age-of-ai-ditch-leetcode-try-code-reviews-instead-9639d7bfd9d4 |
| S17 | Show HN: CodeRev.app — Code Review as Interview (Hacker News discussion) | HN community | 2024 | Practitioner discussion | https://news.ycombinator.com/item?id=39428766 |
| S18 | SWE-bench Verified Explained: What the Coding Agent Leaderboard Actually Measures | Groundy | 2024 | Secondary analysis | https://groundy.com/articles/swe-bench-verified-explained-what-the-coding-agent-leaderboard-actually-measures-and-what-it-misses/ |
