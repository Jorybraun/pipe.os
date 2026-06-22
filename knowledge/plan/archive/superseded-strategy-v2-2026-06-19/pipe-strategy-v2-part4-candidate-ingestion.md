# Pipe Strategy v2 — Part 4: Candidate Ingestion Pipeline
*Resume as seed, living graph, automated screening, and deeper validation.*

---

## The core reframe

A resume is not a candidate profile. It is an impoverished artifact a candidate hands you once — retrospective, written for a general audience, several steps removed from who the person actually is, and already out of date by the time it arrives. No amount of careful parsing, clever extraction, or sophisticated matching rescues candidate quality if the only signal source is a resume.

The reframe: **a candidate is a living graph that grows over time from multiple sources**. The resume is the seed. From there, the graph accumulates through structured screening conversations, public data enrichment, behavioural interviews, technical interviews, code review transcripts, implementation challenge telemetry, and eventually performance outcomes when those become visible. Each data source contributes sub-elements with provenance tags, timestamps, and confidence scores. The profile deepens over months; it persists across roles; it represents the person in increasing fidelity as more evidence accumulates.

This reframe has three architectural implications:

One, **the candidate entity is not written once at ingestion**. It is opened, then grown. The schema has to support ongoing additions, supersedes-pointers when new evidence replaces old, temporal layering so the profile at any point in time is reconstructable, and provenance tracking so every sub-element's origin is auditable.

Two, **"ingestion" is a multi-stage pipeline, not a single step**. Resume parsing is stage one. Loose matching against open roles is stage two. Automated screening is stage three. Public data enrichment runs alongside. Deeper validation (code review, implementation challenge) is stage four. Each stage produces sub-elements that attach to the graph. Matching runs at multiple points with increasing confidence as evidence accumulates.

Three, **the screener is the most important underbuilt piece of the whole platform**. The resume gives you claims. Public data gives you artifacts. The screener is the mechanism that turns claims into *validated, decomposed, structured* signal by probing systematically. Nothing else in the pipeline produces this kind of elicited structured evidence; the culture interview and technical interview are role-specific and come later. A good screener unblocks everything downstream.

Pipe already has most of the infrastructure to build this well. The candidate ingestion pipeline runs 11 steps today. The behavioural interview is production-complete for role-specific culture fit. The dev container and code review challenge produce real assessment evidence. What's missing is the assembly: treating these as stages of a continuous candidate-building pipeline rather than discrete one-shot operations, and filling in the gaps (the screener as pre-match profile builder, the implementation challenge scorer, the living-graph schema).

---

## Current state

The existing pipeline, mapped to what's built:

**Intake.** `POST /api/v1/pipelines/:id/ingestion/upload` accepts a resume PDF. Recruiter-invoked today. Stored in R2. Triggers `runCandidateIngestion` in `lib/candidateDiscovery/orchestrate.ts`.

**Extraction.** Gemma 4 26B (via `createCandidateAgentProvider`) reads the resume and produces the `candidate_searchable_profile` — 400–600 words of third-person prose narrative — along with structured JSON fields: `key_concepts_json` (mustHaveSkills, niceToHaveSkills, detected_domain), `career_context_json` (company_stages, company_size_exposure, tenure_pattern, progression_velocity, ownership_depth, system_scale_exposure, greenfield_ratio), `situation_signature_json` (primary_challenge_types, architecture_exposure, test_culture_exposure, review_culture, impact_signals). All of these land in `candidate_ingestion` table columns as JSON.

**Persistence and embedding.** The narrative is embedded via `@cf/baai/bge-large-en-v1.5` at 1024 dimensions. Vector upserts to CANDIDATE_INDEX with metadata `{seniority, primary_language}` — two fields. Ground truth stored in `candidate_ingestion.embedding_json` per ADR-040.

**Matching.** `matchReposForCandidate` runs vector-native against REPO_INDEX (top-K=50), blends with SQL `matchRepos` via philosophy-weighted cosine (0.3 validate, 0.5 tailored/hybrid), falls back to SQL-only if ANN returns <5 results or bindings are missing. Then Gemma ranks the shortlisted repos against the candidate's narrative via `candidateSituationFit` (uncached, pays the cost every time). `triangulateMatch` combines role-repo alignment (cached Gemma rerank from the role-discovery pipeline), candidate-repo fit (uncached), role-candidate cosine (exact from D1), and skill coverage (SQL-normalized) using philosophy weights.

**Assignment.** `upsertCandidateChallengeAssignment` writes per-candidate PR and issue assignments (tailored/hybrid philosophies only; validate skips).

**Then the candidate journey starts.** Invite link, token resolution, stage progression through code review, implementation challenge, quiz, culture interview.

