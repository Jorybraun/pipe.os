# Research: Discovery Tools and APIs for Programmatic Repository Search

**Brief:** Tooling landscape for finding open-source repos matchable to a target role/stack in the PIPE hybrid AIG content pipeline.
**Scope:** What exists, what it filters on, automation viability, cost. Does NOT cover repo quality criteria, role-to-repo matching, or bug-planting.
**Date:** 2026-04-09

---

## Key Findings

### 1. SEART GHS (seart-ghs.si.usi.ch)

**What it is:** A research-grade GitHub crawler maintained by the Software Engineering & Analytics Research Team (SEART) at USI Lugano. It continuously indexes public GitHub repos, currently storing 25 characteristics across ~735,000 repositories in 10 programming languages (as of the 2024 SEART Data Hub paper). Minimum bar for inclusion: ≥10 stars [S1].

**Filtering capabilities (from the live web UI and the 2024 ICSME paper [S2]):**

The repository-level filters available are:
- **Language** — required field; current support: Java and Python (with plans to extend to C, C++, JavaScript, TypeScript, and others per the roadmap in [S2])
- **Commits** — min/max range
- **Issues** — min/max range
- **Contributors** — min/max range
- **Stars** — min/max range
- **Has open-source license** — boolean checkbox
- **Exclude Forks** — boolean checkbox

There is NO filter for framework (e.g., React, Spring, Django), topic tags, or dependency manifest contents. Framework detection would have to be done downstream by inspecting crawled file trees.

**API availability:** The backend is Spring Boot and "acts as an API for providing access to stored data" [S3], but no public REST API documentation is published. The web UI submits a request, the backend queues it, and the user receives a download link by email within hours. Output format is JSON Lines (JSONL). This is a batch, non-interactive API — not suitable for real-time pipeline queries.

**Automation:** Technically automatable via HTTP form submission (POST to the web UI), but this is web scraping, not a documented API contract. Fragile.

**Cost:** Free for researchers. No authentication token required. Self-hostable (open source: github.com/seart-group/ghs [S3]).

**Verdict for PIPE:** Useful for bulk bootstrapping a seed corpus filtered by language + quality proxies (stars, commits). Cannot filter by framework — a second-pass dependency scan is required after download. Single-source note: API contract details are inferred from the open-source repo; no formal API docs are published.

---

### 2. SEART Data Hub (seart-dl4se.si.usi.ch)

**What it is:** A higher-level sibling tool from the same USI group, presented at ICSME 2024 [S2]. Purpose: produce training/evaluation datasets for DL models in software engineering. It crawls the same GitHub repos as SEART GHS but adds code-level processing.

**Filtering capabilities [S2]:**

*Repository-level (same as SEART GHS):*
- Language (Java, Python; roadmap: C, C++, JS, TypeScript)
- Commits, Issues, Contributors, Stars — all with min/max
- Has open-source license — boolean
- Exclude Forks — boolean

*Code-level (unique to Data Hub):*
- Granularity: File-level or Function-level instances
- Exclude test code — boolean
- Exclude boilerplate code — boolean
- Exclude instances with syntax errors — boolean
- Exclude non-ASCII characters — boolean
- Remove regular comments (JavaDoc / docstring) — boolean
- Remove documentation comments — boolean
- Remove near-clones (semantically similar instances) — boolean
- Remove exact duplicates — boolean
- Include symbolic expression (AST-based XML) — boolean
- Include tree-sitter parser metadata — boolean

**API availability:** Same batch model as GHS — web form submission, async processing, email with download link. No documented REST API for programmatic queries.

**Cost:** Free. Open source: github.com/seart-group/DL4SE [S3].

**Verdict for PIPE:** Not directly useful for repo discovery — it is designed for code instance dataset construction, not repo list generation. But its Java/Python focus limits applicability for a React/TypeScript-targeted pipeline.

---

### 3. GitHub Search API (REST)

**What it is:** GitHub's official REST API endpoint for searching repositories, code, users, topics, and commits. The repo search endpoint is `GET /search/repositories` [S4].

