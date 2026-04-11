# Research Plan: Role Discovery + Repo Understanding Data Contract

**Slug:** `role-discovery-data-contract`
**Date:** 2026-04-10
**Parent:** None — this is the first research pass on the Role Discovery → downstream handoff and the crawler's missing 3rd AI pass
**Related briefs:** `behavioral-culture-interview-agent.md` (culture scoring architecture), `code-review-content-sourcing.md` (6-dimension BARS rubric, persona reactivity), `repo-discovery-pipeline.md` (Pass 1 + Pass 2 crawler)
**Related ADRs:** ADR-027 (Role Discovery Agent), ADR-028 (Multi-Stakeholder Role Discovery), ADR-029 (Culture Interview Architecture), ADR-032 (Code Review Research Integration), ADR-033 (Research Integration Strategy & Guardrails), ADR-035 (Global Copilot Agent)
**Pending:** ADR-036 (Role Discovery + Repo Understanding Data Contract) — scaffold in `/Users/hans/.claude/plans/streamed-squishing-waterfall.md`
**STRATEGY.md findings addressed:** RD-1 through RD-24

## Context

PIPE runs a design-thinking intake interview per the methodology in `migration/dersign-thinking.md` Part 8 — the research spec says the canonical artifact of that interview is a **Knowledge State JSON** document containing hierarchical, story-grounded, motivationally-grounded understanding of the role across six domains (why, work, team, bar, codebase, process). ADR-027 codified this. In practice, synthesis flattens the Knowledge State into an 8-field `CandidatePersona` (`workers/api/src/types.ts:223`) and every downstream consumer (culture interview, challenge generation, scorer, repo search) reads only the flattened output. Knowledge State is persisted but dead. No downstream consumer reads it.

Simultaneously, the repo crawler has just finished its 2nd pass against real repos and PRs (`scripts/crawl-repos/index.ts` Pass 1 + Pass 2), producing a rich substrate — `qualified_repos`, `repo_skills`, `repo_constructs`, `repo_sample_prs` with PR metadata (title, changed-file count, test-touched flag, issue-resolution link, construct-slug tags, SWE-bench eligibility) — but both passes are entirely deterministic. Zero LLM calls. The matching layer (`matchRepos.ts`) is a SQL CTE join on `qualified_repos ← repo_skills ← repo_constructs` with hard filters + weighted scoring on skill keywords. Role Discovery's `mustHaveSkills[]` meets this SQL join and the richer Role Discovery signal dies at the boundary.

These two drifts are halves of one bridge. Even if Role Discovery produces a richer structured artifact, there is nothing on the repo side capable of reasoning over it. Even if the repo side gains an AI enrichment pass, there is no stable input contract for it to consume. This research run informs a single ADR (ADR-036) that specifies both halves of the data contract so they land together.

## Core question

What is the right data contract between the Role Discovery interview and its downstream consumers (culture fit interview, code review challenge generation, repo search + 3rd AI pass, scoring), such that the depth extracted by a design-thinking interview is preserved and usable for team-specific assessment calibration — AND such that the scraped repo library is enriched by its own AI pass so that role-to-repo matching reasons over structured repo understanding, not SQL keyword joins?

## Background for researchers

Researchers launching into any sub-question below need this shared context. Don't re-derive it; each sub-question assumes it. Read this section once, then use the sub-questions as focused prompts.

### What Role Discovery is in PIPE

Role Discovery is a structured-but-adaptive interview agent (ADR-027, ADR-028) that runs before *any* downstream assessment is generated. Its job is not to collect form fields — its job is to extract a deep, story-grounded understanding of *this specific role on this specific team* so downstream agents (culture interview, code review challenge, repo search, scoring) can be calibrated to the team instead of generic. The interview implements a research-grounded IDEO design-thinking protocol documented in `migration/dersign-thinking.md`. The key mechanics a researcher should know:

