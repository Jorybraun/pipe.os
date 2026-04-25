# Pipe Strategy v2 — Part 3: Repo Ingestion Pipeline
*The three-pass crawler, decomposition design, and corpus-growth strategy.*

---

## What repo ingestion is, and why it matters differently than the other two entities

Repos are the third entity type, but their role in Pipe is structurally different from candidates and roles. Repos are **the artifact against which candidate claims get validated**. A candidate says on their resume that they have payment systems experience; the system hands them an open-source PR in a payment-processing codebase and watches how they engage with it. The repo is the substrate for the two-phase technical validation — code review and implementation — that produces the highest-signal evidence in the whole pipeline.

This means repo ingestion quality has two distinct success criteria:

**First, matchability.** The repo's decomposed sub-elements (features, architectural patterns, technical stack, challenge surfaces) must semantically align with candidate sub-elements (experiences, projects, demonstrated skills) and role sub-elements (requirements, technical context, codebase expectations) so that matching can triangulate. A repo that does event-driven payment processing in Go with strong test culture should surface for candidates who have event-driven experience and for roles that need payment infrastructure work.

**Second, assessability.** The repo must offer concrete assessment opportunities — PRs of appropriate complexity for code review challenges, issues that match the role's technical context for implementation challenges. Pass 2 captures PR shape signals (eligibility, change size, test modification); Pass 3's `challenge_surfaces` field encodes what the repo exercises. These are the signals that `autoStageBuilder` and per-candidate assignment use to pick the right PR and the right issue.

Both criteria are bounded by the quality of what Pass 3 extracts. Pass 3 is where Gemma turns the deterministic signals from Passes 1 and 2 into narrative-rich semantic content. This is the leverage point for matching quality on the repo side.

---

## Current three-pass crawler

The crawler is **entirely built**, contrary to what the original strategy documents assumed (they treated Pass 3 as research-pending). Verification against the codebase:

**Pass 1 — `workers/api/scripts/crawl-repos/pass1/`:**

- GitHub search via 46 seeded queries covering languages, frameworks, and domains
- Coarse filters: stars, recency, activity, license type
- GraphQL queries for dependency graphs
- Open issue and PR counts
- **No repo cloning** — metadata-only
- Output: `qualified_repos` rows with provisional data and `pass=1` stamp
- Runs via GitHub Action `crawl-repos.yml` (Monday schedule)

**Pass 2 — `workers/api/scripts/crawl-repos/pass2/`:**

- Clones each `pass=1` repo locally
- Stack analysis (languages via cloc, frameworks via package manifest detection)
- 57 deterministic construct extractors (regex + path patterns, not AST) covering async patterns, state management, API design, data layer conventions, auth patterns, frontend patterns, testing conventions, infrastructure, code quality signals
- Complexity via scc and lizard — mean cyclomatic complexity, file-level metrics
- PR sampling: scan up to 200 merged PRs per repo, stop at 20 eligible ones. Eligibility requires: passing CI, appropriate size (changed_file_count in range), modifies tests (for code review eligibility), SWE-bench-eligible (for implementation challenge eligibility)
- Seniority band derivation from complexity + contributor count + review density
- README excerpt extraction (first N paragraphs, cleaned)
- Output: updates `qualified_repos` to `pass=2`, populates `repo_skills`, `repo_constructs`, `repo_sample_prs` tables
- Constants in `config.ts`: `PASS2_PR_SCAN_LIMIT=200`, `PASS2_PR_ELIGIBLE_LIMIT=20`

**Pass 3 — `workers/api/scripts/crawl-repos/pass3/run.ts`:**

- Vertex AI Gemma 4 26B generates three fields from the aggregated Pass 1 + Pass 2 signals:
  - `architecture_style`: enum (`monolith` | `layered_service` | `microservice` | `library` | `unknown`)
  - `engineering_narrative`: 200–400 word prose description of how the codebase is built
  - `repo_searchable_profile`: 100–400 word labeled template with fields for Language, Domain, Architecture, Seniority signal, Test culture, Key technologies, Challenge surfaces, Summary, PR shape, Key concepts
- Embeds `repo_searchable_profile` via Workers AI `@cf/baai/bge-large-en-v1.5`
- Upserts to `REPO_INDEX` with metadata `{disqualified: 0, admin_status: 'approved'}`
- Output: `repo_engineering_signals` row with `signals_version='v2.0.0'`