**Repository search qualifiers [S5]:**

| Qualifier | Description | Example |
|---|---|---|
| `language:LANG` | Primary repo language | `language:typescript` |
| `topic:TOPIC` | GitHub topic tag on the repo | `topic:react` |
| `stars:N` | Star count (supports `>`, `<`, `>=`, `<=`, `n..n`) | `stars:>500` |
| `forks:N` | Fork count | `forks:>50` |
| `size:N` | Repo size in KB | `size:1000..50000` |
| `created:DATE` | Creation date | `created:>2020-01-01` |
| `pushed:DATE` | Last commit date | `pushed:>2023-01-01` |
| `license:SPDX` | License type (SPDX identifier) | `license:mit` |
| `archived:true/false` | Archived status | `archived:false` |
| `mirror:true/false` | Mirror repos | `mirror:false` |
| `fork:true/only` | Include/show only forks | `fork:false` |
| `template:true/false` | Template repos | `template:false` |
| `is:public` / `is:private` | Visibility | `is:public` |
| `user:USERNAME` | Repos from a specific user | `user:facebook` |
| `org:ORGNAME` | Repos from a specific org | `org:vercel` |
| `in:name` | Search in repo name | `in:name react` |
| `in:description` | Search in description | `in:description "todo app"` |
| `in:topics` | Search within topic tags | `in:topics` |
| `in:readme` | Search README text | `in:readme nextjs` |
| `good-first-issues:>N` | Repos with beginner issues | `good-first-issues:>5` |
| `help-wanted-issues:>N` | Repos with help-wanted issues | |

**Framework filtering:** GitHub has NO native `framework:` qualifier. The practical workaround is stacking `topic:react language:typescript` — this relies on repo maintainers having tagged their repo with the relevant topic, which is inconsistent. The `in:readme` qualifier can partially compensate (e.g., `react language:typescript in:readme` will match repos whose README mentions React), but this is imprecise.

**Dependency filtering:** There is NO `dependency:` qualifier in the search API. You cannot ask "find all repos that have React in their package.json" directly via search. The workaround requires the Code Search API (see §3a below).

**Result limits:** Max 1,000 results per query (10 pages × 100 results/page). This is a hard ceiling — pagination beyond 1,000 is not possible through the search API [S4].

**Rate limits [S6]:**
- Authenticated (personal token): 30 requests/minute for all search endpoints; 9 requests/minute for code search specifically
- Unauthenticated: 10 requests/minute
- GitHub Apps (installation token): higher limits available
- General REST API (non-search): 5,000 requests/hour authenticated; 60/hour unauthenticated

**Cost:** Free for public repo access.

**Verdict for PIPE:** Best primary discovery tool for general repo enumeration by language + topic + recency + license. The 1,000-result ceiling requires creative query decomposition (e.g., shard by stars range: `stars:1000..5000`, then `stars:500..1000`, etc.) to retrieve larger result sets.

---

### 3a. GitHub Code Search API (REST)

**What it is:** A separate endpoint (`GET /search/code`) that searches file *contents* rather than repo metadata [S4]. This is the mechanism that partially substitutes for missing dependency filtering.

**How to use for dependency discovery:** Search for repos whose `package.json` contains `"react"` as a dependency:
```
q="react" filename:package.json
```
or more precisely:
```
q='"dependencies"' filename:package.json language:json
```

Combining with `repo:` qualifier allows scoping to a specific org. Without scoping, it returns repos from across GitHub containing matching code.

**Limitations:**
- Rate limit: 9 requests/minute (authenticated only — unauthenticated code search is not supported) [S4]
- Results capped at 1,000 per query
- The result is file matches, not repo matches — deduplication required
- False positives are high: a file mentioning `"react"` is not necessarily a React app

**Verdict for PIPE:** Useful as a supplemental filter: take a repo candidate list from the repo search API, then verify each candidate's `package.json` via the Contents API (`GET /repos/{owner}/{repo}/contents/package.json`) to confirm framework/dependency presence.

