# Research: Role-to-Repo Matching Strategies + Dependency-Based Tech Stack Detection

**Research date:** 2026-04-09
**Researcher:** R3 (Claude Sonnet 4.6)
**Scope:** How to map a role description to repo characteristics, and how to detect those characteristics in repos.
**Out of scope:** Repo discovery API mechanics (R1), repo quality criteria (R2), AIG bug-planting pipeline.

---

## Key Findings

### 1. Dependency Manifest Parsing

**What it is:** Parsing lock files and manifest files to extract the precise set of named packages a repo depends on. This is far more granular than language detection: `package-lock.json` tells you "React 18.2.0, Next.js 14.1.0, Tailwind CSS 3.4.0, Prisma 5.x" while GitHub Linguist only tells you "JavaScript." [S1]

**GitHub's dependency graph GraphQL API** is the most convenient programmatic source for this. Using the `dependencyGraphManifests` query (preview API, header: `application/vnd.github.hawkgirl-preview+json`) you can retrieve every parsed manifest file in a public repo and the named packages it declares — including `packageName`, `requirements`, and `packageManager`. This covers npm/pnpm/Yarn, pip/Poetry, Maven/Gradle, RubyGems, Cargo, Go modules, NuGet, Composer, Swift PM, and a dozen more. [S2] [S3] (The REST submission API goes the other direction — uploading dependencies — but the GraphQL read API is what PIPE needs.) [S4]

**Supported manifest files parsed by GitHub's graph:**
- JavaScript/TypeScript: `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`
- Python: `requirements.txt`, `pyproject.toml`, `poetry.lock`
- Rust: `Cargo.toml`, `Cargo.lock`
- Java: `pom.xml`, `build.gradle`
- Go: `go.mod`, `go.sum`
- Ruby: `Gemfile`, `Gemfile.lock`
- C#: `.csproj`, `packages.config`
- PHP: `composer.json`, `composer.lock`

(18+ ecosystems in total.) [S3]

**Standalone tools for local parsing at scale:**
- **Snyk**, **OWASP Dependency-Check**, **GitLab Dependency Scanning**: production SCA tools that parse manifests and build dependency trees. Can be used as analysis infrastructure if PIPE clones repos. [S5] [S6]
- **depcheck** (npm): analyzes `package.json` specifically, identifies which deps are actually imported vs. phantom. Usable as a library. [S7]
- **specfy/stack-analyser** (TypeScript, open-source NPM package): the most directly useful tool for PIPE. Detects 700+ technologies from any repository by reading manifests (`package.json`, `docker-compose.yml`, `go.mod`) AND matching file/folder patterns. Outputs JSON with hierarchical component structure, detected technologies per component, dependency arrays with package manager, name, and version, and inter-component edges. Used in production by getstack.dev to scan 50k+ GitHub repos weekly. [S8] [S9]

**Recommendation for PIPE:** Use the GitHub GraphQL `dependencyGraphManifests` API as the primary signal for public repos (zero cloning required). Fall back to cloning + running `stack-analyser` for repos where the API returns insufficient data (e.g., very new repos without a detected graph, or private repos in future enterprise features).

---

### 2. Framework Detection via File Patterns

Beyond manifest parsing, structural file patterns reliably fingerprint frameworks. A combined manifest + pattern approach catches frameworks that don't appear in top-level `package.json` (e.g., micro-frontend setups, workspace monorepos).

**High-confidence pattern signals:**

| Signal | Framework / Tech |
|---|---|
| `next.config.js` or `next.config.ts` + `pages/` or `app/` directory | Next.js |
| `angular.json` + `src/app/` | Angular |
| `nuxt.config.ts` + `.nuxt/` | Nuxt.js |
| `manage.py` + `settings.py` | Django |
| `wsgi.py` or `asgi.py` | Django / FastAPI / Flask |
| `Procfile` | Heroku-deployed app |
| `docker-compose.yml` | Containerized multi-service backend |
| `Dockerfile` only | Single-service containerized app |
| `terraform/` directory + `.tf` files | Infrastructure as Code (Terraform) |
| `.github/workflows/*.yml` | GitHub Actions CI/CD |
| `pubspec.yaml` | Flutter/Dart |
| `android/` + `ios/` directories | React Native or Flutter |
| `mix.exs` | Elixir/Phoenix |
| `build.sbt` | Scala/SBT |
| `project.clj` | Clojure |
| `Stack.yaml` | Haskell/Stack |