**What works.** The orchestration is genuinely sophisticated — 11 steps, checkpoint-based, with philosophy-aware blending. Vector-native matching is primary; SQL is the guardrail. Dual-layer storage per ADR-040 lets you recompute exact cosine from ground truth.

**What doesn't work.**

The extracted narrative is flat prose. All the structured signals that Gemma produced (`career_context_json`, `situation_signature_json`, `key_concepts_json`) sit in adjacent columns and never make it into the embedded text. The matching layer's candidate vector is computed from 400–600 words of generic prose while the structural richness is ignored. This is the dominant cause of weak candidate-role matches.

There is no screening loop. After intake, the candidate either gets invited to a role's assessment stages (if matched) or sits in the pipeline. There's no mechanism for eliciting additional signal from the candidate before the role-specific assessments run. The signal available for matching is only what the resume provides.

There is no public data enrichment. The extraction works from the resume alone. A candidate who provided a GitHub URL gets no additional signal from their public code activity. The `candidate_ingestion` row doesn't have fields for enrichment sources, external profile links, or scraped artifact references.

Candidate-repo alignment via `candidateSituationFit` is not cached. Every ingestion pays the full Gemma cost even for the same candidate-repo pair. The cache key would be trivial (`candidate_id + repo_id + signals_version + candidate_profile_version`).

The behavioural/culture interview is role-specific and runs *after* matching. It produces rich signal (5 competency + 5 profile dimensions, STAR evidence, HITL-gated report) but its output doesn't feed back into the candidate's graph in a way that updates matching. If a candidate does three culture interviews for three different roles, they have three isolated `score_report` blobs in `culture_interview_sessions` rather than a cumulative candidate profile that would improve subsequent matching.

The code review transcript is captured (`review_sessions.transcript`) and scored (`review_sessions.score_report`) but not decomposed into candidate-level signals that persist beyond the assessment. The candidate's demonstrated abilities in a code review (issue identification depth, reasoning quality, prioritization) don't become sub-elements on the candidate's graph.

Implementation challenge submissions have no scoring as covered in Part 3. Even after the Sherlock-based scorer exists, the question of how those signals flow back into the candidate graph is open.

The `review_sessions.score_report` and `culture_interview_sessions.score_report` don't share a schema with `candidate_ingestion.triangulated_scores_json`. Each assessment produces a different JSON blob shape. Cross-assessment aggregation requires shape translation.

---

## The decomposition design for candidates

Same pattern as roles and repos: addressable sub-elements, each with a rich narrative, each with its own embedding, each with structured properties and provenance. The candidate-side sub-element types are broader than role or repo because the candidate is the longest-lived entity with the most sources of data feeding it.

**Core sub-element types:**

| Sub-element type | Source | Narrative shape |
|---|---|---|
| `Experience` | Resume, screening conversation | A professional role at a company. Captures: role title, company, company context (size, stage, industry), duration, team size and structure, scope of ownership, rich 2–3 sentence narrative of what they actually did and accomplished. |
| `Project` | Resume, screening, enrichment (GitHub projects), assessment | A specific project or initiative. What was built, why it mattered, technologies used, their specific role, outcomes, scale. |
| `Accomplishment` | Resume, screening | A concrete achievement with measurable outcome. What was achieved, quantified impact, their contribution, context. |
| `Skill` | Resume, screening, derived from assessments | Technology, methodology, or domain. Name, proficiency signal, evidence source (which Experience/Project demonstrates it), years of exposure, recency. Referenced via ESCO IDs where they exist. |
| `Education` | Resume | Institution, degree, field, dates, notable achievements. |
| `Credential` | Resume, enrichment | Certifications, publications, open-source contributions, talks, patents. What, where, when, context. |
| `CulturalSignal` | Screening (behavioural interview), culture interview | Competency dimensions (ownership, collaboration, learning-orientation, conflict-handling, self-awareness) and profile positions (autonomy, risk-tolerance, work-pace, collaboration-style, feedback-orientation). Each with BARS score, evidence quotes, confidence, reasoning. |
| `TechnicalDemonstration` | Code review transcript, implementation challenge telemetry | Specific demonstrated abilities from assessment work. Issue identification, reasoning quality, debugging strategy, AI collaboration pattern, TDD adherence. With evidence pointers to assessment session. |
| `WorkingStyle` | Screening conversation, behavioural patterns in assessments | How the candidate approaches work — pace, planning depth, iteration style, collaboration preference. Multiple sub-elements for different facets. |
| `CareerArc` | Resume trajectory + screening context | Narrative summary of career progression. Growth velocity, transitions, stated direction. |
| `Motivation` | Screening conversation | What the candidate is optimizing for in their next role. Growth, compensation, mission, autonomy, craft, impact. |
| `Context` | Screening, resume | Circumstances relevant to matching — location, availability, constraints, preferences for company size/stage/domain. |