- **Empathize → Define.** The agent lives in the first two phases of the five-phase IDEO process (Empathize → Define → Ideate → Prototype → Test). *Empathize* = extracting understanding through conversation. *Define* = synthesizing that understanding into a structured artifact (a "Knowledge State JSON") downstream agents can consume. PIPE never runs Ideate/Prototype/Test inside this agent.
- **Six Domains.** Every conversational turn is classified into one of six domains: **Why** (motivation for the hire, stakes), **Work** (day-to-day responsibilities, scope), **Team** (culture, collaboration, dynamics), **Bar** (seniority, ownership expectations, quality standards), **Codebase** (stack, architecture, codebase shape), **Process** (workflow, release cadence, rituals). The Knowledge State is organized around these domains.
- **Laddering via Means-End Chain Theory.** When the user mentions an attribute ("We use Kafka"), the agent drills from attribute → consequence ("We use it to decouple services so teams ship independently") → value ("Reliability matters because our users are clinicians and a bug affects patient care"). The *value* is what calibrates downstream assessment content — not the attribute. Today's synthesis collapses attribute → consequence → value chains down to a flat `mustHaveSkills: ["Kafka"]` entry, losing the value layer entirely.
- **Indirect Five Whys.** The agent never asks "why" literally — it uses hypothesis-offer, consequence framing ("what happens if they haven't worked with X?"), story prompts ("tell me about the last time…"), and "how" questions to reach root cause without feeling interrogative.
- **Seven question types.** Introductory, Grand Tour, Example, Follow-Up, Direct, Hypothesis, Contrast. The conversation arcs from warm/open → drilling → validation across roughly 20 turns (soft budget, not a hard cap).
- **Beginner's Mind with expertise.** The agent demonstrates it knows what a technology *is* in general while refusing to assume what it *means to this team*. "I know what event-driven architecture is — I don't know what it means to you."
- **Multi-stakeholder variants (ADR-028).** Four interviewee types — `HIRING_MANAGER`, `TEAM_MEMBER`, `INTERNAL_RECRUITER`, `EXTERNAL_RECRUITER` — each with a different question bank and different authority weighting. The team member's perspective is treated as ground truth for culture; the hiring manager's as ground truth for scope; recruiters carry less weight on culture specifics. Today's synthesis collapses all stakeholders into a single averaged persona, so disagreements vanish.

### The two artifacts and the drift

The research-specified output of the Define phase is the **Knowledge State** — a hierarchical JSON document organized around the six domains, with laddering chains, stories, per-turn energy signals, contradictions, and per-stakeholder perspectives preserved as first-class fields. In practice, PIPE's synthesis step flattens the Knowledge State into an 8-field **`CandidatePersona`**: `seniority`, `archetype`, `mustHaveSkills[]`, `niceToHaveSkills[]`, `disposition[]`, `careerSignal`, `redFlags[]`, `dealbreakers[]`. **Every downstream consumer today reads `CandidatePersona`, not the Knowledge State.** Laddering chains collapse to skill bullets. Stories become raw transcript text no consumer parses. Multi-stakeholder disagreement averages into single-view fields. The Knowledge State is persisted but dead. This drift is the motivation for half the research — designing a "Role Context Document" that re-preserves what the Knowledge State captured, with a schema written *for* the downstream consumers.

### Downstream consumers that will read whatever schema we design

1. **Culture fit interview agent (ADR-029).** Runs a 5-competency × 5-profile-axis BARS-scored interview on Gemma 4 26B. Today it reads only `persona.seniority` and `persona.archetype` — every other Role Discovery signal is invisible. The BARS rubric is universal (no team-specific anchors). A focus-dimensions override hook exists in code but is never fired. Questions Q2, Q4, Q5, Q9 shape what this agent should read from the Role Context Document and whether its rubric should be calibrated per team.
2. **Code review challenge generation (ADR-032, ADR-034).** Generates planted-bug PRs from repo skeletons. Reads a 5-field persona slice today (`seniority`, `archetype`, `mustHaveSkills`, `niceToHaveSkills`, `careerSignal`) and has **zero repo context** at generation time. Questions Q6, Q7 shape what role context it should read and what repo signals matter for matching.
3. **Scoring (ADR-032).** Uses a 6-dimension BARS rubric (communication, technical depth, practice, tone, initiative, ownership) with no role-specific calibration. Dealbreakers from Role Discovery never enter scoring. Questions Q4, Q9 shape whether and how this should change.
4. **Repo discovery + matching.** `matchRepos.ts` runs a SQL CTE join on `qualified_repos ← repo_skills ← repo_constructs` with hard filters + weighted scoring on skill-keyword hits. It never reasons over the repo substrate with a specific role in mind. The richest role signal it sees is `persona.mustHaveSkills[]` — a flat array of strings. Question Q11 is about designing a new AI layer that bridges this gap.

### What the repo crawler has produced