[S10] [S11] [S12]

**specfy/stack-analyser** uses exactly this dual approach (manifest + file patterns) and open-sources its ruleset. Inspecting its detection rules directly is the most efficient way for PIPE to build its own heuristic table. [S8]

**StackShare's techstack.yml** (November 2023): An emergent open standard — a YAML file that can be committed to a repo listing the full tech stack including closed-source SaaS, infrastructure, data stores, and open-source packages. A GitHub App can auto-generate it. If a repo has this file, it is authoritative and machine-readable. Worth checking for during repo discovery. [S13]

---

### 3. GitHub Linguist and Alternatives for Granular Stack Detection

**GitHub Linguist** detects programming language by file extension and content heuristics [S14]. It is language-level only — it does not know whether a JavaScript repo uses React, Vue, or Svelte, nor whether a Python repo is Django or Flask. It has a 100k-file repo limit. [S14]

**Enry** (Go port of Linguist, 2x faster) offers the same language detection capability, available as a Go library, CLI, and via FFI bindings for Python/Java. It does not require a Git repo on disk. It also does not detect frameworks. [S15]

**Linguist Rust crate**: A Rust reimplementation using file extension, filename, and content heuristics — same scope as Linguist. [S16]

**The critical gap:** Linguist-family tools answer "what language?" not "what framework?" For PIPE's matching needs, framework-level precision is essential. The tools that cross this gap:

| Tool | Detection depth | How | Open source? |
|---|---|---|---|
| **specfy/stack-analyser** | 700+ technologies, languages, SaaS, infra, dependencies | Manifest parsing + file patterns | Yes (TypeScript) [S8] |
| **getstack.dev** | Trend analytics across 50k repos | Uses stack-analyser weekly | Yes (data public) [S9] |
| **StackShare techstack.yml** | Full stack including commercial SaaS | Self-declared YAML in repo | Auto-generated via GitHub App [S13] |
| **GitHub dependency graph GraphQL** | Named packages + versions | Manifest parsing by GitHub | Via API (needs auth token) [S2] |
| **scc** (Sloc Cloc and Code) | LOC, approximate cyclomatic complexity, COCOMO | Source analysis, per-file breakdown | Yes (Go) [S17] |
| **lizard** | NLOC, CCN, token count, param count per function | AST-based, 25+ languages | Yes (Python) [S18] |

**Wappalyzer/BuiltWith** are primarily deployed-site detectors (HTTP responses, JS fingerprints). They are not useful for source code repos. [S19]

---

### 4. Mapping Role Descriptions to Tech Stack Requirements

**The NLP problem:** Given a role description like "Senior Frontend Engineer — React/TypeScript, experience with GraphQL and design systems," extract structured filters: `{mustHave: ['React', 'TypeScript'], niceToHave: ['GraphQL', 'Storybook'], seniority: 'senior', domain: 'frontend'}`.

**Approaches in production:**

**a) LLM-based extraction (dominant approach 2024–2025):**
Prompt an LLM with the JD text and a schema. GPT-4o, Gemini, and Claude all produce structured JSON output well. Research shows "extraction-style" prompts (ask for the skill text verbatim extracted) consistently outperform "NER-style" prompts (classify tokens) in span-F1. [S20]

The 2024 Skill-LLM paper (arXiv:2410.12052) fine-tuned a specialized small LLM for skill extraction, outperforming SOTA, but noted that vanilla GPT-4-class prompting with carefully designed prompts also performs competitively. The fine-tuned approach is worth considering if PIPE needs high-throughput extraction at low cost. [S20]

**b) LinkedIn's production system (2023):**
Uses a two-tower BERT-based model — one tower embeds job description text chunks, the other embeds skill names from their 39k-skill taxonomy. A similarity function matches text to skills. For production deployment, knowledge distillation reduces model size by 80% with no accuracy loss. Maps to a taxonomy of 39k skills across 26 languages, 347k aliases. [S21] [S22]

This is the production-grade approach if PIPE eventually needs to normalize skills against a canonical taxonomy. For MVP purposes, LLM extraction with a structured prompt is faster to build.

