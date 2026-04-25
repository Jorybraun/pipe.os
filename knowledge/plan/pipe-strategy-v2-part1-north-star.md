# Pipe Strategy v2 — Part 1: North Star and Current State
*Synthesized from the 100-Agent Research Swarm report, current-state engineering references (2026-04-24), and working session April 2026.*

---

## Reading guide

This is Part 1 of 5. It replaces the original four-part strategy entirely. The original was written without visibility into what you'd actually built; this version starts from ground truth and synthesizes the research base against it.

**Status tags used throughout all five documents:**
- **[ACTIVE]** — priority work, implement now
- **[IN-FLIGHT]** — scaffolded in code but not yet production (UAR plugins, evaluator.ts, etc.)
- **[LEGACY-REPLACING]** — currently production, will be superseded
- **[DEFERRED]** — good idea, wrong time; revisit after validation
- **[PARK]** — speculative; not pursuing

**Documents in this series:**
1. North Star and Current State *(this document)*
2. Role Discovery Pipeline
3. Repo Ingestion Pipeline
4. Candidate Ingestion Pipeline
5. Matching Architecture and Infrastructure Migration

---

## The product, restated

Pipe is an AI-native developer hiring platform that reasons about fit through structured decomposition of three entity types — candidates, roles, and repos — and triangulates matches using semantic similarity, structured signals, and evidence-grounded LLM reasoning. Matching is not keyword overlap or whole-entity embedding; it is per-element alignment with evidence attribution.

The product exists because hiring decisions made on resume parsing and generic rubrics cause real harm — to candidates filtered out on surface features and to companies making expensive mistakes. Pipe's bet is that you can do meaningfully better by capturing structural richness at ingestion, maintaining candidate profiles as living graphs that grow through multiple data sources over time, and producing auditable match reports that hiring teams can trust and override.

Three things follow from this framing that shape everything downstream:

**Candidates are not applications; they are ongoing relationships.** A resume is a seed, not a profile. Real candidate signal comes from structured screening conversations, public data enrichment, and performance on authentic work. The candidate's profile deepens over months and across roles. This requires a substrate that supports temporal layering, provenance tracking, and accumulating evidence.

**Roles are not job descriptions; they are synthesis artifacts.** The Role Context Document (RCD) captures a hiring team's actual intent through a structured discovery interview — multi-stakeholder perspectives, laddering chains (attribute → consequence → value), dealbreakers with job-relatedness notes, BARS anchor overrides calibrated to this specific team. This is already built and serving production.

**Repos are not keyword-tagged lists; they are decomposed engineering artifacts.** The three-pass crawler already produces rich Pass-3 narratives with labeled fields (language, domain, architecture, seniority signal, test culture, challenge surfaces). The work ahead is exposing the sub-elements as addressable nodes rather than concatenating them into a single blob.

These three entity shapes, matched per-element with evidence structure, are the core architectural commitment.

---

## North-star architecture

**The commitment.** A knowledge graph substrate where candidates, roles, and repos are decomposed into semantically-rich sub-elements, each carrying its own embedding and structured properties, with relationships modeled as first-class edges. Matching happens at the sub-element level and aggregates into per-requirement scores with full evidence traceability. The aggregate score remains for legacy consumers, but the **match report — not the match score — is the primary output**.

**The target storage.** Self-hosted Neo4j Community Edition on a VPS. Called from Cloudflare Workers over HTTPS using the official JavaScript driver. Approximately €25–50/month of infrastructure for the scale you'll operate at in the next 18 months. Full Cypher expressiveness, native vector indexes on node properties, real graph traversal for queries that go beyond one hop. Migration is phased — existing D1 and Vectorize stay running until Neo4j is populated and validated against real queries.

**What stays on Cloudflare.** Everything currently in Workers — API surface, authentication, job orchestration, email, dev containers, voice sessions. D1 remains for transactional operational data (candidates table, pipelines, stages, assessments, challenge_submissions, session stores, compliance audit trails). R2 stays for resume blobs and media. Workers AI stays for embedding generation and model routing to Vertex AI Gemma for the bulk of LLM work. Vectorize becomes a deprecated path once Neo4j's vector indexes are serving matching, but it doesn't need to be retired immediately.