**The auto-chain gate.** Pass 3 runs automatically after Pass 2 as part of the same CI job, **but always with `skipVectorize=true`**. Embeddings and index upserts only happen when a human manually runs Pass 3 against a repo without that flag, which in turn only happens after the repo's `admin_status` flips from `pending` to `approved` in the admin queue. This is a HITL quality gate — a human verifies Pass 3 output is sensible before the repo becomes matchable.

The gate is also the dominant bottleneck on corpus growth. You have 1000s of `pass=2` repos with `repo_engineering_signals` rows that aren't in REPO_INDEX because no human has approved them.

**Construct taxonomy clarification.** The original strategy docs referenced construct slugs like "async", "event-driven", and "HIPAA-constrained" as if they existed. They don't. The 57 slugs in `constructs.config.ts` are engineering-pattern based (specific patterns like `async_callbacks`, `promises`, `async_await`, `event_emitters`, `pub_sub_kafka`, etc.), not architectural or domain-tagging. Architecture style is a separate 5-value enum produced by Gemma in Pass 3. Domain tags come from the Pass 3 narrative, not from a slug vocabulary.

**Issue pipeline.** Separately from the main crawler, a cron-driven issue crawler (Sunday 03:00 UTC) populates `repo_issues` with open issues from qualified repos. An issue scorer (Sunday 04:00 UTC) runs a lightweight classifier that produces `issue_challenge_signals` with `difficulty_band`, `implementability_score`, `clarity_score`, and `disqualified` flags. This is what `autoStageBuilder.pickImplementationIssue` reads when assigning implementation challenges.

---

## What's working, and what's not

**Working well:**

The three-pass structure is sound. Pass 1's broad sweep, Pass 2's deterministic extraction, Pass 3's LLM narrative generation are the right factoring. Deterministic construct extraction in Pass 2 means construct coverage is reproducible — the same repo produces the same constructs. LLM work in Pass 3 is bounded (three fields from one call), which controls cost and variance.

The PR sampling and SWE-bench eligibility flags mean code review assignment has real signal. `autoStageBuilder.pickReviewPr` selects the smallest-diff eligible PR (`WHERE swe_bench_eligible=1 ORDER BY changed_file_count ASC, pr_number DESC`), which is a defensible default for assessment consistency.

Issue scoring produces `difficulty_band` + `implementability_score` + `clarity_score` + `disqualified`, which gives the implementation challenge assignment meaningful selection criteria.

ADR-040 dual-layer storage applies to `repo_engineering_signals.embedding_json`, so the ground-truth vector is recomputable.

**Not working well:**

The admin verdict gate is blocking corpus growth. A thousand repos sitting at `pass=2` with no human reviewer means the matchable corpus is much smaller than the indexed corpus. Candidates are matched against a fraction of what the crawler has gathered.

The labeled template in `repo_searchable_profile` is **one blob**. When a role requires event-driven architecture experience, matching can't query for repos that specifically exercise event-driven patterns — only for repos whose overall narrative is similar to the role's overall narrative. The sub-element granularity that the rest of Pipe needs isn't present.

Construct slugs from Pass 2 live in `repo_constructs` and aren't directly embedded — they're available as a SQL filter in `matchRepos` but don't contribute to semantic matching. A role that needs async work matches a repo via the narrative's "async" mention, not via the deterministic `async_await` construct tag.

The embedding bypass call sites (`adminRepos.ts:698`, `adminRepos.ts:1136`) skip `preprocessForEmbedding`, meaning the repo-side embedding preprocessing is inconsistent with the candidate and role sides. This is a vector-space drift hazard.

There's no embedding model version stamp on `repo_engineering_signals`. A future BGE swap would leave all existing repo vectors unrecomputable without a full recrawl.

The repos table doesn't store an embedding in D1 (`repo_engineering_signals` has `embedding_json` but the reference doc is explicit that "repos are Vectorize-only" from a matching-layer perspective — exact cosine isn't computed from D1 for repos the way it is for candidates and roles). This is a consistency gap relative to ADR-040's dual-layer pattern.

`autoStageBuilder` reads `persona_json` (legacy), not RCD. The implementation challenge assignment doesn't see the RCD's `technical_context`, `codebase_expectations`, or `bars_overrides`. Assignment quality is bounded by what the flat persona carries.

The skill_aliases silent fallback in `matchRepos.ts` applies to repo matching too. `skill.toLowerCase()` as fallback means "Node.js" becomes "node.js" and won't match a repo tagged "nodejs". Pipelines dead-end with zero repo matches when even one must-have skill fails normalization.