The crawler (`workers/api/scripts/crawl-repos/`) has completed two deterministic passes against real GitHub repos. **Neither pass makes any LLM calls.** Pass 1 does GitHub search + manifest parsing (package.json, requirements.txt, go.mod) to filter candidate repos by language/stack. Pass 2 clones each surviving repo, measures SLOC and cyclomatic complexity, detects code constructs from regex templates (stored as `construct_slug` tags), and samples up to 20 merged PRs per repo. PR samples are stored in `repo_sample_prs` with **metadata only**: title, changed-file count, test-touched flag, issue-resolution link, construct-slug tags, SWE-bench eligibility flag. **Raw diffs and PR bodies are not stored.** This is the richest substrate PIPE has ever had about real-world code — and nothing in the platform reasons over it with a role in mind. Q11 is about designing the missing AI reasoning layer.

### What "good" looks like for the research output

This run informs a single ADR (ADR-036) with two halves:
- **Half 1 — Role Context Document.** A new canonical schema produced by Role Discovery synthesis, replacing the flat `CandidatePersona`. Each consumer in the list above reads its own purpose-specific section.
- **Half 2 — Repo Understanding Contract.** A new AI pipeline that sits between the crawler substrate and the matching layer. Likely two tables (`repo_engineering_signals` + `repo_role_alignment`), a new crawler pass, and a new Worker handler.

The ADR cannot be written if the research returns a menu of options without a recommendation. Each load-bearing question (Q1, Q4, Q5, Q8, Q11) must come back with a **specific recommendation grounded in ≥3 concrete alternatives with empirical data**, not a tradeoff survey. Each answer must end with a "what this implies for the Role Context Document AND the Repo Understanding Contract" note.

---

## Sub-questions

Every sub-question below assumes the Background for researchers section above. Each states the PIPE decision it drives, the research question with literature pointers, the HMW design intent, and the deliverable shape.

### Q1 — Role Context Document schema

**What this informs:** The canonical output schema Role Discovery synthesis will produce instead of the flat 8-field `CandidatePersona`. This becomes the contract every downstream consumer reads. Getting it wrong locks in the next flattening drift.

**Research question:** What output schema preserves the depth of an IDEO Empathize→Define interview — specifically laddering chains (attribute → consequence → value per Means-End Chain Theory), story-grounded evidence, per-turn energy signals, and multi-stakeholder disagreements — when converting an unstructured transcript into structured JSON? Draw on qualitative research methodology where this problem has been studied for decades: grounded theory (Glaser & Strauss, Charmaz), thematic analysis (Braun & Clarke), interpretative phenomenological analysis (Smith), narrative analysis, and the qualitative-to-structured conventions used in healthcare research, UX, and market research.

**Design intent (HMW):** How might we design a schema whose fields *are* laddering chains, stories, and per-stakeholder disagreements — rather than a schema whose fields collapse those structures into flat lists at write time?

**Deliverable:** A proposed schema sketch (nested JSON structure with field-level comments) grounded in ≥3 concrete precedents from the literature, each with a brief note on what PIPE should borrow and what it should not.

**Assigned to:** R1

### Q2 — Team-signal extraction taxonomy

**What this informs:** Which team-culture signals the Role Context Document's "Team Context" section must carry so the culture interview agent can calibrate to the team instead of running a universal rubric.

**Research question:** How do existing culture-assessment platforms (HireVue, Plum, Culture Amp, Lattice, Harver, Pymetrics) extract structured team-culture signals from interview data, and what empirical validation exists for their taxonomies — dimension count, construct definitions, inter-rater reliability, published Cronbach's α or κ? Where these platforms have published academic-grade validation, what do those studies say about which taxonomies actually differentiate teams versus proliferating dimensions without signal?

**Design intent (HMW):** How might we extract a minimal, empirically-grounded team-culture signal set that meaningfully differentiates teams in the eyes of a scoring agent — rather than a long taxonomy that fragments signal across too many dimensions?

**Deliverable:** A recommended team-culture signal set (dimension list + per-dimension construct definition + empirical source) with explicit justification for what's included and what's excluded.

**Assigned to:** R2

### Q3 — Multi-stakeholder aggregation

**What this informs:** How the Role Context Document represents disagreements between interviewees (hiring manager vs. team member vs. recruiter per ADR-028) — as first-class structured data, or collapsed into averaged fields. The synthesis step's current behavior is to average; the question is whether that should change.

**Research question:** What does the psychometric literature on multi-source assessment say about preserving versus aggregating conflicting stakeholder views? Draw on 360-degree feedback meta-analyses (Smither, London, Conway, Atwater), the Delphi method literature, and consensus-building protocols from medical guideline development (e.g., RAND/UCLA appropriateness method). When should disagreements be preserved as distinct data points, when should they aggregate, and what weighting schemes hold up empirically against single-rater baselines?