**What moves to Neo4j.** The decomposed entity graph. Candidate sub-elements (Experience, Project, Accomplishment, Skill, Credential, CulturalSignal, TechnicalDemonstration). Role sub-elements derived from RCD (Requirement, Responsibility, CulturalSignal, TeamContext, Dealbreaker, TechnicalContext, CodebaseExpectation). Repo sub-elements derived from Pass-3 (Feature, ArchitecturalPattern, TechnicalStack, ChallengeSurface, QualitySignal, DomainContext). Relationships between them (Candidate-HAS-Experience, Experience-DEMONSTRATES-Skill, Role-HAS-Requirement, Requirement-SOURCED-FROM-Stakeholder, etc.). All sub-elements carry embeddings as node properties, enabling Cypher queries that combine structural traversal with vector similarity in a single statement.

**Why graph over the hybrid.** The matching you're building isn't "find similar entities." It's "for each requirement, find the specific sub-elements across the candidate's history that address it, with evidence, accumulating partial matches across a non-trivial structure." This is a graph problem expressed badly in SQL and awkwardly in application-layer orchestration. It is expressed well in Cypher. As signals accumulate — culture interview outputs, code review transcripts, technical interview claims, assessment telemetry — the candidate's graph grows in ways that benefit from proper graph queries (trajectory analysis, cross-assessment evidence aggregation, multi-hop reasoning through shared companies or technologies). The infrastructure cost is manageable; the expressive gain is substantial.

**Why not AuraDB or Turso or pgvector.** AuraDB is fine but pricing grows steeply past the free tier, and self-hosted Community gives you full capability for ~€10–50/month. Turso is a strong alternative (SQLite + vectors in one database) but doesn't give you Cypher or real graph traversal, which is the specific expressive power you're buying. pgvector is mature and cheap but the hybrid-graph-in-Postgres pattern relies on recursive CTEs that get awkward as the graph deepens; if you wanted Postgres you'd want a dedicated graph extension like Apache AGE, which is less battle-tested than Neo4j. The cost premium of self-hosted Neo4j over these is small; the capability premium is real.

---

## The candidate lifecycle, end-to-end

Before the architecture details, here is the north-star shape of what happens to a candidate. This drives every downstream design decision.

**Intake.** Candidate enters Pipe via a form (currently recruiter-invoked, but the system is designed so sourcing is a pluggable entry point — self-serve, referral, automated outreach, and other flows can be added without changing the downstream pipeline). A resume, a LinkedIn URL, a GitHub handle, or some combination is provided. Whatever seed data exists is extracted into an initial candidate graph — Experiences, Projects, Skills, Accomplishments, and any other sub-element types the extraction produces.

**Enrichment.** Public data sources are scraped where the candidate has provided handles. GitHub is the richest: owned repositories get Pass-3-style decomposition into Features and TechnicalStack and ChallengeSurface sub-elements linked to the candidate. Contributions to others' repos get lighter treatment. Writing (blog posts, talks, threads) becomes CommunicationStyle sub-elements. All enrichment-derived sub-elements carry provenance tags distinguishing them from resume-derived and screening-derived nodes.

**Loose match.** With the initial graph populated, the candidate is scored against open roles in the system using the per-element matching architecture. This is a low-confidence match because the candidate graph is thin — one data source, no screening, no validation. The purpose is not to make hiring decisions; it is to identify the candidates whose seed profile suggests reasonable alignment, so the platform knows which candidates are worth investing screening effort in.

**Screening.** Candidates above the loose-match threshold for any role (or meeting some general intake threshold if no roles match yet) are invited to the automated screener. The screener is a structured conversational agent whose job is graph construction — it identifies coverage gaps in the candidate's current graph, generates calibrated probes to fill them, and decomposes the answers into new sub-elements with provenance marking them as screening-derived. The screener runs until coverage across required dimensions reaches a confidence threshold, or a turn budget is exhausted, or the candidate disengages. The behavioural interview infrastructure already built (cultureAgent + cultureScorer + the compliance audit trail) is the production-grade foundation for this screener, extended to support role-agnostic profile building alongside its existing role-specific culture fit mode.

**Deeper validation.** Candidates who pass screening and match well against specific roles are assigned the two-phase technical validation: the multi-turn code review challenge against a repo PR (already production, ADR-032 scoring) and the implementation challenge against an authentic open-source issue (repo assignment is production, scoring is a gap). Each produces structured evidence sub-elements that attach to the candidate's graph with provenance marking them as assessment-derived. The matching re-runs with the deeper signal, typically with meaningfully higher confidence.

