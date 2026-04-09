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

## Guardrail: do not drift from this plan

**If a founder request contradicts this plan, the assistant MUST pause and flag the contradiction before acting.** The research cost real tokens and real thinking. Dropping findings because they're inconvenient is how founders ship weaker products than they could have. The guardrail:

1. **Surface the contradiction.** Name the research finding being overridden and where it lives in the brief.
2. **Name the risk.** What does the research say the consequence is?
3. **Ask for explicit override.** If the founder still wants to proceed, document the override as a decision in this file's Decision Log.
4. **Never silently drop a finding.** If something is deferred, mark it explicitly in the Deferred section below.

This rule exists because the founder asked for it on 2026-04-08 after noticing the research and the arena and the /calibrate skill had drifted out of sync. Re-sync is expensive. Drift prevention is cheap.

---

## The three research briefs

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
| CR-2 | Hybrid checklist + BARS global rubric | Part 2.2 | New YAML rubric file loaded into Worker; deterministic checklist for planted-bug detection + LLM-judge BARS for dimensions | P1 | NOT STARTED |
| CR-3 | Six scoring dimensions (5 practitioner + AI direction) | Part 2.3–2.4 | Expand from 4 dimensions (Technical / Conversation / Practice / Effectiveness) to 6 (Issue depth / Reasoning / Prioritization / Question formation / Revision evaluation / AI direction) | P1 | NOT STARTED |
| CR-4 | BARS level descriptors with concrete behavioral anchors (Hodges-compliant) | Part 2.2 | Write 5 concrete behavioral anchors per dimension in rubric YAML; no "poor/good/excellent" | P1 | NOT STARTED |
| CR-5 | Consistency classifier (#1 engineering risk) | Part 3.1 | Build Gemma 4 12B classifier Worker; runs on every implementer turn; 4-axis JSON (bug-disclosure / tone / knowledge boundary / pushback deviation); regenerate-or-flag logic | **P2** | NOT STARTED |
| CR-6 | Persona YAML with reactivity parameters | Part 3.3 | Productize junior/mid/senior personas as versioned YAML: `pushback_probability`, `fix_acceptance_threshold`, `information_volunteering_rate`, `error_introduction_rate` | P1 | PARTIAL (hardcoded in `prompts.ts`) |
| CR-7 | Reactivity calibration study (15 experts) | Part 3.3 | DEFERRED — hand-tune YAML for MVP; run study after first paying customer | POST-MVP | DEFERRED |
| CR-8 | Score at encounter level, not turn level | Part 3.4(a) | Worker scoring aggregates per PR; turn data is evidence, not independent score | P1 | CHECK CURRENT STATE |
| CR-9 | Separate scorer and implementer invocations (no shared context) | Part 3.4(b) | Enforce in Worker pipeline; scorer reads transcript from scratch | P1 | CHECK CURRENT STATE |
| CR-10 | Cohen κ target ≥ 0.76 for LLM-judge scoring | Part 3.4 | Build offline Sonnet 4.6 oracle; measure Devstral κ vs Sonnet; escalate if κ < 0.70 | P2 | NOT STARTED |
| CR-11 | Gold-standard conversation corpus (100 transcripts target) | Part 3.5 | Seed with 10 founder-rated transcripts; grow with real sessions; regression-test every prompt change against it | P2 | NOT STARTED (`/calibrate` logs runs but no "gold" subset yet) |
| CR-12 | Model routing (6 roles, 5 distinct models) | Part 3.6 | Document in CLAUDE.md (done in this session); map each role to model+fallback | P1 | DOCUMENTED — enforcement gradual |
| CR-13 | Hybrid real-skeleton + planted bug (AIG pipeline) | Part 4.1 | Build: role-matched repo discovery (Libraries.io `dependent_repositories` + GitHub API quality filter + specfy/stack-analyser) → seniority-complexity match → AIG template → variant generation → execution verification → tag → bank. See `knowledge/outputs/repo-discovery-pipeline.md` (76 sources). | P3 | NOT STARTED |
| CR-14 | Rolling-freshness gate (post-2024-07-01, quarterly advance) | Part 4.2 | Libraries.io queries filtered by `pushed` date + quarterly gate advance; SEART GHS for Java/Python bulk only (no JS/TS support yet) | P3 | NOT STARTED |
| CR-15 | AIG templates × variants (Gierl & Haladyna) | Part 4.1 | Write 10 bug templates; variant generator via Claude Sonnet offline | P3 | NOT STARTED |
| CR-16 | Execution-based ground truth (not LLM-judge) | Part 4.1 | CI sandbox runs repo's test suite; discard items where planted bug doesn't fail a test | P3 | NOT STARTED |
| CR-17 | Tag on 4 dimensions (difficulty × stack × skill × archetype) | Part 4.1 | Item bank schema with tags; selection query over tags; NOT enumerate personas | P3 | NOT STARTED |
| CR-18 | 225-item bank target, 15 to ship MVP | Part 4.3 | Initial 15 items: 3 difficulty × 5 skills × 1 stack (TS/React) | P3 | NOT STARTED (currently has golden/cases.ts with 6 arena cases) |
| CR-19 | Permissive-license-only filtering (MIT/Apache/BSD) | Part 4 | Scraper filter; attribution in validation file; strip PII | P3 | NOT STARTED |
| CR-20 | Sillito Tier 1-2 scaffolding only (not Tier 3-4) | R3 findings | UI shows file structure, entry points, conventions; does NOT answer "why did author choose X" | P1 | CHECK CURRENT STATE |
| CR-21 | Structured interview + work sample r=.42/.33 | Part 1.1 | Motivates format; cited in validation file | P4 | CITED-FOR-REFERENCE |
| CR-22 | Interactive format d≈.21-.22 vs in-basket .74-.76 (Roth 2008) | Part 1.2 | Motivates multi-turn format; cited in fairness section of validation file | P4 | CITED-FOR-REFERENCE |
| CR-23 | Content validity legal route (EEOC/Griggs/Ricci) | Part 1.3 | Lightweight job analysis doc; CVR-rated scenario mapping; adverse-impact monitoring dashboard | P4 | NOT STARTED |
| CR-24 | Criterion problem: bootstrap concurrent validity study | Part 1.4 | Build 90-day post-hire structured rating instrument; run with first paying customer | P4 | NOT STARTED |
| CR-25 | Revision evaluation dimension (exclusive moat) | Part 6 | Dimension 5 — scorer assesses whether implementer's fix is complete / incomplete / introduces new issues | P1 | NOT STARTED (requires CR-3) |
| CR-26 | AI-direction construct (second moat) | Part 6 | Dimension 6 — measured via turn-level directing / evaluating / pushback | P1 | NOT STARTED (requires CR-3) |
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

### Open questions (22 items — things research could not resolve)

> Items OQ-1 through OQ-12 are from the code review + behavioral/culture briefs.
> Items OQ-13 through OQ-22 are from the challenge authoring brief (2026-04-09).

| # | Question | Action |
|---|---|---|
| OQ-1 | No published STAR-specific LLM scoring benchmark | Build PIPE-specific labeled evaluation dataset during beta (deliverable of `/calibrate` over time) |
| OQ-2 | Mistral/Devstral performance on behavioral scoring (QWK unknown) | Calibration study against human-scored samples via `/calibrate` equivalent for culture |
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

---

## Current drift vs. plan (as of 2026-04-08)

Places where the current codebase does not match the plan. These need verification and correction.

| Item | Current state | Plan target | Action |
|---|---|---|---|
| Scoring dimensions | 4 (Technical 30% / Conversation 30% / Practice 25% / Effectiveness 15%) per arena v19 | 6 (Issue depth / Reasoning / Prioritization / Question formation / Revision evaluation / AI direction) | Port arena v19 findings forward; expand prompts; re-calibrate |
| BARS anchors | Arena prompts have some anchors but not Hodges-compliant per research | Concrete behavioral anchors at every level of every dimension | Rewrite rubric YAML |
| Multi-PR structure | Arena scores 6 cases individually; no aggregation | 3-PR sessions aggregated to single candidate score | New Worker challenge type + seed data |
| Consistency classifier | Does not exist | Gemma 4 12B classifier on every implementer turn | Build in Phase 2 |
| Persona reactivity | Hardcoded in `prompts.ts` (per /calibrate skill) | Versioned YAML with parametric reactivity | Productize |
| Content pipeline | 6 hand-crafted arena cases + slopify fixtures | AIG pipeline producing rolling-freshness items | Build in Phase 3 |
| Validation file | Does not exist | `docs/validation/` with job analysis + CVR + rubric + IRR + subgroup analysis | Build in Phase 4 |
| Culture scorer architecture | `cultureAgent.ts` — needs audit against plan | FSM + ReAct + scratchpad + specialist sub-agents + summarization | Audit and upgrade in Phase 1 |
| Culture UI framing | Unknown — needs audit | "Values alignment + working style complementarity"; attitudinal not performance | Audit and reframe in Phase 1 |
| AIVIA / EU AI Act compliance | Not built | Disclosure + consent + non-AI alternative + conformity assessment | **HARD DEADLINE 2026-08-02 for EU AI Act** |

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

---

## Next concrete action

**Start Phase 1. First deliverable: the BARS rubric YAML file.**

This is the smallest unit of work that unblocks the most findings:
- Defines the 6 dimensions (CR-3)
- Defines the BARS anchors (CR-4, BC-38)
- Establishes the content format for the rubric
- Can be ported into both the arena (for fast iteration) AND the Worker (for production)
- Is the thing the `/calibrate` skill tunes against

Once the rubric YAML exists, everything downstream (scorer prompts, consistency classifier specs, validation file structure) has a concrete reference point.

**Then: run `/calibrate --auto` with the new rubric against the existing arena golden cases to establish a new baseline.** This measures the plan's impact on the empirical calibration number (currently 76.5% v19). If it drops below 70%, something is wrong with the rubric and we iterate. If it holds or improves, we have evidence that the research-derived design is at least as good as the hand-tuned v19 and we can proceed to Phase 2.

After that: the consistency classifier (CR-5, Phase 2) — the #1 engineering risk from the research.