**Design intent (HMW):** How might we record "the hiring manager says X but the team member who'll actually work with this hire says Y" as a structured fact the scorer can use — rather than collapsing both views into a single average that destroys the disagreement?

**Deliverable:** A proposed aggregation scheme with explicit rules for (a) which fields preserve per-stakeholder views, (b) which fields aggregate and how, (c) what the scorer should do when stakeholders conflict on a critical signal.

**Assigned to:** R4

### Q4 — Team-specific BARS anchor calibration

**What this informs:** Whether PIPE's 6-dimension code review rubric (ADR-032) and 5-dimension culture rubric (ADR-029) should carry team-specific anchor overrides generated from the Role Context Document, or keep anchors universal.

**Research question:** What is the evidence base for role-specific or team-specific BARS anchor calibration — drawing on Smith & Kendall's 1963 founding paper, Campion's structured-interview meta-analyses, Hodges's medical-education BARS work, and Landy's performance-appraisal research? Does tailoring anchors to role context improve hiring validity (criterion, construct, content), and at what cost to inter-rater reliability and legal defensibility under the Uniform Guidelines on Employee Selection Procedures and the EU AI Act's high-risk hiring provisions?

**Design intent (HMW):** How might we swap BARS anchors based on role context — e.g., "ownership Level 5 means 'pushes back on PMs when the spec is wrong' on this team vs. 'executes exactly as specified without friction' on another — without destroying the rubric's psychometric properties or creating adverse-impact exposure?