**Ongoing relationship.** The candidate's graph persists. When new roles open, the matching engine queries against the accumulated graph without requiring the candidate to re-engage. Over time, candidates can opt into updates — new experiences, new projects, updated availability — which extend the graph. Old signals aren't deleted; they're superseded via explicit pointers, preserving audit history while allowing current state to reflect the latest evidence.

**Scoring and decision is out of scope for this document.** This is Part 1 of a strategy; scoring mechanics, rubric calibration, hiring outcome validation, and recruiter feedback loops are designed later. What matters now is that the graph, the screening loop, and the matching architecture create the substrate on which good scoring becomes possible.

---

## What's actually built today

The engineering reference documents (2026-04-24) establish the ground truth. A summary, organized by whether it's production, scaffolded, or gap:

**Production-complete (serving real traffic):**

Role Discovery runs today via a legacy turn-based agent (`lib/roleAgent.ts`) with 8 deterministic probes across 6 domains, synthesizing a RoleContextDocument that includes the domain matrix (6 domains × up to 4 stakeholders), conflict records, dealbreakers with evidence quotes and job-relatedness notes, BARS overrides, dispositional weights, and a derived consumer_slice that carries the legacy `CandidatePersona` shape. The RCD is persisted to D1 and is genuinely rich.

The repo crawler runs all three passes. Pass 1 searches GitHub broadly, Pass 2 clones and extracts 57 deterministic construct signals plus complexity metrics and PR samples, Pass 3 uses Vertex Gemma 4 26B to produce the `repo_searchable_profile` (labeled template: Language, Domain, Architecture, Seniority signal, Test culture, Key technologies, Challenge surfaces, Summary, PR shape, Key concepts) and embeds it into REPO_INDEX. Pass 3 auto-chains from Pass 2 with `skipVectorize=true` — embeddings only flow into the index when a human runs Pass 3 manually, which is the current corpus-growth bottleneck.

The candidate ingestion pipeline is an 11-step orchestration: upsert → discover profile via Gemma → persist → embed → mark embedded → match repos (vector-native primary with SQL guardrail, philosophy-aware blending at 0.3 or 0.5) → load role alignment → situation fit via Gemma → triangulate with four signals → assign challenge → mark matched. ADR-040 dual-layer storage is in place (vectors in Vectorize plus ground-truth JSON in D1 `embedding_json` columns).

The code review challenge is live. Implementer agent (Qwen 2.5-Coder 32B via Workers AI, mock fallback) runs up to 4 turns per session, candidate emits comments, implementer responds with `comment | change | pushback`, RCD dispositional_weights shape the persona. Scoring runs ADR-032's 6-dimension BARS rubric with scorer A handling ground-truth-scorable dimensions and scorer B handling judgment dimensions, composite at 0.85×BARS + 0.15×effectiveness, with the dispositional weights shifting dimension emphasis ±50% clamped to [0.5, 1.5]. HITL gate is live.

The culture interview is production-complete. Bespoke (not yet on UAR) FSM-driven agent — Gemma 1 call per turn with STAR slot analysis, probe decision, coverage tracking, termination at coverage-complete or hard cap of 20 questions. Scorer runs 11 calls (5 competency + 5 profile + synthesis). Competency dimensions: ownership, collaboration, learning-orientation, conflict-handling, self-awareness. Profile dimensions: autonomy, risk-tolerance, work-pace, collaboration-style, feedback-orientation. Dealbreakers raise HITL flags but never auto-fail (Griggs / EEOC / NYC Local Law 144 / EU AI Act Art 14 compliance). Full compliance audit trail in `culture_compliance_audit` with 13 event types. Cost metering per LLM call via `culture_ai_usage_events`.

Match config wizard (ADR-039) supports three philosophies: validate, tailored, hybrid. Triangulate combines role-repo alignment, candidate-repo fit, role-candidate cosine, and skill coverage with philosophy-specific weights.

Ops: two cron-driven crawlers (issue crawler Sunday 03:00, issue scorer Sunday 04:00), Resend/Gmail/Microsoft email with OAuth, Clerk recruiter auth, custom JWT for candidate/participant, QUIZ_MCQ deterministic scoring, admin repo approval queue, 42 migrations in D1.

**Scaffolded, not yet wired:**