**c) ESCO / O*NET taxonomy grounding:**
ESCO v1.2.0 (May 2024) is a European open skills taxonomy with 13,890 skills across 3,008 occupations, available as machine-readable RDF/SKOS data. ESCOX is an open-source tool that maps free text to ESCO skills. LLM-to-ESCO linking was found challenging (hallucinations when navigating the hierarchy), but LLM + re-ranker approaches show promise. [S23]

For PIPE, using a closed skills taxonomy like ESCO adds complexity without proportional benefit. The more pragmatic approach: extract skills as free-text strings, normalize to a PIPE-maintained "known-tech" vocabulary (React, Next.js, TypeScript, etc.), then use that vocabulary for manifest-based repo filtering.

**d) Distinguishing must-have from nice-to-have:**
JD parsers acknowledge this is an unsolved hard problem — current parsers handle it poorly because the language is ambiguous and subjective. [S24] LLMs do better: explicit prompts like "separate required qualifications from preferred qualifications" produce reasonable results but with non-trivial error rates. For PIPE's use case, the distinction matters but is not safety-critical — if a match is imperfect, the repo is reviewed by the recruiter before use.

**Practical pipeline for PIPE:**

```
JD text → LLM extraction prompt → {mustHave: [...], niceToHave: [...], seniority, domain}
   ↓
Normalize to PIPE "known-tech" vocabulary
   ↓
Build GitHub search + GraphQL manifest filters
```

The LLM extraction step is already aligned with PIPE's Role Discovery agent output (which produces `mustHaveSkills`, `niceToHaveSkills`, domain, seniority). No additional JD parsing step is needed if the Role Discovery persona is used as input.

---

### 5. Seniority-to-Complexity Mapping

There is no single complexity threshold that maps cleanly to seniority. The research suggests a multi-dimensional approach combining proxy metrics:

**Repo-level metrics:**

| Metric | What it signals | Source |
|---|---|---|
| Total SLOC | Raw scale; >50k lines = non-trivial | scc, tokei, lizard [S17][S18] |
| Mean cyclomatic complexity (CCN) | Decision density; McCabe threshold: 10 = maintainable, >15 = high risk | lizard, scc [S17][S18] |
| Number of distinct modules / packages | Architectural scope | stack-analyser, dependency graph [S8][S2] |
| Dependency count (direct + transitive) | Integration complexity | GitHub dependency graph [S2][S3] |
| Contributor count | Community / production-grade signal | GitHub API |
| Git commit frequency + files-per-commit | Churn and coupling (files-per-commit is a heuristic, not a perfect signal) | Pfeiffer et al., QUATIC 2021 [S25] |
| Presence of test suite | Engineering maturity | File pattern detection |
| Presence of CI/CD + Docker | Production-readiness | File pattern detection |
| LOC + high cyclomatic complexity (combined) | Highest reliability risk per SATC study | MS/NIST guidance [S26] |

**Seniority calibration heuristics (inference from industry practice, not a published study):**

| Seniority | Suggested repo profile |
|---|---|
| Junior (0–2 yr) | SLOC 1k–10k, CCN avg < 5, 1–2 primary dependencies (e.g., React + a router), no infrastructure complexity, no monorepo |
| Mid (2–5 yr) | SLOC 10k–50k, CCN avg 5–10, multiple integrations (API + auth + data layer), some testing, possibly CI |
| Senior (5+ yr) | SLOC 50k+, CCN avg 10–15 in hotspots, full stack integration (frontend + backend + DB + auth + infra), design patterns, extensive tests, monorepo or multi-service |
| Staff / Principal | Monorepo with multiple independent packages, cross-cutting concerns, platform engineering patterns |

(Inference from seniority frameworks at madewithlove.com, altexsoft.com, and roadmap.sh — none provide quantitative CCN thresholds.) [S27] [S28] [S29]

**Practical recommendation for PIPE:** Run `lizard` or `scc` (both embeddable, JSON output) on any candidate repo to extract SLOC and mean CCN. Combine with dependency count from the GitHub GraphQL API. Tune thresholds empirically once PIPE has a corpus of human-labeled "junior / mid / senior" repos.

---

### 6. The Long-Tail Problem for Niche Stacks