Not every candidate will have every type. A candidate with no public data contribution won't have Credential nodes from enrichment. A candidate who hasn't completed a screening yet won't have WorkingStyle or Motivation nodes. The graph grows as evidence accumulates; missing types indicate thinness and should flag for the screening system to probe.

**Provenance, timestamps, confidence, supersedes:**

Every sub-element carries four metadata fields that the graph-shaped model requires:

- `source_type` — where this sub-element came from: `resume`, `github_enrichment`, `linkedin_enrichment`, `automated_screener`, `behavioural_interview`, `technical_interview`, `code_review_session`, `implementation_challenge`, `recruiter_note`, etc.
- `captured_at` — when the source was processed. Different from `created_at` because enrichment might process a GitHub profile from 2023.
- `confidence` — 0 to 1, how strong the signal is. Resume-derived "led payment integration" with no surrounding detail might be 0.5; screening-elicited STAR story with specific numbers is 0.9.
- `supersedes` — pointer to a prior sub-element that this one replaces. If a candidate's screening reveals their resume was inaccurate about a role's scope, the new Experience node supersedes the old one. Old one isn't deleted; it's marked superseded for audit.

This metadata is what enables temporal layering. The candidate's profile at any moment is the aggregation of non-superseded sub-elements with recency weighting. Old sub-elements stay queryable for audit purposes and for detecting drift over time.

**Storage shape (D1 transitional):**

```
candidate_nodes (
  id TEXT PK,
  candidate_id TEXT NOT NULL,
  node_type ENUM,
  narrative_text TEXT,
  extracted_properties_json TEXT,
  embedding_json TEXT,
  source_type TEXT NOT NULL,
  source_reference TEXT,           -- e.g., review_sessions.id, resume filename, github_url
  captured_at INTEGER NOT NULL,
  confidence REAL,
  supersedes TEXT REFERENCES candidate_nodes(id),
  superseded_at INTEGER,
  decomposition_version TEXT,
  created_at INTEGER,
  updated_at INTEGER
)

candidate_coverage (
  candidate_id TEXT PK,
  experience_coverage REAL,        -- 0-1 completeness per dimension
  cultural_coverage REAL,
  technical_coverage REAL,
  motivation_coverage REAL,
  context_coverage REAL,
  last_probed_at INTEGER,
  next_probe_target TEXT,          -- which dimension to probe next
  updated_at INTEGER
)
```

`candidate_coverage` is the dimensional completeness view that drives the screening system. More on this below.

In Vectorize, each sub-element gets its own vector in CANDIDATE_INDEX with metadata `{entity_type='candidate', candidate_id=<id>, node_type=<type>, source_type=<source>, confidence=<conf>, superseded=<0|1>}`. The metadata filters let matching queries scope to non-superseded sub-elements above a confidence threshold.

**The existing aggregate stays.** `candidate_ingestion.candidate_searchable_profile` and `candidate_ingestion.embedding_json` remain for backward compatibility with existing consumers (the vector-native ANN path, the exact cosine calculation in triangulation). They're now computed as aggregates over the non-superseded sub-elements rather than generated directly from the resume. The candidate still has a "whole-entity" view; it's just derived from the decomposition rather than computed separately.

---

## The screener design

The screener is the new system the platform needs. The behavioural interview infrastructure (`cultureAgent` + `cultureScorer` + `culture_compliance_audit`) is the production-grade foundation. The screener is a generalization of that infrastructure to support **role-agnostic profile building** in addition to its existing role-specific culture fit mode.

**What the screener does, in concrete terms:**

The screener is a conversational agent whose explicit goal is *graph construction*. Unlike a generic "tell me about yourself" agent, the screener operates against the candidate's current graph state. It sees what sub-elements exist, identifies coverage gaps along known dimensions, generates probes calibrated to fill specific gaps, processes answers through the decomposition pipeline to produce new sub-elements, and terminates when coverage is adequate or a turn budget is exhausted.

The dimensions it covers (the `candidate_coverage` table structure above):

- **Experience coverage** — are the Experience nodes on the candidate rich enough? Do they carry scope, team size, scale indicators, specific accomplishments? Or are they surface-level ("worked as engineer at company") that need deeper probing?
- **Cultural coverage** — does the candidate have CulturalSignal nodes across the 5 competency dimensions (ownership, collaboration, learning, conflict, self-awareness)? The screener uses the existing culture interview probes but in role-agnostic mode (no RCD overlay, no team-specific BARS overrides).
- **Technical coverage** — are Skill and TechnicalDemonstration nodes present with real depth? The screener probes for specific examples: "you mention Kafka on your resume — tell me about a specific problem you solved with it and what the failure modes were."
- **Motivation coverage** — why is the candidate looking, what are they optimizing for, what would a bad-fit role look like for them. This is where Motivation and WorkingStyle nodes get populated.
- **Context coverage** — location, availability, compensation expectations, company-stage preferences. Factual constraints that affect matching but don't usually appear on resumes.