---

### 4. GitHub GraphQL API + Dependency Graph

**What it is:** GitHub's GraphQL API at `https://api.github.com/graphql`. The dependency graph feature exposes manifests (package.json, pom.xml, etc.) detected in a specific, known repo [S7].

**`dependencyGraphManifests` query structure:**
```graphql
{
  repository(owner: "foo", name: "bar") {
    dependencyGraphManifests {
      nodes {
        filename
        dependencies {
          nodes {
            packageName
            requirements
            packageManager
          }
        }
      }
    }
  }
}
```

**Critical limitation:** This API is *per-repo* — you provide a known repo name and retrieve its dependency list. There is NO inverse query: "give me all repos that depend on React." As Simon Willison documented: "I really wanted to get the dependents, not the dependencies — but that's still not available even as a preview API." [S7]

This means the dependency graph GraphQL API is useful for *verifying* a known candidate repo's stack, not for *discovering* repos by their dependencies.

**Headers required:** `Accept: application/vnd.github.hawkgirl-preview+json` (preview feature)

**Rate limits:** GraphQL API shares the general 5,000 requests/hour limit for authenticated users.

**Verdict for PIPE:** Good for the verification step (check a candidate repo's declared dependencies to confirm it uses the target framework), but cannot replace a discovery query.

---

### 5. GitHub Topics API

**What it is:** A REST endpoint for listing or setting topics on a specific repo (`GET /repos/{owner}/{repo}/topics`), plus the ability to search topics as a qualifier in the main search API [S5].

**Practical discovery flow:**
1. Use `GET /search/repositories?q=topic:react+topic:typescript+language:typescript+stars:>100` to get repos tagged with both `react` and `typescript` topics
2. Topics are user-applied labels — coverage is good for popular frameworks but spotty for less-visible ones

**Available topic search:** The `topic:TOPIC` qualifier in the repo search API is the primary mechanism. There is also a dedicated `GET /search/topics` endpoint that searches topic names themselves (useful for discovering what topic names are in use: e.g., `react-hooks`, `react-typescript`, `nextjs`).

**Limitation:** No guarantee of completeness. A React repo not tagged with `topic:react` will be invisible to this filter. Large, well-maintained projects are generally tagged; smaller projects often are not.

**Verdict for PIPE:** Best precision-vs-recall tradeoff for framework filtering. Use `topic:react language:typescript` as a primary filter and supplement with code search for validation.

---

### 6. Libraries.io

**What it is:** An open-source monitoring platform that indexes packages from 36+ package managers (npm, PyPI, Maven, RubyGems, etc.) and augments that data with GitHub/GitLab/Bitbucket repository metadata. It tracks ~9.96M packages and their dependency relationships [S8].

**API capabilities [S9]:**

| Endpoint | Description |
|---|---|
| `GET /api/platforms` | List all supported package managers |
| `GET /api/:platform/:name` | Get package metadata (stars, forks, language, license, latest version, keywords) |
| `GET /api/:platform/:name/:version/dependencies` | Get dependencies for a specific version |
| `GET /api/:platform/:name/dependents` | Get packages that depend on a given package |
| `GET /api/:platform/:name/dependent_repositories` | **Get repos that depend on a given package** |
| `GET /api/:platform/:name/sourcerank` | Get the SourceRank quality score for a package |
| `GET /api/search` | Search packages by keyword, language, keywords, etc. |

The `dependent_repositories` endpoint is particularly relevant: it returns GitHub repo URLs for projects that have a manifest file declaring a dependency on the queried package [S9].

**Rate limits:** 60 requests/minute per API key [S9]. API keys are free for all registered users.

**Open dataset:** Libraries.io publishes a quarterly open data release on Zenodo (311M+ rows across projects, versions, dependencies) and as a Google BigQuery public dataset (`bigquery-public-data.libraries_io.*`) [S10]. This enables arbitrary SQL queries against the full dependency graph without API rate limits.

**Framework discovery example:**
```
GET https://libraries.io/api/npm/react/dependent_repositories?api_key=KEY&page=1&per_page=100
```
Returns repos that list `react` as a dependency in their `package.json`. This is the closest available API to "find all GitHub repos using React."

**Limitation:** Dependent repository data is derived from manifest files at the time of Libraries.io's last crawl — may lag by days or weeks. Also, only covers packages in supported package managers (npm, PyPI, etc.) not arbitrary code patterns.

**Cost:** API free (60 req/min). BigQuery queries charged per-byte scanned under Google's standard pricing (first 1TB/month free).

**Verdict for PIPE:** The `dependent_repositories` endpoint is one of the most powerful tools for framework-based repo discovery. Strongly recommended as a primary source for finding React/Vue/Angular/Django repos.

---

### 7. Open Source Insights / deps.dev (Google)

**What it is:** A Google-hosted dependency analysis service for open-source packages. It indexes npm, Go, Maven, PyPI, Cargo, NuGet, and RubyGems. Available as a REST/gRPC API and as a BigQuery public dataset [S11].

**API endpoints relevant to repo discovery [S12]:**

| Endpoint | Description |
|---|---|
| `GET /v3/systems/{system}/packages/{name}/versions/{version}:dependents` | Returns count of packages depending on this version |
| `GET /v3/projects/{projectKey.id}:packageversions` | Maps a GitHub project to the package versions built from it |
| `GET /v3/systems/{system}/packages/{name}/versions/{version}:dependencies` | Full resolved dependency graph |

**BigQuery tables:**
- `DependentsLatest` — reverse dependency lookup (which packages depend on X)
- `Projects/ProjectsLatest` — maps packages to GitHub/GitLab/Bitbucket project URLs + stars/forks

**Limitation:** The REST API returns dependent *counts* and *package names*, not repo URLs. The `DependentsLatest` BigQuery table gives package-to-package relationships; joining with `Projects/ProjectsLatest` retrieves repo URLs. This is doable in BigQuery SQL but requires two-table join logic.

**Rate limits:** Not documented on the public API page. Google API Terms of Service apply. Caching is explicitly encouraged. BigQuery costs are standard Google pricing.

**Cost:** API appears free. BigQuery: first 1TB/month free, then $5/TB.

**Verdict for PIPE:** Complementary to Libraries.io. Useful for security-aware filtering (the `Advisories` table flags CVE-affected versions). BigQuery path is more powerful than the REST API for bulk discovery.

---

### 8. Sourcegraph (sourcegraph.com)

**What it is:** A code intelligence platform that indexes 2M+ public open-source repositories and provides full-text code search with a rich query language [S13]. Primarily designed for code search, not repo discovery — but repo-level filters exist.

**Repo discovery capabilities via the Stream Search API [S14]:**

The `/.api/search/stream` endpoint accepts a Sourcegraph query string. Repo-level predicates include:

| Filter | Description |
|---|---|
| `repo:PATTERN` | Regex match on repo name |
| `repo:has.path(PATTERN)` | Repos containing a file matching the path pattern |
| `repo:has.topic(TOPIC)` | Repos with a specific GitHub topic |
| `repo:has.commit.after(DATE)` | Repos with recent activity |
| `lang:LANGUAGE` | Language filter |
| `archived:yes/no` | Archived status |
| `fork:yes/no` | Fork status |

**Dependency discovery trick:** Sourcegraph's code search can be used to find repos containing specific dependency declarations:
```
file:package.json "react": repo:has.commit.after(2023-01-01) lang:TypeScript
```
This searches the *content* of `package.json` files across all indexed repos for the string `"react":`, effectively finding React repos. Much more powerful than GitHub's code search for this purpose because:
1. No per-minute rate limit (streaming)
2. Cross-repo search with contextual line matches
3. No 1,000-result cap on streaming queries

**GraphQL API:** Marked as "primarily for debugging" and not backwards-compatible [S15]. **Do not use for production pipelines.**

**Rate limits:** Query complexity limits (max depth 30, max fields 500,000) but no explicit req/minute limit documented. Sourcegraph recommends service accounts for automation [S13].

**Pricing:** Public code search on sourcegraph.com appears free for unauthenticated access. Deep Search (AI-assisted) features require a paid plan (from Oct 2025: 3 deep searches/seat/month on paid plans) [S16]. Self-hosted Sourcegraph (open-source edition) is free.

**Verdict for PIPE:** The most powerful tool for *content-based* repo discovery (find repos whose `package.json` actually contains `react`). Complements GitHub's topic-based search by catching repos that use the framework but haven't applied the topic tag. Requires familiarity with Sourcegraph query syntax. Best used for targeted verification of large candidate pools.

---

### 9. World of Code (WoC)

**What it is:** A research infrastructure maintained by Tennessee/Auburn universities that aggregates nearly all public VCS data: 173M git repos, 3.1B commits, 12.5B trees. Provides cross-references between authors, projects, commits, blobs, and dependencies [S17].

**Filtering/discovery:** Provides Unix command-line tools (`getValues`, `showCnt`) for key-based lookups. Can enumerate all repos using a specific blob SHA or containing a specific file pattern. Not a web API — requires SSH access to the WoC servers, granted by application.

**Automation:** Fully scriptable via bash/Python, but requires server access approval from the WoC team. Data lives on dedicated servers (~250TB); not downloadable.

**Cost:** Free for academic researchers. Commercial/startup use unclear.

**Verdict for PIPE:** Overkill for PIPE's use case and access is gated on academic affiliation. Documented here for completeness, but not recommended as a pipeline component.

---

### 10. npm Registry API

**What it is:** The official npm registry REST API. Primarily designed for package lookup, not repo discovery — but the search endpoint can surface repos via package metadata [S18].

**Relevant endpoints:**
- `GET https://registry.npmjs.org/-/v1/search?text=QUERY` — search packages by keyword; results include repository URL field pointing to the GitHub repo
- `GET https://registry.npmjs.org/PACKAGE_NAME` — get full package metadata including `repository.url`

**Limitation:** There is no "dependents" endpoint in the npm registry API (this has been an open issue since 2014 [S19]). The search endpoint returns packages, not repos. However, searching for a framework name (e.g., `text=react`) and extracting `repository.url` from results does produce a corpus of React-related repos — though these are libraries/tools built around React, not necessarily apps suitable for code review assessment.

**Rate limits:** No documented rate limit for the public registry API. In practice, aggressive scraping triggers 429s.

**Cost:** Free.

**Verdict for PIPE:** Limited utility for assessment repo discovery. Better used to resolve "which GitHub repo does package X come from?" than to enumerate assessment candidates.

---

### 11. GitStar Ranking / GitHub Trending / Curated Awesome Lists

**What they are:**
- **GitStar Ranking** (gitstar-ranking.com): An unofficial leaderboard of top starred GitHub repos/users. No API. Useful for manual browsing, not automation [S20].
- **GitHub Trending** (github.com/trending): GitHub's own trending repos page, filterable by language and time window (daily/weekly/monthly). No official API — scrapers exist but are fragile and rate-limited.
- **EvanLi/Github-Ranking** (github.com/EvanLi/Github-Ranking): A GitHub repo that publishes daily auto-updated markdown tables of top repos by language and star count. Machine-readable via GitHub API on the files [S20].
- **Awesome Lists** (e.g., awesome-react, awesome-vue): Curated hand-maintained lists on GitHub. Can be parsed programmatically via GitHub Contents API, but are hand-curated and not comprehensive.

**Verdict for PIPE:** Useful for manually seeding a high-quality starter corpus (top 100 React repos by stars), but not suitable as an automated pipeline source due to lack of stable APIs and small coverage windows.

---

## Recommended Pipeline Architecture (Inference)

Based on the evidence above, a practical multi-stage discovery pipeline for PIPE would chain:

1. **Primary enumeration** — Libraries.io `dependent_repositories` endpoint: enumerate repos that declare the target package (e.g., `react`, `vue`, `django`) in their manifests. This gives the broadest, most precise framework-filtered list.

2. **Quality pre-filter** — GitHub Search API: filter the candidate list by `stars:>200 pushed:>2022-01-01 archived:false fork:false`. The 1,000-result cap is irrelevant here since you're filtering a known list, not enumerating.

3. **Framework verification** — Sourcegraph Stream API or GitHub Contents API: fetch `package.json` for each candidate and confirm the target framework is a direct dependency (not just mentioned in docs).

4. **Supplemental discovery for underrepresented repos** — SEART GHS: bulk-download by language + stars + recent commits; run dependency scan locally on downloaded manifests.

5. **Dependency graph detail** — GitHub GraphQL `dependencyGraphManifests` per candidate: retrieve the full dependency list to classify the stack (e.g., React + Next.js + TypeScript vs React + CRA + JavaScript).

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | SEART GHS indexes ~735k repos in 10 languages, ≥10 stars, 25 characteristics | SEART GHS website / search result summary | 2024 | Research tool docs | Moderate (web crawl of live tool) |
| S2 | SEART Data Hub filters: language (Java/Python), commits, issues, contributors, stars, license, exclude forks; code filters: granularity, test/boilerplate/syntax/AST | ICSME 2024 paper (Dabic et al., arXiv 2409.18658) | 2024 | Peer-reviewed conference paper | Strong |
| S3 | SEART GHS is open source (Spring Boot), acts as an API for stored data, no published API spec | github.com/seart-group/ghs README | 2024 | Official project docs | Strong |
| S4 | GitHub REST search API: repo search qualifiers include language, topic, stars, license, pushed, created, archived, mirror, fork, template; max 1,000 results; code search at 9 req/min | docs.github.com/en/rest/search | 2024 | Official vendor docs | Strong |
| S5 | Full qualifier list including in:topics, in:readme, good-first-issues, help-wanted-issues, is:sponsorable, props.PROPERTY | docs.github.com/en/search-github/searching-on-github/searching-for-repositories | 2024 | Official vendor docs | Strong |
| S6 | GitHub REST rate limits: 30 req/min (search authenticated), 9 req/min (code search), 10 req/min (unauthenticated); 5,000 req/hr general | docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api | 2024 | Official vendor docs | Strong |
| S7 | GitHub GraphQL dependencyGraphManifests: per-repo forward lookup only; no inverse (dependents) query; requires preview Accept header | Simon Willison's TIL: til.simonwillison.net/github/dependencies-graphql-api | 2023 | Engineering blog (primary source — author accessed the API directly) | Strong |
| S8 | Libraries.io indexes 9.96M packages from 36 package managers | libraries.io homepage | 2024 | Vendor marketing page | Moderate |
| S9 | Libraries.io API: `dependent_repositories` endpoint returns repos depending on a package; 60 req/min; free API key | libraries.io/api docs | 2024 | Official vendor docs | Strong |
| S10 | Libraries.io open data: 311M+ rows, available on Zenodo and BigQuery public dataset; CC BY-SA 4.0 | Medium post (Nesbitt), Kaggle dataset listing | 2024 | Vendor blog + dataset registry | Strong |
| S11 | deps.dev (Google) indexes npm, Go, Maven, PyPI, Cargo, NuGet; provides BigQuery tables including DependentsLatest, ProjectsLatest | docs.deps.dev/bigquery/v1/ | 2024 | Official vendor docs | Strong |
| S12 | deps.dev REST API: GetDependents returns dependent counts; GetProjectPackageVersions maps projects to packages; no rate limit documented | docs.deps.dev/api/v3alpha/ | 2024 | Official vendor docs | Strong |
| S13 | Sourcegraph indexes 2M+ public repos; search supports repo:has.path(), repo:has.topic(), repo:has.commit.after(), lang:, archived:, fork: | sourcegraph.com/docs/code-search/queries | 2024 | Official vendor docs | Strong |
| S14 | Sourcegraph stream API endpoint: `/.api/search/stream`; supports q, v, t (pattern type), display, cl (context lines) parameters | docs.sourcegraph.com/api/stream_api | 2024 | Official vendor docs | Strong |
| S15 | Sourcegraph GraphQL API is marked "primarily for debugging" with no backwards-compatibility guarantees | sourcegraph.com/docs/api/graphql | 2025 | Official vendor docs | Strong |
| S16 | Sourcegraph Deep Search pricing change Oct 2025: 3 deep searches/seat/month on paid plans | sourcegraph.com/changelog/introducing-pricing-plans | 2025 | Official vendor changelog | Strong |
| S17 | World of Code: 173M repos, 3.1B commits, 250TB+; Unix CLI access; requires server access application; free for academics | WoC IEEE/EMSE papers; MSR 2023 mining challenge | 2019–2024 | Peer-reviewed papers | Strong |
| S18 | npm registry search API: `GET /-/v1/search?text=QUERY`; results include repository.url; no documented dependents endpoint | npm/registry GitHub docs; npm API docs | 2024 | Official vendor docs | Strong |
| S19 | npm registry has no dependents API endpoint (open issue since 2014) | npm/registry-issue-archive issue #231 | 2014 | Official issue tracker | Strong (single source — unverified if still open in 2026) |
| S20 | GitStar Ranking: unofficial star leaderboard, no API; EvanLi/Github-Ranking: daily auto-updated markdown tables by language | gitstar-ranking.com; github.com/EvanLi/Github-Ranking | 2024 | Third-party tools | Moderate |

---

## Direct Implications for the PIPE Pipeline

1. **Libraries.io `dependent_repositories` is the highest-leverage discovery endpoint.** A single call to `GET /api/npm/react/dependent_repositories` returns GitHub repos that actually declare React as a dependency in their manifest. This is the most direct proxy for "React codebase" and should be the primary corpus-building tool.

2. **GitHub topic search is necessary but insufficient.** `topic:react language:typescript` catches well-tagged repos quickly, but framework topics are inconsistently applied — especially for older or smaller projects. Always combine with a dependency check.

3. **The GitHub dependency graph GraphQL API is a verifier, not a discoverer.** Use it per-candidate to enumerate the full stack (React version, TS version, testing framework, bundler) to power role-to-repo matching downstream.

4. **Sourcegraph content search is the best tool for catching untagged repos.** Searching for `"react":` in `file:package.json` across Sourcegraph's 2M+ indexed repos surfaces React repos regardless of topic tags.

5. **SEART GHS is valuable for bulk bootstrapping Java and Python corpora** (its two supported languages map to backend roles), but it cannot filter by framework and does not yet support TypeScript/JavaScript — limiting its value for frontend role pipelines.

---

## Open Questions / Gaps

1. **Libraries.io freshness:** The `dependent_repositories` endpoint reflects crawl state — how stale can it be? No SLA is documented. (Mitigation: cross-check last-updated timestamps via GitHub API.)

2. **SEART GHS JavaScript/TypeScript ETA:** The 2024 paper lists JS/TS on the roadmap but gives no release date. Monitor github.com/seart-group/ghs releases.

3. **GitHub search API 1,000-result ceiling workaround:** Sharding by `stars:` range is documented practice but requires empirical calibration per language to avoid coverage gaps. No authoritative guidance exists on how to minimize overlap.

4. **Sourcegraph public instance reliability:** sourcegraph.com indexes public repos, but the platform has been shifting toward enterprise and AI features (Cody/Amp). The public search SLA is undefined — a self-hosted Sourcegraph instance may be more reliable for a production pipeline.

5. **deps.dev `DependentsLatest` coverage vs. Libraries.io:** Both claim to track npm dependents but may have different crawl depths and freshness. Head-to-head comparison not found in literature.

---

## Sources

1. **SEART GitHub Search web tool** — seart-ghs.si.usi.ch (live tool, accessed 2026-04-09): [https://seart-ghs.si.usi.ch/](https://seart-ghs.si.usi.ch/)

2. **Dabic, O., Tufano, R., Bavota, G. — "SEART Data Hub: Streamlining Large-Scale Source Code Mining and Pre-Processing"** — ICSME 2024 Tool Demo Track; arXiv:2409.18658 (2024): [https://arxiv.org/abs/2409.18658](https://arxiv.org/abs/2409.18658)

3. **seart-group/ghs GitHub repository** — open-source codebase and README: [https://github.com/seart-group/ghs](https://github.com/seart-group/ghs)

4. **GitHub Docs — REST API endpoints for search** (apiVersion=2022-11-28): [https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28](https://docs.github.com/en/rest/search/search?apiVersion=2022-11-28)

5. **GitHub Docs — Searching for repositories** (full qualifier reference): [https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories](https://docs.github.com/en/search-github/searching-on-github/searching-for-repositories)

6. **GitHub Docs — Rate limits for the REST API**: [https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)

7. **Simon Willison — "Accessing repository dependencies in the GitHub GraphQL API"** (TIL blog, primary API exploration): [https://til.simonwillison.net/github/dependencies-graphql-api](https://til.simonwillison.net/github/dependencies-graphql-api)

8. **Libraries.io homepage** — package count and manager coverage: [https://libraries.io/](https://libraries.io/)

9. **Libraries.io API documentation** — endpoint reference including `dependent_repositories`: [https://libraries.io/api](https://libraries.io/api)

10. **Nesbitt, A. — "Our second Libraries.io open data release has arrived"** (Medium, Libraries.io publication): [https://medium.com/libraries-io/our-second-libraries-io-open-data-release-has-arrived-703422b1ad88](https://medium.com/libraries-io/our-second-libraries-io-open-data-release-has-arrived-703422b1ad88)

11. **deps.dev BigQuery dataset documentation** — table schema and ecosystem coverage: [https://docs.deps.dev/bigquery/v1/](https://docs.deps.dev/bigquery/v1/)

12. **deps.dev REST API v3alpha reference** — endpoint listing: [https://docs.deps.dev/api/v3alpha/](https://docs.deps.dev/api/v3alpha/)

13. **Sourcegraph — Search Query Language Reference**: [https://sourcegraph.com/docs/code-search/queries](https://sourcegraph.com/docs/code-search/queries)

14. **Sourcegraph — Stream API documentation**: [https://docs.sourcegraph.com/api/stream_api](https://docs.sourcegraph.com/api/stream_api)

15. **Sourcegraph — GraphQL API documentation**: [https://sourcegraph.com/docs/api/graphql](https://sourcegraph.com/docs/api/graphql)

16. **Sourcegraph — Pricing plans changelog (Oct 2025)**: [https://sourcegraph.com/changelog/introducing-pricing-plans-and-major-updates-for-deep-search](https://sourcegraph.com/changelog/introducing-pricing-plans-and-major-updates-for-deep-search)

17. **Mockus, A. et al. — "World of Code: Enabling a Research Workflow for Mining and Analyzing the Universe of Open Source VCS Data"** — Empirical Software Engineering (Springer, 2021): [https://link.springer.com/article/10.1007/s10664-020-09905-9](https://link.springer.com/article/10.1007/s10664-020-09905-9)

18. **npm Registry API documentation** — search and package endpoints: [https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md](https://github.com/npm/registry/blob/main/docs/REGISTRY-API.md)

19. **npm/registry-issue-archive — Issue #231: API to list package dependents**: [https://github.com/npm/registry-issue-archive/issues/231](https://github.com/npm/registry-issue-archive/issues/231)

20. **EvanLi/Github-Ranking** — daily auto-updated top repo lists by language: [https://github.com/EvanLi/Github-Ranking](https://github.com/EvanLi/Github-Ranking)
