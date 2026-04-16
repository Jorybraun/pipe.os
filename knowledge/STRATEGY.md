# PIPE Strategy — The Plan

> **STATUS: CANONICAL PLAN** · Created 2026-04-08
> **This document is the source of truth for what PIPE is building and why.**
> Every research finding is mapped here to a concrete action. If a finding is in the research but not in this plan, this document is broken — fix it here.
> **Navigate:** [INDEX](./INDEX.md) · [code review brief](./outputs/code-review-content-sourcing.md) · [behavioral/culture brief](./outputs/behavioral-culture-interview-agent.md) · [challenge authoring brief](../outputs/challenge-authoring-system-brief.md)

---

## The mission

**PIPE is an AI-native developer interview platform with code review as the killer feature and culture/behavioral interviews as the second pillar.** Both pillars are designed for the solo founder to ship and maintain, tuned live against calibration metrics rather than hand-crafted. The research briefs (2026-04-07 and 2026-04-08) are the design blueprints. The `/calibrate` skill is the execution environment. The arena is the historical reference.

The product crushes when:
1. A hiring manager can run a code review assessment that produces a defensible signal on seniority and real engineering judgment, not algorithmic puzzle-solving.
2. A culture interview agent can score behavioral responses with human-expert reliability (QWK ≥ 0.60) and produce explainable reports.
3. Both are legally defensible (content validity, adverse-impact monitoring, EEOC/AIVIA/EU AI Act compliance).
4. Both run at <5% of revenue in inference costs.
5. Both improve over time via autonomous calibration loops.

This is what we are building. Every decision traces back to these five criteria.

---

## Goal — Role Discovery is the pipeline's source of truth

**The Role Discovery interview is the single source of truth for the entire assessment pipeline.** Its purpose is to understand a role deeply enough that downstream agents — culture fit interviews, code review challenges, and repo selection — can produce team-specific assessments calibrated to *this* team, *this* codebase, and *this* hiring decision. Every downstream artifact (culture questions, BARS anchors, challenge PRs, scoring weights, repo matches) must be traceable back to a fact extracted during Role Discovery. The goal of the pipeline is a single thing: **find the candidate that fulfils this specific role.** Culture and technical interviews are the instruments; Role Discovery is the calibration.

This goal has two halves that must land together:

1. **Role Discovery produces a structured Role Context Document** (not a lossy flat persona) whose sections are purpose-built for each downstream consumer — Team Context for culture, Technical Context for challenges, Dispositional Context for scoring weights.
2. **The repo library is enriched by its own 3rd AI pass** — an offline crawler step that writes role-agnostic engineering signals per repo, plus a runtime Worker step that reasons over those signals with the Role Context Document to produce per-(role × repo) alignment. Without this, role context on one side meets a SQL keyword join on the other side, and the richer signal dies at the boundary.

See the Role Discovery findings table (RD-1 through RD-24) below and the research plan at `knowledge/outputs/.plans/role-discovery-data-contract.md`.

---

## Guardrail: do not drift from this plan

**If a founder request contradicts this plan, the assistant MUST pause and flag the contradiction before acting.** The research cost real tokens and real thinking. Dropping findings because they're inconvenient is how founders ship weaker products than they could have. The guardrail:

1. **Surface the contradiction.** Name the research finding being overridden and where it lives in the brief.
2. **Name the risk.** What does the research say the consequence is?
3. **Ask for explicit override.** If the founder still wants to proceed, document the override as a decision in this file's Decision Log.
4. **Never silently drop a finding.** If something is deferred, mark it explicitly in the Deferred section below.

This rule exists because the founder asked for it on 2026-04-08 after noticing the research and the arena and the /calibrate skill had drifted out of sync. Re-sync is expensive. Drift prevention is cheap.

---

## The four research briefs

### Brief 1 — Code Review Content Sourcing (2026-04-08)

`knowledge/outputs/code-review-content-sourcing.md` · 50 cited sources · 2 rounds · PASS WITH NOTES

**Thesis:** PIPE's wedge is interactive multi-turn code review. HackerRank and CodeSignal ship static diff-comment items. Woven is human-graded and prohibitively expensive for top-of-funnel. GitLab does multi-turn internally because their engineers believe it's the highest-signal interview — but they can't scale it. That gap is PIPE's product.

**Five winning features:**
1. Multi-PR structure (3 minimum)
2. Hybrid scoring (checklist + BARS-anchored global dimensions)
3. Six scoring dimensions (5 practitioner + AI direction as exclusive moat)
4. Agent quality chain (consistency classifier, reactivity calibration, gold corpus)
5. Content pipeline (rolling-freshness + AIG templates × variants + execution verification)

### Brief 2 — Behavioral & Culture Interview Agent (2026-04-07)

`knowledge/outputs/behavioral-culture-interview-agent.md` · 48 cited sources · 1 round · PASS WITH NOTES

**Thesis:** Structured behavioral interviews in STAR format with BARS rubrics are the highest-validity, lowest-bias, most-defensible interview method available. 2024–2026 AI/NLP research has crossed the threshold where multi-agent criterion-decomposed LLM scoring achieves human-expert reliability (QWK ~0.62). A text-only async agent can match human interviewers if built right. P-O fit has weak performance prediction (ρ=.15) so culture scores must be framed as attitudinal/retention predictors, not performance predictors.

**Five architectural pillars:**
1. STAR/PBQ question format with per-question 5-point BARS rubrics
2. FSM flow + ReAct reasoning + working-memory scratchpad + specialist sub-agents + summarization
3. Belief-state tracking with Previous Belief Aware (PBA) judge
4. Culture as explicit profile (values alignment + working style complementarity), framed as "culture add" not "culture fit"
5. Compliance architecture: disclosure + consent + human-in-the-loop + evidence-linked scoring

### Brief 3 — Challenge Design Authoring System (2026-04-09)

`outputs/challenge-authoring-system-brief.md` · 90 cited sources · 1 round · PASS WITH NOTES