The Unified Agent Runtime (ADR-034, proposed 2026-04-23) has its runtime foundation complete — FSM, provider wrapper with retry/timeout/force-JSON, per-turn eval gate, end-of-session multi-dimension scoring with evidence grounding and -0.3 confidence penalty for ungrounded scores, in-memory and D1 session stores, plugin registry. Three plugins exist (role_discovery, code_review, culture_interview) registered via `registerAllPlugins()`. **All three plugins' `generateTurn` are mock stubs returning "Mock question #N".** Route (`routes/agents.ts`) is mounted but has no auth middleware. Session store hardcoded to in-memory. Migration 0043 (`agent_sessions`) is written but not applied. Phase 1 done; phases 2–5 (role discovery migration, code review migration, culture fresh build on UAR, session table unification) are all not done.

Role discovery has a scaffolded evaluator pipeline (`lib/roleDiscovery/evaluator.ts`, `evaluatorPrompt.ts`) with **broken imports** — references `CandidateQuestion`, `DomainCoverage`, `EvalResult`, `RoleExchange` types that aren't defined in `types.ts`. Will fail `tsc --noEmit`. No callers. The internal shared-secret evaluator route (`routes/internal/evaluateDiscovery.ts`) exists but is **not registered in `index.ts`** — dead code.

**Known gaps (not built):**

LLM scoring for CODE_IMPLEMENTATION submissions (score is always null, set only via recruiter PATCH).

LLM scoring for QUIZ_SHORT_ANSWER submissions (score is always null).

Issue body pre-fetch for implementation challenges — candidate is handed "Implement issue #N on <url>" and has to navigate independently.

RCD consumer cutover is incomplete. `cultureRoleResolution.ts` reads RCD as primary. `autoStageBuilder.ts`, `repoDiscovery/discover.ts`, and cockpit routes still read the legacy `persona_json` column or the `consumer_slice` fallback.

Dealbreaker gatekeeping enforcement in scoring — records carry evidence quotes and job-relatedness notes, but no scoring-layer gate actually uses them to fail matches or flag assessments. `cultureScorer.ts` is the only consumer, and it raises `hitlReviewRequired: true` without auto-failing (which is correct for legal defensibility but incomplete as a system).

Re-prompt on ungrounded culture scores (ADR-029 §6) — empty `evidenceQuotes: []` is silently accepted.

Culture question bank is a TypeScript constant in `cultureQuestionBank.ts`, not synced to D1.

Vector signal slots in `triangulateMatch` are wired as `VECTOR_WEIGHTS` preset (vector_role_repo, vector_role_cand, vector_cand_repo at 0.05 each) but `orchestrate.ts` never passes these parameters. The `match_feedback` table lacks the columns to track them. Unreachable from the current orchestrator.

Role embeddings in `ROLE_INDEX` store the JD-based text (`buildRoleSearchableProfile`), not the RCD-narrative (`buildRcdSearchProfile`). The RCD narrative is only used as query text into `REPO_INDEX`. This means `role_candidate_cosine` in triangulation compares thin candidate prose against JD-thin role prose, not against the structural RCD depth.

No embedding-model version stamp anywhere in D1. Profile versions exist (`candidate-v2`, `signals_v2.0.0`) but nothing tracks which BGE version produced the stored vector. Swapping BGE would leave stale vectors undetectable.

Three embedding call sites bypass `preprocessForEmbedding` — `adminRepos.ts:698`, `adminRepos.ts:1136`, `discover.ts:414`. Inconsistent preprocessing creates subtle vector-space drift.

Skill-slug normalization fails silently in `matchRepos.ts` — if `skill_aliases` lookup fails, it falls back to `skill.toLowerCase()`, so "Node.js" becomes "node.js" and won't match a repo tagged "nodejs". Pipelines dead-end with zero matches when even one must-have skill fails normalization.

`autoStageBuilder.ts` is hardcoded to TypeScript/general (`DEFAULT_LANGUAGE='typescript'`, `DEFAULT_DOMAIN='general'`). Does not read RCD. Does not use vectors. Comment: "v2 wires it."

`candidateSituationFit` is not cached. Every ingestion pays the full Gemma cost even for the same candidate-repo pair.

Staging and test environments have D1, R2, and Vectorize bindings commented out in `wrangler.jsonc`. Staging effectively shares production D1, which is a deployment hazard.

**Compile/correctness concerns:**

`lib/roleDiscovery/evaluator.ts` and `evaluatorPrompt.ts` have broken type imports. `tsc --noEmit` will fail.