---

## The decomposition design for repos

The goal: turn Pass 3's labeled blob into addressable sub-element nodes, same pattern as roles. The Pass 3 output (`engineering_narrative`, `repo_searchable_profile`, `architecture_style`) stays — it's the authoritative synthesis artifact at the repo level. Sub-elements are a derivative view, regenerated per Pass 3 run, pointed back to the originating Pass 2 signals for traceability.

**Sub-element types for repos:**

| Sub-element type | Source | Narrative shape |
|---|---|---|
| `Feature` | Extracted from Pass 3 narrative + Pass 2 construct tags | A distinct feature the repo implements. Auth, payments, real-time messaging, data pipeline, admin UI — each its own node. Captures: what the feature does, its complexity, technologies used, scale indicators, test coverage. |
| `ArchitecturalPattern` | Pass 3 `architecture_style` + narrative | One per major pattern: event-driven, CQRS, microservice-with-monolith, layered-service, etc. |
| `TechnicalStack` | Pass 2 stack analysis | Language, framework, database, infrastructure — each as its own node. Replaces the comma-separated list in the labeled template with addressable nodes. |
| `Construct` | Pass 2 construct slugs | Each of the 57 deterministic constructs the repo exhibits, with `evidence_count`. Semantic matching of constructs alongside code review PRs. |
| `ChallengeSurface` | Pass 3 `challenge_surfaces` field | Specific areas where a candidate would demonstrate skill if they worked on the repo. Used by `autoStageBuilder` for assessment path selection. |
| `QualitySignal` | Pass 2 complexity + PR sampling + test ratio | Test culture, review density, documentation depth, complexity band. Each as a separate node with narrative. |
| `DomainContext` | Pass 3 narrative | What domain the repo operates in (fintech, devtools, ML infra, consumer, dev tools) with relevant specifics. |
| `PRSample` | `repo_sample_prs` rows | Each eligible PR becomes a sub-element pointing to its sample data. Used for code review assignment. |
| `IssueCandidate` | `repo_issues` + `issue_challenge_signals` | Each scored issue becomes a sub-element for implementation challenge assignment. |

Each sub-element gets its own embedding (rich narrative with type prefix: "Feature: ..." or "ArchitecturalPattern: ..."). Pass 3 prompting expands to generate these per-sub-element narratives instead of a single labeled blob.

**Pass 3 prompt changes.** The current Pass 3 prompt asks Gemma for the three fields. The new prompt asks Gemma for structured sub-element generation:

> "Given this repo's signals [Pass 1 + Pass 2 output], identify its distinct features, architectural patterns, challenge surfaces, and quality signals. For each, produce a rich 2–3 sentence narrative describing what it is, how the repo exercises it, and what a candidate would learn from engaging with it. Return JSON. Use as many sub-elements as the repo supports — don't force a fixed count. Don't invent features that aren't evident from the signals."

Output is structured JSON with arrays per sub-element type. The existing three fields (`architecture_style`, `engineering_narrative`, `repo_searchable_profile`) remain as summary outputs for legacy consumers — they're regenerated from the sub-elements or kept as separate Gemma outputs for continuity.

**Storage shape (D1 transitional):**

```
repo_nodes (
  id TEXT PK,
  repo_id INTEGER NOT NULL,
  signals_version TEXT NOT NULL,
  node_type ENUM,
  narrative_text TEXT,
  extracted_properties_json TEXT,
  embedding_json TEXT,
  source_reference TEXT,  -- which Pass 2 signal or construct slug this derived from
  created_at INTEGER,
  updated_at INTEGER
)
```

Vectors in REPO_INDEX with metadata `{entity_type='repo', entity_id=repo_id, node_type=<type>, signals_version=<version>, admin_status='approved'}`. The existing disqualified filter stays.

---

## The admin verdict gate: replace with confidence-threshold auto-approval

The manual approval gate is the dominant cause of corpus stagnation. The gate's intent is quality — a human verifies Pass 3 output makes sense before the repo becomes matchable. The problem is that the gate doesn't scale and has become a bottleneck.

**Replace with a confidence-threshold model:**

Pass 3 already produces output that can be evaluated for quality. A secondary quality check runs after Pass 3 generates the sub-elements:

- A lightweight LLM call (possibly Qwen3-30b, matching the cross-family principle used elsewhere — Gemma guards Qwen, Qwen guards Gemma) evaluates each sub-element's narrative against the underlying Pass 2 signals. Score: "does this narrative accurately represent what the deterministic signals show?"
- Aggregate confidence per sub-element and per repo
- Auto-approve repos where aggregate confidence exceeds a threshold (0.8 to start, tune from data)
- Route repos below threshold to the existing admin queue for human review
- Auto-reject (back to `pending`) repos where confidence is catastrophically low — signals don't match narrative, narrative is generic, or extraction produced near-empty sub-elements

This preserves HITL for the uncertain cases while unblocking the clear-majority. The admin queue becomes a low-volume human judgment surface rather than a blocking gate on all growth.

**The confidence scorer must be isolated from Gemma.** The point of the gate is catching Gemma's errors. Using Gemma to evaluate Gemma's output is circular. The cross-family principle (Panickssery 2024) argues for Qwen-family evaluation of Gemma output and vice versa.

**Evaluation criteria for the confidence scorer:**

- Coverage: does the sub-element set include the features/patterns/constructs the Pass 2 signals suggest?
- Accuracy: does each sub-element's narrative accurately describe what the deterministic signals show?
- Groundedness: does each narrative cite specific technologies, scale indicators, or patterns that are present in Pass 2?
- Non-generic: does each narrative specific to this repo, or could it be copy-pasted to any repo in the same stack?

Generic narratives are the dominant Gemma failure mode. Scoring explicitly for specificity catches the "Pass 3 ran but the output is slop" case.

---

## Matching improvements on the repo side

With decomposition done, repo matching becomes per-sub-element. The matching pipeline details live in Part 5, but the repo-side changes are:

**Role sub-element → repo sub-element matching.** For each `Requirement` or `TechnicalContext` sub-element in the role, the matching queries repo sub-elements above the similarity threshold. Partial matches across multiple repo sub-elements accumulate. A role that needs event-driven architecture gets matched against repos whose `ArchitecturalPattern` or `Construct` sub-elements align, not just repos whose overall narrative mentions "async."

**Candidate sub-element → repo sub-element matching.** For candidate-repo assignment (the second stage of triangulation, where a candidate matched to a role is given a specific repo), the matching queries repos whose sub-elements align with the candidate's demonstrated experience. A candidate with strong payment-processing evidence gets matched to repos whose `Feature` and `DomainContext` sub-elements involve payments.

**Skill adjacency on the SQL side.** The `matchRepos.ts` SQL query's `HAVING must_hits = must_total` requirement is the hard gate that dead-ends when skills don't normalize. Replace it with the adjacency relaxation from the original research:

- Hand-curate a `skill_adjacency` table covering the top ~50 framework groupings (React/Vue/Angular/Svelte as frontend frameworks, Postgres/MySQL/SQLite as relational DBs, AWS/GCP/Azure as cloud providers, etc.)
- Each adjacency has a graded weight (0.9 for same-family substitution, 0.7 for adjacent paradigm, 0.4 for distant domain)
- Rewrite the query with threshold-based coverage: `HAVING SUM(skill_adjacency.weight) / must_total >= :coverage_threshold` where threshold is philosophy-dependent (0.85 for validate, 0.70 for tailored)
- Keep the exact-match path as a specialization of the adjacency path with all weights at 1.0

This is a day's SQL work plus the curation of the adjacency table. It unblocks the majority of pipeline dead-ends where a single skill normalization failure zeros out the whole match. Fine-tuning BGE for skill similarity remains deferred — the hand-curated table covers 80% of the value.

**Skill-slug alert on unknown terms.** When `skill_aliases` lookup fails and the fallback `skill.toLowerCase()` fires, log a warning with the skill name and the role context. Review the log periodically and extend `skill_aliases`. Silent failures compound; visible failures get fixed.

**Vector signal slots in triangulation.** The existing `VECTOR_WEIGHTS` preset in `triangulateMatch` has three 0.05-weight terms (`vector_role_repo`, `vector_role_cand`, `vector_cand_repo`) that are wired but never populated. Populate them. The role-repo vector cosine uses stored role embedding (after the Phase 0 cutover to RCD narrative) against repo embedding. The role-candidate and candidate-repo vector cosines use the candidate's stored embedding.

Add the three corresponding columns to `match_feedback` so thumbs-up/down can track them. When recruiter feedback accumulates, a logistic regression can be fit to adjust weights. Not now — data first, model later — but the infrastructure should be in place.