Niche stacks (Elixir/Phoenix, Rust embedded, Kotlin Multiplatform, Zig, Clojure, etc.) present three distinct challenges:

**a) Fewer quality repos available.** The GitHub corpus is heavily skewed toward JavaScript, Python, and Java. Elixir/Phoenix, Rust embedded, and KMP have far fewer repos meeting quality thresholds (stars, test coverage, recent activity). Stack Overflow 2025 survey: Rust is the most *admired* language (72% positive) but only ~13% of developers use it professionally — the repo pool is smaller. [S30]

**b) Assessment tool coverage gaps.** SonarQube/SonarCloud does not support Rust or Elixir natively — coverage metrics must be pushed manually from external tools. HackerRank covers Elixir and Rust but with limited depth (smaller question banks). [S31] [S32]

**c) AI tooling gaps compound the problem.** LLM assistants perform worse on niche languages due to sparse training data, making AI-assisted AIG (bug planting, variant generation) harder. Small codebases also cause hallucinations. [S33]

**Strategies for PIPE:**

1. **Curated fallback list per niche language.** For stacks where < N quality repos exist (configurable threshold), maintain a manually-curated shortlist. The sourcing team reviews and approves each repo once.

2. **Synthetic seed repos.** If no suitable open-source repo exists for a niche stack, generate a synthetic but realistic codebase using a high-capability model (Claude Opus) as a seed, then use AIG on top of it. This extends the approach already used for the challenge authoring system (ADR-034).

3. **Language-transfer assessment.** For niche stacks, structure assessments around language-agnostic patterns (concurrency model, error handling idioms, ownership model for Rust, OTP supervision trees for Elixir) that can be assessed from a description even if the repo itself is simple.

4. **Tier the stack coverage.** Make niche stacks an explicit "advanced" tier with manual curation. PIPE's MVP focuses on the high-volume stacks (React/TS, Python/Django/FastAPI, Java/Spring, Go) where automatic pipeline coverage is feasible.

---

### 7. Existing Platform Approaches to Role-Assessment Matching

**HackerRank:**
- JD upload → AI extracts "core competencies, qualifications, skills, and technologies" → maps to internal question bank of 7,500+ questions across 260 skills / 84 roles. [S34]
- Internally uses a "Skill Taxonomy" built from internal data + external JD analysis + SME review. [S35]
- The JD→question mapping is AI-assisted but the mechanism details are not published. The question bank is pre-tagged by skill + difficulty; matching is likely a retrieval problem (embed JD, embed questions, cosine rank). [S34]
- Role-based certified assessments exist for 84 specific roles (Frontend Engineer, Data Scientist, etc.). These are static, not dynamically generated. [S35]

**CodeSignal:**
- Offers "Certified Assessments" validated by IO psychologists (2,800+ hours per assessment). Optimized for standardization, not customization. [S36]
- Limited role/tech customization — "one-size-fits-all" for volume hiring. [S36]
- Does not expose a JD-to-assessment generator; role selection is from a predefined list.

**Codility:**
- Provides asynchronous role-specific skills assessments organized by role + experience level. [S37]
- More customizable than CodeSignal but still pre-curated content rather than dynamic repo-based assessment.

**Karat:**
- Human-conducted live technical interviews, not automated. Role customization is limited — Karat's team defines interview content. [S38]