**Two modes of operation:**

The screener runs twice in the candidate lifecycle, in two distinct configurations:

*Mode 1: Pre-match profile builder (role-agnostic).* Runs shortly after resume intake, before the candidate is matched to specific roles. The goal is broader, shallower coverage — build enough profile breadth that loose matching works reliably. 10–15 turns, BARS scoring runs but is advisory rather than role-calibrated, output sub-elements attach to the candidate with `source_type='automated_screener'`. No HITL gate on the output (the output isn't a hiring decision; it's profile enrichment), though the candidate's own view of what the screener captured should be available to them for correction.

*Mode 2: Post-match culture fit (role-specific).* This is the existing production culture interview. Runs after a candidate is matched to a specific role, with RCD overlay providing role-specific BARS anchors, dispositional weights, and probe bank enrichment. Output is HITL-gated and becomes part of the hiring decision record.

Same underlying infrastructure for both modes — same `cultureAgent.ts` core, same FSM, same scorer, same compliance audit. Configuration flag `screener_mode: 'profile_builder' | 'role_fit'` determines which probe bank, which BARS anchor set, whether RCD overlay applies, and whether HITL gating is required.

**The probe bank question.** For Mode 2, the existing `role_probe_bank` table already supports role-specific probes with `source='rcd_enriched'` and `rcd_version` stamp. For Mode 1, there's no equivalent — a role-agnostic probe bank needs to exist. It's a new `profile_probe_bank` table, curated upfront with probes designed to elicit signal across the five coverage dimensions without being role-specific. Each probe carries a `dimension` tag and an `expected_sub_element_types` array indicating what the answer should contribute to. Recruiter-approved probes only (NYC Local Law 144 and EU AI Act Art 14 compliance — no dynamic per-candidate generation, every probe traces to a finite approved bank).

**Gap identification logic.** At each turn, the screener queries the candidate's current graph:

1. For each coverage dimension, compute a completeness score from the non-superseded sub-elements tagged to that dimension (count, confidence, recency-weighted).
2. Identify the dimension with the lowest completeness that hasn't been exhausted in the current session.
3. From `profile_probe_bank`, select a probe tagged to that dimension, prioritizing probes that would produce sub-element types the candidate is thinnest on.
4. Ask the probe. Process the answer. Extract sub-elements via the same decomposition pipeline used for resumes.
5. Update coverage scores. Loop.

**Termination conditions** (mirroring `cultureAgent.ts` termination triggers):

- `coverage_complete` — all five dimensions reach adequate threshold AND minimum turns (8) have been asked
- `budget_exhausted` — hard cap at 20 turns, same as culture interview
- `bank_exhausted` — the probe bank runs dry for the dimensions that need more signal
- `candidate_disengaged` — idle timeout or explicit exit

**Answer decomposition.** Each answer is sent to the same LLM extraction pipeline used for resumes (but in single-answer mode rather than full-document mode). The output is a typed sub-element array. These attach to the candidate's graph with `source_type='automated_screener'`, `source_reference=<screening_session_id>`, confidence scored by the extraction LLM, captured_at set to the turn timestamp.

**Implementation path:**

This is a substantial build. Rough breakdown:

1. Generalize `cultureAgent.ts` into a mode-aware screener. The FSM stays; the probe selection and state tracking expand to handle `screener_mode`. Role-agnostic mode reads from `profile_probe_bank`; role-specific mode reads from `role_probe_bank` (current behavior).
2. Build `profile_probe_bank` with recruiter-curated probes across the five dimensions. This is content work, not code — 50–100 probes covering the dimensions with enough variety to run 10–15 turns without repetition.
3. Wire the decomposition pipeline for single-answer processing. This is a new prompt for Gemma that takes a screener answer and the current candidate graph state, produces sub-element JSON. Reuses the decomposition logic from resume extraction but scoped to a single answer.
4. Build `candidate_coverage` computation. A function that reads the candidate's non-superseded sub-elements and computes per-dimension completeness. Updated after each screener turn and after other sub-element sources (resume extraction, enrichment, assessment completion).
5. Add the mode-2 entry point to the recruiter UI — "invite candidate to screening" as an action separate from "invite candidate to assessment." The existing invite token and candidate JWT infrastructure works for this.
6. The screener lives in UAR when UAR is ready for it. The existing `cultureAgent.ts` bespoke path keeps running for role-specific mode 2 until UAR's culture plugin is real. Mode 1 can be built on the bespoke path first and migrated to UAR alongside the rest of the culture work.

**What mode 1 produces as output:**

Not a hiring recommendation. Not a score. The output of a Mode 1 screening is a set of new candidate sub-elements attached to the candidate's graph. The candidate's `candidate_coverage` row updates. The next loose-match recompute runs with the deeper signal. Recruiters see the candidate's profile has grown, not a screener "score."