---

## Code review challenge: tighten the PR assignment

The code review challenge is already production with ADR-032 scoring. Three improvements specific to the repo side:

**Per-candidate PR override.** The existing `candidate_challenge_assignment.github_pr_number` column already supports per-candidate PR overrides. Use it more. `autoStageBuilder` picks a default PR for the role's code review stage, but per-candidate tuning should be an option when a candidate's specific background suggests a better PR match than the role-level default. This is recruiter-facing functionality — a "reassign PR" button on the candidate detail page.

**PR metadata enrichment.** `repo_sample_prs` carries `changed_file_count`, `modifies_tests`, `swe_bench_eligible`, `construct_slugs_json`. Extend this to include a Gemma-derived `pr_narrative` (2–3 sentences describing what the PR does and what a reviewer would encounter) and embed it. Per-candidate PR selection can then be semantic: given the candidate's profile, find the PR whose narrative best matches their experience. Current selection is `ORDER BY changed_file_count ASC` — defensible as a default but missing the semantic dimension.

**Dispositional weight consumption in the implementer agent.** The implementer agent already reads `dispositionalWeights` from the RCD via the challenge config. This is a scalar input that shapes the persona prompt. The decomposed RCD's sub-element-level dispositional signals (per-dimension weights on specific BARS anchors) should flow through to the scorer rather than just the implementer. Today, the scorer reads `dispositional_weights` as a single scalar that shifts dimension weights ±50% clamped. This is a narrow consumption — actual per-anchor overrides aren't being used. Part 2's sub-element `BarsOverride` type addresses this on the role side.

---

## Implementation challenge: the missing scorer

This is the biggest repo-side gap. CODE_IMPLEMENTATION submissions currently have no LLM scorer. `/rpc/score-submission` returns `{success: true, score: null, feedback: null}`. Scoring happens only when a recruiter manually PATCHes the submission. This means the highest-signal assessment in the pipeline (candidate does authentic work on an open-source issue in a real dev container) produces no structured evaluation.

The original strategy's Sherlock AI framework is directly applicable here. Four signal areas:

| Signal area | Score range | Pipe telemetry mapping | Weight |
|---|---|---|---|
| Reasoning & Decomposition | 0–3 | Time-to-first-comment, planning phase duration, issue breakdown structure | 30% |
| Code Construction Process | 0–3 | Edit pattern entropy, TDD cycle adherence, commit granularity | 30% |
| Adaptability Under Constraint Change | 0–2 | Response latency to requirement shifts, code churn directionality (productive vs. panic) | 20% |
| Debugging & Maintenance Awareness | 0–2 | Debug strategy systematicity, test coverage evolution, edge case identification | 20% |

Total 10-point scale converts to percentage for integration with other BARS scores.

**The "assessment IS the work" framing.** The Sherlock rubric's key insight is that behavioral signals — how the candidate decomposes the problem, how they construct code, how they debug — carry more information than the final code quality for most assessment purposes. The dev container (`DevContainerDO`) captures filesystem events and git history. These feed the behavioral scoring.

**AI collaboration framing.** The Sherlock distinction between "AI used for planning" (acceptable) and "AI used for solution substitution" (flagged) becomes the basis for scoring the candidate's AI copilot interactions. High AI acceptance rate without modification indicates potential substitution; paste events without typing preamble flag for review; exploratory AI use with human-led integration is the target pattern.

**Implementation path:**

1. Write `lib/implementationScorer.ts` implementing the four Sherlock dimensions
2. Add prompts in `lib/implementationScorerPrompts.ts` with detailed BARS anchors per dimension (following the existing pattern in `cultureScorerPrompts.ts`)
3. Wire it into `/rpc/score-submission` to run scoring asynchronously via `ctx.waitUntil` after submission, same pattern as `scoreAndPropagate.ts` for code review
4. Extend `challenge_submissions` with a `score_report_json` column holding the structured output
5. Add HITL gate parallel to culture scoring — recruiter must confirm/override before candidate sees final score
6. Cost metering via the existing `aiUsage.ts` infrastructure, tagged `feature='implementation_scoring'`

This is a 3–4 week build, depending on rubric iteration. It is **the single highest-ROI piece of new scoring work** in the pipeline because it unblocks the most expensive assessment moment (candidate invested 1–4 hours in real work) from depending on manual recruiter evaluation.