**Key observation:** None of the existing platforms do what PIPE intends to do: take a specific open-source codebase, match it to a role persona, and generate contextually relevant assessments from it. The closest is HackerRank's JD→question mapping, but that maps to a fixed question bank, not to dynamic repo-derived content. PIPE's hybrid AIG approach is a genuinely differentiated pipeline.

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | Dependency manifests give framework-level precision; language detection only gives language-level | GitHub dependency graph docs | 2024 | Vendor documentation | Strong |
| S2 | GitHub GraphQL `dependencyGraphManifests` query returns named packages, versions, and package managers per manifest | Simon Willison TIL, GitHub docs | 2023 | Primary doc + engineering blog | Strong |
| S3 | GitHub dependency graph supports 18+ ecosystems incl. npm, pip, Cargo, Go modules, Maven, NuGet, Composer | GitHub official documentation | 2024 | Vendor documentation | Strong |
| S4 | REST dependency submission API is for uploading deps, not reading them; GraphQL API is for reads | GitHub Docs REST | 2024 | Vendor documentation | Strong |
| S5 | OWASP Dependency-Check, Snyk, GitLab Dependency Scanning parse manifests and build dependency trees at scale | OWASP, Snyk, GitLab docs | 2024 | Vendor documentation | Strong |
| S6 | Dependency scanners work by reading pom.xml, package.json, requirements.txt and comparing to vulnerability DBs | Mend/OWASP blog | 2024 | Vendor documentation | Moderate |
| S7 | depcheck analyzes package.json to find declared vs actually-imported dependencies | npm depcheck package | 2024 | Open-source library docs | Strong |
| S8 | specfy/stack-analyser: TypeScript library detecting 700+ technologies via manifests + file patterns, JSON output, usable as NPM package | GitHub specfy/stack-analyser | 2024–2026 | Open-source primary source | Strong |
| S9 | getstack.dev uses stack-analyser to analyze 50k+ repos weekly for technology trend analytics | getstack.dev, HN | 2024–2025 | Engineering blog + primary | Moderate |
| S10 | Next.js canonical project structure: `pages/` or `app/` + `next.config.js` | Next.js official docs | 2024 | Vendor documentation | Strong |
| S11 | Angular canonical structure: `angular.json` + `src/app/` | Angular official docs | 2024 | Vendor documentation | Strong |
| S12 | Django canonical structure: `manage.py` + `settings.py` + `urls.py` at project root | Django official docs | 2024 | Vendor documentation | Strong |
| S13 | StackShare introduced techstack.yml in Nov 2023: YAML file in repo listing full tech stack incl. SaaS and infrastructure; auto-generated via GitHub App | StackShare announcement (BusinessWire) | 2023 | Vendor press release | Moderate |
| S14 | GitHub Linguist: file-extension + content heuristics, language-level only, 100k file limit | GitHub Docs | 2024 | Vendor documentation | Strong |
| S15 | Enry: Go port of Linguist, 2x faster, no Git repo required on disk, does not detect frameworks | github.com/src-d/enry | 2024 | Open-source primary | Strong |
| S16 | Rust linguist crate: file extension + filename + content heuristics, same scope as Linguist | crates.io/linguist | 2024 | Open-source primary | Moderate |
| S17 | scc: Go tool, LOC + approximate cyclomatic complexity + COCOMO, per-file mode, JSON output, MCP server mode | github.com/boyter/scc | 2024 | Open-source primary | Strong |
| S18 | lizard: Python tool, 25+ languages, per-function NLOC/CCN/token/param count, usable as Python library, XML/CSV/HTML output | github.com/terryyin/lizard | 2024 | Open-source primary | Strong |
| S19 | Wappalyzer/BuiltWith detect deployed sites via HTTP/JS; not useful for source code repos | AlternativeTo, DEV.to comparison | 2024 | Secondary review | Strong |
| S20 | Skill-LLM (2024): fine-tuned LLM outperforms SOTA for skill extraction; extraction-style > NER-style; vanilla LLMs with careful prompts also competitive | arXiv:2410.12052 | 2024 | Peer-reviewed paper | Strong |
| S21 | LinkedIn production skill extraction: two-tower BERT model matching JD text chunks to 39k-skill taxonomy via similarity | LinkedIn Engineering blog | 2023 | Engineering blog (primary) | Strong |
| S22 | LinkedIn knowledge distillation for production: 80% model size reduction with no accuracy loss | ZenML LLMOps DB (LinkedIn case study) | 2023 | Engineering blog (secondary) | Moderate |
| S23 | ESCO v1.2.0 (May 2024): 13,890 skills, 3,008 occupations, RDF/SKOS; ESCOX open-source extractor; LLM-direct linking challenged by hallucinations | ESCO official, ScienceDirect | 2024–2025 | EU official + peer-reviewed | Strong |
| S24 | JD parsers struggle to distinguish must-have from nice-to-have; recommended to combine with other tools | recrew.ai blog | 2024 | Vendor blog | Moderate |
| S25 | Pfeiffer et al. QUATIC 2021: files-per-commit heuristic for contribution complexity; Technical Debt compounds complexity over time | SpringerLink QUATIC 2021 | 2021 | Peer-reviewed conference paper | Strong |
| S26 | SATC/NIST: combined LOC + cyclomatic complexity most reliable predictor of defect risk; McCabe threshold 10 with evidence, up to 15 in experienced teams | Microsoft Learn, Codacy, LinearB | 2024 | Vendor docs citing SATC/NIST | Moderate |
| S27 | Seniority levels: junior gets low-complexity tasks, senior owns high-complexity cross-cutting initiatives independently | madewithlove.com, altexsoft.com | 2024 | Industry blog (anecdotal) | Weak — single-source |
| S28 | Repo complexity signals for seniority proxy: contributor count, test suite presence, CI/CD, monorepo structure | lightit.io, rootstack.com | 2024 | Industry blog | Weak — anecdotal |
| S29 | roadmap.sh seniority levels: junior → guided tasks; mid → weekly support; senior → independent, defines risk | roadmap.sh | 2024 | Community resource | Weak — editorial |
| S30 | Rust: 72% admired by developers in 2025 SO survey but only ~13% use professionally; Kotlin grew 27% in 2024 | Stack Overflow Developer Survey 2025 | 2025 | Industry survey | Strong |
| S31 | SonarQube/SonarCloud do not support Rust and Elixir natively; coverage must be pushed manually | Sonar Community forum | 2024 | Vendor forum (single source) | Moderate — single source |
| S32 | HackerRank: 7,500+ questions, 260 skills, 84 roles, 55+ languages including niche ones but with limited depth | HackerRank marketing / comparison pages | 2025 | Vendor documentation | Moderate |
| S33 | Niche languages (Elixir, Zig) have worse AI assistant support; small codebases cause hallucinations; may accelerate developer avoidance | angeloceccato.it, github.com/dwyl/learn-elixir | 2025–2026 | Blog / GitHub discussion | Weak — anecdotal |
| S34 | HackerRank JD-to-assessment AI (2025): parses JD, extracts competencies/skills/technologies, maps to question bank | HackerRank engineering writing | 2025 | Vendor blog | Moderate |
| S35 | HackerRank Skill Taxonomy: internal data + JD analysis + SME review; 84 roles directory | HackerRank blog | 2024 | Vendor documentation | Moderate |
| S36 | CodeSignal Certified Assessments: IO-psychologist-validated, 2,800+ hours per assessment, limited customization | CodeSignal marketing | 2025 | Vendor documentation | Moderate |
| S37 | Codility: asynchronous role-specific skills assessments by role + experience level; pre-curated not dynamic | Codility.com | 2025 | Vendor documentation | Moderate |
| S38 | Karat: human-conducted live interviews; limited role customization, Karat team defines content | karat.com, codesubmit.io | 2025 | Vendor + review | Moderate |