**Thesis:** Pipe's challenge system needs three content sources unified in one UX: AI generation from job descriptions, curated template packs by role (FRONTEND, FULLSTACK, etc.), and recruiter-authored custom challenges. The current hardcoded library (~50 templates) and minimal preset system (DEFAULT + BLANK) don't scale. Competitive analysis of 8 platforms confirms template libraries and role-based browsing are table-stakes; AI generation with confidence scores and batch variant generation are unmet gaps Pipe can own. Multi-language code execution requires Judge0 CE (Workers can't run arbitrary code). MVP languages: Python + JS/TS (51% of hiring demand).

**Five architectural pillars:**
1. Immutable, versioned challenge templates and template packs (IMS QTI pattern) in D1
2. Multi-agent AI generation pipeline with cross-model-family validation and quality gates
3. 4-step wizard UX (Source → Select → Refine → Review) with three entry points
4. Judge0 CE for multi-language code execution with resource limits
5. Confidence scoring on AI-generated content (no competitor does this)

### Brief 4 — Role Discovery + Repo Understanding Data Contract (2026-04-10)

`knowledge/outputs/role-discovery-data-contract.md` · 84 cited sources · 1 round · PASS WITH NOTES
Provenance: `knowledge/outputs/role-discovery-data-contract.provenance.md` · Verification: `knowledge/outputs/role-discovery-data-contract-verification.md`
Research files: `*-research-methodology.md` (R1, 18 sources), `*-research-culture.md` (R2, 24), `*-research-codereview.md` (R3, 25), `*-research-validation.md` (R4, 17)

**Thesis:** The Role Discovery interview is the single source of truth for the entire pipeline, but the synthesis step flattens its Knowledge State into an 8-field `CandidatePersona` and every downstream consumer reads only the flattened output. Simultaneously, the repo crawler has zero LLM calls — `matchRepos.ts` is a SQL keyword join on `persona.mustHaveSkills[]`. Two drifts, one bridge: depth-preserving Role Context Document on one side, two-stage repo understanding (offline signal extraction + runtime role-fit rerank) on the other. Both halves land together in ADR-036 because neither half is useful alone.

**Five architectural pillars:**
1. **Role Context Document** replaces CandidatePersona — hybrid qualitative schema (framework-analysis matrix + IPA evidence anchors + grounded-theory axial links + Means-End Chain laddering) preserving per-stakeholder per-domain `attribute → consequence → value` chains, structured stories, per-turn energy signals, and first-class cross-stakeholder disagreements. Persona becomes a derived cache view.
2. **Three-layer synthesis prompting** — schema-guided generation with field-level exemplars, constrained JSON decoding via `response_format: json_schema`, and a Haiku 4.5 verification pass enforcing verbatim-quote grounding. Five named failure modes to defend against (value projection, consequence genericization, energy-signal inflation, domain-coverage collapse, stakeholder averaging).
3. **Three-tier multi-stakeholder aggregation** — domain-authoritative anchors (HM on Why/Bar, TM on Team/Process), per-source preservation on shared domains with `conflict_flag`, explicit-formula aggregates only on genuine consensus fields. Grounded in Conway & Huffcutt (supervisor-peer ρ=.34 → 89% variance is source-unique); disagreement is its own category, not a midpoint.
4. **Five-signal team culture profile + BARS overrides + static probe bank + HITL dealbreaker gates** — 4 OCAI archetypes (Current-culture framing) + psychological safety; universal base BARS with per-dimension RCD-derived anchor overrides; static probe bank with role-setup-time enrichment (never per-candidate dynamic generation — fails NYC LL 144 auditability and EU AI Act Article 14 interpretability); dealbreakers trigger auto-flag-then-HITL, never auto-fail (Griggs, EEOC v. iTutorGroup, Mobley v. Workday, EU AI Act Art 14).
5. **Two-stage repo understanding architecture** — Crawler Pass 3 (offline, Cloudflare Queue consumer, Claude Haiku 4.5) writes role-*agnostic* `repo_engineering_signals` once per repo. Runtime Worker (Gemma 4 26B) reads RCD Technical Context + top-N signals per SQL candidate, writes cached per-(role × repo) `repo_role_alignment` rows. `matchRepos.ts` becomes stage-1 retriever; Worker does stage-2 rerank with per-candidate justification. Mirrors ColBERT offline/online split and AIF asynchronous preranking; validated by SWE-bench limits on query-agnostic retrieval.

**Cross-cutting validation methodology:** Local criterion studies are infeasible at PIPE's volumes (r=.30 needs N≈85, r=.20 needs N≈193). Research prescribes a staged evidence ladder: N=0 face validity → N=30–50 convergent bootstrap → N=100–200 transportability case (Sackett 2022 r_op=.42; Hoffman 1999) → N=300–500 criterion-suggestive ITS. Precondition: RCD `validation_metadata` + RUC `rcd_version` / `signals_version` so old cohorts are never silently mixed with new ones after schema evolution.

### Brief 5 — Role Discovery Dual-Purpose Needs Discovery (2026-04-11)

`knowledge/role-discovery/role-discovery-sales-intake.md` · 247 cited sources · 4 researchers · PASS WITH NOTES
Plan: `knowledge/outputs/.plans/role-discovery-sales-intake.md`

**Thesis:** The Role Discovery agent is vague and goal-light because it uses a single monolithic prompt that cannot simultaneously be a rapport-building listener, a divergent-thinking prier, a convergent challenger, and a MEDDIC qualifier. The fix is a controller-directed phase-switching architecture: a cheap ControllerAgent reads full conversation context each turn and passes a PhaseDirective to the active PhaseAgent, whose prompt is narrow and posture-specific. The research prescribes five phases (Context → Discovery → Prioritize → EVP/Friction → Qualify/Close), 16 turn-behavior rules (SPIN/MEDDIC/Sandler/JTBD/Ulwick-ODI/d.school grounded), EVP coverage tracking alongside domain coverage, a `recruitment_brief` synthesis artifact (stories + EVP + friction + demand-side pitch + qualification), and three forcing functions to guarantee critical topics are covered before synthesis is allowed.

**Five architectural pillars:**
1. Controller agent reads `ConversationContext` → emits `PhaseDirective` → phase agent uses narrow prompt; controller advances phase on *coverage completion*, not turn count
2. Five posture-specific phase prompts: `CONTEXT` (listener) / `DISCOVERY` (divergent prier) / `PRIORITIZE` (Challenger, convergent) / `EVP_FRICTION` (empathic truth-teller) / `QUALIFY_CLOSE` (MEDDIC closer)
3. 16 turn-behavior rules replacing loose directives (SPIN Problem+Implication, Sandler Pain Funnel, JTBD four forces, Ulwick ODI outcome statements, IDEO Says/Thinks gap, d.school defamiliarization, Cooper day-in-the-life)
4. `ConversationContext` extends existing `domainCoverage` with `evpCoverage` (Gartner 5-category), `qualificationStatus` (MEDDIC fields), `storiesExtracted[]`, `mustHavesPrioritized`, `frictionProbed`, `dayInLifeProbed` — passed to both controller and phase agent every turn
5. `recruitment_brief` synthesis artifact alongside RCD — different consumer (recruiter outreach vs. scorecard); contains structured stories, EVP coverage status, transparent friction, demand-side pitch (JTBD Pull/Push/Anxiety/Habit), compensation narrative, MEDDIC qualification summary

---

## The two calibration systems

### System A: The Arena (`/Users/hans/Code/PIPE/research/code-review-arena/`)

**Status:** Legacy reference. Last touched 2026-03-30. Best calibration: **76.5% (v19)** at `mistral-medium-latest`.

**What it is:** Standalone synthetic harness for calibrating the scoring panel. Runs 18 conversations (6 cases × 3 reviewer tiers × 1 implementer) through a fixed pipeline, scores them via an LLM panel, logs to `results.tsv`. No Chrome, no real product, pure LLM-to-LLM.

**When to use it:**
- **Fast scorer-only iteration.** No Chrome orchestration overhead. ~minutes per run.
- **Scoring formula / weight changes.** The harness code is editable (`src/harness.ts`).
- **Baseline regression testing.** Deterministic with pinned models; can replay.
- **Historical reference.** 21 experiment versions logged with notes on what worked.

**When NOT to use it:**
- End-to-end changes involving the real Worker or the UI.
- Changes to the implementer's code-generation behavior (not fully modeled in arena).
- Anything that touches the real scoring API (`workers/api/src/lib/scorerAgent.ts`).

**What it knows that the research doesn't yet:**
- 21 iterations of empirical calibration data: what prompts worked, what didn't.
- The 4-dimension scoring formula (Technical 30% / Conversation 30% / Practice 25% / Effectiveness 15%) that currently works.
- That Conversation is the strongest separator (60-point tier gap).
- That Practice compresses (strong/adequate/weak too close together).
- That `mistral-medium-latest` >> `devstral-latest` for reviewer quality.

**What it doesn't know (the research gaps):**
- The six-dimension design (adds revision evaluation + AI direction).
- Multi-PR aggregation (currently scores each PR independently).
- Agent drift / consistency classifier (not modeled at all).
- BARS-anchored level descriptors (current prompts have some anchors but not Hodges-compliant).
- Persona reactivity as parametric YAML.

### System B: The `/calibrate` skill (`PIPE-OS/.claude/commands/calibrate.md`)

**Status:** Go-forward system. **"The app IS the harness."**

**What it is:** A Claude Code slash command that runs real conversations through the live PIPE UI in Chrome, triggers scoring via the real Worker pipeline (Devstral on Mistral), logs structured experiment data to `data/experiments/runs.jsonl`, and auto-tunes prompts in `workers/api/src/lib/scorerPrompts.ts` and `prompts.ts` until calibration target is hit.

**Key architectural rule** (from the skill file):
> **Claude Code MUST NEVER act as the scoring agent or implementer agent.** All scoring and implementer responses are done by Devstral, called by the Worker API. Claude Code's role is ONLY: play personas in Chrome, wait for real pipeline results, analyze calibration data, and tune prompts.

**Modes:**
- `/calibrate` — interactive, 1 batch, asks before tuning
- `/calibrate --auto` — autonomous loop until ≥80% calibration or max iterations
- `/calibrate --auto --target 85` — custom target
- `/calibrate slop-101-search` — single challenge
- `/calibrate --persona strong` — single persona
- `/calibrate --analyze exp-v1-baseline` — re-analyze existing data
- `/calibrate --compare exp-v1 exp-v2` — side-by-side
- `/calibrate --score-only <sessionId>` — score existing session

**When to use it:**
- End-to-end testing of the real product before shipping.
- Tuning production scorer / implementer prompts.
- Validating that a research finding actually improves real calibration.
- Scoring real candidate sessions (not just personas) via `--score-only`.

**When NOT to use it:**
- Fast iteration on scoring formula changes (Chrome + Worker latency is too slow — use arena).
- Changes that don't touch the Worker pipeline (use arena).

### The division of labor

| Layer | Lives in | Managed by | Changes tracked in |
|---|---|---|---|
| Scoring formula / weights | `workers/api/src/lib/scorerAgent.ts` + `scorerPrompts.ts` | `/calibrate` in production, arena for offline iteration | git + `data/experiments/runs.jsonl` |
| Scorer prompts (BARS, anchors) | `workers/api/src/lib/scorerPrompts.ts` | `/calibrate` (primary), arena (secondary) | git + `data/experiments/runs.jsonl` |
| Implementer prompts (junior/senior personas) | `workers/api/src/lib/prompts.ts` | `/calibrate` in production | git + `data/experiments/runs.jsonl` |
| Reviewer persona strategies (Priya/Tom/Casey) | `/calibrate` skill file itself (behavior descriptions) | edit the skill file directly | git |
| Golden cases (PR library) | `research/code-review-arena/golden/prepared/cases.json` + Worker seed data | hand-authored, future: AIG pipeline | git |
| Consistency classifier | **Not built yet** — Gemma 4 12B in Worker | to be built per code-review brief Part 3 | git + new tests |

---

## The full finding → action map

Every research finding is mapped to a phase and a concrete artifact. If you disagree with a mapping, edit the mapping — but **do not drop a finding without writing an explicit override in the Decision Log**.

### CR — Code Review Content Sourcing findings (33 items)

| # | Finding | Source (brief section) | Plan action | Phase | Status |
|---|---|---|---|---|---|
| CR-1 | Multi-PR structure (3 min / 5 target / 8 summative) | Part 2.1 | Build multi-PR challenge type in Worker; challenge = bundle of 3 PRs | P1 | NOT STARTED |
| CR-2 | Hybrid checklist + BARS global rubric | Part 2.2 | New YAML rubric file loaded into Worker; deterministic checklist for planted-bug detection + LLM-judge BARS for dimensions | P1 | **DONE** (2026-04-09 — `scorerRubric.yaml` + `scorerRubric.ts` + rewritten `scorerPrompts.ts` + `scorerAgent.ts` + `scoring.ts`) |
| CR-3 | Six scoring dimensions (5 practitioner + AI direction) | Part 2.3–2.4 | Expand from 4 dimensions (Technical / Conversation / Practice / Effectiveness) to 6 (Issue depth / Reasoning / Prioritization / Question formation / Revision evaluation / AI direction) | P1 | **DONE** (2026-04-09 — 6 dimensions shipped in `scorerRubric.yaml`) |
| CR-4 | BARS level descriptors with concrete behavioral anchors (Hodges-compliant) | Part 2.2 | Write 5 concrete behavioral anchors per dimension in rubric YAML; no "poor/good/excellent" | P1 | **DONE** (2026-04-09 — 1-5 BARS anchors per dimension in `scorerRubric.yaml`) |
| CR-5 | Consistency classifier (#1 engineering risk) | Part 3.1 | Build Gemma 4 12B classifier Worker; runs on every implementer turn; 4-axis JSON (bug-disclosure / tone / knowledge boundary / pushback deviation); regenerate-or-flag logic | **P2** | NOT STARTED |
| CR-6 | Persona YAML with reactivity parameters | Part 3.3 | Productize junior/mid/senior personas as versioned YAML: `pushback_probability`, `fix_acceptance_threshold`, `information_volunteering_rate`, `error_introduction_rate` | P1 | PARTIAL (hardcoded in `prompts.ts`) |
| CR-7 | Reactivity calibration study (15 experts) | Part 3.3 | DEFERRED — hand-tune YAML for MVP; run study after first paying customer | POST-MVP | DEFERRED |
| CR-8 | Score at encounter level, not turn level | Part 3.4(a) | Worker scoring aggregates per PR; turn data is evidence, not independent score | P1 | **DONE** (2026-04-09 — `scorerRubric.yaml:10,31` `scoring_level: encounter`) |
| CR-9 | Separate scorer and implementer invocations (no shared context) | Part 3.4(b) | Enforce in Worker pipeline; scorer reads transcript from scratch | P1 | **DONE** (2026-04-09 — Scorer A + Scorer B in `scorerAgent.ts` run in parallel, independent of implementer) |
| CR-10 | Cohen κ target ≥ 0.76 for LLM-judge scoring | Part 3.4 | Build offline Sonnet 4.6 oracle; measure Devstral κ vs Sonnet; escalate if κ < 0.70 | P2 | NOT STARTED |
| CR-11 | Gold-standard conversation corpus (100 transcripts target) | Part 3.5 | Seed with 10 founder-rated transcripts; grow with real sessions; regression-test every prompt change against it | P2 | NOT STARTED (`/calibrate` logs runs but no "gold" subset yet) |
| CR-12 | Model routing (6 roles, 5 distinct models) | Part 3.6 | Document in CLAUDE.md (done in this session); map each role to model+fallback | P1 | DOCUMENTED — enforcement gradual |
| CR-13 | Hybrid real-skeleton + planted bug (AIG pipeline) | Part 4.1 | ✅ **Stages 1-4 DONE (2026-04-10):** Offline repo crawler replaces real-time Libraries.io. `scripts/crawl-repos/` (Pass 1: GH Search + coarse filter; Pass 2: clone + stack-analyser + scc/lizard + construct extractors + SWE-bench PR sampling). D1 schema: `qualified_repos`, `repo_skills`, `repo_constructs`, `repo_sample_prs`, `skill_aliases` (migration 0021). Runtime: `matchRepos.ts` — tag-graph query, <50ms p95. `discover.ts` rewritten to query pre-populated catalog instead of Libraries.io. GH Actions cron: weekly pass-1, weekly pass-2 (200/run). Remaining: AIG template + variant generation (CR-15), execution verification (CR-16). | P3 | **IN PROGRESS — crawler done, AIG templates next** |
| CR-14 | Rolling-freshness gate (post-2024-07-01, quarterly advance) | Part 4.2 | ✅ **Implemented via crawler refresh policy (2026-04-10):** `last_pushed_at >= 6mo` hard filter in `matchRepos` WHERE clause + `staleCutoff()` marks stale repos `disqualified=1,reason='stale'` on each pass-2 refresh run. Quarterly gate advance = update `STALE_MONTHS` in `config.ts`. | P3 | **DONE** |
| CR-15 | AIG templates × variants (Gierl & Haladyna) | Part 4.1 | Write 10 bug templates; variant generator via Claude Sonnet offline | P3 | NOT STARTED |
| CR-16 | Execution-based ground truth (not LLM-judge) | Part 4.1 | CI sandbox runs repo's test suite; discard items where planted bug doesn't fail a test | P3 | NOT STARTED |
| CR-17 | Tag on 4 dimensions (difficulty × stack × skill × archetype) | Part 4.1 | Item bank schema with tags; selection query over tags; NOT enumerate personas | P3 | NOT STARTED |
| CR-18 | 225-item bank target, 15 to ship MVP | Part 4.3 | Initial 15 items: 3 difficulty × 5 skills × 1 stack (TS/React) | P3 | NOT STARTED (currently has golden/cases.ts with 6 arena cases) |
| CR-19 | Permissive-license-only filtering (MIT/Apache/BSD) | Part 4 | ✅ **DONE (2026-04-10):** `ALLOWED_LICENSES` set in `config.ts` enforced in Pass-1 coarse filter. Only MIT/Apache-2.0/BSD-2/BSD-3/ISC/MPL-2.0/LGPL-2.1/LGPL-3.0 accepted. | P3 | **DONE** |
| CR-20 | Sillito Tier 1-2 scaffolding only (not Tier 3-4) | R3 findings | UI shows file structure, entry points, conventions; does NOT answer "why did author choose X" | P1 | CHECK CURRENT STATE |
| CR-21 | Structured interview + work sample r=.42/.33 | Part 1.1 | Motivates format; cited in validation file | P4 | CITED-FOR-REFERENCE |
| CR-22 | Interactive format d≈.21-.22 vs in-basket .74-.76 (Roth 2008) | Part 1.2 | Motivates multi-turn format; cited in fairness section of validation file | P4 | CITED-FOR-REFERENCE |
| CR-23 | Content validity legal route (EEOC/Griggs/Ricci) | Part 1.3 | Lightweight job analysis doc; CVR-rated scenario mapping; adverse-impact monitoring dashboard | P4 | NOT STARTED |
| CR-24 | Criterion problem: bootstrap concurrent validity study | Part 1.4 | Build 90-day post-hire structured rating instrument; run with first paying customer | P4 | NOT STARTED |
| CR-25 | Revision evaluation dimension (exclusive moat) | Part 6 | Dimension 5 — scorer assesses whether implementer's fix is complete / incomplete / introduces new issues | P1 | **DONE** (2026-04-09 — `scorerRubric.yaml:189-190` `id: revision_evaluation`) |
| CR-26 | AI-direction construct (second moat) | Part 6 | Dimension 6 — measured via turn-level directing / evaluating / pushback | P1 | **DONE** (2026-04-09 — `scorerRubric.yaml:233` `id: ai_direction`) |
| CR-27 | Persona-calibrated reactivity (moat #4) | Part 6 | YAML + calibration corpus + /calibrate measurement | P2 | NOT STARTED |
| CR-28 | Validation file from day one (moat #5) | Part 5.3 | `docs/validation/` directory: job analysis + CVR + rubric + inter-rater reliability + subgroup analysis; starts empty, grows | P4 | NOT STARTED |
| CR-29 | Unit economics ~$0.05/assessment MVP | Part 5.4 | Budget reference; informs pricing; monitor token usage per session | ONGOING | REFERENCE ONLY |
| CR-30 | Ship sequence (4 phases) | Part 5.1 | The phase structure in this document | META | APPLIED |
| CR-31 | Ship with 3 PRs default, defer 8-station summative | Part 5.2 | MVP = 3 PRs; summative mode post-MVP | P1 | APPLIED |
| CR-32 | Defer IRT calibration (need n≥100/item) | Part 5.2 | Ship uncalibrated; revisit after volume | DEFERRED | DEFERRED |
| CR-33 | Defer AutoIRT with LLM-simulated students | Part 5.2 | Not critical path | DEFERRED | DEFERRED |

### BC — Behavioral & Culture Interview Agent findings (45 items)

| # | Finding | Source (brief section) | Plan action | Phase | Status |
|---|---|---|---|---|---|
| BC-1 | STAR/PBQ format (ρ = .44–.64 corrected validity) | 1.1–1.2 | Use STAR/PBQ in behavioral question bank | DONE | IN PLACE (`knowledge/behavioural/`) |
| BC-2 | BARS rubric (+35% criterion validity) | 1.3 | 5-point BARS rubric per behavioral question with concrete anchors | P1 | PARTIAL (questions exist, anchors need upgrade) |
| BC-3 | 6–12 structured STAR questions per interview | 1.5 | Culture/behavioral agent FSM: 6–9 questions, 35–55 min | P1 | CHECK CURRENT STATE |
| BC-4 | Multi-agent criterion decomposition (QWK 0.621) | 2.2 | Culture scorer uses one specialist agent per dimension; NOT holistic | P1 | CHECK CURRENT STATE |
| BC-5 | 3-shot L/M/H calibration examples per dimension | 2.2 | Include balanced 5th/50th/95th percentile examples in every scoring prompt | P1 | NOT STARTED |
| BC-6 | Belief-state tracking over rubric dimensions | 2.2 | Judge LLM maintains posterior per KSA dimension; updates per turn | P2 | NOT STARTED |
| BC-7 | Previous Belief Aware (PBA) judge for stability | 2.2 | PBA approach for 100% stability on irrelevant input | P2 | NOT STARTED |
| BC-8 | CoMAI 4-agent architecture (Q-gen / Security / Scoring / Summary) | 2.3 | Culture agent = FSM + ReAct + specialist sub-agents + summarization | P1 | CHECK CURRENT STATE |
| BC-9 | Resume-agnostic scoring | 2.3 | Scoring agent never sees candidate profile; prevents pedigree bias | P1 | CHECK CURRENT STATE |
| BC-10 | FSM backbone + ReAct layer + working memory scratchpad | 2.3 | Agent architecture in `cultureAgent.ts` | P1 | CHECK CURRENT STATE |
| BC-11 | 5 trigger types for follow-up probes (Bloom/Grice) | 2.4 | Probe generator: Missing STAR / Vague quantifier / Attribution / Evidence / Depth | P1 | NOT STARTED |
| BC-12 | Max 2 probes per question | 2.4 | Probe budget rule in agent logic | P1 | NOT STARTED |
| BC-13 | STAR completeness JSON scratchpad with specificity scores | 2.5 | Working memory tracks S/T/A/R slot specificity per turn | P1 | NOT STARTED |
| BC-14 | Handling difficult responses (evasive / off-topic / brief / rambling) | 2.6 | Agent behavior rules in prompts | P2 | NOT STARTED |
| BC-15 | Belief-state delta as evasion detector | 2.7 | Information-theoretic evasion detection; no separate classifier | P2 | NOT STARTED |
| BC-16 | Reality Monitoring signals (episodic specificity) | 2.7 | NLP signals for fabrication detection as scoring bonus | P3 | NOT STARTED |
| BC-17 | Cognitive load via unexpected follow-ups | 2.7 | Probe strategy for fabrication detection | P3 | NOT STARTED |
| BC-18 | Structured scratchpad + rolling compaction + pinned exchanges | 2.8 | Memory management for long interviews | P2 | NOT STARTED |
| BC-19 | QWK ≥ 0.60 scoring target | 2.9 | Calibration metric for culture scorer; validate via `/calibrate` skill equivalent for culture | P2 | NOT STARTED |
| BC-20 | Verbosity bias r < 0.10 | 2.9 | Monitor and correct | P2 | NOT STARTED |
| BC-21 | P-O fit ρ=.15 for performance (weak caveat) | 3.1 | Frame culture scores as **attitudinal/retention predictors**, NOT performance predictors — everywhere in UI and reports | P1 | NOT STARTED |
| BC-22 | Culture add vs. culture fit framing | 3.2 | UI and scoring framed as "values alignment + working style complementarity" | P1 | NOT STARTED |
| BC-23 | Explicit culture profile before candidate comparison | 3.3–3.4 | Recruiter defines org culture benchmark FIRST; candidate scored against it | P1 | PARTIAL (`culture-profile/` dimensions exist; benchmark-first UX not yet) |
| BC-24 | Harver OCAI profile matching (Clan/Adhocracy/Hierarchy/Market) | 3.4 | Optional future culture archetype mapping | POST-MVP | DEFERRED |
| BC-25 | NLP culture signals (autonomy/collaboration/conscientiousness/risk/learning) | 3.5 | Culture dimensions already match in `knowledge/culture/dimensions/` and `knowledge/culture/culture-profile/` | DONE | IN PLACE |
| BC-26 | Social desirability limitation — probabilistic, not definitive | 3.5 | Culture scores presented as **evidence**, not classification | P1 | NOT STARTED |
| BC-27 | HireVue lesson: drop audio/video features, text-only is cleaner | 4.1 | PIPE's text-only approach is a differentiator — **keep text-only**, do not add audio/video features | LOCKED | APPLIED |
| BC-28 | Illinois AIVIA HB 3773 coverage | 5.1 | Disclosure screen + non-AI alternative + vendor disclosure + $2,500/violation risk mitigation | P4 | NOT STARTED |
| BC-29 | EEOC vendor liability | 5.1 | Disparate impact monitoring from day one | P4 | NOT STARTED |
| BC-30 | EU AI Act Annex III high-risk (effective **2026-08-02**) | 5.1 | Conformity assessment + technical docs + human oversight + candidate transparency + right to explanation | P4 | NOT STARTED (HARD DEADLINE) |
| BC-31 | NYC Local Law 144 annual bias audit | 5.1 | Annual bias audit + public summary | P4 | NOT STARTED |
| BC-32 | LLM resume bias documented (85.1% white-name preference) | 5.2 | Motivates resume-agnostic scoring and bias mitigation architecture | P1 | APPLIED VIA BC-9 |
| BC-33 | Decouple content scoring from style scoring | 5.3 | Scoring evaluates content, NOT vocabulary richness / fluency / linguistic style | P1 | NOT STARTED |
| BC-34 | Human-in-the-loop final decisions | 5.3 | Recruiter review required before final decision; no AI-only rejection | P1 | CHECK CURRENT STATE |
| BC-35 | Candidate disclosure + consent + non-AI alternative | 5.4 | Disclosure screen UI component | P4 | NOT STARTED |
| BC-36 | FSM + ReAct + Working Memory + Specialist Sub-Agents + Summarization | 6.1 | Architecture target for `cultureAgent.ts` | P1 | CHECK CURRENT STATE |
| BC-37 | 4–6 PBQ + 1–2 SQ + 1 calibration question = 6–9 total | 6.2 | Question bank composition rule | P1 | CHECK CURRENT STATE |
| BC-38 | 5-point BARS per question (exact level descriptors given) | 6.2 | Template for every question's rubric | P1 | NOT STARTED |
| BC-39 | Culture as 5-dimension profile (autonomy / risk / collaboration / pace / feedback) | 6.3 | Matches `knowledge/culture/culture-profile/` | DONE | IN PLACE |
| BC-40 | Scoring pipeline (extract → check → probe → score → belief update → anomaly → aggregate → narrative) | 6.4 | Worker pipeline structure | P2 | NOT STARTED |
| BC-41 | L/M/H calibration + Platt scaling post-hoc | 6.4 | Bias mitigation post-hoc | P2 | NOT STARTED |
| BC-42 | Recruiter report format with evidence quotes + score links (Spark Hire-style) | 6.5 | UI shows score → evidence links | P1 | NOT STARTED |
| BC-43 | Disclosure screen / consent gate / non-AI alternative (UI) | 6.6 | Compliance UI components | P4 | NOT STARTED |
| BC-44 | Data handling (Illinois 30-day deletion, audit logs ≥6 months) | 6.6 | Data retention policy + D1 schema | P4 | NOT STARTED |
| BC-45 | No AI-only rejection; all dimensions link to evidence | 6.6 | UI + Worker logic enforces evidence linking | P1 | NOT STARTED |

### CA — Challenge Authoring System findings (20 items)

> **Research brief:** `outputs/challenge-authoring-system-brief.md` · 90 cited sources · 2026-04-09
> **ADR:** [ADR-034](../docs/decisions/ADR-034-challenge-authoring-system.md) · Supersedes ADR-004, extends ADR-010
> **Scope:** MCQ, Code Implementation, Long-form text/video. Excludes CODE_REVIEW (CR-*) and FOLLOW_UP.

| # | Finding | Source (brief section) | Plan action | Phase | Status |
|---|---|---|---|---|---|
| CA-1 | Multi-agent generate-then-validate pipeline required (single-pass has quality issues) | Part 1.2, R1-S7 | Build 5-stage pipeline: generate → content review → linguistic eval → difficulty calibrate → human approve | CA-P3 | NOT STARTED |
| CA-2 | Chain-of-Thought + in-context learning for MCQ generation (78% high-quality, 65.56% Bloom's match) | Part 1.3, R1-S18 | MCQ generator prompt uses CoT + skill descriptions + 3-5 similar examples via embedding | CA-P3 | NOT STARTED |
| CA-3 | Misconception-based distractors (CoT reduces accidental correct from 39% to 2%) | Part 1.3, R1-S27 | MCQ prompt requests misconception articulation before distractor generation | CA-P3 | NOT STARTED |
| CA-4 | Content reviewer MUST be different model family from generator | Part 1.2, ADR-032 principle | Gemma reviews Qwen output; Qwen reviews Gemma output. Never same-family. | CA-P3 | NOT STARTED |
| CA-5 | Bloom's → challenge type routing (Remember→MCQ, Apply→Code, Evaluate→Long-form) | Part 1.1 | **UNVALIDATED inference** — needs internal validation before encoding as ground truth | CA-P3 | NOT STARTED |
| CA-6 | Skill-LLM extraction from JD achieves 64.8% F1 | Part 1.1, R1-S17 | Use role discovery persona `mustHaveSkills`/`niceToHaveSkills` directly instead of re-extracting | CA-P3 | NOT STARTED |
| CA-7 | IMS QTI item banking: challenges are immutable atomic units, packs are versioned compositions | Part 2.1, R2-S1/S2 | D1 tables: `challenge_templates` (immutable) + `template_packs` (versioned) + `template_pack_items` (composition) | CA-P1 | NOT STARTED |
| CA-8 | Immutability after publish — version-on-edit for fairness | Part 2.1, R2-S3 | `is_published = 1` locks template/pack; edits create new version; snapshot version at stage assignment | CA-P1 | NOT STARTED |
| CA-9 | Language variants as first-class entities | Part 2.1 | `challenge_language_variants` table: per-language starter code, test suite, test framework, test command | CA-P1 | NOT STARTED |
| CA-10 | Cloudflare Workers cannot execute arbitrary user code — need external service | Part 3.1, R2-S16 | Integrate Judge0 CE (open-source, 60+ languages, self-hostable, REST API) | CA-P4 | NOT STARTED |
| CA-11 | MVP language set: Python + JavaScript/TypeScript (51% of hiring demand) | Part 3.2, R2-S8 | Launch with 2 languages; add Java/Go in Phase 2 | CA-P4 | NOT STARTED |
| CA-12 | Judge0 CE: configurable resource limits (CPU 2-15s, memory 128-256MB) | Part 3.1, R2-S18 | Set per-challenge resource limits in `challenge_language_variants.config` | CA-P4 | NOT STARTED |
| CA-13 | 4-step wizard UX (Source → Select → Refine → Review) with three entry points | Part 4.2, R3-S1 | Replace `ChallengePicker.tsx` with wizard component | CA-P2 | NOT STARTED |
| CA-14 | Role-based template pack browsing is table-stakes (all 8 competitors do this) | Part 4.3, R3 | Template browser with primary=role, secondary=seniority/type/language/skill | CA-P2 | NOT STARTED |
| CA-15 | Right-sidebar drawer for challenge editing (45.5% conversion vs 25.96% for modals) | Part 4.5, R3-S33 | Per-type editors in drawer layout within wizard flow | CA-P2 | NOT STARTED |
| CA-16 | Confidence scores on AI-generated content (no competitor does this) | Part 4.4, R3 | Display Topic Relevance, Role Fit, Clarity scores (0-1) per generated challenge | CA-P3 | NOT STARTED |
| CA-17 | Batch variant generation (difficulty × language) — unmet market gap | Part 4.6, R3 | Post-MVP: generate N difficulty × M language variants in one flow | CA-P5 | NOT STARTED |
| CA-18 | IRT difficulty calibration post-deployment (need n≥100 responses/item) | Part 1.5, R1-S21/S23 | Track p-value, discrimination index, distractor efficiency; Rasch 1PL estimation | CA-P5 | DEFERRED |
| CA-19 | Larger proprietary models outperform open-source on Bloom's alignment | Part 1.2 caveat, R1-S18 | Use Claude Opus for gold-standard seed templates; pilot-test Gemma before relying on it for MCQ generation | CA-P3 | NOT STARTED |
| CA-20 | Competitive library bar: 1K+ (HackerRank) to 300K+ (TestGorilla/Vervoe) | Part 6.1, R3 | Seed 50-75 templates via Opus across 7 role packs; scale via AI generation + recruiter contributions | CA-P1 | NOT STARTED |

### RD — Role Discovery + Repo Understanding findings (42 items)

> **Research brief 1 (data contract):** `knowledge/outputs/role-discovery-data-contract.md` · 84 cited sources · 1 round · PASS WITH NOTES · 2026-04-10
> **Research plan 1:** `knowledge/outputs/.plans/role-discovery-data-contract.md` · Provenance: `knowledge/outputs/role-discovery-data-contract.provenance.md`
> **Research brief 2 (needs discovery):** `knowledge/role-discovery/role-discovery-sales-intake.md` · 247 cited sources · 4 researchers · PASS WITH NOTES · 2026-04-11
> **Research plan 2:** `knowledge/outputs/.plans/role-discovery-sales-intake.md`
> **ADR:** [ADR-036](../docs/decisions/ADR-036-role-discovery-data-contract.md) — Role Discovery + Repo Understanding Data Contract (2026-04-10, Proposed)
> **Supersedes:** ADR-028 sections on `CandidatePersona` as canonical artifact
> **Scope:** Brief 1 fixes the artifact schema — Knowledge State flattened to a lossy 8-field persona; repo crawler has zero AI reasoning layer. Brief 2 fixes the agent conversation — single monolithic prompt produces vague, goal-light interviews; needs controller-directed phase-switching with posture-specific prompts.
>
> **Status:** Both research briefs complete. ADR-036 drafted (schema types exist in `types.ts`). **RD-P5 DONE (2026-04-13):** Phase-switching controller, 5 phase prompts, ConversationContext, PhaseDirective, forcing functions, voice prompt. Next: RD-P1 (synthesis rewrite to emit Role Context Document).

**Phase key:** RD-P0 = research prep · RD-P1 = schema migration (Role Context Document) · RD-P2 = culture interview wiring · RD-P3 = code review + challenge generation wiring · RD-P4 = repo understanding (3rd AI pass + runtime role-fit re-ranker) · RD-P5 = controller-directed phase-switching agent redesign

#### Role Discovery core (RD-1 through RD-8)

| # | Finding | Source | Plan action | Phase | Status |
|---|---|---|---|---|---|
| RD-1 | `CandidatePersona` is a lossy 8-field schema masquerading as the canonical artifact; research says Knowledge State is the artifact | `migration/dersign-thinking.md:355`, `workers/api/src/types.ts:223` | Resolved by ADR-036 Role Context Document | RD-P0 | **DONE** (`144ca3b` — RCD schema + synthesis rewrite) |
| RD-2 | Knowledge State is persisted but no downstream consumer reads it | `workers/api/src/types.ts:205`, grep `knowledge_state` across `workers/api/src` | Resolved by ADR-036 Role Context Document | RD-P0 | **DONE** (`144ca3b`) |
| RD-3 | Laddering chains (attribute → consequence → value) collapse to flat `mustHaveSkills[]` at synthesis | `roleAgentPrompts.ts:38-43` vs. `roleAgentPrompts.ts:156-162` | Resolved by ADR-036 synthesis prompt rewrite (informed by research Q8) | RD-P0 | **DONE** (`144ca3b`) |
| RD-4 | Stories are raw text in `exchanges[].answer`, never structured into situation/action/outcome/moral records | `workers/api/src/types.ts:259` | Resolved by ADR-036 (story schema under Team Context) | RD-P1 | **DONE** (`144ca3b`) |
| RD-5 | Per-turn energy signals are used in-flight but never persisted | `roleAgentPrompts.ts:28` | Resolved by ADR-036 (energy trace under Dispositional Context) | RD-P1 | **DONE** (`144ca3b`) |
| RD-6 | Cross-stakeholder contradictions live only in free-text `reasoning` | `roleAgentPrompts.ts:153`, ADR-028 | Resolved by ADR-036 (structured disagreement records per Q3) | RD-P1 | **DONE** (`144ca3b`) |
| RD-7 | `RoleExchange.feedback` is a reserved-but-unused channel | `workers/api/src/types.ts:270` | Resolved by ADR-036 (either wire or remove) | RD-P1 | **DONE** (`144ca3b`) |
| RD-8 | Drift from research is not logged in the Decision Log | ADR-033 guardrail | Logged 2026-04-10 in Decision Log below | RD-P0 | **DONE** |

#### Culture Fit consumers (RD-9 through RD-16)

| # | Finding | Source | Plan action | Phase | Status |
|---|---|---|---|---|---|
| RD-9 | Culture agent reads only `persona.seniority` and `persona.archetype` from Role Discovery — every other field is invisible | `cultureRoleResolution.ts:52-74` | Wire Team Context into `cultureRoleResolution` once ADR-036 lands | RD-P2 | **DONE** (`1b75fcf` — culture consumer rewrite) |
| RD-10 | Archetype → overlay via 4-keyword regex; staff-IC-who-leads gets same overlay as mid-IC-in-isolation | `cultureRoleResolution.ts:35-39` | Replace regex with Team Context structured fields | RD-P2 | **DONE** (`1b75fcf`) |
| RD-11 | Three hardcoded overlays (`senior-ic`, `manager`, `universal`); no granularity for startup-vs-enterprise, on-call-heavy, async-first, player-coach | `cultureRoleOverlay.ts:28-84` | Replace static overlays with Team Context dimensional weights | RD-P2 | **DONE** (`1b75fcf`) |
| RD-12 | Silent fallback to `mid + universal` on any lookup miss; default behavior when no role context exists | `cultureRoleResolution.ts:25-28` | Require Role Context Document or raise; no silent default | RD-P2 | **DONE** (`1b75fcf`) |
| RD-13 | BARS rubric is universal (hardcoded anchors at `cultureScorer.ts:148-252`); no team-specific override; ADR-029 Phase C sync script not yet built | `cultureScorer.ts:138-140`, ADR-029 | Add BARS override mechanism reading Team Context per research Q4 | RD-P2 | **DONE** (`1b75fcf`) |
| RD-14 | `orgBenchmark.focusDimensions` is read but never passed to the selector — dead wiring | `culture.ts:250`, `cultureQuestionBank.ts:402` | Pass Team Context focus dimensions into `pickNextQuestion` | RD-P2 | **DONE** (`1b75fcf`) |
| RD-15 | Culture agent cannot generate team-specific probes from Knowledge State; probe bank is static | `cultureQuestionBank.ts`, `cultureProbePatterns.ts` | Add team-specific probe generation per research Q5 | RD-P2 | **DONE** (`1b75fcf`) |
| RD-16 | Multi-stakeholder culture signal (team member perspective per ADR-028 TEAM_MEMBER variant) is the "ground truth for culture" per research but never reaches culture scoring | `roleAgentPrompts.ts:268`, `cultureRoleResolution.ts` | Plumb TEAM_MEMBER stakeholder data into Team Context | RD-P2 | **DONE** (`1b75fcf`) |

#### Code Review consumers (RD-17 through RD-22)

| # | Finding | Source | Plan action | Phase | Status |
|---|---|---|---|---|---|
| RD-17 | Challenge generation reads 5 persona fields only; Knowledge State `codebase` and `work` domains are invisible | `challengeGeneration/prompts.ts:35-39` | Refactor `challengeGeneration` to read Technical Context | RD-P3 | **DONE** (`1bf7a74`, `c60cf57`, `e49ed36`, `3de3d89` — generator + content-review prompts now read `technical_context.{stack, constructs, seniority_band, codebase_expectations}` and `dispositional_weights`, with verbatim-token BDD lock) |
| RD-18 | Implementer agent has zero Role Discovery context; its `persona` field is `'junior' \| 'senior'` (acting persona), not `CandidatePersona` | `implementerAgent.ts:56` | Add Role Context Document to implementer input | RD-P3 | **DONE** (`f24f87e`, `c60cf57`, `e49ed36` — `CallImplementerAgentInput` threads `dispositionalWeights` into a qualitative team-disposition addendum on the system prompt, with bucket-direction BDD lock) |
| RD-19 | Scorer evaluates only against `plantedBugs[]` ground truth; 6-dimension BARS rubric has no role-specific calibration | `scorerAgent.ts:54`, `scorerRubric.yaml` | Add Dispositional Context weights to scorer per research Q4 | RD-P3 | **DONE** (`f24f87e`, `c60cf57`, `3de3d89` — `applyDispositionalWeights` with sign-preservation clamp `[0.5, 1.5]`, `ScorerInput.dispositionalWeights` threaded through `computeOverallScore`, scorer model switched off Qwen family to satisfy ADR-032 independence rule; production model pending CAL-1..4) |
| RD-20 | Repo search uses skill-keyword join (`mustHaveSkills[]`) only; no pairing on codebase-shape signals | `matchRepos.ts:139-175`, `discover.ts:46-71` | ~~Extend matchRepos with Technical Context construct signals~~ | RD-P3 | **SUPERSEDED** (Decision Log 2026-04-14: Vectorize path replaces SQL construct matching. Constructs are fuzzy signals from LLM/heuristic tagging — hard SQL filters cause recall collapse and taxonomy drift. Semantic recall via `repo_searchable_profile` embeddings resolves the underlying gap without brittle joins.) |
| RD-21 | `repo_constructs` semantic layer exists but is not driven by Role Discovery signals | `migrations/0021_qualified_repos.sql:86-94`, `matchRepos.ts` | ~~Join `repo_constructs` against Technical Context construct tags~~ | RD-P3 | **SUPERSEDED** (same rationale as RD-20 — constructs now carried as soft signal in profile embedding + Gemma rerank context, not as SQL hard filter) |
| RD-22 | Repo DB has no README embeddings; embedding-based semantic search is deferred | `migrations/0021_qualified_repos.sql` | Deferred — structured summaries via RD-23 Pass 3 are the MVP path | RD-P3 | DEFERRED |

#### Scorer model calibration (supports RD-19)

RD-19 plumbs RCD dispositional weights into the scorer, but it leaves open the question of *which model* should run the scoring call. The research brief's model routing table lists Devstral as production scorer with Sonnet 4.6 as offline oracle (CR-12), but that pairing was inherited from the code-review-arena spec and has not been empirically validated against the 6-dimension BARS rubric. Gemma 4 26B is already the workhorse for the culture scorer and satisfies the **model-independence rule** (must be a different family than the Qwen 2.5-Coder implementer it scores — same rule ADR-032 applies to the consistency classifier).

The scorer is currently set to Gemma 4 26B (`@cf/google/gemma-4-26b-a4b-it`) as a **provisional default** pending a three-way empirical comparison. This section defines the calibration harness that picks the production scorer.

**Hypothesis:** Gemma 4 26B, Devstral Small, and Claude Sonnet 4.5 produce statistically indistinguishable 6-dimension BARS scores on our fixture set. If true, we ship Gemma (cheapest, already in the stack, satisfies independence). If false, the differences determine the routing.

**Methodology:**

1. **Fixture set — 30 to 50 completed review sessions (CAL-1).** Each fixture is a full `ScorerInput` payload with ground-truth planted bugs and a known seniority level. Mix of personas, PR shapes, and conversation lengths. Fixtures live under `workers/api/fixtures/scorer-calibration/{id}.json` alongside a sidecar `{id}.ground-truth.json` documenting which planted bugs were genuinely caught. The fixture set must cover the full BARS anchor range (at least one session expected to score 1, one expected 5, per dimension) or the κ measurement will be non-informative due to range restriction.

2. **Harness — three-way run (CAL-2).** `workers/api/scripts/calibrate-scorer.ts` runs `scoreReviewSession` against every fixture under three provider overrides: Gemma 4 26B on Workers AI, Devstral Small on Mistral, and Claude Sonnet 4.5 on Anthropic. Raw results land in `workers/api/fixtures/scorer-calibration-runs/{timestamp}/{provider}/{fixture}.json`. The script is re-runnable and idempotent — each run is a new timestamped directory, prior runs are preserved for regression comparison.

3. **Metrics — Cohen's weighted κ + ICC (CAL-3).** `workers/api/scripts/analyze-scorer-calibration.ts` reads a run directory and computes:
   - **Per-dimension weighted Cohen's κ** (quadratic weights, since BARS is ordinal) for every pair: Gemma↔Devstral, Gemma↔Sonnet, Devstral↔Sonnet. Weighted κ penalizes larger disagreements more than adjacent-band disagreements, which matches the BARS anchor semantics.
   - **Composite ICC(2,1)** across the 6-dimension score vectors — agreement on the overall score, not just individual dimensions.
   - **Bias** (mean score delta per dimension per pair) — catches systematic leniency or severity drift that κ alone can miss.
   - **MAE** per dimension — raw distance, easier to reason about than κ for stakeholder writeups.
   - **Sonnet as oracle** for the three communication dimensions (`reasoning_quality`, `question_formation`, `prioritization`) where there is no structural ground truth — for these dimensions we treat Gemma↔Sonnet and Devstral↔Sonnet κ as the operative number, since there is no external referent.
   - Output: `scorer-calibration-runs/{timestamp}/report.md` with a table per dimension and a recommendation.

4. **Decision rule (CAL-4).**
   - **Pass threshold:** κ ≥ 0.75 on all 6 dimensions (matches ADR-032 CR-10 gold-standard oracle target).
   - **Escalation rule:** any dimension with κ < 0.70 against Sonnet must be escalated — that specific dimension runs on Sonnet live, not the cheaper model, while the rest of the dimensions stay on the cheap model. This mirrors ADR-032's per-dimension escalation pattern and avoids blanket upgrades.
   - **Tie-breaking:** if Gemma and Devstral both clear κ ≥ 0.75 with overlapping confidence intervals, pick Gemma (cheapest, already in the Workers AI binding, satisfies independence rule without fetch overhead).
   - **Failure mode:** if neither cheap model clears the threshold, Sonnet 4.5 becomes the production scorer and the cost budget for Phase 3 is revised upward in a new decision log entry.

5. **Continuous calibration loop with domain expert adjudication (CAL-5) — NOT STARTED, DEFERRED until CAL-1..4 complete.**

    CAL-1..4 is a one-shot offline pick. CAL-5 is the ongoing loop that keeps the scorer honest in production. The design conversation on 2026-04-11 surfaced that calibration is the same problem for code review and culture interviews, just with different rubrics and different expert pools, so the infrastructure should be built once and partitioned by domain.

    **Shape:**
    - **Worker endpoint `POST /rpc/calibrate/score`** — unified scoring surface used by the harness (replaces the fragile REST shim we built in CAL-2, which hit Cloudflare AI 503 "Max retries exhausted" ~50% of the time on Gemma 4 26B), by shadow scoring on real sessions, and by future "rescore this" UX. Runs inside the Worker so `env.AI` binding behavior matches production exactly.
    - **Cases collection, not feedback.** Unit is an immutable `calibration_cases` row: a ScorerInput snapshot with `{id, scoring_domain: 'code_review' | 'culture_interview', source, created_at, status}`. Many `calibration_scores` rows attach to a case over time, one per voice: production model, shadow models, Sonnet oracle, domain expert(s). A case never mutates; only new scores are appended.
    - **Authority hierarchy.** Rubric is the constitution. Sonnet oracle is the default judge (consistent, cheap via Claude Code subscription, applies the rubric uniformly). Domain experts are senior judges — higher trust than oracle on edge cases, but two experts disagree ±1 routinely, so they vote, they don't declare. **Recruiters do NOT adjudicate code review scores** — only vetted senior engineers do. For culture scoring, recruiters may be domain experts because they genuinely know team-fit; see CAL-6.
    - **Expert feedback enters the scorer through three legible paths, not gradient descent.** (a) Contested cases get promoted into the CAL-1 fixture corpus so every subsequent CAL-2 run measures against expert-adjudicated anchors. (b) Systematic expert/oracle divergence on a dimension triggers a prompt revision in `scorerPrompts.ts` or a BARS anchor clarification. (c) If a model provider consistently disagrees with experts, CAL-4 switches production to a different provider. We never fine-tune — every change is git-committed, ADR'd, and legally defensible under ADR-031.
    - **Trigger surface.** Cases get created from: (a) manual promotion of a real session to "worth expert review," (b) CAL-2 synthetic fixtures, (c) later, automatic shadow-on-every-session once experts are wired up. Batch runs (Sonnet oracle + rolling κ + drift alarm) kick off via cron every N hours, or manually via the existing `/calibrate-scorer` skill, or on CI when `scorerPrompts.ts` changes.
    - **Expert review UI is scoped down hard for v1.** A single admin-only page listing pending cases in the domain(s) the viewer has permission for, showing transcript + rubric + a per-dimension scoring form. No assignment flows, no SLAs, no queues with filters.
    - **Expert grant mechanism — DEFERRED.** v1 is a D1 column (`calibration_expert_domains: string[]`) on the recruiter user row, flipped manually with SQL. No invite UX, no marketplace, no self-service. Revisit only when there is a second person to grant the privilege to.

    **What this does not cover:** ADR-037 (proposed) should capture the cases model, the authority hierarchy, the trigger surface, and the three legible paths in detail. That ADR is a prerequisite for CAL-5 implementation — do not build the endpoint and the D1 schema until the ADR is written and accepted, or the design drifts.

6. **Culture scorer calibration equivalent (CAL-6) — NOT STARTED, DEFERRED.**

    The culture interview scorer (Gemma 4 26B, 5 dimensions × 5 axes + synthesis, per CLAUDE.md routing table) has no calibration harness today and no fixture corpus. OQ-2 flags "Mistral/Devstral performance on behavioral scoring (QWK unknown)" and BC-19 commits to a QWK ≥ 0.60 target, but neither is operationalized. CAL-6 is the culture-domain analog of CAL-1..4: build a culture fixture schema, author an anchor set that covers the 5×5 grid, port `calibrate-scorer.ts` to run the culture scorer against it, and compute QWK per dimension.

    **Deferred because:** (a) code review is the killer feature and the culture scorer is the second pillar, not the first; (b) CAL-5 infrastructure (cases, Worker endpoint, expert review UI) should be built code-review-first so the culture side inherits a proven spine; (c) culture fixture authoring requires research-grade L/M/H anchors per BC-5, which is its own multi-day task; (d) we don't yet know how culture calibration will interact with the dispositional weights already threaded through the code review scorer. Picking this up requires a dedicated planning pass — do not silently merge it into CAL-5.

    **Tracking:** This row exists so CAL-6 does not get forgotten. When code review CAL-5 ships and the Phase 3 culture surface is warm enough to matter, promote this to a proper row with findings references and a phase assignment.

**Why this matters:** The scorer is the final signal the recruiter sees. A 0.15 κ drift in `issue_identification` is the difference between a candidate being advanced and rejected. The implementer is a persona, the classifier is a guardrail — the scorer is the verdict. We cannot run a blind model choice on the verdict call and the research brief (CR-10) is explicit that offline κ measurement is non-optional.

**Tracking:** See CAL-1 through CAL-4 in the task list (one-shot pick), CAL-5 above (continuous loop + expert adjudication, deferred until CAL-1..4 complete and ADR-037 is written), and CAL-6 above (culture scorer calibration equivalent, deferred pending dedicated planning pass). Decision on the CAL-1..4 pick is recorded in the Decision Log below once CAL-4 completes. OQ-2 is partially subsumed by CAL-1..4 for code review and fully subsumed by CAL-6 for culture — the Devstral-on-behavioral-scoring question does not apply to the code-review rubric but the methodology transfers directly when we run the equivalent harness for culture.

**Operational documentation:** The full runbook, cost model, fixture authoring rules, and decision log live in [`knowledge/calibration/`](calibration/README.md). That folder is the operational expansion of this section — when you are about to run the harness or revise a fixture, read the runbook there. When this paragraph and the folder disagree, this paragraph wins and the folder is wrong.

#### Repo Understanding — 3rd AI pass (RD-23 through RD-24)

| # | Finding | Source | Plan action | Phase | Status |
|---|---|---|---|---|---|
| RD-23 | Crawler has zero LLM calls; Pass 1 + Pass 2 are deterministic. `repo_sample_prs` metadata is the richest substrate but nothing reasons over it. No 3rd AI pass exists. | `scripts/crawl-repos/index.ts`, `scripts/crawl-repos/pass2/prSample.ts:126-138` | Add crawler Pass 3 (offline, Haiku 4.5) writing to new `repo_engineering_signals` table per ADR-036 Repo Understanding Contract | RD-P4 | **DONE — code** (`1bf7a74` — `scripts/crawl-repos/pass3/persist.ts` D1 writer with content-hash idempotency; `.claude/commands/crawl-repos-pass3.md` — Claude Code skill that orchestrates the Haiku 4.5 summarizer and writes `repo_engineering_signals`; `scripts/crawl-repos/index.ts` `--pass3` flag shells out to the skill so cron/CI has one CLI surface). **Not yet run against production D1** — queued as a manual batch operation once the Pass 1 + Pass 2 seed set is in place. Pass 3 lives as a slash command rather than a `summarize.ts` module because the Haiku call has to route through the Claude Code Agent tool path (not reachable from plain `npx tsx`), and the model-family independence rule (ADR-032) is easier to enforce when Pass 3 and the Stage-2 rerank run in entirely different execution environments. |
| RD-24 | `matchRepos` is SQL-only; no role-fit reasoning layer between SQL candidates and final ranking. Repo library and Role Discovery meet only at keyword join. | `matchRepos.ts:139-176`, `discover.ts:46-71` | Add Worker runtime role-fit pass (Gemma 4 26B) reading Role Context Document + `repo_engineering_signals`, writing to new `repo_role_alignment` table. `matchRepos` becomes stage-1 retriever; Worker does stage-2 rerank. | RD-P4 | **DONE** (`f24f87e`, `ff639a4` — `roleFitRerank.ts` + cache-aware `rerankPipeline.ts` (key invariant `role_context_id + rcd_version + signals_version`) + `discover.ts` wiring with failure isolation. `createRoleAgentProvider` instantiated at the route boundary so the rerank fires live on `/api/v1/pipelines/:id/repo-discovery`. Missing RCD / missing signals / provider down → silent fallback to `matchRepos` order.) |

#### Agent architecture redesign (RD-25 through RD-42)

> Source: Brief 5 — `knowledge/role-discovery/role-discovery-sales-intake.md` · 247 sources · 2026-04-11
> Sequencing note: ~~Ship RD-P5 before RD-P1.~~ **RD-P5 shipped 2026-04-13.** Conversation quality fixed — the Role Context Document that the synthesis rewrite (RD-P1) will emit is already richer. Next: RD-P1 → RD-P2 (culture wiring) → RD-P3 (code review wiring).

**Group A — Missing phased architecture**

| # | Finding | Source | Plan action | Phase | Status |
|---|---|---|---|---|---|
| RD-25 | Single monolithic prompt tries to be rapport-builder + divergent prier + Challenger + MEDDIC closer simultaneously; postures conflict and produce vague, goal-light interviews | `workers/api/src/lib/roleAgentPrompts.ts`, sales-intake brief intro | Refactor to `callControllerAgent()` + 5 phase-specific prompt builders; controller selects posture each turn based on `ConversationContext` | RD-P5 | DONE |
| RD-26 | Phase advancement is hardcoded to question budget (turn count), not coverage — terse HMs exhaust phases early, verbose ones never reach prioritization or EVP | `workers/api/src/routes/discovery/roleContexts.ts` `:id/respond` handler | Controller agent advances phase on coverage completion, not turn count; `synthesisAllowed` gate in `PhaseDirective` | RD-P5 | DONE |
| RD-27 | SPIN Implication + Need-Payoff probe types absent — Problem domain probed but urgency never built ("if role stays open 60 days, what's delayed?", "if someone ships independently in 30 days, how does that change Q3 planning?") | sales-intake brief Part 2.1, R1-S3/S36 (35,000-call Huthwaite study) | Add Implication + Need-Payoff probe types to DISCOVERY phase prompt as explicit directives | RD-P5 | DONE |
| RD-28 | Sandler Pain Funnel missing — stated pain never escalated to quantified business pain or personal emotional stakes | sales-intake brief Part 2.3 | Add three-tier Pain Funnel escalation (surface → business → emotional) to DISCOVERY phase prompt | RD-P5 | DONE |

**Group B — Divergent discovery gaps**

| # | Finding | Source | Plan action | Phase | Status |
|---|---|---|---|---|---|
| RD-29 | No defamiliarization probes — agent never asks "what would confuse a new hire in week 1?" to surface hidden assumptions (Madsbjerg: defamiliarize the familiar) | sales-intake brief Part 2.8 | Add defamiliarization probe type to DISCOVERY phase prompt directives | RD-P5 | DONE |
| RD-30 | Says/Thinks gap not probed — accepts "we value work-life balance" without "what does it feel like when someone doesn't share that value?"; the fear reveals what the value actually means | sales-intake brief Part 2.8 (IDEO Says/Thinks/Does/Feels) | Add Rule 6 (probe Says/Thinks gap) to DISCOVERY phase prompt | RD-P5 | DONE |
| RD-31 | Stories never extracted as structured artifacts — concrete anecdotes with named protagonists, stakes, resolution are the most retellable signal; exchanges store raw text only | sales-intake brief Part 2.5 (Green & Brock: stories 22× more memorable than facts) | Add `storiesExtracted: StoryRecord[]` to `knowledgeStateUpdate`; controller checks `storiesExtracted.length === 0` at turn 14 and redirects | RD-P5 | DONE |
| RD-32 | JTBD four forces not extracted — Push (what's broken in their current situation?), Pull (what's possible here?), Anxiety (what's the worry?), Habit (what's the safe default?) never captured | sales-intake brief Part 2.4, R4-S10 (Christensen JTBD) | Add four-forces probing to DISCOVERY phase prompt; carry into `demandSidePitch` block of `RecruitmentBrief` | RD-P5 | DONE |
| RD-33 | Day-in-the-life never probed — Cooper goal-directed design requires walking a specific day ("walk me through Tuesday: 9am standup, 2pm code review — what does this person actually say and catch?") before synthesis; abstract requirement lists accepted | sales-intake brief Part 2.7 (R4-S21, Cooper) | Add Rule 8 (mandatory day-in-the-life) as a gate condition: controller blocks DISCOVERY → PRIORITIZE transition until `dayInLifeProbed: true` | RD-P5 | DONE |

**Group C — Convergent prioritization gaps**

| # | Finding | Source | Plan action | Phase | Status |
|---|---|---|---|---|---|
| RD-34 | No must-have prioritization checkpoint — all requirements treated equal weight; "if you could keep only 3–4, what are non-negotiables?" never asked; leads to purple-squirrel searches (research: 41% more likely to change requisitions mid-search) | sales-intake brief Part 3.4 (MEDDIC decision criteria) | Add prioritization checkpoint to PRIORITIZE phase prompt; controller sets `mustHavesPrioritized: true` after HM forces ranking; blocks synthesis until set | RD-P5 | DONE |
| RD-35 | Requirements captured as nouns not verbs — records "Kafka" when real requirement is "minimize message loss during traffic spikes" (Ulwick ODI: direction + metric + object + context) | sales-intake brief Part 2.6, R4-S8 (Ulwick ODI) | Add Rule 3 (probe noun → verb) + Rule 4 (translate to outcome statement format) to PRIORITIZE phase prompt | RD-P5 | DONE |
| RD-36 | No MEDDIC qualification layer — economic buyer, champion, decision process, budget approval, and timeline urgency never captured; agent can spend 20 turns on an unbudgeted role | sales-intake brief Part 2.2 | Add `qualificationStatus: QualificationStatus` to `ConversationContext`; QUALIFY_CLOSE phase uses dedicated MEDDIC prompt | RD-P5 | DONE |

**Group D — EVP and friction gaps**

| # | Finding | Source | Plan action | Phase | Status |
|---|---|---|---|---|---|
| RD-37 | EVP coverage not tracked — Gartner 5-category EVP (Rewards / Opportunity / Work / People / Organisation) not checked as a completeness dimension alongside the 6 role domains | sales-intake brief Part 3.3 (Gartner TalentNeuron: 42% of offer acceptance driven by EVP) | Add `evpCoverage: Record<EvpCategory, DomainCoverage>` to `ConversationContext`; EVP gate fires when controller enters EVP_FRICTION phase | RD-P5 | DONE |
| RD-38 | Transparent friction not probed — RJP meta-analysis (Earnest et al. 2011, k=52, n≈17,000): hiding friction increases 90-day turnover 35%; agent never asks "what might surprise a candidate?" or "why did the last person leave?" | sales-intake brief Part 3.2 | Add mandatory friction probe to EVP_FRICTION phase; controller blocks synthesis if `frictionProbed: false`; friction framed as trade-off in `RecruitmentBrief`, never as flaw | RD-P5 | DONE |

**Group E — Missing recruitment_brief synthesis artifact**

| # | Finding | Source | Plan action | Phase | Status |
|---|---|---|---|---|---|
| RD-39 | Synthesis produces only `CandidatePersona` (scorecard consumer) — no structured artifact for recruiter outreach: EVP coverage, structured stories, friction framing, demand-side pitch, compensation narrative are discarded | sales-intake brief Part 4 | Add `RecruitmentBrief` type to `workers/api/src/types.ts`; emit from synthesis alongside existing artifacts; add `recruitment_brief_json` column to D1 `role_contexts` table | RD-P5 | DONE |
| RD-40 | Demand-side flip never happens — agent never asks "why would a top engineer leave their job for this?" (JTBD demand-side); `RecruitmentBrief` has no pull narrative | sales-intake brief Part 2.4 (JTBD demand-side flip, Rule 12) | Add Rule 12 (demand-side flip) as required probe in EVP_FRICTION phase prompt | RD-P5 | DONE |

**Group F — Controller and context infrastructure**

| # | Finding | Source | Plan action | Phase | Status |
|---|---|---|---|---|---|
| RD-41 | Turn controller passes only `exchanges` and `knowledgeState` to agent — agent cannot see which EVP categories, qualification elements, or story gaps exist; cannot self-direct to fill them | `workers/api/src/routes/discovery/roleContexts.ts` `:id/respond`, `workers/api/src/lib/roleAgent.ts` `CallRoleAgentInput` | Add full `ConversationContext` (domain + EVP + qualification + story + phase state) to every agent call; controller receives it first and emits `PhaseDirective` | RD-P5 | DONE |
| RD-42 | No forcing functions for completeness — three structural guarantees absent: (a) EVP coverage gate before synthesis, (b) must-have prioritization checkpoint before EVP phase, (c) friction probe before synthesis | sales-intake brief Part 3.6 | Wire three gates into controller's `synthesisAllowed` logic in `PhaseDirective`; all three must be `true` before `synthesisAllowed: true` is emitted | RD-P5 | DONE |

**New types implied by RD-P5 (sketch — details in implementation):**

```typescript
type ConversationPhase = 'CONTEXT' | 'DISCOVERY' | 'PRIORITIZE' | 'EVP_FRICTION' | 'QUALIFY_CLOSE';
type EvpCategory = 'Rewards' | 'Opportunity' | 'Work' | 'People' | 'Organisation';

interface ConversationContext {
  phase: ConversationPhase;
  domainCoverage: Record<string, DomainCoverage>;    // existing
  evpCoverage: Record<EvpCategory, DomainCoverage>;  // new
  storiesExtracted: StoryRecord[];                    // new
  qualificationStatus: QualificationStatus;           // new
  mustHavesPrioritized: boolean;                      // new
  frictionProbed: boolean;                            // new
  dayInLifeProbed: boolean;                           // new
}

interface PhaseDirective {
  phase: ConversationPhase;
  focusGoal: string;        // one-line directive for phase agent
  urgentGaps: string[];     // specific gaps controller identified
  synthesisAllowed: boolean;
  reasoning: string;        // inspectable — why this phase/directive
}
```

### Open questions (28 items — things research could not resolve)

> Items OQ-1 through OQ-12 are from the code review + behavioral/culture briefs.
> Items OQ-13 through OQ-22 are from the challenge authoring brief (2026-04-09).
> Items OQ-23 through OQ-28 are from the needs discovery brief (2026-04-11).

| # | Question | Action |
|---|---|---|
| OQ-1 | No published STAR-specific LLM scoring benchmark | Build PIPE-specific labeled evaluation dataset during beta (deliverable of `/calibrate` over time) |
| OQ-2 | Mistral/Devstral performance on behavioral scoring (QWK unknown) | Code-review scorer calibration via CAL-1..CAL-4 (Gemma vs Devstral vs Sonnet, κ + ICC, see "Scorer model calibration" above). Culture equivalent to follow once the code-review harness is validated. |
| OQ-3 | Culture signal vs. coaching signal | Unexpected follow-ups + RM signals as mitigation; monitor coaching saturation empirically |
| OQ-4 | Async text vs. synchronous voice validity | Treat existing literature as upper bound for async text; measure empirically |
| OQ-5 | Illinois AIVIA text-only applicability | Consult employment counsel before launch in Illinois |
| OQ-6 | P-O fit causality | Never claim performance prediction from culture scores |
| OQ-7 | Intersectional bias in text-only behavioral scoring | Internal bias audit with demographically varied synthetic candidates |
| OQ-8 | Criterion validity for code review (no study exists) | 90-day concurrent study with first paying customer |
| OQ-9 | Turn-level vs encounter-level scoring trade-off | Empirical validation during beta; default to encounter-level |
| OQ-10 | Reactivity calibration ground truth | Post-MVP calibration study with 15 expert reviewers |
| OQ-11 | AI-direction BARS rubric (no prior art) | Critical-incident study with expert reviewers to derive anchors |
| OQ-12 | Content freshness decay curve | Monitor leakage empirically after first candidate cohorts |
| OQ-13 | Bloom's → challenge type routing unvalidated for developer roles | Internal validation with real developer challenges before encoding in generation pipeline |
| OQ-14 | Gemma 4 26B MCQ Bloom's alignment accuracy vs. larger models | Pilot-test Gemma; use Opus for gold-standard seeds; fallback to Sonnet if Gemma underperforms |
| OQ-15 | Judge0 hosting: self-host vs. RapidAPI managed | Start with RapidAPI; self-host on Fly.io when volume justifies ops burden |
| OQ-16 | Candidate language choice vs. recruiter-locked language | Recruiter sets allowed languages; candidate picks from allowed set |
| OQ-17 | Confidence score calibration thresholds for recruiter UX | No published research; need internal testing to set green/yellow/red thresholds |
| OQ-18 | Voice/video challenge execution pipeline | Long-form text is straightforward; voice/video need R2 storage + transcription; scope separately |
| OQ-19 | IRT calibration cold-start (need n≥100 responses/item) | Post-launch feature; improves over time with candidate volume |
| OQ-20 | Fairness validation for AI-generated challenges | Define Pipe-specific bias criteria; language diversity, background-agnostic framing |
| OQ-21 | Template pack sizing for competitive positioning | 50-75 seed templates across 7 packs for launch; scale via AI generation |
| OQ-22 | Per-language scoring equivalence (should difficulty/rubrics differ by language?) | Recommendation: challenge is skill-agnostic; scoring identical per language |

> Items OQ-23 through OQ-28 are from the needs discovery brief (Brief 5, 2026-04-11).

| # | Question | Action |
|---|---|---|
| OQ-23 | Market data access for Challenger reframes — agent has no salary benchmark source; comp alignment probes in PRIORITIZE phase assume external data the agent doesn't have | Decide: surface external salary API (e.g. Levels.fyi, Radford) or require HM to self-report comp range + market context; scope decision in RD-P5 design pass |
| OQ-24 | Story retellability — when is a story "good enough" for the `RecruitmentBrief`? No published threshold | Heuristic: named protagonist + specific time/place + challenge + resolution = HIGH; controller uses this to decide whether to probe for more story detail or advance |
| OQ-25 | Phase budget adaptability — if HM covers Phase 2 domains in 7 turns (terse), should controller compress Phase 2 and promote to Phase 3 early? If HM is at turn 18 still in Phase 2 (verbose), does Phase 4 get skipped? | Yes to early promotion; no to skipping EVP_FRICTION — it can be compressed to 1 turn but friction probe is non-negotiable (RJP evidence). Controller must never skip a phase, only compress. |
| OQ-26 | Challenger reframe tone in text-only channel — "teach, tailor, take control" can read as combative without tone-of-voice softening | Frame as curiosity, not confrontation: "I notice the market for this role typically commands $X — want to make sure we're positioned to attract the pool you're targeting" |
| OQ-27 | RCD vs. `recruitment_brief` boundary — should stories extracted during discovery live in `domain_matrix` (inside RCD) or only in `recruitment_brief`? | Both: stories live in `domain_matrix` as `StoryRecord[]` (qualitative evidence for scorecard), AND in `recruitment_brief` filtered/framed for recruiter outreach. Different consumers; `recruitment_brief` may surface a subset with a retellability filter applied. |
| OQ-28 | Multi-stakeholder EVP conflict — HM says "great work-life balance," TM says "3 crunch weeks per year" — which narrative goes to the candidate? | Tell both as honest range in `transparentFriction` block of `RecruitmentBrief`, framed as trade-off. This is the RJP principle applied to multi-stakeholder data: disagreement is its own category, not averaged. |

---

## Phased roadmap

### Phase 1 — Core format alignment (weeks 1–4)

**Goal:** Bring the live Worker pipeline into alignment with the research briefs on format, scoring, and agent architecture. No new infrastructure — retarget what exists.

**Code review:**
- CR-1: Multi-PR challenge type (3 PRs default)
- CR-2, CR-4: BARS rubric YAML file + loader in Worker
- CR-3: Expand scorer from 4 → 6 dimensions (adds revision evaluation + AI direction)
- CR-6: Persona YAML with reactivity parameters
- CR-8, CR-9: Verify encounter-level scoring + separate invocations
- CR-12: Apply model routing (implementer tiering, scorer oracle for offline calibration)
- CR-20: Verify scaffolding is Tier 1–2 only
- CR-25, CR-26: Revision evaluation + AI direction dimensions (requires CR-3 first)
- CR-31: Ship with 3 PRs default

**Behavioral/culture:**
- BC-2, BC-38: Upgrade every behavioral question to 5-point BARS with concrete anchors
- BC-3: Verify 6–9 questions / 35–55 min FSM
- BC-4, BC-5: Multi-agent criterion decomposition with L/M/H calibration
- BC-8, BC-10, BC-36: Architecture audit of `cultureAgent.ts` against target
- BC-9: Resume-agnostic scoring enforcement
- BC-11, BC-12: Probe generator with 5 trigger types + max-2 budget
- BC-13: STAR completeness scratchpad
- BC-21, BC-22, BC-26: Reframe all culture UX as "values alignment + working style complementarity", attitudinal framing
- BC-23: Benchmark-first culture profile UX (recruiter defines org profile before scoring candidates)
- BC-33: Decouple content from style scoring in prompts
- BC-34, BC-45: Human-in-loop + evidence-linked scoring
- BC-37: Question composition rule (4–6 PBQ + 1–2 SQ + 1 calibration)
- BC-42: Recruiter report with evidence quotes

**Deliverables:**
- `workers/api/src/lib/scorerRubric.yaml` — 6-dimension BARS rubric
- `workers/api/src/lib/personas/{junior,mid,senior}.yaml` — reactivity parameters
- Updated `scorerPrompts.ts`, `prompts.ts`, `cultureAgentPrompts.ts`
- Updated `cultureAgent.ts` with FSM + ReAct + scratchpad + specialist sub-agents
- Updated recruiter report UI with evidence links

**Exit criteria:**
- `/calibrate --auto` reaches ≥60% calibration on code review with new 6-dimension rubric
- Culture agent passes a manual 15-candidate test for STAR completeness + evidence linking

### Phase 2 — Agent quality chain + gold corpus (weeks 5–8)

**Goal:** Build the consistency classifier (the #1 engineering risk per research), establish the gold-standard calibration corpus, and create the Sonnet oracle.

**Code review:**
- **CR-5: Gemma 4 12B consistency classifier** — this is the highest-priority item in the entire plan
- CR-10: Claude Sonnet 4.6 offline oracle for Cohen κ measurement
- CR-11: Gold-standard conversation corpus (10 transcripts to seed, grow over time)
- CR-27: Persona-calibrated reactivity measurement via `/calibrate`

**Behavioral/culture:**
- BC-6, BC-7: Belief-state tracking with PBA judge
- BC-14: Difficult-response handling rules
- BC-15: Belief-state delta as evasion detector
- BC-18: Scratchpad + compaction + pinned exchanges for long interviews
- BC-19, BC-20: QWK calibration target + verbosity bias monitoring
- BC-40: Full scoring pipeline implementation
- BC-41: L/M/H calibration + post-hoc Platt scaling

**Deliverables:**
- `workers/api/src/lib/consistencyClassifier.ts` (new Worker function)
- Gold corpus storage scheme (D1 table or R2 bucket)
- Sonnet 4.6 calibration oracle runner (offline script using Agent tool)
- Belief-state judge in `cultureAgent.ts`
- QWK measurement harness

**Exit criteria:**
- Consistency classifier runs on every implementer turn in production
- `/calibrate --auto` reaches ≥80% calibration
- Devstral vs Sonnet Cohen κ ≥ 0.75 on gold corpus

### Phase 3 — Content pipeline (weeks 9–12)

**Goal:** Build the rolling-freshness AIG content pipeline so the founder can produce new code review items sustainably at ~$0.003/item.

**Code review:**
- CR-13: Hybrid real-skeleton + planted bug pipeline (role-matched repo discovery via Libraries.io + stack-analyser + GitHub API)
- CR-14: Rolling-freshness gate via Libraries.io `pushed` date filter + quarterly advance
- CR-15: 10 bug templates + Claude Sonnet variant generator
- CR-16: Execution-based ground truth via CI sandbox
- CR-17: 4-dimension tagging + selection-query schema
- CR-18: Initial 15-item bank (3 difficulty × 5 skills × TS/React)
- CR-19: Permissive-license filter + PII strip

**Behavioral/culture:**
- BC-16, BC-17: Reality Monitoring signals + cognitive-load follow-ups (research-grade fabrication detection)

**Deliverables:**
- `scripts/discover-repos.ts` — role-matched repo discovery (Libraries.io + GitHub API + specfy/stack-analyser)
- `scripts/assess-repo-quality.ts` — quality assessment (scc complexity + test suite validation + flakiness check)
- `scripts/generate-variants.mjs` — Claude Sonnet variant generator (Agent tool)
- `scripts/verify-planted-bugs.mjs` — CI sandbox execution harness
- `workers/api/src/seed/code-review-items.ts` — 15-item seed bank
- Item bank schema migration in D1

**Exit criteria:**
- 15 code review items in production, all tagged, all execution-verified
- Quarterly refresh cron running

### Phase 4 — Validity framework + compliance (ongoing, hard deadline 2026-08-02)

**Goal:** Ship the validation file, adverse-impact monitoring, and EU AI Act compliance before August 2, 2026.

**Code review:**
- CR-23: Lightweight job analysis + CVR mapping
- CR-24: Concurrent-validity study protocol (ready for first paying customer)
- CR-28: `docs/validation/` directory from day one

**Behavioral/culture:**
- BC-28: Illinois AIVIA disclosure + non-AI alternative
- BC-29: EEOC vendor-liability disparate impact monitoring
- BC-30: **EU AI Act conformity assessment — HARD DEADLINE 2026-08-02**
- BC-31: NYC Local Law 144 annual bias audit
- BC-35: Disclosure + consent + non-AI alternative UI
- BC-43: Compliance UI components
- BC-44: Data retention policy + D1 schema for AIVIA 30-day deletion

**Deliverables:**
- `docs/validation/` directory structure
- Disclosure screen UI component
- Adverse-impact monitoring dashboard (recruiter-facing, internal)
- Bias audit report template
- Data retention migration

**Exit criteria:**
- Full EU AI Act conformity before 2026-08-02
- Illinois AIVIA compliance before any Illinois launch
- First concurrent-validity study running with first paying customer

### Challenge Authoring phases (parallel track, per ADR-034)

> These phases run in parallel with the CR/BC phases above. They share D1 and the Worker but are otherwise independent.

#### CA Phase 1 — Data foundation (can start immediately)

**Goal:** Replace hardcoded `challengeLibrary.ts` with D1-backed template system.

- CA-7: D1 migration for `challenge_templates`, `challenge_language_variants`, `template_packs`, `template_pack_items`
- CA-8: Immutability enforcement (publish locks, version-on-edit)
- CA-9: Language variant schema
- CA-20: Seed script migrating existing ~50 templates from `challengeLibrary.ts` → D1
- Template pack + challenge template CRUD API routes
- `expandPack()` replaces `expandPreset()`
- Seed 7 default packs (Frontend/Backend/Fullstack × Junior/Mid + Fullstack Mid)

**Deliverables:**
- `workers/api/migrations/0004_challenge_authoring.sql`
- `workers/api/src/routes/cockpit/templatePacks.ts`
- `workers/api/src/routes/cockpit/challengeTemplates.ts`
- `workers/api/scripts/seed-challenge-templates.ts`

**Exit criteria:**
- Template packs queryable via API
- `expandPack()` produces same output as `expandPreset('DEFAULT')`
- 7 seed packs with 5 challenges each in D1

#### CA Phase 2 — Template Pack UX

**Goal:** Recruiters can browse packs by role, pick/customize, and build pipelines via the 4-step wizard.

- CA-13: 4-step wizard (Source → Select → Refine → Review)
- CA-14: Role-based template pack browser
- CA-15: Right-sidebar drawer for challenge editing

**Deliverables:**
- `src/components/Pipeline/TemplatePackBrowser.tsx`
- `src/components/Pipeline/ChallengeWizard.tsx`
- Updated `ChallengeEditorPage.tsx` with drawer layout

**Exit criteria:**
- Recruiter can create a pipeline from a FRONTEND_MID pack in < 2 minutes
- Custom challenge creation works via wizard flow

#### CA Phase 3 — AI Generation Pipeline

**Goal:** Role discovery output feeds into challenge generation with quality gates and confidence scoring.

- CA-1: Multi-agent pipeline (generate → review → evaluate → calibrate → approve)
- CA-2, CA-3: CoT + in-context learning + misconception-based distractors for MCQ
- CA-4: Cross-model-family content review
- CA-5: Bloom's routing (validate internally first)
- CA-6: Wire `persona.mustHaveSkills` as generation input
- CA-16: Confidence score display (Topic Relevance, Role Fit, Clarity)
- CA-19: Use Opus for gold-standard seed templates

**Deliverables:**
- `workers/api/src/lib/challengeGenerator.ts`
- `workers/api/src/lib/challengeValidator.ts`
- Generation API route (`POST /api/v1/generate/challenges`)
- Confidence scoring UI in wizard

**Exit criteria:**
- Generate 5-8 challenges from a role context in < 30 seconds
- Content reviewer catches injected factual errors in >80% of test cases
- Confidence scores correlate with human quality ratings (spot-check)

#### CA Phase 4 — Multi-Language + Execution

**Goal:** Candidates can write code in JavaScript/TypeScript or Python, executed via Judge0.

- CA-10: Judge0 CE integration
- CA-11: Python + JS/TS language support
- CA-12: Per-challenge resource limits

**Deliverables:**
- `workers/api/src/lib/codeExecutor.ts` (Judge0 client)
- `POST /rpc/execute` candidate-facing route
- Language variant management UI
- Candidate language picker in challenge flow

**Exit criteria:**
- Candidate can submit Python or JavaScript code and see pass/fail results
- Resource limits enforced (no infinite loops, no memory bombs)
- Test suites run correctly for both languages on same challenge

---

## Deferred items (explicitly not dropped)

These findings are in the research and ARE in the plan, but are consciously deferred past MVP. Do not let the assistant forget them — they come back into scope at the exit criteria below.

| # | Deferred item | When it returns |
|---|---|---|
| CR-7 | Reactivity calibration study with 15 expert reviewers | When first paying customer asks for validation evidence |
| CR-32 | IRT calibration with n ≥ 100 attempts/item | After 3 months of real candidate volume |
| CR-33 | AutoIRT with LLM-simulated students | Only if cold-start calibration becomes critical before volume |
| CR-31 | 8-station summative mode | When first enterprise customer requests summative hiring tier |
| BC-24 | Harver OCAI culture archetype mapping (Clan/Adhocracy/Hierarchy/Market) | When recruiters ask for archetype-level culture benchmarking |
| BC-16 | Reality Monitoring fabrication detection | Phase 3 (optional uplift) |
| BC-17 | Cognitive-load unexpected follow-ups for fabrication detection | Phase 3 (optional uplift) |
| CA-17 | Batch variant generation (difficulty × language in one flow) | CA Phase 5 — after AI generation pipeline is validated |
| CA-18 | IRT difficulty calibration (Rasch 1PL, need n≥100/item) | After 3 months of real candidate volume (same trigger as CR-32) |

---

## What to NOT compromise on (locked-in decisions)

These are research-derived decisions that must not be traded away. Contradicting any of these triggers the guardrail.

1. **Multi-PR structure.** One PR is not enough. 3 minimum. (CR-1)
2. **BARS anchors.** Concrete behavioral descriptions at each level, not "poor/good/excellent". (CR-4, BC-38)
3. **Consistency classifier.** Agent drift will destroy the format. Build it in Phase 2, no shortcuts. (CR-5)
4. **Separate scorer and implementer calls.** No shared context. Ever. (CR-9)
5. **Validation file from day one.** Legal defensibility is not retrofittable. (CR-28)
6. **Text-only.** No audio/video features. Keep the bias-reduction differentiator. (BC-27)
7. **Resume-agnostic scoring.** Scoring agent never sees candidate profile. (BC-9)
8. **Culture scores are attitudinal predictors, not performance predictors.** Never claim otherwise. (BC-21)
9. **Human-in-the-loop for final decisions.** No AI-only rejection. (BC-34)
10. **Evidence-linked scoring.** Every dimension score references specific candidate utterances. (BC-45)
11. **Never use same model for implementer and consistency classifier.** (CR-12)
12. **Execution-based ground truth for planted bugs.** Not LLM-judge. (CR-16)
13. **Challenge templates immutable after publish.** Version-on-edit for fairness. Snapshot pack version at stage assignment. (CA-8)
14. **Content reviewer different model family from generator.** Same principle as consistency classifier. (CA-4)
15. **No client-side code execution for assessments.** Server-side via Judge0 for auditability and resource enforcement. (CA-10)
16. **Candidate-facing app must be server-side rendered.** Ground truth (planted bugs, scoring rubrics, correct answers) must never reach the browser. With CSR the Worker must send data to the client to render it — a candidate can open DevTools and read the planted bug locations. SSR renders HTML server-side; the raw data never touches the network. The candidate experience (`interview.pipe.com`) is a separate Cloudflare Pages deployment using React Router v7 (runs natively on Workers). The recruiter app (`app.pipe.com`) stays CSR — it's behind auth and has no ground-truth exposure risk.

---

## Current drift vs. plan (as of 2026-04-09)

Places where the current codebase does not match the plan. These need verification and correction.

| Item | Current state | Plan target | Action |
|---|---|---|---|
| Scoring dimensions | ✅ **DONE.** 6-dimension BARS rubric (`scorerRubric.yaml` + `scorerRubric.ts`). Scorer A (ground truth: issue identification, prioritization, revision evaluation) + Scorer B (communication: reasoning, question formation, AI direction). Composite: BARS×0.85 + effectiveness×0.15. Seniority-adjusted weights. | 6 dimensions per research | **Calibrate:** run `/calibrate --auto` to establish new baseline vs arena v19 (76.5%) |
| BARS anchors | ✅ **DONE.** Hodges-compliant 1-5 behavioral anchors for all 6 dimensions. Cross-checks enforced (e.g. <40% bugs → max score 3). | Concrete behavioral anchors at every level | Validate anchors produce discriminating scores via `/calibrate` |
| Multi-PR structure | Arena scores 6 cases individually; no aggregation | 3-PR sessions aggregated to single candidate score | New Worker challenge type + seed data |
| Consistency classifier | Does not exist | Gemma 4 12B classifier on every implementer turn | Build in Phase 2 |
| Persona reactivity | Hardcoded in `prompts.ts` (per /calibrate skill) | Versioned YAML with parametric reactivity | CR-6: next Phase 1 item |
| Content pipeline | ✅ **SUBSTANTIALLY DONE (2026-04-10).** Offline repo crawler replaces Libraries.io: `scripts/crawl-repos/` (Pass 1 + Pass 2). Tag-graph D1 index with `qualified_repos`, `repo_skills`, `repo_constructs`, `repo_sample_prs`. `matchRepos.ts` runtime — <50ms, no external API calls. Weekly GH Actions cron. SWE-bench eligible PRs sampled per repo. Remaining: AIG bug planting (CR-15), execution verification (CR-16). | AIG pipeline producing rolling-freshness items | CR-15 (bug templates via Claude Opus 4.6) + CR-16 (CI sandbox) |
| Repo discovery | ✅ **DONE + UPGRADED (2026-04-10).** Runtime now queries pre-populated `qualified_repos` catalog — no Libraries.io calls at request time. `discover.ts` rewritten to call `matchRepos`. `LIBRARIES_IO_API_KEY` no longer required at runtime. Old Libraries.io pipeline preserved in `librariesIo.ts` but unused. D1 migrations 0018 + 0021. | Role-matched repo discovery (CR-13) | ✅ Done — run crawler to populate DB |
| Validation file | Does not exist | `docs/validation/` with job analysis + CVR + rubric + IRR + subgroup analysis | Build in Phase 4 |
| Culture scorer architecture | `cultureAgent.ts` — needs audit against plan | FSM + ReAct + scratchpad + specialist sub-agents + summarization | Audit and upgrade in Phase 1 |
| Culture UI framing | Unknown — needs audit | "Values alignment + working style complementarity"; attitudinal not performance | Audit and reframe in Phase 1 |
| AIVIA / EU AI Act compliance | Not built | Disclosure + consent + non-AI alternative + conformity assessment | **HARD DEADLINE 2026-08-02 for EU AI Act** |
| **Role Discovery → downstream consumers** | Synthesis flattens Knowledge State into 8-field `CandidatePersona`. Culture reads 2 fields. Challenge generation reads 5. Repo search joins `mustHaveSkills[]` as keyword. Knowledge State is dead inventory. Research spec (`migration/dersign-thinking.md` Part 8) says Knowledge State is the canonical artifact. | Role Context Document (Team/Technical/Dispositional/Public Pitch sections) replaces persona; each downstream consumer reads its own section per ADR-036 | RD-1 through RD-22 — research plan at `knowledge/outputs/.plans/role-discovery-data-contract.md` |
| **Repo library AI reasoning layer** | Crawler Pass 1 + Pass 2 are deterministic (zero LLM calls). `matchRepos.ts` is SQL-only CTE join. No reasoning layer reads `repo_sample_prs` + constructs + stack with a role in mind. Repo library and Role Discovery meet at keyword join. | Crawler Pass 3 (offline Haiku) writes `repo_engineering_signals` per repo. Worker runtime role-fit pass (Gemma) writes `repo_role_alignment` per (role × repo). `matchRepos` becomes stage-1; Worker stage-2 reranks. All per ADR-036. | RD-23, RD-24 — research question Q11 loads the architecture choice |

The arena's v19 at 76.5% is the current best real-pipeline calibration. Every Phase 1 change should be measured against v19 as a regression baseline — if a change drops calibration below 70% it needs justification or rollback.

---

## Decision log

This section is append-only. Every time the plan is overridden, deferred, or changed, record it here.

| Date | Decision | Rationale | Who |
|---|---|---|---|
| 2026-04-08 | Defer reactivity calibration study (CR-7) until first paying customer | Cost of 15-expert study not justified pre-revenue; hand-tuned YAML acceptable for MVP | Founder + Lead |
| 2026-04-09 | Add Challenge Authoring System as third research pillar (CA-*) | Research brief with 90 sources across AI generation, template architecture, UX/competitive. ADR-034. Supersedes ADR-004 (static library). | Founder + Lead |
| 2026-04-09 | Supersede ADR-004 (static TypeScript challenge library) with ADR-034 | Hardcoded TS library doesn't scale; need D1-backed templates with versioning, packs, and AI generation | Founder + Lead |
| 2026-04-08 | Defer IRT calibration (CR-32) and AutoIRT (CR-33) | Need n≥100/item traffic first; ship uncalibrated and tighten with volume | Founder + Lead |
| 2026-04-08 | Defer 8-station summative mode (CR-31) | MVP is 3 PRs; summative only matters for enterprise summative hiring decisions | Founder + Lead |
| 2026-04-08 | Lock text-only (no audio/video) as architectural decision | HireVue cautionary tale; text eliminates accent/speech bias vector | Founder + Research (BC-27) |
| 2026-04-08 | Culture scores framed as attitudinal predictors, never performance | P-O fit performance ρ=.15 is weak; legal defensibility | Founder + Research (BC-21) |
| 2026-04-08 | Arena is legacy reference, /calibrate is go-forward | Arena last touched 2026-03-30 at 76.5%; /calibrate uses real Worker pipeline | Founder |
| 2026-04-09 | CR-13/CR-14: Replace generic "scrape" with role-matched repo discovery pipeline | Research brief (76 sources): Libraries.io `dependent_repositories` for dependency-first discovery, specfy/stack-analyser for tech stack detection, scc/lizard for seniority-complexity matching. SEART GHS Java/Python only, no framework filter. See `knowledge/outputs/repo-discovery-pipeline.md` | Founder + Lead |
| 2026-04-08 | Research findings not yet ported to production; Phase 1 = alignment work | Research briefs delivered 2026-04-07 and 2026-04-08; code hasn't caught up | Founder + Lead |
| 2026-04-09 | **CR-2, CR-3, CR-4 DONE:** 6-dimension BARS rubric shipped | `scorerRubric.yaml` + `scorerRubric.ts` + rewritten `scorerPrompts.ts` + `scorerAgent.ts` + `scoring.ts`. 2-scorer pipeline (A: ground truth, B: communication). 1-5 scale, encounter-level, seniority-adjusted weights. All 23 existing tests pass. | Founder + Lead |
| 2026-04-09 | **CR-13 DONE (Stages 1-2):** Repo discovery pipeline built | Libraries.io + GitHub quality filter in Worker. D1 migration 0018. 6 API routes. REPOS tab in Challenge Studio. `skillToPackage.ts` (120+ mappings). Stages 3-4 (stack-analyser + scc) deferred to offline scripts. | Founder + Lead |
| 2026-04-10 | **CR-13 + CR-14 + CR-19 DONE (Stages 3-4 + refresh policy + license filter):** Offline repo crawler + graph index | Replaced real-time Libraries.io with pre-populated D1 catalog. `scripts/crawl-repos/` (Pass 1: GH Search + coarse filter; Pass 2: clone + manifest parsing + scc/lizard + construct extractors (60 slugs) + SWE-bench PR sampling). D1 schema: `qualified_repos`, `repo_skills`, `repo_constructs`, `repo_sample_prs`, `skill_aliases` (migration 0021). `matchRepos.ts` runtime — tag-graph scoring query, <50ms p95, no external API. `discover.ts` rewritten. LIBRARIES_IO_API_KEY no longer required at runtime. Weekly GH Actions cron (pass-1 Mon 02:00 UTC, pass-2 Mon 04:00 UTC). Contamination risk as soft penalty (not hard reject). Vectors deferred to Phase 2. Open questions: monorepo handling, pass-2 budget planning, extractor versioning — see plan §7.2. | Founder + Lead |
| 2026-04-09 | **ADR-035: Global Copilot Agent built** | Conversational recruiter copilot in a side drawer. Gemma 4 on Workers AI with prompt-injected tool protocol. 6 tools (search_repos, fetch_repo_info, list_repo_prs, fetch_pr_diff, save_challenge_draft, lookup_pipeline). Skill modes: general + challenge_design. D1 session persistence. Replaces button-press repo discovery UX with conversational challenge design. | Founder + Lead |
| 2026-04-10 | **Flag drift: Role Discovery → downstream consumers (RD-1 through RD-22)** | Research source: `migration/dersign-thinking.md:355` Part 8 ("Define Phase") specifies the Knowledge State JSON as the canonical artifact of a design-thinking intake interview. ADR-027 preserved this language; ADR-028 (multi-stakeholder) introduced `CandidatePersona` as a cached summary for repo discovery, but the cached summary became the canonical artifact by default and downstream consumers (culture, challenge generation, scorer, repo search) read only the flattened output. Knowledge State is persisted but dead. No explicit override was ever recorded. Flagged per ADR-033 guardrail rule. Research prep launched: `knowledge/outputs/.plans/role-discovery-data-contract.md` with 11 sub-questions across 4 researchers. Resolution target: ADR-036 (Role Discovery + Repo Understanding Data Contract). | Founder + Claude (guardrail flag per ADR-033) |
| 2026-04-10 | **Flag drift: Repo library has no AI reasoning layer (RD-23, RD-24)** | The crawler's Pass 1 (GitHub search + manifest parsing) and Pass 2 (clone + SLOC/CCN + construct detection + PR sampling) are deterministic — zero LLM calls. The richest substrate (`repo_sample_prs` metadata + `repo_constructs` + stack + seniority band) is queried only by a SQL keyword join on `persona.mustHaveSkills[]` in `matchRepos.ts`. Role Discovery signal on one side meets a keyword join on the other; the richer signal dies at the boundary. This gap was not in the original CR-13 research scope (the Libraries.io brief was about *discovery*, not *understanding*) and so was not a tracked finding until now. Resolution target: ADR-036 Repo Understanding Contract section — crawler Pass 3 (offline Haiku → `repo_engineering_signals`) + runtime Worker role-fit rerank (Gemma → `repo_role_alignment`). Research question Q11 loads the offline-vs-runtime architecture choice. | Founder + Claude (guardrail flag per ADR-033) |
| 2026-04-10 | **Research complete: Role Discovery + Repo Understanding Data Contract (RD-1 through RD-24)** | 4 parallel researchers produced 84 cited sources across R1 (methodology: framework analysis + IPA + grounded theory + Means-End Chain laddering), R2 (culture platforms + OCAI + BARS calibration + dealbreaker legal evidence base), R3 (MSR codebase signals + competitor scan + two-stage retrieval architecture), R4 (multi-stakeholder aggregation + staged validation ladder). Verifier pass resolved all 84 sources and caught 2 attribution errors. Reviewer verdict PASS WITH NOTES (0 FATAL, 3 MAJOR patched: OCAI per-archetype α values softened to reported range, SWE-bench 40% figure flagged for primary-source reconfirmation, Mobley v. Workday characterization softened from "established" to "certification analysis indicates" because the case is in active litigation). Final brief: `knowledge/outputs/role-discovery-data-contract.md`. Provenance: `knowledge/outputs/role-discovery-data-contract.provenance.md`. ADR-036 drafted 2026-04-10. | Founder + Claude (Lead Researcher) |
| 2026-04-10 | **ADR-036 drafted: Role Discovery + Repo Understanding Data Contract (Proposed)** | Captures both halves of the bridge: Role Context Document schema (hybrid framework-matrix + IPA evidence-anchor + grounded-theory axial + Means-End Chain laddering; three-layer synthesis prompt pattern; three-tier multi-stakeholder aggregation; universal BARS base + RCD-derived overrides; static probe bank + role-setup enrichment; HITL-only dealbreaker gates) and Repo Understanding Contract (two-stage retrieval — offline Crawler Pass 3 on Haiku 4.5 writing `repo_engineering_signals`, runtime Worker on Gemma 4 writing cached `repo_role_alignment`; `matchRepos.ts` becomes stage-1 retriever). Supersedes ADR-028 sections on CandidatePersona as canonical artifact. Extends ADR-027 (Role Discovery Agent), ADR-029 (Culture Interview), ADR-031 (AI Hiring Compliance). Status Proposed pending founder decision on implementation sequencing (culture-first vs. repo-first split). | Founder + Claude (Lead Researcher) |
| 2026-04-11 | **Path B complete: Phase 3 (code-review consumers) + Phase 4 (repo understanding) landed** | Closes RD-17, RD-18, RD-19, RD-23, RD-24 end-to-end. Four waves across seven commits on `feat/cloudflare-migration`: **Wave 1** (`1bf7a74`) — Pass 3 persister + copilot `explain_repo_for_role` tool + RCD-aware challenge generator prompts (Sonnet lane). **Wave 2** (`f24f87e`) — `roleFitRerank` (Gemma 4 26B on RCD + engineering signals, verbatim-token prompt, `rcd_version`/`signals_version` cache-key stamping) + scorer dispositional weight overlay (`applyDispositionalWeights` with sign-preservation clamp `[0.5, 1.5]`) + implementer team-disposition prompt addendum (Opus lane). **Phase 3 consumer wiring** (`c60cf57`) + **unit BDD lock** (`e49ed36`) — full chain `assessments → stages → role_contexts` via new `loadRcdForAssessment`, RCD threaded into challenge generator, content review, implementer, and scorer; scorer model switched off Qwen family (`@cf/qwen/qwen2.5-coder-32b-instruct` → `@cf/google/gemma-4-26b-a4b-it`) to satisfy ADR-032 independence rule — provisional default pending CAL-1..4. **Wave 3** (`ff639a4`) — cache-aware `rerankPipeline.ts` (`repo_role_alignment` write-through keyed on `(role_context_id, rcd_version, repo_id)`, stale-version miss detection, missing-signals skip behavior) + `discover.ts` injection via new `rerankWithRcd` helper with failure isolation (rerank never blocks discovery) + route-boundary `createRoleAgentProvider` wiring. **Phase 3 canonical e2e BDD** (`3de3d89`) — the spec-mandated fixture `stack: ['Rust', 'WebAssembly']`, `dispositional_weights: { pragmatism: 1.3, rigor: 0.8 }` with all three handoff assertions: verbatim stack tokens in generator prompt, pragmatism/rigor tilt relative to baseline (ratio check + composite tilt both directions), sign-preservation under pathological inputs (`NaN`, `±Infinity`, negatives, direct dimension-ID zeroing) plus a composite integration check that the "zeroed" dimension still contributes. Ancillary: CAL-1 fixture schema + two anchor seeds committed as `1e50439` for the Gemma/Devstral/Sonnet scorer calibration harness (OQ: full 30–50 set + harness + analysis remain). Test coverage: 43/43 across the Phase 3 trio (`codeReviewPhase3.e2e.test.ts` + `codeReviewPhase3.test.ts` + `scorerDispositional.test.ts`); 18/18 across the rerank pipeline (`rerankPipeline.test.ts` + `roleFitRerank.test.ts`). Zero new tsc errors across all touched files. **Correction recorded 2026-04-11:** Pass 3 is implemented as a Claude Code slash command at `.claude/commands/crawl-repos-pass3.md`, not as a `summarize.ts` TypeScript module. The slash command is the orchestrator + summarizer; `scripts/crawl-repos/pass3/persist.ts` is the D1 writer helper it invokes. `scripts/crawl-repos/index.ts --pass3` shells out to the skill via `spawnSync('claude', ['-p', '/crawl-repos-pass3 …'])` so cron/CI keeps one CLI surface across all three passes. The skill-based architecture was always the intent (Haiku must route through the Agent tool path, which plain `npx tsx` can't reach, and keeping Pass 3 and the Stage-2 rerank in different execution environments is the cleanest way to enforce the ADR-032 model-family independence rule). An earlier draft of this entry wrongly described the slash command as an optional convenience affordance over a non-existent `summarize.ts` module; that framing has been corrected here and in the RD-23 row above.
**Deferred:** (a) Running Pass 3 against production D1 — the code path (skill + persister + `--pass3` CLI wrapper) exists and is idempotent on content hash, but the batch operation is a manual trigger once the Pass 1 + Pass 2 seed set is in place (no CRON wiring yet). (b) CAL-1 through CAL-4 scorer calibration — blocks the final Gemma/Devstral/Sonnet decision; scorer runs on Gemma provisionally until the harness disagrees. | Founder + Claude (Opus lane) |
| 2026-04-11 | **ADR-037 code-complete: Dev Containers on Cloudflare (Phase 3b)** | Full implementation of Cloudflare Containers replacing AWS ECS Fargate. `DevContainerDO` extends `Container` from `@cloudflare/containers` with `/__init`, `/__destroy`, proxy passthrough, and DO alarm-based TTL enforcement (warn at T-60s, expire at T). Routes: `POST /rpc/dev-container/launch`, `GET /:sid/status`, `POST /:sid/destroy`, `ALL /:sid/proxy/*`. Security fixes same day: (1) exchange tokens for iframe auth (prevents JWT leakage via Referer), (2) `/destroy` now calls DO to actually stop container, (3) rerank cache validates `signals_version`. 48 tests pass. E2E tests written. ADR-037 documented. **Blocked on deployment:** R2 not enabled on Cloudflare account. To unblock: enable R2 in Dashboard → `npx wrangler r2 bucket create pipe-assets` → `npm run deploy`. Post-deploy: flip `VITE_USE_CLOUDFLARE_DEV_CONTAINERS=true`, run E2E, 7-day soak, then teardown 5 Amplify Lambdas + ECS cluster + ALB + NAT gateway. Plan: `.claude/plans/optimized-squishing-church.md`. | Founder + Claude |
| 2026-04-14 | **Architectural decision: candidate-facing app will be server-side rendered (SSR)** | Security boundary, not just a performance choice. With CSR the Worker must send challenge data (including planted bug metadata, scoring rubrics, correct answers) to the browser to render the UI. A candidate can open DevTools → Network and read the payload. SSR renders HTML server-side — only the rendered output reaches the browser. The candidate experience will be a separate Cloudflare Pages deployment (`interview.pipe.com`) using React Router v7 (runs natively on Cloudflare Workers). The recruiter app (`app.pipe.com`) remains CSR — it's behind Clerk auth and has no ground-truth exposure risk. Deferred to post-MVP (current CSR candidate flow is pre-launch with no real candidates). | Founder |
| 2026-04-14 | **Override: Repo matching extensions beyond RUC §2.3 (signals_version v2.0.0)** | Extends canonical Repo Understanding Contract (`knowledge/outputs/role-discovery-data-contract.md:408-473`) to solve two problems the RUC schema does not address: library/plugin contamination in candidate pools (solved via new `architecture_style='library'` enum value — canonical addition) and no semantic bridge between free-form RCD prose (`domain_matrix[*].summary`, `stories[]`, `bars_overrides`) and repo signals. **Canonical alignment (no override needed):** add `library` and `layered_service` to `architecture_style` enum; re-map existing `modular_monolith → layered_service` and `serverless → microservice`; add canonical `test_style` field (enum `unit_only \| integration_heavy \| e2e_present \| minimal \| unknown`); tighten `engineering_narrative` to RUC's 200–400 word spec. **Extensions beyond RUC (override):** (1) Cloudflare Vectorize binding `REPO_INDEX` with 1024-dim `@cf/baai/bge-large-en-v1.5` embeddings — added as PARALLEL recall path, not a replacement. SQL hard filter and Gemma rerank both remain, preserving RUC §2.3's rejection of runtime-only cross-encoder. Vectorize does top-50 semantic recall; Gemma still makes final alignment judgments. (2) `repo_searchable_profile` (400–600 word narrative written by Gemma from a FACTS-only block — no LLM numeric estimation, validator rejects digit sequences not in the facts block). (3) `business_logic_ratio` and `cross_module_change_rate` — deterministic Pass 2 aggregates from per-PR `changed_file_paths_json` via path classifier (`src/services/** → domain_logic` etc.). (4) `challenge_surfaces` — 10 `*_potential` scores mapped 1:1 to the ADR-032:131 bug template list (off-by-one, TOCTOU race, stale cache, unvalidated input, type confusion, dangling reference, SQL injection, CORS misconfig, N+1 query, missing null check), deterministic rules over `detected_stack_json + primary_language + constructs`. (5) `open_pr_count` and `open_feature_issue_count` via Pass 1 GitHub Search API (2 calls/repo) — feed a "challenge-ready" hard filter in `matchRepos`. **Risks:** Workers 30s timeout (mitigated: Vectorize only recall, rerank still bounded); judgment inconsistency (mitigated: Gemma rerank preserved as final pass with justifications); plan drift (mitigated: this Decision Log entry). **Rationale:** contamination solved by canonical library filter alone; Vectorize solves the orthogonal problem of RCD ↔ repo matching across free-form prose that structured enum-match cannot reach. Per founder explicit decision 2026-04-14 during /plan session (plan file `.claude/plans/woolly-bubbling-owl.md`). | Founder + Claude |

---

## Next concrete action

### Completed (2026-04-09 – 2026-04-10)

1. ✅ **BARS rubric YAML** (CR-2, CR-3, CR-4) — `scorerRubric.yaml` + `scorerRubric.ts` with all 6 dimensions, 1-5 BARS anchors, cross-checks, seniority weights.
2. ✅ **Scorer pipeline rewrite** — 2 LLM calls (Scorer A: ground truth, Scorer B: communication) replacing 3 old calls. New `ScoreReport` shape with evidence + metrics.
3. ✅ **Repo discovery pipeline Stages 1-2** (CR-13) — Libraries.io + GitHub filter in Worker. REPOS tab in Challenge Studio. Convert accepted repos to CODE_REVIEW templates.
4. ✅ **Repo crawler + graph index** (CR-13 Stages 3-4, CR-14, CR-19) — Offline crawler replaces Libraries.io at runtime. `scripts/crawl-repos/` with Pass 1 + Pass 2. `qualified_repos` D1 catalog. `matchRepos.ts` runtime (<50ms). Weekly GH Actions cron. SWE-bench eligible PR sampling. Contamination risk. 60-slug construct taxonomy.
5. ✅ **Research: Role Discovery + Repo Understanding Data Contract** (RD-P0 — all 24 RD findings research-resolved, 2026-04-10) — 4 parallel researchers, 84 cited sources, PASS WITH NOTES verdict. Final brief at `knowledge/outputs/role-discovery-data-contract.md`. Provenance at `.provenance.md`. Research validated the hybrid qualitative schema, three-layer synthesis prompt pattern, three-tier multi-stakeholder aggregation, 5-signal team culture profile, universal-base BARS with RCD-derived overrides, static-base probe bank with role-setup-time enrichment, HITL-only dealbreaker gates, and two-stage repo retrieval (offline Haiku 4.5 signals + runtime Gemma 4 rerank).
6. ✅ **ADR-036 drafted (Proposed)** — `docs/decisions/ADR-036-role-discovery-data-contract.md`. Captures both halves of the bridge (Role Context Document + Repo Understanding Contract). Full TypeScript schema sketch for RCD, full SQL DDL for `repo_engineering_signals`, `repo_role_alignment`, `role_probe_bank`. Phased rollout plan: Phase 1 (schema + synthesis rewrite) → Phase 2 (culture consumers) → Phase 3 (code review consumers) → Phase 4 (repo understanding). Phase 2 and 3 can run in either order after Phase 1 — founder decision pending on culture-first vs. repo-first sequencing.

### Next up

1. **Seed the DB: run `npx tsx scripts/crawl-repos/index.ts --pass1`** then `--pass2` against the production D1 database. Requires `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_D1_DATABASE_ID` in `.dev.vars` or GH Actions secrets. Without rows in `qualified_repos`, `matchRepos` returns empty.

2. **Run `/calibrate --auto`** with the new 6-dimension rubric to establish a baseline vs. arena v19's 76.5%. This is the empirical validation gate — if calibration drops below 70%, iterate on the rubric before proceeding.

3. **CR-6: Persona YAML with reactivity parameters** — Productize the hardcoded persona configs in `prompts.ts` into versioned YAML. Same pattern as the rubric. Prerequisite for consistency classifier.

4. **CR-1 / CR-31: Multi-PR challenge type** — D1 schema for 3-PR sessions. This is the format change that enables the multi-encounter design the research requires for G ≥ 0.70.

5. **CR-15: AIG bug templates** — 10 templates via Claude Opus 4.6 (offline). Each template: a PR from `repo_sample_prs` + planted bug + ground truth + test that fails. Variant generator via Claude Sonnet 4.6.

6. **CR-5: Consistency classifier** (Phase 2) — Gemma 4 12B on every implementer turn. Highest-priority engineering risk. Blocked on persona YAML (CR-6) being done first.

7. **ADR-037: Dev Containers on Cloudflare — deployment blocked on R2** — Code is complete (48 tests pass). `DevContainerDO` extends `Container` from `@cloudflare/containers`. Routes: `/rpc/dev-container/launch`, `/status`, `/destroy`, `/proxy/*`. TTL enforcement via DO alarms (warn at T-60s, expire at T). Exchange tokens for iframe auth (security fix 2026-04-11). E2E tests written (`e2e/dev-container-happy.spec.ts`, `e2e/dev-container-ttl.spec.ts`). **Blocked:** `npm run deploy` fails because R2 is not enabled on the Cloudflare account. To unblock: (a) enable R2 in Cloudflare Dashboard, (b) `npx wrangler r2 bucket create pipe-assets`, (c) `npm run deploy`. After deploy: flip `VITE_USE_CLOUDFLARE_DEV_CONTAINERS=true` in prod, run E2E tests, 7-day soak, then teardown ECS/Amplify Lambdas per the plan at `.claude/plans/optimized-squishing-church.md`.