**Issue body pre-fetch.** Currently candidates get `"Implement issue #N on <url>"` and navigate to GitHub independently. Pre-fetching the issue body and surfacing it inline in the assessment UI is a small improvement that reduces friction and improves assessment completion rates. Cache the fetched issue body in `repo_issues.body_cache_json` with a TTL, refresh weekly via the existing issue crawler cron.

---

## Repo-ingestion work, sequenced

**Phase 0 — Consumption cutover and hygiene:**

Route `autoStageBuilder` through RCD primary instead of `persona_json`. Use `technical_context`, `codebase_expectations`, and `bars_overrides` where applicable. Backwards-compatible read pattern with persona fallback.

Add embedding model version stamp to `repo_engineering_signals`. Migration adds `embedding_model_version` column. Pass 3 writes the current version. Backfill sets existing rows to `'@cf/baai/bge-large-en-v1.5'`.

Normalize the `adminRepos.ts:698` and `:1136` bypass call sites to go through `preprocessForEmbedding`. Small change, removes the vector-space drift hazard.

Ungate Pass 3 vectorize. Confidence-threshold auto-approval replaces `admin_verdict='approved'` as the primary gate. Manual admin queue becomes fallback for low-confidence cases. Backfill: run the confidence scorer against all existing `pass=2` repos with Pass 3 output and auto-approve those above threshold.

Hand-curate `skill_adjacency` table. Rewrite `matchRepos.ts` SQL from `HAVING must_hits = must_total` to threshold-based coverage. Feature-flag the old and new behavior for A/B comparison.

Fix silent `skill_aliases` fallback. Add alerting. Extend the table based on logged unknowns.

Issue body pre-fetch. Extend issue crawler to capture `body_cache_json`. Surface in assessment UI.

**Phase 1 — Implementation challenge scorer:**

Build `lib/implementationScorer.ts` with Sherlock-based rubric. Wire into `/rpc/score-submission`. HITL gate. Cost metering.

**Phase 2 — Repo decomposition:**

Update Pass 3 prompt to produce sub-element JSON. Add `repo_nodes` table migration. Pass 3 writes sub-elements alongside the existing aggregate outputs. Backfill existing `pass=3` repos. Update Vectorize upsert to include sub-elements with metadata tags.

**Phase 3 — Matching rewrite consumes sub-elements.** See Part 5.

**Phase 5 — Graph migration.** `repo_nodes` become `:RepoNode` in Neo4j with type sub-labels. PR samples and issue candidates become linked nodes. Details in Part 5.

---

## Honest caveats

**Gemma variance on Pass 3.** Gemma's output on repos with thin signals (small codebases, missing README, sparse PR activity) is noticeably worse than on repos with rich signals. The confidence scorer will reveal this as a cluster of low-confidence outputs on thin repos. Mitigation options: restrict Pass 1 filtering to exclude thin repos, add a Pass 2.5 enrichment step for borderline repos (more README excerpts, more construct extractors), or accept that the corpus has a quality gradient and surface confidence to matching so thin repos contribute less signal. My recommendation: tighten Pass 1 filters (minimum stars, minimum recent activity, minimum contributor count) and accept a smaller but higher-quality corpus. This is a product choice.

**Sub-element count drift across repos.** Rich repos will produce 20+ sub-elements; thin repos will produce 3–5. The matching layer needs to handle this distribution without accidentally favoring repos with more sub-elements (more surface area for matches means higher aggregate score by volume). The `max(sim)` per requirement aggregation in Part 5 addresses this — quality of best match matters more than total volume — but it's worth testing on a distribution of repos to confirm the behavior is intended.

**Decomposition cost.** Each Pass 3 run currently makes one Gemma call per repo. The sub-element version makes one call with a longer output (all sub-elements in one response) — not a multiplicative cost increase, but a modest token increase. The confidence scorer adds one Qwen call per repo. Combined, Pass 3's per-repo cost goes up roughly 30–50%. At current corpus growth rate this is manageable; monitor via `ai_usage_events`.

**The issue candidate pipeline is lighter-touch than Pass 3 on the repo.** `issue_challenge_signals` is scored by a lightweight classifier that doesn't produce narrative. For the implementation challenge to have the richest possible context, issues should get Gemma-generated narratives too — "what does this issue actually ask the candidate to do, what skills would it exercise, what's the expected complexity band." This is a Phase 2+ extension of the existing issue crawler, not a Phase 0 priority.

---

*End of Part 3.*