`agents/culture/plugin.ts` lists scoring dimensions that don't match live `cultureScorer.ts` — the stub references `adaptability`, `clan_affinity`, `adhocracy_affinity`, etc., while the live system uses `ownership`, `collaboration`, `learning-orientation`, `conflict-handling`, `self-awareness` for competency and `autonomy`, `risk-tolerance`, `work-pace`, `collaboration-style`, `feedback-orientation` for profile. The stub will mislead anyone wiring UAR to production.

---

## The central diagnosis

The infrastructure is not the problem. The matching substrate is competent — BGE at 1024 dimensions, three Vectorize indexes with asymmetric prefixing done correctly, ADR-040 dual-layer storage, philosophy-aware triangulation. You have built significantly more than most teams at your stage.

**The problem is that structural richness is being collected and then dropped on the floor before it reaches the matching layer.**

Specifically:

The RCD is rich. The RCD is stored. The RCD is **explicitly flattened** by `buildRoleSearchableProfile` into JD-based prose for ROLE_INDEX, and the richer `buildRcdSearchProfile` narrative is only used as query text, never stored. Laddering chains, per-stakeholder domain cells, dealbreakers, red_flags, probe_bank_enrichment are all **explicitly excluded** from search profiles. Comments in the code claim they're "applied as filters downstream" but no downstream filter reads them — `cultureScorer.ts` is the only structural consumer, and it's advisory-only.

The candidate is the thinnest of the three entities. `candidate_searchable_profile` is a 400–600 word prose narrative. The LLM already produces `career_context_json`, `situation_signature_json`, and `key_concepts_json` in the same call — these contain company stage exposure, scale signals, primary challenge types, architecture exposure, test culture exposure, review culture, impact signals, must-have and nice-to-have skills, detected domain. **None of this is injected into the embedded text.** It all sits in adjacent D1 columns, unread by matching.

The repo is structurally richest (labeled template via Gemma, with fields for architecture, challenge surfaces, engineering narrative), but it's still one blob per repo. Features, architectural patterns, technical stack components, quality signals all concatenate into a single narrative. When a role has a specific requirement about event-driven architecture, the matching can't find repos that specifically exercise event-driven patterns; it can only find repos whose overall narrative is similar to the role's overall narrative. This is the dominant failure mode in repo matching quality.

The UAR migration is ambitious and architecturally sound but has stalled at Phase 1. The three plugins are mocks. Culture interview runs on the legacy bespoke path (which works well). Code review runs on the legacy implementer agent (which works). Role discovery runs on the legacy turn-based agent (which works). The new runtime exists as infrastructure without agents; the new agents exist as infrastructure without logic. Migrating one pipeline at a time into UAR is the right call, but it isn't happening.

Four-signal triangulation is a reasonable aggregation, but it's producing scores without producing evidence. Recruiters see a number; they don't see the case. Per-requirement match reports with attribution to specific candidate sub-elements — which is what decomposition enables — would transform the output from opaque to auditable.

These are all the same underlying issue at different layers: **structured signals are being collected but not consumed.** The fix is not infrastructure migration. The fix is decomposition of the entities that are currently flat, consumption cutover for signals that already exist, and matching-layer rewrites that read the structural depth rather than flattening it.

Neo4j migration is the *endpoint* of this work, not the *beginning*. The decomposition has to happen in the extraction and schema layer first, on the existing infrastructure; once that's working, the migration to Neo4j is a port of a graph-shaped data model into a graph database. Doing it in the opposite order — migrate first, decompose later — multiplies the work and defers the actual quality improvements.

---

## The phased direction

A ten-to-fourteen month trajectory, with rough sequencing. Each phase defers to the next only when the earlier work is validated.

**Phase 0 — Consumption cutover and production hygiene (4–6 weeks).** Finish what exists. Get RCD consumers off `persona_json`. Wire the vector signal slots in triangulation. Store the RCD narrative in ROLE_INDEX (not just as query text) so role-candidate cosine compares against structural depth. Wire dealbreaker gate enforcement. Fix the broken evaluator imports or delete the dead code. Add embedding model version stamps. Normalize the three bypass call sites. Add the skill_aliases unknown-slug alerting. Ungate Pass 3 vectorize via confidence thresholds rather than manual admin verdict. These are not glamorous but they compound: consuming existing signal moves matching quality materially without building anything new.