This is architecturally important. Mode 1 is profile building; Mode 2 is hiring evaluation. The HITL gate, the recruiter review, the hiring recommendation — these all belong to Mode 2. Keeping Mode 1 as pure profile enrichment (candidate-facing, candidate-owned, no hiring-decision implications) is what makes it usable as a screening step without triggering the full legal and ethical apparatus of automated hiring decisions.

**Risk flag: double interview fatigue.** If a candidate goes through Mode 1 screening at intake, then Mode 2 culture interview after being matched to a role, they're doing two behavioural interviews. The Mode 2 interview needs to **consume what Mode 1 already learned** rather than re-asking the same questions. The Mode 2 agent prompt gets the candidate's existing CulturalSignal sub-elements as context and is explicitly instructed to skip probes that have adequate coverage already and to go deeper on dimensions where Mode 1 signal was thin. This keeps total candidate-facing time reasonable (Mode 1: 15–20 minutes, Mode 2: 15–25 minutes depending on coverage gaps) rather than doubling to 40+ minutes of interview.

---

## Public data enrichment

Separate from the screener, an enrichment pipeline scrapes public sources where candidates provide handles. This runs asynchronously after resume intake.

**GitHub enrichment** (highest value for developer candidates):

For a candidate who provides a GitHub handle, the enrichment worker fetches:

- **Owned repositories** — run a lightweight Pass 3-style decomposition on each. Owner's own repos get Feature, TechnicalStack, ArchitecturalPattern sub-elements attached to the candidate (not the repo — these are candidate's demonstrated abilities, not repo corpus entries). A candidate with a significant open-source project gets as much evidence from that project's decomposition as from three resume lines.
- **Contributions to others' repos** — lighter treatment. An Experience-like sub-element for each repo the candidate has contributed meaningfully to (defined by some threshold: 5+ merged PRs, sustained activity). Captures language, domain (from the target repo's Pass 3 if it's in Pipe's corpus), contribution type (bug fix, feature, docs).
- **Commit patterns** — languages used over time, commit frequency, longevity of engagement. Produces WorkingStyle sub-elements ("sustained contributor, consistent weekly activity over 3 years") or fades ("spike of activity 2022, quiet since").
- **README writing quality and issue discussion quality** — CommunicationStyle sub-elements derived from sampling the candidate's own writing in repo contexts.
- **Stars and followers** — a signal, not determinative. A candidate with a widely-starred project has different weight than a solo-contributor hobby project; the graph captures both.

**LinkedIn enrichment:** fraught. Scraping violates their ToS and is technically shaky. If the candidate pastes their LinkedIn profile URL in the intake form, a one-time consented extraction is okay (candidate has agreed to this by providing the URL with understanding of its use). Ongoing monitoring is not. My recommendation: no LinkedIn scraping. If the candidate wants LinkedIn signal in their profile, provide a one-time import feature where they consent to the import, and the extraction runs once at their initiation.

**Blog posts, talks, podcast appearances, conference content:** candidate-surfaced URLs. If the candidate provides URLs, the enrichment fetches them and decomposes into CommunicationStyle, TechnicalDemonstration, or Credential sub-elements depending on content. No automated discovery beyond what the candidate provides.

**Implementation:**

An `enrichment_jobs` queue in D1, triggered at intake when the candidate record has external URLs. A worker polls the queue, runs the appropriate extractor per source type, writes sub-elements back to the candidate's graph with `source_type='github_enrichment'` (or similar), tagged with `source_reference=<url>` for traceability.

This is its own workstream, probably 4–6 weeks of build time for GitHub alone. Lower priority than the screener if forced to choose — the screener is a must-have, the enrichment is a meaningful quality boost but not load-bearing for the architecture.

---

## Loose match

After intake and optionally after enrichment, before the screener, a loose match runs against open roles in the system. This is the existing matching pipeline from `matchReposForCandidate` generalized to matching against roles rather than repos.

**What loose match is for:**

The purpose is not hiring decisions. The purpose is routing — identifying which candidates are worth investing screening effort in, for which roles. A candidate who loosely matches no open roles might still enter the general candidate pool (depending on product design), but screening priority goes to candidates whose seed profile suggests alignment with active roles.

**How it works:**

Same per-element matching architecture that Part 5 details, but with acknowledged low confidence. The candidate's graph is thin (resume-only, pre-enrichment, pre-screening). Many requirements on a role have no candidate evidence to match against. The match score is discounted by a "evidence density" multiplier that reflects how much of the candidate's graph has been populated.

A candidate who loose-matches a role at 0.75 with thin evidence density gets flagged as "potentially strong match, needs screening to confirm." A candidate who loose-matches at 0.82 with dense evidence (rich resume + GitHub enrichment complete) is a stronger signal.