---

## Direct Implications for PIPE

1. **The Role Discovery agent output is already the right input format.** It produces `mustHaveSkills`, `niceToHaveSkills`, domain, and seniority — exactly the structured data needed to drive manifest-based repo filtering. No separate JD parsing step is needed for the happy path.

2. **specfy/stack-analyser is the highest-leverage open-source tool to adopt.** It subsumes both manifest parsing and file-pattern detection, outputs JSON, and is embeddable as an NPM package. PIPE can run it on cloned repos (or point it at a local checkout) to produce a structured tech stack profile that can be compared against the role's `mustHaveSkills`. This one tool eliminates the need to build custom parsers.

3. **The GitHub GraphQL dependency graph API is the zero-clone path.** For repos that don't need cloning, query `dependencyGraphManifests` to extract named packages and package managers. Cross-reference against a PIPE-maintained "known-tech" vocabulary (React, Next.js, Tailwind, Prisma, etc.) to determine if the repo's stack matches the role's requirements.

4. **Complexity scoring for seniority matching should be a lightweight two-pass approach.** First pass: file pattern check (does the repo have tests? CI/CD? Docker? monorepo indicators?). Second pass: run `scc --by-file -s complexity` to get SLOC and cyclomatic complexity per file. Combine with dependency count from the GraphQL API. Calibrate thresholds empirically against a curated ground-truth corpus once PIPE has one.