**Deliverable:** A specific recommendation (do it / don't do it / do it with constraints), the evidence that supports the recommendation, and — if calibration is recommended — a proposed override mechanism at the field level.

**Assigned to:** R2

### Q5 — Team-specific probe generation vs. static bank

**What this informs:** Whether PIPE's culture interview agent should dynamically generate follow-up probes from Role Context Document facts, or keep a static probe bank with team-specific weighting. ADR-029 currently uses a static bank; the question is whether the research supports switching.

**Research question:** In behavioral/structured interview research, what are the empirical tradeoffs between dynamically generated team-specific probes and static-bank probe selection with team-specific weighting? Evaluate on: question quality, interview consistency, candidate fairness, cross-candidate comparability, and auditability under the EU AI Act (high-risk hiring provisions) and EEOC guidance on adverse impact.

**Design intent (HMW):** How might we generate custom probes grounded in Role Discovery facts — e.g., "the hiring manager said the team's last conflict was around v2 launch criteria; probe for the candidate's experience with launch tradeoffs" — without sacrificing audit trails, cross-candidate comparability, or defensibility under regulatory scrutiny?

**Deliverable:** A specific recommendation (dynamic / static-with-weighting / hybrid), the supporting evidence, and a proposed audit-trail design for whichever approach is recommended.

**Assigned to:** R2

### Q6 — Codebase-shape signals beyond skill keywords

**What this informs:** What fields belong in the Role Context Document's "Technical Context" section and what signals the new `repo_engineering_signals` table (Q11) should store beyond today's skill-keyword join.

**Research question:** What signals beyond skill keywords meaningfully differentiate codebase shape for challenge-relevant matching? Draw on empirical software engineering literature from MSR (Mining Software Repositories), ICSE empirical tracks, FSE, and EMSE. Evaluate candidates: PR-size distribution, commit cadence, review density, test-to-code ratio, architecture patterns (monolith / microservice / layered), testing style (unit / integration / e2e), issue-to-resolution latency, refactor frequency, tech debt indicators. Which are empirically extractable from git and GitHub metadata at scale, and which are known to predict engineer-codebase fit?

**Design intent (HMW):** How might we translate a recruiter's qualitative description — e.g., "async-first Go microservices, 200–400 line PRs, integration-test-heavy, HIPAA-constrained" — into queryable structured signals that match against what the crawler already stores in `qualified_repos`, `repo_constructs`, and `repo_sample_prs`? And what signals should the crawler start storing that it doesn't today?

**Deliverable:** A ranked signal list — name + extractability from git/GitHub metadata + empirical source + PIPE mapping ("stored today in X" or "needs to be added to Pass 2/3").

**Assigned to:** R3

### Q7 — How competitors pair challenges to team context

**What this informs:** Benchmarks the matching layer between Role Context Document and the repo library against how existing coding-assessment platforms claim to do it. Competitive intelligence companion to Q6 and Q11.

**Research question:** How do existing code review / coding assessment platforms (Codility, HackerRank, Coderbyte, CodeSignal, Woven, TripleByte/Karat, GreenHouse Prelude) pair candidate-facing challenges to team context? Draw on product documentation, engineering blogs, published whitepapers, public conference statements (HR Tech, UNLEASH, SIOP). What signals do they surface in their matching logic, what do they claim as differentiator, and what evidence (if any) do they publish that role-tailored content improves hiring signal over universal challenge banks?

**Design intent (HMW):** How might we build a matching layer that, given a Role Context Document, returns the top-N repos from `qualified_repos` a challenge generator should use — with explicit per-repo justification a recruiter can audit ("this repo matches because X, Y, Z; the 4th-ranked was dropped because W")?

**Deliverable:** A competitor scan (per platform: claims / evidence / verifiability / marketing filter) plus a recommended matching-layer interface shape for PIPE.

**Assigned to:** R3

### Q8 — Synthesis prompting to preserve laddering chains

**What this informs:** How the Role Discovery synthesis prompt should be written so it produces the Q1 schema without collapsing laddering depth the way today's `CandidatePersona` synthesis does.

**Research question:** What prompt patterns have been empirically shown to convert qualitative interview transcripts into structured JSON without losing hierarchical motivational context? Evaluate: chain-of-density summarization (Adams et al. 2023), schema-guided generation, constrained JSON decoding (Outlines, jsonformer, llguidance, grammar-constrained decoding), extraction prompts with field-level exemplars, multi-pass refinement (draft → critique → rewrite), and role-conditioned extraction. The key concern is preserving attribute → consequence → value chains across a prompt boundary.

**Design intent (HMW):** How might we write a synthesis prompt that, given the Role Discovery transcript + mid-interview Knowledge State, produces a Role Context Document whose fields preserve the laddering depth the live interview extracted — rather than collapsing everything into a flat skills list the way today's synthesis step does?

**Deliverable:** A recommended prompt pattern (sketch, not full text), the empirical evidence for why it preserves laddering chains better than alternatives, and a list of failure modes the synthesis step should guard against.

**Assigned to:** R1

### Q9 — Dealbreaker propagation as auto-fail or HITL gate

**What this informs:** How the Role Context Document's `dealbreakers` and `redFlags` fields enter the downstream scoring pipeline. Today they're extracted during Role Discovery but no downstream consumer reads them; nothing in PIPE will auto-fail on a dealbreaker. The question is whether that should change, and under what legal constraints.

**Research question:** What is the legal evidence base for automated hard-fail decisions in hiring? Draw on EEOC Title VII enforcement history, Griggs v. Duke Power (disparate impact), the Uniform Guidelines on Employee Selection Procedures (four-fifths rule), EU AI Act Article 14 (human oversight for high-risk AI), NYC Local Law 144 (AEDT audit requirements), Illinois AI Video Interview Act, and recent enforcement actions against AI hiring tools (e.g., EEOC v. iTutorGroup 2023). Which designs have survived scrutiny — pure auto-fail, auto-flag-then-HITL, advisory-only — and what are the evidence thresholds for each?

**Design intent (HMW):** How might we turn the Role Discovery `dealbreakers` field into a gating mechanism for downstream assessments without creating adverse-impact exposure, and what HITL design has held up under regulatory scrutiny?

**Deliverable:** A specific recommendation (auto-fail / HITL / advisory-only), the legal-evidence trail that supports it, and a proposed design for how dealbreakers flow from Role Context Document → scoring → HITL queue.

**Assigned to:** R2

### Q10 — Validation methodology for role-tailored assessment

**What this informs:** How PIPE proves to a skeptical customer or regulator that role-tailored assessment (Role Context Document + calibrated scoring + role-matched repos) produces better hiring signal than the current universal-rubric + skill-keyword baseline.

**Research question:** What validation methodologies are tractable at low-to-moderate hiring volumes (<500 candidates per quarter, the realistic range for PIPE's early customers)? Evaluate quasi-experimental designs (Shadish, Cook & Campbell), A/B comparison protocols, criterion validity studies (with their known small-sample challenges), construct validity bootstrapping, transportability analysis, and low-N tactics used in HR-tech validation (synthetic validation, validity generalization).

**Design intent (HMW):** How might we design a validation protocol that produces credible evidence of improved hiring signal within the first 3–6 months of a customer engagement — without requiring the sample sizes that traditional concurrent-validity studies demand?

**Deliverable:** A validation protocol sketch (study design + statistical test + sample-size estimate + timeline + what counts as "credible evidence") plus empirical precedents.

**Assigned to:** R4

### Q11 — 3rd AI pass architecture: offline per-repo vs. runtime per-role

**What this informs:** The second half of ADR-036 — the Repo Understanding Contract. This question directly shapes two new D1 tables (`repo_engineering_signals`, `repo_role_alignment`), a new crawler pass flag (`--pass3`), and a new Worker handler sitting between `discover.ts` and `matchRepos.ts`. The ADR cannot be written without a specific architectural recommendation.

**PIPE state specific to this question:** The crawler's Pass 1 and Pass 2 are both deterministic — zero LLM calls. The richest substrate available is `repo_sample_prs` (up to 20 PRs per repo, metadata only: title, changed-file count, test-touched flag, issue-resolution link, construct-slug tags, SWE-bench eligibility) plus repo-level constructs, stack, seniority band, and complexity metrics. Raw PR diffs and bodies are not stored. `matchRepos.ts` is SQL-only — a CTE join on `qualified_repos ← repo_skills ← repo_constructs` with hard filters + weighted scoring on skill-keyword hits. Role Discovery and the repo library meet only at `persona.mustHaveSkills[]`.

**Research question:** What is the correct architecture for a 3rd AI pass that reasons over this substrate with Role Discovery signals in mind? Specifically, the tradeoff between (a) an **offline per-repo** summarization that writes a role-agnostic "engineering signal" document once per repo and reuses it across every role that queries it, and (b) a **runtime per-(role × repo)** alignment score called at discovery time that reads both a Role Context Document and the repo substrate. Evidence sources: the LLM-over-repo summarization literature (RepoBench, SWE-bench, CodeT5, RepoFusion, long-context retrieval benchmarks) for the offline side; the recommendation-system / IR literature (two-stage ranking, candidate generation + re-ranking, learning-to-rank over structured features, cold-start caching) for the runtime side. Secondary: how existing code-assessment platforms (Codility, HackerRank, CodeSignal, Woven, Coderbyte, GreenHouse Prelude) structure their "match content to candidate role" step in their public architecture.

**Design intent (HMW):** How might we split the pass into two halves that each do one job well — an offline crawler step that writes a stable `repo_engineering_signals` record per repo (amortized across every role that ever queries it) and a runtime Worker step that reads the Role Context Document + engineering signals to produce a `repo_role_alignment` record per (role × repo) pair — without token-burn on repeat queries, inconsistent judgments across roles, or latency spikes at discovery time? Or is there evidence that a single-stage architecture (offline-only or runtime-only) outperforms the two-stage split on cost, consistency, and retrieval quality?

**Why this question is load-bearing:** Getting this wrong means either re-paying the same LLM reasoning on every recruit to the same role (runtime-only, no caching) or producing a static summary no consumer actually uses because it wasn't written with a role in mind (offline-only, no rerank). The ADR-036 Repo Understanding Contract section cannot be written without a specific recommendation.

**Deliverable:** A specific recommendation (offline-only / runtime-only / two-stage / other) with the evidence for each alternative, the expected cost/latency/consistency profile of the recommendation, and a table-schema sketch for whichever tables the recommendation requires.

**Assigned to:** R3

## Strategy

4 parallel researcher subagents, disjoint dimensions:

- **R1 — Qualitative methodology & synthesis:** Q1, Q8
  - Grounded theory (Glaser & Strauss, Charmaz), thematic analysis (Braun & Clarke), interpretative phenomenological analysis (Smith), narrative analysis, chain-of-density prompting, constrained JSON decoding, schema-guided generation, multi-pass refinement, Means-End Chain Theory (laddering)

- **R2 — Culture assessment platforms & BARS calibration:** Q2, Q4, Q5, Q9
  - HireVue, Plum, Culture Amp, Lattice, Harver, Pymetrics product documentation + academic validation; Hodges/Landy BARS literature; Smith & Kendall 1963; Campion structured interview meta-analyses; dealbreaker/auto-fail legal evidence base (EEOC Title VII, Griggs v. Duke Power, Uniform Guidelines, EU AI Act Article 14)

- **R3 — Code review assessment platforms + codebase-shape matching + repo understanding:** Q6, Q7, Q11
  - Codility, HackerRank, Coderbyte, CodeSignal, Woven, TripleByte, GreenHouse Prelude product documentation; MSR / ICSE empirical tracks on git metadata signals; LLM-over-repo summarization (RepoBench, SWE-bench, CodeT5, RepoFusion, long-context retrieval); recommendation-system / IR literature on two-stage ranking and candidate generation + re-ranking

- **R4 — Multi-stakeholder aggregation + validation methodology:** Q3, Q10
  - Psychometric multi-source assessment (360-degree feedback meta-analyses), consensus-building / Delphi method literature; quasi-experimental validation designs (Shadish & Cook), criterion validity studies, construct validity bootstrapping; low-volume validation tactics for HR tech

Expected rounds: 2
Expected total sources: 60-90

Primary researcher model: Sonnet 4.6 via the `researcher` subagent type.

## Acceptance criteria

- [ ] All 11 sub-questions answered with ≥2 independent sources
- [ ] Q1, Q4, Q5, Q8, Q11 (the load-bearing questions for ADR-036 — schema design, BARS calibration, probe generation, synthesis prompting, repo pass architecture) evaluated against ≥3 concrete alternatives with data, not abstractions
- [ ] Contradictions between sources identified and addressed in the brief
- [ ] No single-source claims on critical findings — specifically Q4 BARS calibration, Q9 dealbreaker legal defensibility, Q11 offline-vs-runtime repo pass architecture
- [ ] Each answer includes a concrete "what this implies for the Role Context Document schema AND the Repo Understanding Contract" note
- [ ] Q11 must return a specific recommendation (not a menu): offline-only, runtime-only, or two-stage, with the evidence the research found for each
- [ ] Open questions section explicitly lists what the research could NOT answer (honest gap list) — items that become ADR-036 "deferred" and STRATEGY.md Open Questions rows

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | researcher R1 (sonnet) | Q1, Q8 — qualitative methodology & synthesis prompting | done | `knowledge/outputs/role-discovery-data-contract-research-methodology.md` |
| T2 | researcher R2 (sonnet) | Q2, Q4, Q5, Q9 — culture platforms, BARS calibration, probe generation, dealbreaker legal defensibility | done | `knowledge/outputs/role-discovery-data-contract-research-culture.md` |
| T3 | researcher R3 (sonnet) | Q6, Q7, Q11 — codebase-shape signals, competitor pairing, 3rd AI pass architecture | done | `knowledge/outputs/role-discovery-data-contract-research-codereview.md` |
| T4 | researcher R4 (sonnet) | Q3, Q10 — multi-stakeholder aggregation, validation methodology | done | `knowledge/outputs/role-discovery-data-contract-research-validation.md` |
| T5 | lead | Synthesize draft | done | `knowledge/outputs/.drafts/role-discovery-data-contract-draft.md` |
| T6 | verifier | Cite + URL-check | done | `knowledge/outputs/role-discovery-data-contract-brief.md` |
| T7 | reviewer | Evidence integrity | done | `knowledge/outputs/role-discovery-data-contract-verification.md` |
| T8 | lead | Final deliverable + provenance | done | `knowledge/outputs/role-discovery-data-contract.md` + `.provenance.md` |

## Verification log

_Empty at plan time. Reviewer fills in post-research with verification method + evidence IDs for each load-bearing claim in the brief._

## Decision log

- **2026-04-10** — Plan created. Scope: two halves of one bridge — Role Context Document (synthesis output) and Repo Understanding Contract (3rd AI pass + runtime role-fit rerank). Both land in ADR-036. STRATEGY.md Decision Log entry recorded under guardrail rule per ADR-033.
- **2026-04-10** — Q11 added as the architecture-critical question for the 3rd AI pass. R3 takes Q6, Q7, Q11 (code review cluster). R4 takes Q3, Q10 (validation cluster). R1 and R2 assignments unchanged from the original 10-question formulation.
- **2026-04-10** — Researcher model: Sonnet 4.6 per existing convention (`repo-discovery-pipeline.md`, `behavioral-culture-interview-agent.md`).
- **2026-04-10** — Embedding-based semantic matching for repos (README / diff embeddings) explicitly deferred to post-MVP. Pass 3 structured summaries + runtime role-fit rerank are the MVP path. Research will document embeddings as a future enhancement but will not block the ADR on them.
- **2026-04-10** — Pass 3 reasons over `repo_sample_prs` metadata only (title, changed files, constructs, test flags). Raw PR diffs/bodies are not stored today and storing them is out of scope for this plan. If research Q11 surfaces a strong case for diff-level reasoning, that becomes a separate STRATEGY.md finding and a later crawler extension.
- **2026-04-10** — R1–R4 launched in parallel (not sequential as handoff originally proposed). Justification: researchers write to files and return <300-word summaries, so Lead context pressure is at T5 synthesis, not T1–T4 fan-out. All four returned cleanly with ≥2 sources per claim; zero blocked items.
- **2026-04-10** — R1 recommends hybrid schema: Ritchie & Spencer framework-matrix + IPA evidence-anchor pattern + Reynolds & Gutman directional A→C→V fields. Primary artifact is `domain_matrix`; `consumer_slice` (replacing CandidatePersona) is derived at write time. Synthesis prompt uses bottom-up ordering (attribute_quote verbatim → consequence → value) with schema-guided JSON output + conditional verification pass.
- **2026-04-10** — R2 recommends: (Q2) OCAI 4 archetypes + Psychological Safety as team profile signals (not candidate score); (Q4) universal base rubric + per-dimension anchor overrides derived from RCD laddering chains; (Q5) hybrid static bank with role-setup-time enrichment, not per-candidate AI generation; (Q9) auto-flag-then-HITL gate for dealbreakers with `jobRelatednessNote` pre-populating business-necessity defense. Auto-fail is legally indefensible (Griggs, iTutorGroup, EU AI Act Art. 14).
- **2026-04-10** — R3 recommends (Q11, load-bearing): two-stage architecture. Pass 3 offline via Claude Haiku 4.5 on a Queue consumer writes role-agnostic `repo_engineering_signals`; runtime Worker reads RCD + top-N signals and writes cached `repo_role_alignment` (score + justification_json). Five codebase signals computable from existing PIPE schema today (test_touch_rate, mean_changed_files, issue_link_rate, complexity_band, SWE-bench eligibility); four require Pass 2 additions. No competitor publishes criterion validity for role-tailored content — PIPE's approach is architecturally novel.
- **2026-04-10** — R4 recommends (Q3) three-tier aggregation: domain-authoritative anchor fields + shared-domain preserved values with `conflict_flag` + explicit-formula aggregates for genuine consensus only. Supervisor–peer correlation is only ρ=.34 (Conway & Huffcutt 1997) — aggregation without scalar invariance testing is invalid. (Q10) staged validation: content validity (N=0) → convergent bootstrap (N≥30) → transportability via Sackett 2022 (r_op=.42 for structured interviews) → quasi-experimental ITS at N≥100. Local criterion studies require N=85–200, infeasible at PIPE's volumes. RCD + RUC must carry versioned `validation_metadata` or cross-cohort comparisons become confounded.
- **2026-04-10** — T5 (Lead synthesis) complete. Draft saved at `knowledge/outputs/.drafts/role-discovery-data-contract-draft.md` with full `[R#-S#]` inline citations mapped to all 84 sources across the 4 research files. Structure: Executive Summary + Half 1 (RCD, 7 subsections incl. JSON schema sketch) + Half 2 (RUC, 4 subsections incl. D1 DDL for `repo_engineering_signals`, `repo_role_alignment`, `role_probe_bank`) + Cross-cutting validation methodology + 11 Open Questions + Appendix.
- **2026-04-10** — T6 (Verifier) complete. 84 sources resolved; 15 URLs verified live, 4 dead, 1 redirected, 2 PDF binaries, 1 blank page, 61 not individually URL-verified (paywalled / book ISBN / spot-checked in research files). Two attribution corrections applied: R2-S7 Quinn→Heritage; R3-S4 Gousios→Kudrjavets. Zero unsupported-claim flags; zero broken-marker flags.
- **2026-04-10** — T7 (Reviewer) complete. Verdict: **PASS WITH NOTES**. 0 FATAL, 3 MAJOR, 5 MINOR. MAJOR issues: (M1) OCAI per-archetype Cronbach's α values not directly verified in research file; (M2) SWE-bench ~40% BM25 oracle-file recovery figure not directly quoted in research file; (M3) Mobley v. Workday characterization overstated — cited source is a Norton Rose Fulbright client alert, not an appellate opinion, and the case is in active litigation. All three patched in the brief via targeted prose softening before delivery; no re-review needed because no FATAL issues were found.
- **2026-04-10** — T8 (Finalization) complete. Verified brief copied to `knowledge/outputs/role-discovery-data-contract.md`. Provenance record written to `knowledge/outputs/role-discovery-data-contract.provenance.md`. Research run closed. Next actions are post-run: draft ADR-036 using scaffold at `/Users/hans/.claude/plans/streamed-squishing-waterfall.md`; update `knowledge/STRATEGY.md` RD-1 through RD-24 rows; commit outputs folder with `[Unreleased]` CHANGELOG entry.