**Loose match triggers the screener invitation.** Candidates above the loose-match threshold for any open role are invited to the Mode 1 screener, with the screener's probe selection biased toward dimensions relevant to the roles they loosely match. "This candidate loosely matches a senior backend role needing payment systems experience — probe deeper on payment and backend experience dimensions" is a parameter the screener can consume.

---

## Deeper validation: code review and implementation challenge

After screening, candidates who continue to match well against specific roles (loose match + screening evidence = deep match above the assessment invitation threshold) are invited to the two-phase technical validation.

**Code review challenge** is production. Part 3 covered the repo-side work. The candidate-side integration:

When the code review session completes, `review_sessions.score_report` is written with the 6-dimension BARS scores. This score report is the current endpoint. **The new work is decomposing the transcript into candidate sub-elements** that persist beyond the session.

Each scored dimension (issue_identification, reasoning_quality, prioritization, question_formation, revision_evaluation, ai_direction) becomes a TechnicalDemonstration sub-element on the candidate's graph with:

- `source_type='code_review_session'`
- `source_reference=<review_session_id>`
- `narrative_text` derived from the transcript — specific evidence of the behavior ("In turn 3, candidate identified the race condition in the retry logic and correctly explained the fix path")
- `extracted_properties_json` including the BARS score, the effectiveness metrics (bugs_found_pct, false_positive_count, cave_ratio, fix_verifications), the implementer persona that was used, the challenge repo context
- `confidence` tied to scoring confidence

These sub-elements attach to the candidate's graph. Subsequent matching queries see them. A candidate with strong `issue_identification` demonstrated in a code review has better per-requirement matching against roles that require debugging competence.

**Implementation challenge** needs the Sherlock-based scorer (Part 3). Same decomposition pattern: each scored Sherlock dimension (Reasoning & Decomposition, Code Construction Process, Adaptability, Debugging & Maintenance) becomes a TechnicalDemonstration sub-element. Telemetry-derived features (TDD ratio, debug strategy pattern, AI collaboration style) become WorkingStyle sub-elements.

**The implementation scorer integration:**

`/rpc/score-submission` currently returns null. The new implementation:

1. When submission arrives, `ctx.waitUntil` triggers `scoreImplementationSubmission` in `lib/implementationScorer.ts`
2. The scorer reads the submission (code, virtual FS files), the dev container telemetry (filesystem events, git history, AI copilot interaction log), and the challenge repo context
3. Runs the four Sherlock dimensions through Gemma with detailed BARS anchors
4. Produces `ImplementationScoreReport` with per-dimension scores, evidence quotes from the telemetry, confidence, reasoning
5. Writes to `challenge_submissions.score_report_json`
6. Decomposes into TechnicalDemonstration and WorkingStyle sub-elements on the candidate's graph
7. HITL gate parallel to culture scoring — recruiter must confirm/override before candidate sees score

Cost metering via `aiUsage.ts` tagged `feature='implementation_scoring'`. Per-submission cost estimate: 4 Gemma calls (one per dimension) plus synthesis, ~30–60 cents depending on token volume.

**Culture interview integration:**

The existing culture interview already produces rich sub-element-like data (CompetencyScoreResult, CultureProfileScoreResult with evidence_quotes and reasoning). The decomposition work is minor — map these result objects to CulturalSignal sub-elements and attach to the candidate's graph with `source_type='culture_interview'`, `source_reference=<culture_interview_session_id>`.

Mode 1 and Mode 2 screenings both contribute CulturalSignal sub-elements. Mode 1's are role-agnostic; Mode 2's are role-specific with BARS overrides applied. The graph carries both with provenance, and matching against a specific role prefers Mode 2 sub-elements for that role when present (because they're calibrated to the team) while falling back to Mode 1 for dimensions that Mode 2 didn't cover.

---

## The living graph: temporal layering and supersedes

A candidate's graph at any moment is the set of non-superseded sub-elements. Supersedes pointers handle the case where new evidence replaces old.

**Examples of supersession:**

A candidate's resume says "Led team at Acme Corp." Screener reveals they were actually an IC, not a lead. The Experience sub-element from the screener supersedes the Experience sub-element from the resume. The old one is marked superseded with timestamp; it stays queryable for audit ("where did the original claim come from?") but doesn't contribute to matching.

A candidate's first screening captures their CulturalSignal dimensions with thin evidence. A later behavioural interview produces deeper evidence on the same dimensions. The later CulturalSignal sub-elements supersede the earlier ones for matching, but the earlier ones remain as temporal history ("this candidate's cultural profile has been stable across two screenings spanning 6 months").

A candidate's GitHub enrichment captures their projects as of intake. Six months later, they've completed a new significant project. A re-enrichment produces a new Project sub-element. It doesn't supersede the old ones (they're historical accomplishments that remain valid); it just adds to the graph.

