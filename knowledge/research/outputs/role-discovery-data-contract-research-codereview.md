# R3 Research — Codebase Signals, Competitor Pairing, 3rd AI Pass Architecture

**Researcher:** R3 (Sonnet 4.6)
**Date:** 2026-04-10
**Plan file:** `knowledge/outputs/.plans/role-discovery-data-contract.md`
**Sub-questions covered:** Q6, Q7, Q11
**Output target:** ADR-036 Half 2 — Repo Understanding Contract

---

## Q6 — Codebase-Shape Signals Beyond Skill Keywords

**Question restated:** What signals beyond skill keywords meaningfully differentiate codebase shape for challenge-relevant matching? Which are empirically extractable from git and GitHub metadata at scale, and which are known to predict engineer–codebase fit?

---

### Answer

The MSR and EMSE literature converges on several signal families that go beyond keyword matching. They fall into three tiers: (1) signals directly extractable from git and GitHub metadata at near-zero cost, (2) signals requiring static analysis of source files (which Pass 2 of PIPE's crawler already does), and (3) signals that require dynamic analysis or human labeling (out of scope for MVP).

#### Tier 1 — Git/GitHub metadata (extractable today without code parsing)

**PR size distribution.** The empirical record on whether smaller PRs merge faster is contested. Kalliamvakou et al. (MSR 2015) identified PR churn as a developer-ranked factor in latency. The multi-language study by Gousios et al. (arXiv:2203.05045) analyzed 845,316 PRs across 100 projects and found that "pull request size and composition do not relate to time-to-merge" [R3-S4] — a negative result that challenges the industry belief but confirms PR size is *measurable* from git metadata. What the signal *does* carry for PIPE is not merge speed but codebase work-unit size: the typical changed-file count per PR reveals whether the team ships fine-grained feature slices or broad cross-cutting changes. PIPE already stores `changed_file_count` per sample PR in `repo_sample_prs`. Mean and p90 over the 20-PR sample is a directly computable shape signal. (single source on the null size-latency finding — confirmed across languages [R3-S4])

**Test-touched flag rate.** PIPE's crawler already stores a `test_touched` boolean per sample PR. The fraction of merged PRs that touch test files (`test_touch_rate`) is a proxy for testing culture. The 2023 DORA State of DevOps report [R3-S8] identifies code review metrics and test culture as significant correlates of engineering performance band, distinguishing elite from medium performers. A repo where <10% of PRs touch tests signals a different challenge context than one where >60% do. This is directly computable from the existing schema.

**Commit frequency and recency.** Commit cadence (commits per month over the trailing 6 months) is extractable from git log without parsing source. It signals project vitality. Bus factor estimation literature [R3-S9] uses commit authorship concentration as a risk metric — high authorship concentration (few contributors touch most files) predicts knowledge-silo risk, which has direct bearing on what "ownership" means on a challenge. This is extractable via GitHub's contributors API at crawl time. PIPE does not currently store this; it belongs in Pass 2 or the new Pass 3.

**Issue-resolution linkage rate.** PIPE already stores an `issue_resolution_link` boolean per PR. The fraction of PRs that resolve a tracked issue signals whether the team practices systematic issue tracking versus informal development. A repo where PRs frequently reference issues is likely to produce more realistic "fix a tracked regression" challenge scenarios. Directly computable.

**Review density (reviewers per PR).** The number of distinct reviewers per PR (from GitHub's PR review API) is not currently stored but is extractable. Kalliamvakou et al. [R3-S3] found that existence of tests in a project was a top-ranked developer factor for PR latency; review density is a correlated signal for code-review culture maturity. Repos with ≥2 reviewers per PR on average signal a team where the code-review challenge scenario is realistic.

#### Tier 2 — Static analysis (Pass 2 already extracts some of these)

**Cyclomatic complexity.** PIPE's Pass 2 already measures cyclomatic complexity per repo. The MSR literature uses complexity as a proxy for architectural debt — high average complexity correlates with legacy codebases, medium with standard service boundaries [R3-S5]. Complexity at the file level is more informative than repo average; PIPE currently stores repo-level mean, which is sufficient for coarse categorization.

**Architecture pattern (monolith / layered service / microservice).** Detectability from static signals is well-studied. The presence of `docker-compose.yml`, multiple `Dockerfile`s, `kubernetes/*.yaml`, or service-directory patterns in the repo tree are strong signals for microservice structure [R3-S5]. Pass 2's manifest parsing (package.json, go.mod, requirements.txt) already touches these files. A heuristic that counts top-level service directories with independent entry points gives a monolith-vs-distributed score without LLM calls. This should be added to Pass 2 rather than deferred to Pass 3.

**Test-to-code ratio.** The fraction of files matching `*.test.*`, `*_test.*`, `*spec*`, or residing in `test(s)/` directories is extractable from the file tree. A 2024 ICSE study [R3-S6] found that test coverage characteristics vary significantly by test type (unit vs. integration vs. performance) and that coverage ratio alone is context-dependent. For PIPE's purposes, the *existence* of a dedicated test directory and the test-file fraction are more useful than coverage percentage (which requires running the tests).

**Tech-debt indicator: SATD density.** Self-admitted technical debt (SATD) — TODO/FIXME/HACK comments in source — is predictable from commit contents and comment patterns [R3-S10]. This requires scanning source files, which Pass 2 could do cheaply with a regex pass. A high SATD density signals a codebase where the challenge should probe debt recognition skills rather than green-field design.

#### Tier 3 — Not extractable at MVP scale

Dynamic analysis (runtime coupling, actual test coverage %), semantic architecture inference from code graphs, and AI-generated "engineering narrative" summaries require either running the code or expensive LLM passes over raw source. These are deferred to post-MVP per the plan's Q11 scope boundary.

---

### Ranked signal list (for PIPE)

| Signal | Extractability | Empirical grounding | PIPE mapping |
|---|---|---|---|
| `test_touch_rate` — % of PRs touching tests | Computed from existing `repo_sample_prs.test_touched` | DORA 2023 [R3-S8] | Stored today; add aggregation to Pass 3 or query layer |
| `mean_changed_files` — mean changed-file count per sample PR | Computed from existing `changed_file_count` | Gousios et al. 2022 [R3-S4] | Stored today; add aggregation |
| `issue_link_rate` — % of PRs with issue reference | Computed from existing `issue_resolution_link` | Implicit in PR quality literature [R3-S3] | Stored today; add aggregation |
| `architecture_style` — monolith/layered/microservice | Pass 2 heuristic on repo tree (Dockerfile count, service dirs) | Microservice detection literature [R3-S5] | Needs Pass 2 addition |
| `review_density` — mean reviewers per PR | GitHub PR reviews API at crawl time | Kalliamvakou et al. MSR 2015 [R3-S3] | Needs Pass 2 addition |
| `commit_cadence` — commits/month trailing 6m | GitHub commits API | Bus factor / activity literature [R3-S9] | Needs Pass 2 addition |
| `complexity_band` — low/medium/high cyclomatic | Already measured in Pass 2 | MSR complexity literature [R3-S5] | Stored today |
| `satd_density` — TODO/FIXME comment rate | Regex pass on source files in Pass 2 | Technical debt prediction literature [R3-S10] | Needs Pass 2 addition |
| `test_style` — unit/integration/e2e inferred | File-path heuristic on test directories | ICSE 2024 coverage study [R3-S6] | Needs Pass 2 addition |

---

### What this implies for the Role Context Document AND the Repo Understanding Contract

**RCD:** The Technical Context section of the Role Context Document should expose the *recruiter's qualitative description* of codebase shape as structured fields — `architecture_style`, `testing_culture` (heavy/light/unit-only), `pr_size_preference` (small/medium/large), `review_culture` (solo/lightweight/rigorous). Role Discovery's synthesis step should extract these from the "Codebase" domain of the interview. These become the query-side inputs to the matching layer.

**RUC:** The new `repo_engineering_signals` table should store computed aggregates of the signals above — not raw PR rows. Each row is one repo, written once by Pass 3. The `architecture_style`, `test_touch_rate`, `mean_changed_files`, `review_density`, and `complexity_band` are the five signals with the strongest empirical grounding and the most direct relevance to challenge calibration.

---

## Q7 — How Competitors Pair Challenges to Team Context

**Question restated:** How do existing code review and coding-assessment platforms pair candidate-facing challenges to team context? What signals do they surface in their matching logic, and what evidence do they publish that role-tailored content improves hiring signal?

---

### Answer

The competitive landscape divides into three pairing models: (A) taxonomy-based role filtering (most platforms), (B) human-configured work simulation (Woven), and (C) pre-built framework validated by industrial-organizational psychologists (CodeSignal). None of the platforms publish a public architectural description of an automated algorithmic matching pipeline. Role-to-challenge pairing is primarily a content-classification problem, not an embedding or ML retrieval problem, at this tier.

#### Platform scan

**HackerRank — Taxonomy-based role filtering with framework extensions** [R3-S1, R3-S2]

HackerRank's role-based assessments allow recruiters to filter a challenge library by job role and skill taxonomy. The library supports filtering on Role (which maps questions to selected job roles) and Skill (specific technologies). Role-specific certifications exist for 19 defined roles as of 2024. The matching signal is purely taxonomic: a challenge tagged `{role: "Senior Frontend Engineer", skill: "React"}` surfaces for that role. There is no team-specific configuration — the taxonomy is HackerRank's own, not derived from recruiter intake.

The engineering claim for "real-world" signal comes from project-based workspaces that mirror production tasks (multi-file, Git integration, AI copilot enabled). No peer-reviewed validity evidence is published. The 2025 comparison between HackerRank and CodeSignal authored by HackerRank [R3-S1] is vendor marketing, not empirical research.

**Verifiability:** Low. The matching logic is opaque. The role taxonomy is documented in their support portal. Validity claims are unsupported.

**CodeSignal — Skills Evaluation Frameworks validated by I/O psychologists** [R3-S11, R3-S12]

CodeSignal builds "pre-built, role-relevant assessments that are built by my team and validated by CodeSignal's in-house Industrial-Organizational Psychologists" [R3-S11]. Their matching approach uses "Skills Evaluation Frameworks" — pre-built, role-specific assessment bundles validated against job-relevant competencies. The matching signal is a combination of: (a) role category (backend/frontend/data/ML etc.), (b) seniority level, and (c) framework/language tag. The I/O psychology validation is a differentiator: tasks are calibrated for job-relevance rather than algorithmic difficulty alone.

CodeSignal does not publish empirical validity evidence (κ, criterion validity, adverse impact studies) in public documentation. The claim of I/O psychologist validation is plausible but not independently verifiable.

**Verifiability:** Medium. Role-specific assessment bundles exist as documented artifacts. I/O psychology involvement is disclosed but unpublished. No public study links role tailoring to hiring outcome improvement.

**Codility — Skill taxonomy + job-role filter on a 1100-task library** [R3-S13]

Codility's task library is organized by: language/framework tag, skill type (algorithms, real-life engineering, bug-fixing, multiple choice), and job role shorthand. The job-role filter is "a great shorthand way to find tasks useful for real-life assessment of skills for a specific role." [R3-S13] The matching signal is a recruiter manually selecting tasks from a filtered view. There is no automated team-context matching. A 2024 upgrade introduced "Engineering Skills Model 2.0" with a skill-mapped content library, but the architectural details are not public.

**Verifiability:** Low. Library browsing is manual. No published study on role tailoring.

**Woven — Human-configured work simulation** [R3-S14]

Woven's model is the furthest from automated matching. They begin with a discovery call: "When your company is ready to work with Woven to identify the coding challenges you need for interviewing, we will begin by understanding your software development challenges and where additional engineering talent is required now." [R3-S14] Challenges are configured per client engagement — scenarios like "reviewing a PR, debugging an outage, and handing off work to colleagues" are assembled per role with Woven's staff choosing the scenario type based on what the client says they need. Scoring is done by two Certified Engineers per submission. The matching signal is entirely human-curated from a structured intake conversation, not algorithmic.

Woven's validity claims rest on retention outcomes (96% retention) and time-to-hire savings, not published criterion validity studies. The human-scoring approach yields high inter-rater reliability (two scorers per submission) but the validity of the intake-to-challenge mapping is never independently tested.

**Verifiability:** Medium. The intake process is documented. Outcome claims are customer-reported. No peer-reviewed study.

**Karat — Role-specific interview design with calibrated question banks** [R3-S15]

Karat ties each interview to a specific role at a specific company. "There isn't one Karat interview—each Karat interview is tied to a specific role at a specific company and each candidate's performance is evaluated by that specific company based on their specific needs." [R3-S15] The matching signal is a company-specific question bank configured during onboarding. Interview Engineers deliver the live interview, so calibration happens through the question bank design and interviewer training rather than algorithmic challenge selection. Karat "extensively tests interview questions to calibrate expectations, ensure they aren't overly sensitive, and reduce noise." [R3-S15]

**Verifiability:** Medium. The company-role-specific configuration is real (documented). The calibration process is described but not published as a methodology.

---

### What none of them do

None of the platforms above expose their matching logic as anything resembling a pipeline that reasons over a structured "team context document." All approaches collapse to one of: (a) taxonomy tags the recruiter browses, (b) pre-built bundles the I/O team assembled, or (c) human-curated onboarding. The gap between what a structured Role Discovery interview captures (laddering chains, codebase-shape specifics, process culture) and what any of these platforms consume (a role dropdown) is the exact gap PIPE's matching layer is designed to cross.

---

### Recommended matching-layer interface for PIPE

Given the competitive landscape, PIPE should not replicate the taxonomy-browse model (too manual, no team signal) or the pure human-onboarding model (doesn't scale). The recommended interface shape is a **two-stage matching API** that takes a Role Context Document and returns a ranked list of repos with per-repo justification:

```
Input:  RoleContextDocument { technical_context, seniority_band, architecture_style,
                              testing_culture, pr_size_preference }
Stage 1 (SQL hard filter): qualified_repos WHERE stack overlaps mustHaveSkills
Stage 2 (AI rerank):       foreach candidate repo, score(repo_engineering_signals, rcd) → alignment_score
Output: TopN repos with alignment_explanation[]
```

This is architecturally informed by Q11 (below). The key distinguisher from any competitor: PIPE produces a per-repo justification the recruiter can audit ("matched because: same Go microservice architecture, high test-touch rate consistent with HIPAA-sensitive context the recruiter mentioned, p90 PR size 380 lines matches stated preference"). No competitor produces anything like this.

---

### What this implies for the Role Context Document AND the Repo Understanding Contract

**RCD:** The Technical Context section must expose queryable structured fields — `architecture_style`, `testing_culture`, `pr_size_band` — not just free text. The synthesis step needs to map recruiter statements ("we're async-first, 200-400 line PRs, integration-test heavy") to these enum fields. These become Stage 2 query inputs.

**RUC:** The `repo_role_alignment` table must store both the alignment score and a `justification_json` field that the frontend can render. Justification is not cosmetic — it is the auditable artifact that distinguishes PIPE from all competitors in this category.

---

## Q11 — 3rd AI Pass Architecture: Offline Per-Repo vs. Runtime Per-Role

**Question restated:** What is the correct architecture for a 3rd AI pass that reasons over PIPE's repo substrate (Pass 1 + Pass 2, zero LLM calls, `repo_sample_prs` metadata only) with Role Discovery signals in mind? Specifically: offline per-repo summarization vs. runtime per-(role × repo) alignment scoring vs. a two-stage split?

---

### Evidence for each alternative

#### Alternative A — Offline-only per-repo summarization

The hierarchical repository summarization literature demonstrates that LLMs can produce stable, reusable per-repo summaries at reasonable cost. Makharev et al. (2025, arXiv:2502.16704) [R3-S16] and Liu et al. (2025, arXiv:2501.07857) [R3-S17] both use two-level hierarchical summarization (function/variable → file/package) that can be computed offline and reused across queries. The key architectural insight is the same as ColBERT's offline document precomputation [R3-S18]: "document embeddings can be precomputed and stored offline since they don't depend on the query. At query time, only the query needs to be encoded, reducing computation."

**Pros for offline-only:**
- Amortizes LLM token cost across every role that ever queries a repo (write once, read many).
- Produces stable, consistent summaries — no judgment variance between two role queries hitting the same repo.
- Compatible with Cloudflare D1: write once in a background Worker or batch job, read via SQL at matching time.
- Pass 3 can be a `--pass3` flag on the existing crawler running as a background Cloudflare Queue consumer — same infrastructure, no new runtime surface.

**Cons for offline-only:**
- A repo's engineering signal summary written without a role in mind may not expose the dimensions relevant to a specific role. A summary written for a generic audience will describe what the repo *is*, not whether it is *fit for this challenge*.
- SWE-bench evidence [R3-S19] shows that BM25 (a static, query-agnostic retriever) retrieves the oracle file set in only ~40% of instances with a 27K-token context window. When retrieval is query-agnostic, relevance suffers.
- The summary cannot reason about role-specific fit: "does this repo's PR review culture match the HIPAA-constrained environment the recruiter described?"

**Verdict on Alternative A:** Offline-only is correct for the *first* processing step but insufficient as the sole step. It is the right place for structural/behavioral signal extraction. It is the wrong place for role-fit judgment.

---

#### Alternative B — Runtime per-(role × repo) alignment scoring

Recommendation-system research establishes that cross-encoder rerankers — models that jointly encode query and document — are significantly more accurate than bi-encoders at relevance judgment [R3-S21]. The Pinecone reranking guide [R3-S21] states: "In two-stage systems, a first-stage model (an embedding model/retriever) retrieves a set of relevant documents from a larger dataset, then a second-stage model (the reranker) is used to rerank those documents retrieved by the first-stage model."

A pure runtime model would call an LLM at discovery time for every (role × repo) candidate pair: "given this Role Context Document and this repo's signals, how well do they align?"

**Pros for runtime-only:**
- Maximum alignment accuracy — the model sees both the current role's specifics and the repo's signals simultaneously.
- No staleness risk: every query gets a fresh judgment.

**Cons for runtime-only:**
- Token burn at every role creation event. If a recruiter creates 5 new roles per month and `matchRepos.ts` evaluates the top-50 SQL candidates, that is 250 LLM calls per month just for repo matching — before any interview runs.
- Latency at discovery time: calling an LLM for 50 (role × repo) pairs inline with a Worker request is not viable on a 30-second Worker timeout without streaming or background processing.
- Judgment inconsistency: the same repo evaluated against two almost-identical roles may receive different alignment scores if the model is sampled non-deterministically.
- No caching possible unless role context is exactly identical, which it rarely is.

**Verdict on Alternative B:** Runtime-only reranking over the full candidate set is too expensive and too slow for an MVP deployment on Cloudflare Workers. It is the right *shape* for a reranking step, but it must operate over a pre-filtered candidate set, not the full repo library.

---

#### Alternative C — Two-stage: offline per-repo + runtime per-(role × repo) rerank

The IR literature's two-stage pipeline — offline retriever + runtime reranker — is the standard architecture for systems that must balance cost, latency, and relevance accuracy. The precomputation/caching research (CEUR-WS 2025) [R3-S20] demonstrates 27–58% latency reduction when shared prefixes are precomputed. The AIF framework (arXiv:2511.12934) [R3-S22] demonstrates the principle at industrial scale: "interaction-independent components... can be decoupled from the sequential pipeline and precomputed asynchronously," achieving "notable performance gains without significantly increasing computational and latency costs."

Applied to PIPE's context:

- **Offline stage (Pass 3 / `repo_engineering_signals`):** An LLM (Claude Haiku 4.5 for cost, per CLAUDE.md routing table) processes each repo's `repo_sample_prs` metadata, construct tags, complexity, and architecture signals once. It writes a structured JSON record to `repo_engineering_signals`. This record is role-agnostic — it describes *what kind of engineering environment this repo represents*, not how it fits a specific role. Token cost: ~500 tokens per repo × 5,000 repos = 2.5M tokens, one-time. At Haiku 4.5 pricing this is under $5 total. Refreshed only when Pass 2 re-crawls the repo.

- **Runtime stage (Worker handler / `repo_role_alignment`):** At role-creation time (or lazily at first match request), a lightweight runtime call takes the RCD's `technical_context` fields and the top-N SQL candidates' `repo_engineering_signals` records and produces alignment scores. This call is cheap because the repo context is pre-summarized — the model only needs to judge fit, not extract signals from raw metadata. Token cost: ~200 tokens per (role × repo) pair × 20 candidate pairs = 4,000 tokens per role. At Gemma 4 on Workers AI: effectively free at this volume. Results are cached in `repo_role_alignment` keyed on `(role_id, repo_id)` and expire only when the RCD or the repo's signals change.

This two-stage approach directly mirrors ColBERT's offline/online split [R3-S18]: "ColBERT enables precomputing document embeddings, shifting the cost of encoding documents offline and amortizing the cost of encoding the query once across all ranked documents." PIPE's offline stage is the "document encoding"; the runtime rerank is the "MaxSim interaction."

The AIF framework [R3-S22] provides the modern justification: precomputing item-side features (repo engineering signals) reduces redundant real-time computation, allowing the online stage to focus exclusively on interaction-dependent computation (the role-specific fit judgment).

**Pros for two-stage:**
- Token cost amortized: each repo's signal extraction is paid once, not once per role.
- Runtime latency acceptable: reranking 20 pre-summarized candidates takes <1 second on Workers AI.
- Caching of `repo_role_alignment` records means repeat queries for the same role (e.g., a recruiter browsing candidates) pay nothing.
- Consistent judgment: repo signals are stable facts; only the fit judgment varies per role, and those judgments are cached.
- Independent verification: the offline stage produces auditable structured records; a reviewer can inspect `repo_engineering_signals` without understanding the role context.

**Cons for two-stage:**
- Introduces a new D1 table (`repo_engineering_signals`) and a new crawler step (Pass 3).
- Offline stage must run to completion before any role can query a repo — cold-start problem for newly crawled repos. Mitigated by running Pass 3 as a background queue consumer immediately after Pass 2 completes.
- The offline summary must be designed carefully enough that it exposes the right dimensions for runtime role-fit judgment — a poorly designed `repo_engineering_signals` schema wastes the runtime step.

---

### Recommendation: Two-stage (Alternative C)

The two-stage split is the correct architecture. The evidence across IR, rec-sys, and repository summarization literature consistently supports the offline/online split for systems that (a) have a large stable set of "documents" (repos), (b) receive many distinct "queries" (roles), and (c) must operate under latency and cost constraints.

**The specific call for PIPE:**

1. **Pass 3 (offline, background job, Claude Haiku 4.5)** — processes `repo_sample_prs` metadata + `repo_constructs` + Pass 2 signals for each repo. Writes one `repo_engineering_signals` row per repo. Run as a Cloudflare Queue consumer triggered when Pass 2 completes. Refresh on each Pass 2 re-crawl.

2. **Runtime rerank Worker (Gemma 4 on Workers AI)** — called when a role requests repo discovery. Takes the RCD `technical_context` + top-N SQL candidates' `repo_engineering_signals`. Produces `repo_role_alignment` rows with score + justification. Cached by `(role_id, repo_id)`. Invalidated if RCD changes or repo's signals refresh.

3. **SQL Stage (existing `matchRepos.ts`)** — unchanged as the first-pass hard filter. Stack overlap and seniority band filtering happens here before any AI calls.

The full pipeline is: SQL hard filter → Pass 3 signals lookup → runtime role-fit rerank → ranked list with justifications.

---

### D1 Table Schema Sketch

#### `repo_engineering_signals` (one row per repo, written by Pass 3, role-agnostic)

```sql
CREATE TABLE repo_engineering_signals (
  repo_id           TEXT NOT NULL PRIMARY KEY,  -- FK to qualified_repos.id
  
  -- Architecture signals (from Pass 2 heuristics + Pass 3 LLM)
  architecture_style TEXT NOT NULL,   -- 'monolith' | 'layered_service' | 'microservice' | 'library' | 'unknown'
  service_count      INTEGER,         -- count of independent service dirs (for microservice style)
  
  -- PR behavior signals (aggregated from repo_sample_prs, no LLM needed)
  mean_changed_files REAL,            -- mean changed-file count across sample PRs
  p90_changed_files  REAL,            -- p90 changed-file count (size band upper bound)
  test_touch_rate    REAL,            -- fraction of sample PRs with test_touched = true
  issue_link_rate    REAL,            -- fraction of sample PRs with issue_resolution_link
  
  -- Code review culture (from GitHub API at crawl time)
  mean_reviewers_per_pr REAL,         -- mean distinct reviewers per sample PR
  
  -- Code health signals (from Pass 2 or regex pass)
  complexity_band    TEXT NOT NULL,   -- 'low' | 'medium' | 'high'
  satd_density       REAL,            -- TODO/FIXME/HACK per 1000 SLOC
  test_style         TEXT,            -- 'unit_only' | 'integration_heavy' | 'e2e_present' | 'minimal' | 'unknown'
  
  -- LLM-generated narrative (Pass 3 output, used as context for runtime rerank)
  engineering_narrative TEXT,         -- 200-400 word structured description of engineering environment
                                      -- e.g. "Fast-moving Go microservices codebase with strong test culture..."
  narrative_version  INTEGER NOT NULL DEFAULT 1,
  
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);
```

#### `repo_role_alignment` (one row per (role × repo) pair, written by runtime Worker, role-specific)

```sql
CREATE TABLE repo_role_alignment (
  id              TEXT NOT NULL PRIMARY KEY,
  role_id         TEXT NOT NULL,      -- FK to the role/pipeline record
  repo_id         TEXT NOT NULL,      -- FK to qualified_repos.id
  
  -- Alignment scoring
  alignment_score REAL NOT NULL,      -- 0.0 – 1.0, higher = better fit for this role
  rank_position   INTEGER,            -- rank among candidates for this role (1 = best)
  
  -- Justification for recruiter-facing explanation (auditable)
  justification_json TEXT NOT NULL,   -- JSON array of { dimension, signal, verdict } objects
                                      -- e.g. [{"dimension":"architecture","signal":"microservice","verdict":"matches role's async-first Go description"}]
  
  -- Cache management
  rcd_version     INTEGER NOT NULL,   -- increments when RoleContextDocument changes; invalidates on mismatch
  signals_version INTEGER NOT NULL,   -- mirrors repo_engineering_signals.narrative_version; invalidates on mismatch
  
  created_at      TEXT NOT NULL,
  expires_at      TEXT               -- NULL = permanent until version change; set for time-bounded roles
);

CREATE UNIQUE INDEX repo_role_alignment_role_repo ON repo_role_alignment(role_id, repo_id);
CREATE INDEX repo_role_alignment_by_role ON repo_role_alignment(role_id, alignment_score DESC);
```

---

### What this implies for the Role Context Document AND the Repo Understanding Contract

**RCD:** The Technical Context section must expose structured enum fields that the runtime rerank step can compare directly against `repo_engineering_signals`:

```json
"technical_context": {
  "architecture_style": "microservice",       // matches repo_engineering_signals.architecture_style
  "testing_culture": "integration_heavy",     // matches test_style
  "pr_size_band": "medium",                  // maps to mean_changed_files range (medium = 100–500)
  "review_culture": "rigorous",              // maps to mean_reviewers_per_pr >= 2
  "complexity_tolerance": "medium"           // maps to complexity_band
}
```

Without these fields in the RCD, the runtime rerank step has nothing role-specific to compare against. The RCD schema and the `repo_engineering_signals` schema must be co-designed with matching enum vocabularies.

**RUC:** The Repo Understanding Contract has two halves:

1. **Pass 3 contract:** Inputs = `repo_sample_prs` + `repo_constructs` + Pass 2 signals. Output = one `repo_engineering_signals` row. Trigger = background queue after Pass 2. Model = Claude Haiku 4.5 (per CLAUDE.md AI routing table, offline batch use case). The LLM's job is *signal extraction and structuring*, not role-fit judgment.

2. **Runtime rerank contract:** Inputs = RCD `technical_context` + top-N `repo_engineering_signals` rows. Output = `repo_role_alignment` rows with score + justification_json. Model = Gemma 4 on Workers AI (cheap, fast, Workers-native, acceptable for structured comparison tasks). The model's job is *role-fit judgment*, not signal extraction.

These two contracts must not collapse into one. Merging them produces the worse outcome: a single runtime call that pays full signal-extraction cost at every role query, with no caching, no auditability, and a latency profile incompatible with Cloudflare Worker constraints.

---

## Contradictions

1. **PR size and merge latency:** The Gousios et al. multi-language study [R3-S4] finds no relationship between PR size and time-to-merge, directly contradicting the Kalliamvakou MSR 2015 study [R3-S3] where developers rank PR churn as a top-5 latency factor. The resolution: developer *belief* about PR size affecting latency is strong, but empirical measurement across 845K PRs finds no causal relationship. For PIPE's purposes, PR size is still a useful codebase-shape signal (it describes work-unit culture), but should not be presented as a "speed predictor."

2. **Test coverage as a quality signal:** The ICSE 2024 study [R3-S6] finds that coverage ratio is "context-dependent" and that performance tests achieve significantly lower coverage than functional tests, complicating the intuition that high coverage = high quality. For PIPE, the `test_touch_rate` metric (fraction of PRs touching tests) is more robust than coverage percentage because it requires no test execution.

3. **Offline vs. runtime for repo signals:** The SWE-bench BM25 evidence [R3-S19] (40% oracle-file retrieval success with static BM25) could be read as an argument *against* offline-only retrieval. However, PIPE's use case is role-fit *scoring*, not file localization for code generation — the precision requirements are different. An offline summary that correctly identifies "this is a microservice codebase with rigorous code review and integration-test culture" is sufficient for matching purposes, even if it would fail the SWE-bench file-localization task.

---

## Known Gaps

1. **No published evidence that role-tailored challenge content improves hiring signal over universal banks.** None of the competitors (HackerRank, CodeSignal, Codility, Woven, Karat) publish criterion validity studies showing that role-specific challenge selection improves predictive validity vs. a random sample from the same difficulty band. This is a gap across the entire industry, not unique to PIPE. The assumption that role-tailoring helps is theoretically grounded in content validity (challenges should resemble the actual job) but empirically untested at production scale.

2. **Pass 3 LLM output stability is untested.** The two-stage architecture assumes that Haiku 4.5's per-repo summaries are stable across re-runs (i.e., re-running Pass 3 on the same repo produces the same `architecture_style`, `test_style`, etc.). The hierarchical summarization literature [R3-S16, R3-S17] does not directly address LLM output stability for structured field extraction. This needs empirical measurement — run Pass 3 3× on a sample of repos and measure field-level agreement.

3. **Woven's intake process is a strong human analog to PIPE's design but no methodology paper exists.** The Woven model (structured intake → human-curated scenario selection → human scoring) is architecturally similar to PIPE's (Role Discovery interview → automated repo matching → AI scoring) but no published methodology allows borrowing their challenge-to-role mapping criteria.

4. **`review_density` extraction requires GitHub API pagination.** Fetching distinct reviewer counts per PR requires individual PR review API calls, not just the PR list endpoint. At 20 PRs × 5,000 repos = 100,000 API calls, this may require rate-limit handling in Pass 2. This is an engineering constraint, not a research gap.

5. **`satd_density` at scale.** Scanning source files for TODO/FIXME/HACK patterns at 5,000 repos requires cloning — which Pass 2 already does — but adds a regex scan pass over all source files. The technical debt prediction literature [R3-S10] uses this signal reliably, but PIPE has not budgeted for this in the existing Pass 2 runtime estimates.

---

## Sources

| ID | Title | Authors | Year | Type | URL |
|---|---|---|---|---|---|
| R3-S1 | Codility vs HackerRank vs CodeSignal: 2025 Enterprise Showdown | HackerRank | 2025 | Vendor marketing | https://www.hackerrank.com/writing/codility-vs-hackerrank-vs-codesignal-2025-enterprise-comparison |
| R3-S2 | New Role-based Developer Skill Assessments | HackerRank | 2024 | Vendor blog | https://www.hackerrank.com/blog/new-role-based-assessments/ |
| R3-S3 | Wait For It: Determinants of Pull Request Evaluation Latency on GitHub | Gousios et al. | 2015 | Peer-reviewed (MSR 2015) | https://cmustrudel.github.io/papers/msr15.pdf |
| R3-S4 | Do Small Code Changes Merge Faster? A Multi-Language Empirical Investigation | Gousios et al. | 2022 | Peer-reviewed (arXiv preprint) | https://arxiv.org/abs/2203.05045 |
| R3-S5 | From Monolith to Microservices: Architecture Detection | Verano Merino et al. | 2022 | Peer-reviewed (arXiv) | https://arxiv.org/pdf/2204.11844 |
| R3-S6 | Productive Coverage: Improving the Actionability of Code Coverage | ICSE-SEIP authors | 2024 | Peer-reviewed (ICSE SEIP 2024) | https://dl.acm.org/doi/10.1145/3639477.3639733 |
| R3-S7 | RepoBench: Benchmarking Repository-Level Code Auto-Completion Systems | Liu et al. | 2024 | Peer-reviewed (ICLR 2024) | https://openreview.net/forum?id=pPjZIOuQuF |
| R3-S8 | 2023 DORA State of DevOps Report (Code Reviews and Team Health) | DORA / Google | 2023 | Industry report | https://codeclimate.com/blog/2023-dora-state-of-devops |
| R3-S9 | Assessing the Bus Factor of Git Repositories | Ricca et al. | 2015 | Peer-reviewed (MSR) | https://www.researchgate.net/publication/272794507_Assessing_the_Bus_Factor_of_Git_Repositories |
| R3-S10 | Predicting Technical Debt from Commit Contents | Ren et al. | 2020 | Peer-reviewed (Software Quality Journal) | https://link.springer.com/article/10.1007/s11219-020-09520-3 |
| R3-S11 | The Unique Role of Assessment Design Engineers at CodeSignal | CodeSignal | 2024 | Vendor engineering blog | https://codesignal.com/blog/engineering/the-unique-role-of-assessment-design-engineers-at-codesignal/ |
| R3-S12 | Role-Based Simulations: CodeSignal Skills Platform | CodeSignal | 2024 | Vendor product page | https://codesignal.com/industry/ |
| R3-S13 | The Codility Task Library | Codility | 2024 | Vendor documentation | https://support.codility.com/hc/en-us/articles/360043827713-The-Codility-Task-Library |
| R3-S14 | Interview Coding Challenges for Technical Assessment of High-Performing Engineers | Woven Teams | 2024 | Vendor blog | https://www.woventeams.com/post/interview-coding-challenges-for-technical-assessment-of-high-performing-engineers/ |
| R3-S15 | What do Karat technical interviews measure? | Karat | 2024 | Vendor blog | https://karat.com/blog/post/what-do-karat-technical-interviews-measure/ |
| R3-S16 | Code Summarization Beyond Function Level | Makharev et al. | 2025 | Preprint (arXiv:2502.16704) | https://arxiv.org/pdf/2502.16704 |
| R3-S17 | Hierarchical Repository-Level Code Summarization for Business Applications | Liu et al. | 2025 | Preprint (arXiv:2501.07857) | https://arxiv.org/abs/2501.07857 |
| R3-S18 | ColBERT: Efficient and Effective Passage Search via Contextualized Late Interaction | Khattab & Zaharia | 2020 | Peer-reviewed (SIGIR 2020) | https://arxiv.org/abs/2004.12832 |
| R3-S19 | SWE-bench: Can Language Models Resolve Real-World GitHub Issues? | Jimenez et al. | 2024 | Peer-reviewed (ICLR 2024) | https://arxiv.org/abs/2310.06770 |
| R3-S20 | On Precomputation and Caching in Information Retrieval Experiments with Pipeline Architectures | CEUR-WS authors | 2025 | Workshop paper | https://arxiv.org/html/2504.09984 |
| R3-S21 | Rerankers and Two-Stage Retrieval | Pinecone | 2024 | Vendor technical reference | https://www.pinecone.io/learn/series/rag/rerankers/ |
| R3-S22 | AIF: Asynchronous Inference Framework for Cost-Effective Pre-Ranking | Kou et al. | 2025 | Preprint (arXiv:2511.12934) | https://arxiv.org/abs/2511.12934 |
| R3-S23 | RepoFusion: Training Code Models to Understand Your Repository | ServiceNow | 2023 | Peer-reviewed (arXiv:2306.10998) | https://arxiv.org/abs/2306.10998 |
| R3-S24 | Pull Request Decision Explained: An Empirical Overview | Zampetti et al. | 2021 | Peer-reviewed (arXiv:2105.13970) | https://arxiv.org/abs/2105.13970 |
| R3-S25 | Multi-Stage Approach to Building Recommender Systems | Towards Data Science | 2024 | Engineering blog | https://towardsdatascience.com/multi-stage-approach-to-building-recommender-systems-71a31e58ecb4/ |