**Phase 1 — Candidate decomposition (6–8 weeks).** Rewrite `candidateDiscovery/prompts.ts` to produce structured decomposition (Experience, Project, Accomplishment, Skill, Credential, etc.) rather than a flat narrative. New `candidate_nodes` table with per-sub-element rows, embeddings, provenance. Backfill existing candidates. Keep `candidate_searchable_profile` as the aggregate for legacy consumers during transition. Details in Part 4.

**Phase 2 — Role and repo decomposition (4–6 weeks).** RCD already has the structural depth; the work is exposing sub-elements as first-class rows alongside the existing `role_contexts` row. Details in Part 2. Pass-3 repo output needs restructuring from labeled blob into per-feature sub-elements with separate embeddings. Details in Part 3.

**Phase 3 — Per-element matching rewrite (4–6 weeks).** Rewrite the matching layer to operate on sub-elements rather than whole-entity vectors. Evidence-structured match reports become the primary output; triangulated scores become a summary layer on top. Details in Part 5.

**Phase 4 — Screener consolidation and UAR migration (6–10 weeks).** The behavioural interview infrastructure becomes the automated screener, running twice per candidate (loose pre-match, role-specific post-match). UAR plugins transition from mock to real, starting with culture (fresh build is cleaner than migrating the bespoke path) and then code review. Role discovery migration to UAR follows last. Details in Part 4.

**Phase 5 — Graph DB migration (6–10 weeks).** With decomposition done on existing infrastructure, entities are already graph-shaped. Stand up self-hosted Neo4j Community on a VPS. Dual-write from ingestion to both D1+Vectorize and Neo4j. Validate matching parity by running both paths and comparing results. Cut matching reads over to Neo4j. D1+Vectorize retention for legacy consumers and audit trail. Details in Part 5.

**Phase 6 — Scoring maturity and validation (ongoing).** Kappa calibration study (Cohen's κ for single-rater, Fleiss' κ for multi-rater consensus). Golden set regression testing. Recruiter feedback loops wired into per-dimension calibration. Hiring outcome tracking where permitted. QWK floors tightened as calibration improves. This is out of scope for this strategy but the architecture is designed to support it.

Total: 30–50 weeks of focused work, compressible with agentic capabilities but not by order of magnitude. This is a real product build, not a weekend refactor.

---

## What's being preserved from the original research

The original research swarm's findings remain valid where they addressed problems that still exist, revised where the ground has shifted, and dropped where your system already solves them or the investment isn't justified at current stage.

**Preserved and integrated throughout these documents:**

The Sherlock AI scoring framework (Reasoning & Decomposition, Code Construction Process, Adaptability Under Constraint Change, Debugging & Maintenance Awareness) is directly applicable to the missing CODE_IMPLEMENTATION scorer. Part 4 wires this into the implementation challenge pipeline.

Core-O's decomposition discipline (competence / skill / knowledge / attitude / task / resource / artifact distinctions) shapes the sub-element type taxonomy across all three entities. Not adopted as a normative ontology, but used as a vocabulary for thinking clearly about what each sub-element represents.

ESCO's skill vocabulary provides a ready-made tag set for ~500 developer skills, reducing the extraction prompt burden. Sub-element Skill nodes reference ESCO IDs where they exist and extend with Pipe-specific terms where they don't.

The "Rubric Is All You Need" finding validates the existing heavy investment in BARS anchors (ADR-032 for code review, `COMPETENCY_BARS_RUBRICS` for culture). The Leniency metric from that study is added to the calibration dashboards as a supplementary signal alongside QWK and Cohen's κ.

CodeSignal AI Interviewer's phased calibration model (pilot → tuned → monitored → revision) becomes the operational framework for ongoing rubric maintenance. Culture already operates this way informally; formalizing it with explicit "rubric lock" milestones extends the discipline to code review and the eventual implementation scorer.

Cohen's κ (single rater) and Fleiss' κ (multi-rater consensus) complement the existing QWK target in culture scoring. QWK stays at its 0.55 floor and 0.60 aspirational target; κ is added for recruiter-agreement tracking, with interpretation thresholds per the standard literature (<0.20 none, 0.21–0.40 fair, 0.41–0.60 moderate, 0.61–0.80 substantial, >0.80 almost perfect).