**Re-engagement as a first-class product surface:**

When a candidate re-engages with Pipe (new role opens that loose-matches them, or the candidate updates their profile), the re-engagement triggers:

- Re-enrichment of public sources if URLs exist (new GitHub activity, new writing)
- An optional abbreviated Mode 1 screener focused on dimensions that have low recency (if last screening was 12+ months ago, probe motivation and context; skip dimensions that are still well-covered)
- Recompute loose match against any open roles
- Recompute match reports for any role the candidate is still actively considered for

The existing `candidates.status` state machine (`INVITED → IN_PROGRESS → COMPLETED | ABANDONED`) doesn't support this re-engagement model cleanly. It's single-role by design. A new state layer is needed — candidate-level status separate from per-role assessment status. This is schema work parallel to the decomposition: `candidate_profile_state` table tracking the candidate's overall relationship with Pipe, distinct from any specific role application.

**Temporal queries on the graph:**

"Show me this candidate's cultural profile trajectory" becomes a graph query walking CulturalSignal sub-elements ordered by captured_at, surfacing how specific dimensions evolved. "What's this candidate's Experience node distribution by company stage?" is a Cypher query over non-superseded Experience nodes grouped by extracted_properties_json → company_stage. These queries become natural once the graph substrate (Neo4j) is in place; they're painful in D1 + Vectorize orchestration.

---

## Candidate-side work, sequenced

**Phase 0 — Hygiene and cache wins:**

Cache `candidateSituationFit` by (candidate_id, repo_id, candidate_profile_version, signals_version). Invalidation when any of those bump. Simple key-value cache in D1 or KV. Saves meaningful Gemma cost on re-ingestion.

Fix the `candidate_searchable_profile` prompt in `lib/candidateDiscovery/prompts.ts` to inject `career_context_json`, `situation_signature_json`, and `key_concepts_json` content into the embedded narrative. This is a prompt-only change with no schema impact. Re-embed existing candidates via a backfill script following the `scripts/backfillRoleEmbeddings.ts` pattern. Single highest-ROI change available on the candidate side — the matching gets meaningfully better without any decomposition work.

Add embedding model version stamp to `candidate_ingestion`. Migration adds column. Extraction writes current version. Backfill sets existing rows.

**Phase 1 — Candidate decomposition (6–8 weeks):**

Rewrite `candidateDiscovery/prompts.ts` to produce structured decomposition — sub-element JSON rather than flat narrative. LLM prompt produces Experience, Project, Accomplishment, Skill, Education, Credential arrays with rich narratives and extracted properties.

New `candidate_nodes` table migration. Columns per the schema above. Indexes on `candidate_id`, `node_type`, `source_type`, `superseded_at` (null for active).

New `candidate_coverage` table migration. Coverage computation function runs after any sub-element write.

Update `lib/candidateDiscovery/embed.ts` to embed each sub-element separately, write to CANDIDATE_INDEX with metadata tags. Keep the aggregate `candidate_searchable_profile` and `embedding_json` updated as aggregates over sub-elements for backward compatibility.

Backfill existing candidates. Idempotent batch job that re-processes each candidate through the new decomposition pipeline. `decomposition_version` column tracks completion. Run over days, not hours; budget for Gemma cost.

Update `candidateSituationFit` and `matchReposForCandidate` to optionally consume sub-elements when present, falling back to aggregate profile when not. Progressive migration; matching gets richer as decomposition completes per candidate.

**Phase 2 — Public data enrichment (4–6 weeks):**

Build `enrichment_jobs` queue and GitHub enrichment worker. Same decomposition pipeline as resume extraction but scoped to GitHub API output. Sub-elements attach with `source_type='github_enrichment'`.

Wire intake form to accept GitHub handle (plus any other URLs candidate chooses to share). Enrichment triggers asynchronously after resume intake completes.

Candidate-facing profile view showing what's been captured, with ability to correct or add. This is product UI work — candidates should see their graph and participate in its accuracy.

**Phase 3 — Screener (6–10 weeks):**

Generalize `cultureAgent.ts` into mode-aware screener. Build `profile_probe_bank` with ~100 probes across coverage dimensions. Implement coverage computation and gap identification. Wire to UAR when UAR's culture plugin goes real (or keep on bespoke path in parallel until UAR is ready).

Recruiter UI for "invite candidate to screening" as distinct from "invite candidate to assessment."

HITL policy: Mode 1 output is profile enrichment, no HITL. Mode 2 output is hiring-relevant, full HITL gate (already in production).

**Phase 4 — Assessment decomposition (4–6 weeks):**

Extend `scoreAndPropagate.ts` (code review) to decompose transcript into TechnicalDemonstration sub-elements alongside the existing score report write.