5. **Niche stack coverage requires a manual curation tier from day one.** Elixir/Phoenix, Rust (embedded or systems), Kotlin Multiplatform, Clojure, Zig — these cannot be covered by the automated pipeline at launch. Define an explicit "Tier 2 / manually curated" category so the system gracefully degrades rather than returns no results.

---

## Open Questions / Gaps

1. **must-have vs. nice-to-have distinguishing accuracy** — No published benchmark exists for how well LLMs distinguish required vs. preferred skills in JDs. PIPE will need to measure this empirically on a sample of real role descriptions.

2. **Complexity-to-seniority calibration data** — No published paper maps quantitative CCN/SLOC/dependency-count thresholds to seniority levels for assessment purposes. PIPE will need to build this empirically with its own labeled corpus.

3. **GitHub GraphQL dependency graph coverage rate** — It's unclear what percentage of public repos have a fully populated dependency graph (requires GitHub's detection to have run). Repos with unusual file layouts or private registries may have gaps. This coverage rate needs empirical measurement before relying on it as the primary source.

4. **specfy/stack-analyser accuracy on edge cases** — The tool is well-documented but there is no published precision/recall benchmark for its 700-technology detection. Given it powers getstack.dev in production, quality is likely reasonable, but known false-positive categories (e.g., a repo that mentions `react` in its README but doesn't use it) are unknown.

5. **techstack.yml adoption** — The StackShare standard was announced November 2023. Actual adoption in the wild (percentage of repos with the file) is unknown. It cannot be relied upon as a primary signal yet.

---

## Sources

1. [GitHub Dependency Graph — how it recognizes dependencies (GitHub Docs)](https://docs.github.com/en/code-security/concepts/supply-chain-security/dependency-graph-data) — Vendor documentation, 2024.
2. [Accessing repository dependencies in the GitHub GraphQL API (Simon Willison TIL)](https://til.simonwillison.net/github/dependencies-graphql-api) — Engineering blog, 2023.
3. [Dependency graph supported package ecosystems (GitHub Docs)](https://docs.github.com/en/code-security/supply-chain-security/understanding-your-software-supply-chain/dependency-graph-supported-package-ecosystems) — Vendor documentation, 2024.
4. [REST API endpoints for dependency submission (GitHub Docs)](https://docs.github.com/en/rest/dependency-graph/dependency-submission) — Vendor documentation, 2024.
5. [OWASP Dependency Check: How It Works (Mend.io)](https://www.mend.io/blog/owasp-dependency-check/) — Vendor blog, 2024.
6. [Dependency scanning (GitLab Docs)](https://docs.gitlab.com/user/application_security/dependency_scanning/) — Vendor documentation, 2024.
7. [depcheck (npm)](https://www.npmjs.com/package/depcheck) — Open-source library documentation, 2024.
8. [specfy/stack-analyser: Extract +700 technologies from any repository (GitHub)](https://github.com/specfy/stack-analyser) — Open-source primary source, 2024–2026.
9. [getStack — Technology Trends (getstack.dev)](https://getstack.dev) — Production service, 2024–2025.
10. [Getting Started: Project Structure (Next.js official docs)](https://nextjs.org/docs/app/getting-started/project-structure) — Vendor documentation, 2024.
11. [Workspace and project file structure (Angular official docs)](https://angular.dev/reference/configs/file-structure) — Vendor documentation, 2024.
12. [Django settings (Django official docs)](https://docs.djangoproject.com/en/6.0/topics/settings/) — Vendor documentation, 2024.
13. [StackShare Introduces The Tech Stack File — Universal Standard (BusinessWire)](https://www.businesswire.com/news/home/20231108514442/en/StackShare-Introduces-The-Tech-Stack-File---The-Universal-Standard-for-Tech-Stack-Data-to-Power-New-AI-Capabilities-and-Partner-Ecosystem) — Vendor press release, 2023.
14. [About repository languages (GitHub Docs)](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-repository-languages) — Vendor documentation, 2024.
15. [src-d/enry: A faster file programming language detector (GitHub)](https://github.com/src-d/enry) — Open-source primary source, 2024.
16. [linguist crate (crates.io)](https://crates.io/crates/linguist) — Open-source library, 2024.
17. [boyter/scc: Sloc, Cloc and Code (GitHub)](https://github.com/boyter/scc) — Open-source primary source, 2024.
18. [terryyin/lizard: Code complexity analyser (GitHub)](https://github.com/terryyin/lizard) — Open-source primary source, 2024.
19. [BuiltWith vs Wappalyzer vs DetectZeStack (DEV Community)](https://dev.to/mikel_7c461a5ca8fe80a526e/builtwith-vs-wappalyzer-vs-detectzestack-which-tech-detection-tool-is-right-for-you-1gcb) — Community article, 2024.
20. [Skill-LLM: Repurposing General-Purpose LLMs for Skill Extraction (arXiv:2410.12052)](https://arxiv.org/abs/2410.12052) — Peer-reviewed paper (arXiv preprint), October 2024.
21. [Extracting skills from content to fuel the LinkedIn Skills Graph (LinkedIn Engineering)](https://engineering.linkedin.com/blog/2023/extracting-skills-from-content-to-fuel-the-linkedin-skills-graph) — Engineering blog, 2023.
22. [LinkedIn: Building and Deploying LLMs for Skills Extraction at Scale (ZenML LLMOps Database)](https://www.zenml.io/llmops-database/building-and-deploying-large-language-models-for-skills-extraction-at-scale) — Secondary source (case study aggregator), 2023.
23. [ESCOX: A tool for skill and occupation extraction using LLMs (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S2665963825000326) — Peer-reviewed journal article, 2025.
24. [Job Description Parsing 101: Everything You Need to Know (Recrew.ai)](https://www.recrew.ai/blog/job-description-parsing-101) — Vendor blog, 2024.
25. [Automatically Assessing Complexity of Contributions to Git Repositories (SpringerLink / QUATIC 2021)](https://link.springer.com/chapter/10.1007/978-3-030-85347-1_9) — Peer-reviewed conference paper, 2021.
26. [Code metrics — Cyclomatic complexity (Microsoft Learn)](https://learn.microsoft.com/en-us/visualstudio/code-quality/code-metrics-cyclomatic-complexity?view=visualstudio) — Vendor documentation citing SATC/NIST research, 2024.
27. [Seniority level in software engineering and how to assess it (madewithlove.com)](https://madewithlove.com/blog/seniority-level-in-software-engineering-and-how-to-assess-it/) — Industry blog, 2024.
28. [Software Engineer Qualification Levels: Junior, Middle, and Senior (AltexSoft)](https://www.altexsoft.com/blog/software-engineer-qualification-levels-junior-middle-and-senior/) — Industry blog, 2024.
29. [Levels of Seniority (roadmap.sh)](https://roadmap.sh/guides/levels-of-seniority) — Community reference, 2024.
30. [Technology | 2025 Stack Overflow Developer Survey](https://survey.stackoverflow.co/2025/technology) — Industry survey, 2025.
31. [Pushing test coverage from unsupported languages like Rust or Elixir (Sonar Community)](https://community.sonarsource.com/t/pushing-test-coverage-from-unsupported-languages-like-rust-or-elixir/37892) — Vendor forum, 2024.
32. [HackerRank vs CodeSignal: Coding Assessment Platform Comparison](https://www.hackerrank.com/writing/hackerrank-vs-codesignal-coding-assessment-platform-comparison) — Vendor marketing, 2025.
33. [Would you still pick Elixir in 2026? (GitHub issue, dwyl/learn-elixir)](https://github.com/dwyl/learn-elixir/issues/102) — Community discussion, 2026.
34. [Generate Technical Assessment Interviews from Job Descriptions with AI (HackerRank)](https://www.hackerrank.com/writing/generate-technical-assessment-interviews-from-job-descriptions-with-ai-2025) — Vendor blog, 2025.
35. [New Role-based Developer Skill Assessments (HackerRank Blog)](https://blog.hackerrank.com/new-role-based-assessments/) — Vendor blog, 2024.
36. [Technical Assessments (CodeSignal Skills Platform)](https://codesignal.com/technical-assessments/) — Vendor documentation, 2025.
37. [Codility: Online Coding Tests & Technical Interviews](https://www.codility.com/) — Vendor documentation, 2025.
38. [Your Guide to Technical Interviews (Karat)](https://karat.com/guide-to-technical-interviews/) — Vendor documentation, 2025.