Retry-with-exponential-backoff, circuit breakers per provider, and idempotency keys remain valid for pipeline reliability. Despite ADR-040 landing, the orchestration doesn't yet shield LLM calls from transient failures. Part 5 integrates provider-specific retry parameters (Vertex AI 429 backoff: 2s/4s/8s/16s/32s, Workers AI 3050 fixed at 30s for cold starts).

Hierarchical summarization for multi-turn transcripts remains relevant for long-horizon culture interviews and code reviews. The existing explainer agent role in the legacy pipeline can be repurposed once UAR is live. Detail deferred until UAR migration.

OpenTelemetry gen_ai semantic conventions are the right target for when you add structured observability. Currently all logging is console.error/console.warn tailed via Cloudflare Workers Logs. Not blocking now, but Part 5 frames it as an observability maturity axis.

Skill adjacency modeling maps to the `skill_aliases` silent-fallback failure. Hand-curated adjacency table for the top ~50 framework groupings (React/Vue/Angular/Svelte, Postgres/MySQL/SQLite, AWS/GCP/Azure, etc.) with graded weights is the pragmatic first pass. Part 3 covers this.

Fairness framework — conditional statistical parity, equal opportunity, equalized odds — is increasingly urgent as the platform approaches real hiring decisions. NYC Local Law 144 and EU AI Act Art 14 already shape culture architecture (recruiter-approved finite question bank, HITL gate, never-auto-fail dealbreakers). This hardens as the screener expands and the matching surface grows. Part 4 and Part 5 integrate.

**Revised in light of current state:**

Unified competency signal ontology work — you have RCD. The work is applying the RCD treatment to candidates (currently flat) and consuming the rich RCD in matching (currently flattened). Part 2 and Part 4.

Resume parsing robustness — still valid for the parsing layer, but not the leverage point. The bigger issue is that resumes are thin artifacts regardless of how cleanly they're parsed. Part 4 frames resume as seed, not profile.

Matching recommendations around skill adjacency and late fusion — valid but need reframing. You already have vector-native primary, SQL guardrail, triangulation with philosophy weights. The work is fixing specific gaps (vector signal slots unpopulated, role-candidate cosine comparing thin-to-thin, dealbreakers advisory-only). Part 5.

**Dropped:**

Keystroke biometrics (parked — GDPR Article 9 complexity outruns the 1–8% EER gain).

Adversarial debiasing (deferred — monitoring first, constraint optimization later; adversarial much later).

Multi-LLM ensemble scoring at 3× cost (deferred — cost growth unjustified at current stage, existing single-scorer QWK is acceptable).

Real-time affect detection in culture interview (deferred — validate static version first, and the bias risk from adaptive probing is real).

KV cache compression (deferred — gated on Workers AI exposing it).

BGE fine-tuning for skill adjacency (deferred — hand-curated adjacency table covers 80% of value at 2% of effort).

Early fusion joint embedding (deferred — late fusion has plenty of headroom; revisit if the architecture genuinely tops out).

Learning-to-rank (BPR, LambdaMART) on recruiter feedback (deferred — data infrastructure now, model training when volume justifies it).

---

## How to use these documents

Each of the next four parts covers one pipeline or architectural theme in the same depth as the original strategy documents. They are designed to be read sequentially for a complete picture, or individually for focused work on a specific pipeline.

Part 2 covers **Role Discovery** — the existing RCD production path, the scaffolded evaluator work that's compile-broken, the decomposition design for turning RCD into addressable sub-elements, the UAR migration path for the role-discovery plugin.

Part 3 covers **Repo Ingestion** — the three-pass crawler, the manual approval gate that's blocking corpus growth, the decomposition design for Pass-3 output, confidence-threshold auto-approval, skill adjacency for the SQL matcher.

Part 4 covers **Candidate Ingestion** — the big one. Resume as seed. Enrichment pipeline. Loose match. The screener design (behavioural interview as foundation, extended for dual-mode operation). Two-phase validation (code review, implementation challenge). The living-graph model with provenance and temporal layering. The missing CODE_IMPLEMENTATION scorer with the Sherlock rubric adapted.

Part 5 covers **Matching Architecture and Infrastructure Migration** — per-element matching with evidence-structured reports, triangulation as summary layer, the Neo4j migration plan with phased cutover, observability and reliability integration, the full [ACTIVE]/[IN-FLIGHT]/[LEGACY-REPLACING]/[DEFERRED]/[PARK] master list tying everything together.

---

*End of Part 1.*