Build `lib/implementationScorer.ts` with Sherlock-based rubric. Wire into `/rpc/score-submission`. HITL gate. Decompose into TechnicalDemonstration and WorkingStyle sub-elements.

Extend culture scoring to write CulturalSignal sub-elements from the existing `CompetencyScoreResult` and `CultureProfileScoreResult` outputs. Map role-specific (Mode 2) culture results with `rcd_version` and `role_context_id` as properties on the sub-elements.

**Phase 5 — Graph migration.** All candidate sub-elements become `:CandidateNode` in Neo4j with type-specific sub-labels. Temporal queries and evidence aggregation happen in Cypher. Details in Part 5.

---

## The UAR culture plugin: what needs to be reconciled

The reference documents flagged that `lib/agents/culture/plugin.ts` lists scoring dimensions that don't match live `cultureScorer.ts`. The stub references `adaptability`, `clan_affinity`, `adhocracy_affinity`, etc., while the live system uses the 5 competency + 5 profile dimensions. This stub will mislead anyone wiring UAR to production.

**The reconciliation:**

First, the UAR culture plugin's stub dimensions are replaced with the live dimensions. The 5 competency (ownership, collaboration, learning-orientation, conflict-handling, self-awareness) and 5 profile (autonomy, risk-tolerance, work-pace, collaboration-style, feedback-orientation) become the UAR plugin's scoring config.

Second, when the UAR culture plugin transitions from mock stub to real implementation, it should ideally build **fresh on UAR** rather than migrating from the bespoke `cultureAgent.ts`. The legacy path is production-complete and works well; migrating it is risky and doesn't unlock new capability. A fresh UAR implementation can coexist with the legacy path, run dual-path for parity checking, and cut over only when parity is validated.

Third, the screener Mode 1 (role-agnostic profile builder) is a cleaner candidate for the *first* real UAR implementation of the culture plugin — it's new functionality that the legacy path doesn't provide, so there's no parity-checking risk, and building it on UAR from the start avoids future migration debt.

So the UAR culture migration has a natural sequencing: build Mode 1 fresh on UAR → validate in production → migrate Mode 2 (legacy culture interview) to UAR with dual-path parity checking → retire legacy. This aligns with ADR-034's Phase 4 but reorders the work.

---

## Honest caveats

**Decomposition cost is real.** Extracting rich sub-elements from resumes costs more than generating one flat narrative. Each candidate goes from one Gemma call (~2K in / 1K out) to one call with longer structured output (~2K in / 3–5K out) plus potentially multiple calls if decomposition runs per section. Budget 3–4× the current per-candidate extraction cost. At your stage the math is fine; at enterprise scale it matters.

**Screening is not free for candidates either.** A 15–20 minute Mode 1 screening on top of a resume intake is a meaningful friction add. Product design has to make the value proposition clear — the candidate gets a richer profile that works for them across opportunities, not a gate they have to pass. Candidates who don't want to screen should still be accepted into the pool; they just match with lower confidence until they engage more. Making screening feel like career-building rather than hiring-gatekeeping is product work that the architecture enables but doesn't by itself deliver.

**Enrichment is legally and ethically nuanced.** GitHub is public, ToS-permitted, candidate-surfaced. Fine. LinkedIn scraping is neither ToS-permitted nor ethically clean. Deep background research on candidates beyond what they surface crosses a line. The framing throughout has to be: the candidate is building their own profile with Pipe's help, and Pipe is assisting by processing what they provide. It is not Pipe as investigator.

**The living graph has privacy implications.** A candidate's profile persisting indefinitely across roles is a feature, but it's also a data-minimization concern under GDPR. Candidates need ability to delete their profile (and have the deletion propagate to superseded sub-elements and assessment records subject to legal retention requirements). The 7-year EEOC retention on `culture_compliance_audit` is a known constraint; align candidate-facing deletion UX accordingly ("delete my active profile; assessment records retained per legal requirements for X years then deleted").

**The screener Mode 1 product risk.** If Mode 1 screening doesn't feel useful to candidates — if they see it as "another interview" rather than profile building — completion rates will be low and the enrichment won't materialize. UX design matters more than architecture here. Candidates need to see immediate value from the screening: their profile gets richer, they see how it grew, it's portable to them (exportable if they want to use it elsewhere). The technical substrate supports this; the product has to execute on it.

**Candidate self-service is out of scope here but inevitable.** The current model is recruiter-invoked intake. Long-term, candidates will self-serve onto the platform — build their profile, see their match surface across Pipe's role corpus, apply selectively. The architecture is designed to support this (sourcing is a pluggable entry point, the candidate is a first-class entity with a persistent graph). But the product mechanics of self-service — candidate onboarding, privacy controls, the candidate's view of their own graph — aren't detailed here. They're their own product surface, probably phase 6+.

---

*End of Part 4.*
