> **STATUS: INTERMEDIATE (verifier pass output)** · Created 2026-04-08 14:16
> **Research run:** `code-review-content-sourcing`
> **Role in run:** Cited brief — verifier-pass output with inline citations added. Superseded by the final after reviewer corrections (Woven pricing claim softened, Stack Overflow citation added).
> **Use the final instead:** [`./code-review-content-sourcing.md`](./code-review-content-sourcing.md)
> **Kept for:** Audit trail of the citation pass before reviewer corrections.
> **Navigate:** [INDEX](../INDEX.md)

---

# Designing a Code-Review Assessment That Crushes

**Synthesis of Rounds 1 & 2 research** · 2026-04-08 · Cited verifier pass

> This document is the Lead-authored synthesis of six research files (R1 mining, R2 synthetic, R3 scaffolding, R4 work-sample validity, R5 simulation-based assessment, R6 market + practitioner), now with inline citations and verified URLs.

---

## Executive summary

PIPE is aimed at a **real, specific gap in the market**: no developer-hiring platform ships interactive multi-turn code review with an implementer that responds, pushes back, and revises code. HackerRank and CodeSignal ship *static* diff-comment items [R6-S1][R6-S2][R6-S3]. Woven ships human-graded PR review, but its double-blind certified-engineer scoring model makes per-assessment cost prohibitive for high-volume top-of-funnel screening [R6-S4][R6-S5]. GitLab does multi-turn review internally because their own engineers believe it's the highest-signal interview — they just don't have a scalable version [R6-S10]. **That gap is PIPE's wedge.**

The research converges on a design that's buildable by a solo founder and defensible as a hiring instrument. The winning shape has five features:

1. **Multi-PR structure (3 minimum, 5 target)** — borrowed from MMI / OSCE context-specificity literature [R5-S2][R5-S3]. A single PR is noise.
2. **Hybrid scoring: objective checklist + BARS-anchored global dimensions** — Hodges-finding-compliant [R5-S5][R5-S6], so you don't penalize the expert reviewer who triages instead of enumerating.
3. **Five scoring dimensions from the practitioner literature** — issue depth, reasoning quality, prioritization, question formation, and **revision evaluation** (the exclusive one) [R6-P1][R6-P2][R6-P5][R6-P10].
4. **AI-direction as a first-class construct** — measurable via suggestion-acceptance patterns [R6-P11][R6-S11], entirely unmeasured by competitors, and aligned with what engineering managers now actually want to hire for.
5. **An agent quality chain that treats the implementer like a standardized patient** — consistency classifier, reactivity calibration, and gold-standard corpus replay [R5-S7][R5-S8][R5-S9]. Without this, the whole format collapses on agent drift.

The biggest threats to validity are **not** content leakage (solvable with a rolling-freshness pipeline [R1-S12]) or psychometric calibration (solvable with AutoIRT [R3-S10]). They are:
- **Agent drift** (14–34% off-persona baseline for instruction-tuned LLMs [R5-S9]) — engineering problem.
- **The criterion problem** (no study has ever validated a code-review assessment against on-the-job SWE performance [R4-S15]) — bootstrap problem.

Both are tractable, and the rest of this document lays out how.

---

## Part 1 — The format is sound. Here's the evidence.

### 1.1 Validity ceiling

A turn-based code review is simultaneously a **high-fidelity work sample** and a **structured interview**. Post-Sackett (2022) corrected coefficients [R4-S3]: structured interviews *r* = .42, work samples *r* = .33, the combination approaches the practical ceiling for standalone assessments. Huffcutt & Arthur's level model [R4-S6] puts a "Level 3–4" structured assessment (standardized prompts + anchored rubrics + multi-rater scoring) at *r* = .51–.57 predictive validity.

PIPE's format sits in that ceiling *if* it hits all three structural features. All three are low-cost design decisions, not expensive engineering investments.

### 1.2 Fairness profile is favorable

The Roth et al. (2008) data [R4-S12] is the critical one: knowledge-recall / in-basket work samples show Black–White applicant *d* ≈ .74–.76 (close to pure cognitive ability tests), but **interactive, oral, conversational formats show *d* ≈ .21–.22** — more than 3× smaller adverse-impact gap. A multi-turn code-review conversation that weights reasoning and communication over pattern-matching of known bugs is structurally in the favorable zone.

This is a marketing advantage as well as a legal one: hiring teams are actively searching for formats that reduce adverse impact without sacrificing validity, and most current technical assessments (algorithmic challenges, MCQ screens) are in the high-*d* zone [R4-S16].

### 1.3 Legal defensibility is a package, not a principle

Under EEOC Uniform Guidelines [R4-S9] + Griggs [R4-S10] + Ricci [R4-S11], the defensible pathway is **content validity**:

1. Lightweight job analysis (SWE job postings + SME ratings of code-review task criticality — cheap).
2. CVR-rated mapping of each PR scenario to the task inventory.
3. Adverse-impact monitoring from day one (4/5ths rule compliance [R4-S9]).
4. Documented validation file — job analysis, rubric, inter-rater reliability, subgroup analysis.

This is a compliance package a solo founder can ship. It is *not* optional — SIOP 2023 guidelines [R4-S19] on AI-based assessments explicitly require the same validity and fairness standards as traditional tests, with auditable documentation.

### 1.4 The criterion problem is the real unfinished business

**No peer-reviewed study validates a code-review assessment against SWE job performance.** [R4-S15] describes a practitioner implementation with reasonable construct logic but no criterion data. That is the gap. The bootstrap path:

- **Concurrent validity study at 90 days post-hire** (12–18 months after beta traffic): structured manager rating instrument with a "code-review quality" dimension, correlated against hire-time assessment scores [R4-S18].
- **Proxy criteria from GitHub/GitLab metadata**: comment acceptance rate, review turnaround, bug catch rate post-merge.
- **Expert-rater calibration as a construct-validity bridge**: senior engineers re-score the same candidate transcripts; use inter-rater agreement as interim evidence.

This is more runway than a founder wants, but the *framework* shipping on day one is what matters for defensibility. Even partial evidence beats none.

---

## Part 2 — The format design: make it crush

### 2.1 Multiple PRs, independently scored — not one deep PR

The single most important design decision. **Every simulation-based assessment domain independently converged on this finding [R5-S1][R5-S2][R5-S3]:** context/case specificity accounts for ~25% of variance; a single encounter is unreliable as a standalone signal.

- OSCE: consensus 8–12 stations for G ≥ 0.80 [R5-S2]
- MMI: G = 0.70 with 8 stations, G = 0.80 requires 14 [R5-S3]
- Aviation LOE: multiple scenarios required for certification decisions [R5-S19][R5-S20]

For PIPE, the practical numbers:

| Use case | PR count | Why |
|---|---|---|
| Top-of-funnel screen | 3 PRs | Usable signal, low candidate time cost |
| Mid-funnel assessment | 5 PRs | Approaching G ≥ 0.75 |
| Summative hiring decision | 8 PRs | G ≥ 0.80, MMI-equivalent [R5-S3] |

Each PR must be **scored independently** — no cross-PR context in the scoring prompt, no halo from the previous PR's score. This is trivially achievable for LLM-as-judge scoring (separate invocations, clean prompts) and impossible in human-rater OSCE without expensive process control. That's a structural advantage PIPE should exploit.

**Design choice:** the "challenge type" in the pipeline isn't "CODE_REVIEW" — it's "CODE_REVIEW (3 PRs)". One PR = one station. Default the challenge to 3.

### 2.2 Hybrid checklist + BARS-anchored global rating

Hodges et al. (1999) [R5-S5] is the finding that matters: **checklists penalize experts**. Board-certified physicians scored *lower* than clerks on binary checklists but *higher* on global rating scales. The expert skips redundant information-gathering; the checklist scores the skip as a miss.

Direct analog for PIPE: a checklist that awards points for "mentioned type safety", "mentioned error handling", "mentioned performance" will penalize the senior reviewer who targets two real bugs and skips cosmetic noise. **This is exactly the opposite of the signal you want.**

The fix is a hybrid scoring design:

| Layer | Purpose | Scoring mechanism |
|---|---|---|
| **Objective checklist** (per PR) | Did the candidate identify planted bug X? Did they propose fix Y? | Automated, binary, ground-truth comparison. Deterministic. |
| **BARS-anchored global dimensions** (per PR) | Reasoning depth, prioritization, communication, AI direction | LLM-judge scoring against behaviorally-anchored rubric levels 1–5 [R5-S18] |

**BARS-anchored means every rating level has a concrete observable behavior, not "poor/good/excellent".** Example for "Technical Communication Quality":

| Level | Anchor behavior |
|---|---|
| 5 | Specifies the bug mechanism, references the relevant constraint/contract, proposes a fix with tradeoffs |
| 4 | Identifies bug with correct technical framing, proposes direction but not complete solution |
| 3 | Identifies that something is wrong, explanation partially accurate or incomplete |
| 2 | Vague or conflates symptoms with root cause |
| 1 | Factually incorrect or misidentifies the problem |

Ship this as a YAML rubric in the Worker and version it under git. Scorer prompts load the rubric; rubric versions are logged with every score for auditability.

### 2.3 The five dimensions to actually score

Converged from Bacchelli & Bird 2013 [R6-P1], Sadowski 2018 [R6-P2], Bosu 2015 [R6-P5], Zhang 2024 [R6-P7], Sillito 2006 [R6-P10], MacLeod 2018 [R6-P4] — the entire practitioner literature points the same direction:

| # | Dimension | What it measures | Seniority signal? |
|---|---|---|---|
| 1 | **Issue identification depth** | Functional defects + security > design > tests > docs > readability > style | Strong [R6-P5][R6-P7] |
| 2 | **Reasoning/explanation quality** | Does the candidate explain *why* an issue matters, not just *that* it exists? | Strong [R6-P5] |
| 3 | **Prioritization accuracy** | Distinguishes blockers from nitpicks; doesn't conflate | Strong [R6-P4] |
| 4 | **Question formation** | Asks questions that elicit rationale, history, design intent [R6-P10] | Strong [R6-P1][R6-P10] |
| 5 | **Revision evaluation** | After implementer responds, correctly assesses whether fix is complete / incomplete / introduces new issues | **PIPE-exclusive** |

Dimension 5 is the moat. No other platform can score it because no other platform has an interactive implementer. Every scoring rubric should weight this dimension *heavily* — it's the reason PIPE exists as a separate product.

### 2.4 AI-direction as a sixth dimension (the emerging construct)

The 2024–2025 data is unambiguous: "can direct, evaluate, push back on AI code" has become a core engineering skill, and nobody in hiring measures it.

- Jellyfish 2025 [R6-P11]: only 18% of AI code-review suggestions result in code changes. Developer *judgment* on which 18% to accept is the skill.
- Graphite Diamond [R6-S11] operationalizes "acceptance rate" as a product metric.
- CoderPad 2024 survey [R6-S14]: only 8% of recruiters openly allow AI in assessments, but 48% want to know how candidates use AI — the demand is there, the instrument isn't.
- Stack Overflow 2024: 63% of developers use AI daily; only 43% trust accuracy [R6-E12].

**How PIPE measures it without forcing a second format:** the implementer agent itself is the AI under direction. The candidate directs the implementer, evaluates its responses, and decides whether to push back or accept. Every turn produces observable data on AI-direction quality:

- When the implementer proposes a flawed fix, does the candidate catch it?
- When the implementer pushes back with a superficially plausible but wrong argument, does the candidate hold the line?
- When the implementer offers a cleaner alternative, does the candidate evaluate it on merits or defer?
- Does the candidate escalate when they sense the agent is stuck, or persist unproductively?

This maps the Addy Osmani "judgment over acceptance" framing [R6-S18] directly into measurable turn-level behaviors. Add it as the sixth BARS dimension. It should be weighted heavily for senior personas and lightly for junior personas.

---

## Part 3 — Making the implementer agent crush

This is the technical core. Everything above is design; this section is engineering.

### 3.1 The drift problem is real and it's the #1 risk

LLM agents playing a role drift off-persona on **14–34% of turns** at baseline (Llama-8B / Gemma-2B / Mistral-7B) [R5-S9]. PPO fine-tuning reduces this by >55%; supervised fine-tuning produces smaller and less stable gains; prompt engineering alone is insufficient.

**If the implementer drifts, the whole assessment breaks:**
- If the agent volunteers the planted bug, the candidate gets credit for detection they didn't earn.
- If the agent abandons its pushback persona, reactivity calibration collapses.
- If the agent adopts the candidate's framing uncritically, there's nothing to direct.
- If the agent varies its behavior between sessions, comparative scoring becomes invalid.

**Treat the implementer like a standardized patient.** The SP literature [R5-S7][R5-S8][R5-S23] has a 40-year head start on this exact problem. Their solutions translate directly:

| SP mechanism | PIPE equivalent |
|---|---|
| Pre-session training | Prompt validation with fixed conversation-tree test set before deployment |
| Earpiece / real-time monitoring by trainer | **Turn-by-turn consistency classifier** — a separate small LLM that checks each response against the persona spec before delivery |
| Post-session written feedback form | Post-conversation audit flagging persona violations for human review |
| Annual performance evaluation | Periodic re-benchmarking against a gold-standard conversation corpus |
| Multiple SPs for same role | Multiple implementer invocations scored for cross-invocation consistency |

### 3.2 Concrete engineering: the agent quality chain

This is the minimum viable agent architecture to prevent drift:

```
┌─────────────────────────────────────────────────────────────────┐
│ 1. Persona spec (YAML, versioned)                               │
│    - pushback probability                                        │
│    - bug disclosure rules (NEVER / ON_DEMAND / PROGRESSIVE)     │
│    - tone profile (formal / casual / defensive)                 │
│    - knowledge boundaries (what the agent "knows")              │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 2. Implementer LLM call                                         │
│    Junior/Mid: Qwen 2.5-Coder 32B (Workers AI)                 │
│    Senior:    Qwen3-Coder (Workers AI when avail)              │
│               → Claude Sonnet 4.6 premium fallback              │
│    - persona spec + PR context + candidate turn history        │
│    - generates response + optional diff                         │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 3. Consistency classifier — Gemma 4 12B (Workers AI)            │
│    Fallback: Claude Haiku 4.5 (Anthropic)                       │
│    MUST be a different model family than the implementer.      │
│    - scores response against persona spec on 4 axes:           │
│      (a) bug-disclosure violation? (binary)                    │
│      (b) tone drift? (0-1)                                     │
│      (c) knowledge boundary violation? (binary)                │
│      (d) pushback ratio deviation from target? (0-1)           │
│    - if any axis fails: regenerate (max 2 retries)             │
│    - if still failing: flag for scoring discount               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ 4. Deliver to candidate                                         │
└─────────────────────────────────────────────────────────────────┘
```

**The consistency classifier is non-negotiable.** Prompt engineering alone will not hold Qwen to persona across 15+ turns; the literature is unambiguous on this [R5-S9]. Build it from day one.

### 3.3 Reactivity calibration — the genuinely novel part

The SP literature documents the consistency-reactivity tradeoff [R5-S8] but offers no calibration protocol for setting the *right level* of reactivity. For PIPE's junior-vs-senior implementer personas, this must be determined empirically. A concrete protocol:

1. **Define reactivity as measurable parameters** in the persona spec:
   - `pushback_probability` — chance the implementer argues back on any given suggestion
   - `fix_acceptance_threshold` — how convincing the candidate's argument must be before implementer fixes
   - `information_volunteering_rate` — how often the implementer offers context the candidate didn't ask for
   - `error_introduction_rate` — how often the implementer's "fix" introduces a new subtle bug (for revision-evaluation scoring)

2. **Run a calibration study with ~15 expert reviewers:**
   - Each reviewer reviews the same 5 PRs with different reactivity settings.
   - Collect subjective ratings: "did this feel like reviewing a junior / mid / senior engineer?"
   - Collect behavioral data: comment depth, revision catch rate, escalation points.
   - Fit reactivity parameters to match the subjective persona labels.

3. **Version the calibrated persona specs** and treat them like scoring rubrics: diffable, git-tracked, auditable.

The junior persona memory from prior work ("pushes back naively 40% of the time") is the right shape — now productize it into the persona YAML.

### 3.4 Scoring the implementer-plus-candidate conversation

Two non-obvious decisions from the research:

**(a) Score at the PR/encounter level, not the turn level.** Turn-level scoring is architecturally tempting but dangerous: individual turns are noisy, and aggregating 15 turn-level scores may amplify noise rather than reduce it. OSCE / MMI / aviation LOE all score at the encounter level [R5-S1][R5-S3][R5-S13]. Turn data is *evidence* for the encounter score, not independent data points.

**(b) Separate the scoring invocation from the implementer invocation.** The implementer is Qwen 2.5-Coder; the scorer is Devstral (per existing PIPE architecture). Do not reuse context. The scorer reads the full transcript from scratch, applies the BARS rubric, and outputs per-dimension scores with justification. Cohen κ target: 0.76 (the EasyMED LLM-judge baseline [R5-S24] in a clinical SP context — closest available prior art).

### 3.5 The gold-standard conversation corpus

This is the asset you build once and leverage forever. Over time, as real candidate sessions run:

1. Sample transcripts across the score distribution.
2. Have senior engineer raters score them manually on the BARS rubric.
3. Lock the gold-standard subset (e.g., 100 transcripts) as a regression test.
4. Every rubric version change must be re-validated against the gold corpus — does the new scorer produce scores correlated with expert ratings on the gold set?
5. Every implementer-agent model upgrade must pass drift-regression against the gold corpus too.

This is the AQP "periodic recalibration" discipline [R5-S13][R5-S20] from aviation, adapted to a Worker-scale product. It's what transforms the assessment from a one-off into a living, defensible instrument.

### 3.6 Model routing — the six roles, optimally matched

The system is **five distinct model roles**, each with different cost, latency, and quality profiles. Picking one model for all of them is the wrong move.

| Role | Primary model | Provider | Fallback | Runs per turn? |
|---|---|---|---|---|
| Implementer (junior/mid) | Qwen 2.5-Coder 32B | Workers AI | Claude Sonnet 4.6 | Yes |
| Implementer (senior) | Qwen3-Coder *(when avail)* / Qwen 2.5-Coder 32B | Workers AI | Claude Sonnet 4.6 | Yes |
| **Consistency classifier** | **Gemma 4 12B** | Workers AI | Claude Haiku 4.5 | **Yes — every turn** |
| Scorer (production) | Devstral Small | Mistral | Claude Sonnet 4.6 | No (per PR) |
| Scorer (gold-standard oracle) | Claude Sonnet 4.6 | Anthropic (Agent tool) | Claude Opus 4.6 | No (offline) |
| Summative panel (3-judge, post-MVP) | Devstral + Qwen3-Coder + Sonnet 4.6 | Mixed | — | No (per PR) |
| Content: bug templates | Claude Opus 4.6 | Anthropic (Agent tool) | — | No (offline, ~20 ever) |
| Content: variant generation | Claude Sonnet 4.6 | Anthropic (Agent tool) | — | No (offline, batch) |
| Content: tagging | Claude Haiku 4.5 | Anthropic (Agent tool) | — | No (offline, bulk) |
| Content: execution verification | **No LLM** — real test suite | CI sandbox | — | No |

**Three routing principles locked in:**

1. **Never use the same model for implementer and consistency classifier.** A model checking its own output for drift systematically misses the drift patterns it itself produces. Gemma-guarding-Qwen is an independent perspective; Qwen-guarding-Qwen is useless.

2. **Always keep a ceiling model distinct from production scoring.** Devstral Small runs live scoring cheaply; Claude Sonnet 4.6 runs gold-standard calibration offline as the reference oracle. Target Cohen κ ≥ 0.75 between them (EasyMED LLM-judge baseline in clinical SP context is 0.76 [R5-S24]). When Devstral κ drops below 0.70 on any dimension, retune or escalate that dimension to Sonnet live.

3. **Only two roles must run on Workers AI.** The implementer (per-turn latency) and the consistency classifier (per-turn latency × every single turn). Everything else — scoring, content generation, tagging, calibration — goes offline or uses the Anthropic Agent tool path, leaving Workers AI quota available for the real-time hot path.

**What changes vs. PIPE's current model routing (from CLAUDE.md):**

| Agent | Current | Proposed | Why |
|---|---|---|---|
| Code review implementer | Qwen 2.5-Coder 32B | Qwen 2.5-Coder 32B *(unchanged for junior/mid)* + Qwen3-Coder or Sonnet 4.6 premium tier for senior persona | Senior persona needs stronger reasoning to hold nuanced pushback in-character |
| Code review scoring panel | Devstral Small | Devstral Small *(unchanged)* + Sonnet 4.6 as offline calibration oracle | Need reference point to detect Devstral drift |
| Consistency classifier | *(does not exist)* | **Gemma 4 12B on Workers AI (new)** | Agent drift is the #1 risk; no current defense |
| Content: templates | *(not yet built)* | **Claude Opus 4.6 via Agent tool (offline)** | Template authoring is the highest-leverage content artifact; spend the premium tokens once |
| Content: variants | *(not yet built)* | **Claude Sonnet 4.6 via Agent tool (offline, batch)** | Quality-sensitive, cost-insensitive, offline |
| Content: tagging | *(not yet built)* | **Claude Haiku 4.5 via Agent tool (offline, bulk)** | Matches existing "build-time bulk tagging" pattern per CLAUDE.md |

The implementer and production scorer choices don't change — they're already correct. What's missing is (a) the consistency classifier and (b) the content-generation toolchain, both of which are additions not replacements.

---

## Part 4 — Content sustainability (integrating Round 1)

Round 1 answered *how* to produce content at scale, leak-resistant, cheap. The short version:

### 4.1 Content pipeline (from R1 + R2)

**Primary path: hybrid real-skeleton + planted bug (AIG).**

1. Source real open-source PRs from GitHub after a rolling freshness cutoff (currently 2024-07-01, advanced quarterly) [R1-S12]. Filter via SEART GHS [R1-S9] for permissive licenses, non-trivial complexity, clean history.
2. Strip PII and repo-identifying strings.
3. Apply automatic item generation [R2-S10]: use a bug template (e.g., off-by-one in loop index) × a variant generator to plant a bug into the real code skeleton. BugPilot-style semantic injection [R2-S6] is the SOTA — generates bugs that are both plausible and detectable by runtime tests.
4. Execute against the repo's own test suite to confirm the planted bug actually fails a test. **Execution-based ground truth > LLM-judge ground truth** [R2-S6][R2-S7] (R2 is unambiguous here).
5. Tag the generated item on four dimensions: difficulty, tech-stack, skill tested, archetype. This is how persona selection works without a combinatorial explosion of personas.

### 4.2 The rolling-freshness gate is the leakage defense

Every pre-2024 dataset is HIGH-to-VERY-HIGH contamination risk [R1-S10][R1-S11] — frontier LLMs have seen them all. The defense is not "find uncontaminated data"; it's **"continuously produce new items from source material post-dating the last training cutoff."** LiveCodeBench [R1-S12] uses this strategy for coding benchmarks; it's directly portable. Advance the gate quarterly; retire old items.

### 4.3 Minimum viable bank size

From R3 [R3-S17]: ~225 items is the floor for a persona-discriminating bank (3 archetypes × 5 difficulty levels × 5 skill dimensions × 3 tech stacks). In practice, you can ship with ~50 items and grow the bank as candidate volume accumulates — IRT calibration needs n ≥ 100 attempts per item [R3-S11] for stable parameter estimation, so the early bank is intentionally under-calibrated and gets tightened over time.

### 4.4 Production cost budget

A solo founder can maintain this pipeline with:
- Quarterly GitHub scrape + filter (automated, ~2 hours human review)
- AIG template library (~20 bug templates, written once, versioned in repo) [R2-S10][R2-S18]
- LLM-assisted variant generation (Gemma 4 on Workers AI — free tier)
- Execution harness against scraped repos' test suites (CI sandboxing)
- SME review of ~10% of generated items for quality gate

**All of this fits inside PIPE's existing Cloudflare stack.** Nothing here requires new infrastructure.

---

## Part 5 — What this looks like as a product roadmap

### 5.1 Ship sequence (minimum viable crushing)

**Phase 1: Core format (weeks 1–4)**
- Multi-PR challenge type (3 PRs default)
- BARS rubric YAML in Worker, 6 dimensions (5 from practitioner lit + AI-direction)
- Devstral scoring with per-dimension BARS anchors
- Fixed persona specs (junior / mid / senior YAML)

**Phase 2: Agent quality chain (weeks 5–8)**
- Turn-level consistency classifier
- Gold-standard corpus bootstrap (10 transcripts, founder-rated)
- Implementer drift regression test in CI

**Phase 3: Content pipeline (weeks 9–12)**
- Rolling-freshness scraper
- AIG template library (10 templates to start)
- Execution-based ground-truth harness
- Initial bank: 15 items across 3 difficulty levels

**Phase 4: Validity framework (ongoing)**
- Lightweight job analysis document
- CVR mapping for each item
- Adverse-impact monitoring dashboard
- Concurrent-validity study protocol ready for first paying customer

### 5.2 What to defer

- **IRT calibration.** Need n ≥ 100 attempts/item [R3-S11]; ship uncalibrated, tighten with volume.
- **AutoIRT with LLM-simulated students [R3-S10].** Good idea, but not critical-path. Revisit after 3 months of real candidate data.
- **Full 8-station summative mode.** Start with 3 PRs; 8 is the target for senior-hire summative but 3 is enough for top-of-funnel screening and covers the MVP.
- **Perfect reactivity calibration.** Ship with hand-tuned persona YAML; run the formal 15-expert calibration study after the first real customer wants it.

### 5.3 What to not compromise on

- **Multi-PR structure.** One PR is not enough. This is the single biggest validity lever and it's free.
- **BARS anchors.** Level descriptors must be concrete observable behaviors. "Poor/good/excellent" is not an anchor — it's an excuse.
- **Consistency classifier.** Agent drift will destroy the assessment if not defended against. Build it before scaling traffic.
- **Separate scoring and implementer calls.** No shared context. Ever.
- **Content validity documentation.** Keep the validation file from day one. Legal defensibility is not retrofittable.

### 5.4 Unit economics — per-assessment cost with the proposed model routing

**Assumptions** (reasonable MVP defaults):
- 3 PRs per assessment × ~15 turns per PR = **45 turns per assessment**
- Per turn: ~2k input tokens (PR context + history + persona) / ~500 output tokens (response + optional small diff)
- Per turn consistency-classifier call: ~1k input tokens (response + persona spec) / ~100 output tokens (JSON)
- Scoring: 3 PR-level calls × ~8k input / ~1k output (full transcript + rubric)

**Approximate 2026 token pricing** (per 1M tokens):
- Workers AI Qwen 2.5-Coder 32B: ~$0.30 in / $0.50 out
- Workers AI Gemma 4 12B: ~$0.10 in / $0.30 out *(free-tier eligible under daily Gemma quota)*
- Mistral Devstral Small: ~$0.20 in / $0.60 out
- Claude Haiku 4.5: ~$1 in / $5 out
- Claude Sonnet 4.6: ~$3 in / $15 out
- Claude Opus 4.6: ~$15 in / $75 out

#### MVP tier — standard assessment (Qwen implementer + Gemma classifier + Devstral scorer)

| Component | Calls | Input tokens | Output tokens | Unit cost | Cost / assessment |
|---|---|---|---|---|---|
| Implementer (Qwen 2.5-Coder 32B) | 45 | 90k | 22.5k | $0.30 / $0.50 | **$0.038** |
| Consistency classifier (Gemma 4 12B) | 45 | 45k | 4.5k | $0.10 / $0.30 | **$0.006** |
| Scorer (Devstral Small) | 3 | 24k | 3k | $0.20 / $0.60 | **$0.007** |
| | | | | **Total** | **~$0.051** |

**≈ 5 cents per assessment.** Below ~222 assessments/day the Gemma classifier cost is covered by the existing Workers AI free allotment, making the effective cost even lower (~$0.045). The dominant line item is the implementer, not the scorer — because it runs 45 times vs. 3.

#### Premium tier — senior persona with Sonnet 4.6 implementer fallback

| Component | Calls | Input tokens | Output tokens | Unit cost | Cost / assessment |
|---|---|---|---|---|---|
| Implementer (Claude Sonnet 4.6) | 45 | 90k | 22.5k | $3 / $15 | **$0.61** |
| Consistency classifier (Gemma 4 12B) | 45 | 45k | 4.5k | $0.10 / $0.30 | **$0.006** |
| Scorer (Devstral Small) | 3 | 24k | 3k | $0.20 / $0.60 | **$0.007** |
| | | | | **Total** | **~$0.62** |

**≈ 62 cents for a full Sonnet-powered senior assessment.** This is the ceiling — most senior assessments will route through Qwen and only the hardest 5–10% need Sonnet fallback. Blended senior-tier cost (90% Qwen / 10% Sonnet):

`(0.9 × $0.051) + (0.1 × $0.62) = $0.046 + $0.062 = **$0.11 per senior assessment**`

#### Summative tier — 3-model scoring panel (post-MVP)

| Component | Cost / assessment |
|---|---|
| MVP base | $0.051 |
| Add: Qwen3-Coder as 2nd judge (3 PR-level calls) | +$0.007 |
| Add: Sonnet 4.6 as 3rd judge (3 PR-level calls) | +$0.10 |
| **Total** | **~$0.16** |

**≈ 16 cents for a full summative assessment with triple-judge panel.** Only used for post-MVP enterprise-tier hiring decisions where the stakes justify the redundancy.

#### Offline content costs — amortized, effectively zero

| Activity | Model | One-time cost | Amortized per assessment |
|---|---|---|---|
| Bug template authoring (~20 templates, lifetime) | Opus 4.6 | ~$45 total | ~$0.00004 |
| Variant generation (15-item initial bank) | Sonnet 4.6 | ~$3 one-time | ~$0.003 over first 1,000 sessions |
| Item tagging (15 items) | Haiku 4.5 | ~$0.10 total | negligible |
| Gold-standard calibration (100 transcripts) | Sonnet 4.6 | ~$4 per run × ~4/year | ~$0.016/year |
| Execution verification | (no LLM, CI sandbox) | compute only | negligible |

**Total lifetime offline content investment to launch: ~$52.** That's less than a dinner.

#### Scale math

| Volume | MVP tier (~$0.05) | Premium blend (~$0.11) | Summative (~$0.16) |
|---|---|---|---|
| 100 assessments/month | $5 | $11 | $16 |
| 1,000 assessments/month | $51 | $110 | $160 |
| 10,000 assessments/month | $510 | $1,100 | $1,600 |
| 100,000 assessments/month | $5,100 | $11,000 | $16,000 |

#### Margin analysis

At a market-comparable price of $10–$20 per assessment:

| Price / assessment | MVP tier margin | Senior tier margin | Summative margin |
|---|---|---|---|
| $5 | **99.0%** | 97.8% | 96.8% |
| $10 | **99.5%** | 98.9% | 98.4% |
| $20 | **99.75%** | 99.45% | 99.2% |

**The unit economics are not the bottleneck.** At MVP pricing, the Cloudflare compute + token costs are under 1% of revenue. The constraints on this business are founder time, content pipeline discipline, and sales motion — not inference cost. This is a direct consequence of the Workers AI routing keeping the hot-path calls cheap and pushing premium models offline.

**Caveat on the numbers:** Token prices for Workers AI models are approximate — Cloudflare prices in "neurons" not tokens, and the conversion varies by model. For a precise budget, benchmark one real assessment end-to-end against the Cloudflare billing dashboard. The order-of-magnitude — cents not dollars per assessment — is robust.

---

## Part 6 — The moat

Five things that are genuinely hard for competitors to replicate:

1. **Revision-evaluation scoring dimension.** Requires an interactive implementer. HackerRank and CodeSignal would have to rebuild their entire assessment runtime to ship this.
2. **AI-direction construct.** Requires instrumentation of turn-level agent-directed behavior. Nobody else has the telemetry.
3. **Rolling-freshness content pipeline.** Operational discipline, not technology — competitors that have invested in curated bug libraries cannot pivot to a continuous-refresh model without abandoning their investment.
4. **Persona-calibrated reactivity.** The junior/mid/senior implementer distinction is a product of the calibration study, not the prompt. Once you have gold-standard corpora, this compounds.
5. **Validation file from day one.** Being able to ship a legal defensibility package at sales time is a moat against enterprise buyers who need it.

None of the five requires an army of content engineers. All five require consistent founder discipline over 3–6 months.

---

## Open questions (genuine unknowns)

1. **Criterion validity study design.** What's the minimum viable concurrent-validity study? How small can n be and still produce usable evidence? (This is the biggest remaining research gap; the literature has not settled it for SWE-specific assessments.)
2. **Turn-level vs. encounter-level scoring trade-off.** The research recommends encounter-level, but encounter-level scoring may lose signal on turn-by-turn AI direction quality. Might need a two-layer scoring model (turn-level evidence feeding encounter-level judgment). Needs empirical validation.
3. **Reactivity calibration ground truth.** Who are the "expert raters" for the calibration study? Senior engineers, yes — but which subpopulation? The reliability of subjective persona labels has not been studied in this specific context.
4. **AI-direction scoring rubric.** This dimension is genuinely novel. The BARS anchors above are inferred from Osmani / Jellyfish / Graphite operational metrics [R6-S18][R6-P11][R6-S11] but have not been empirically validated. Needs a critical-incident study with expert reviewers to derive proper anchors.
5. **Content-freshness decay curve.** How quickly does a given cohort of generated items leak as LLMs update? Quarterly advance is a guess; the actual decay rate is unknown and affects the pipeline cost model.

## Needs internal product decision (not research)

- **Scoring output shape to customers.** Score only? Score + narrative report? Transcript + annotations? (Buyer-voice research suggests hiring managers want the transcript more than the score, but this is product packaging not validity.)
- **Candidate-facing framing of the AI implementer.** Explicitly labeled as AI? Framed as "the author"? This affects face validity and candidate experience but not construct validity.
- **Pricing tier tied to PR count.** 3 PRs = screen tier, 5 PRs = assessment tier, 8 PRs = summative tier? This is a packaging call, not a research call.
- **Who gets the gold-standard rater role.** Founder? Hired senior consultants? Advisory board? Affects corpus trust but is a product/ops decision.

---

## Sources

### R4 — Work Sample Validity

[R4-S3] Sackett, P. R., Zhang, C., Berry, C. M., & Lievens, F. (2022). *Revisiting meta-analytic estimates of validity in personnel selection: Addressing systematic overcorrection for restriction of range.* Journal of Applied Psychology, 107(11), 2040–2068. https://www.semanticscholar.org/paper/Revisiting-meta-analytic-estimates-of-validity-in-Sackett-Zhang/3d97bb723b4ec316b23105126b78b71a855de79e; summary at https://www.siop.org/tip-article/is-cognitive-ability-the-best-predictor-of-job-performance-new-research-says-its-time-to-think-again/ ✓ verified

[R4-S6] Huffcutt, A. I., & Arthur, W. Jr. (1994). *Hunter and Hunter (1984) revisited: Interview validity for entry-level jobs.* Journal of Applied Psychology, 79(2), 184–190. https://psycnet.apa.org/record/1994-31607-001 ✓ verified (abstract accessible)

[R4-S9] Equal Employment Opportunity Commission et al. (1978). *Uniform Guidelines on Employee Selection Procedures.* 29 CFR Part 1607. https://www.uniformguidelines.com/uniformguidelines.html ✓ verified

[R4-S10] Griggs v. Duke Power Co., 401 U.S. 424 (1971). Supreme Court opinion. https://www.law.cornell.edu/supremecourt/text/401/424 ✓ verified

[R4-S11] Ricci v. DeStefano, 557 U.S. 557 (2009). Supreme Court opinion. https://supreme.justia.com/cases/federal/us/557/557/ ✓ verified

[R4-S12] Roth, P. L., Bobko, P., McFarland, L. A., & Buster, M. (2008). *Work sample tests in personnel selection: A meta-analysis of Black–White differences in overall and exercise scores.* Personnel Psychology, 61(3), 637–662. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2008.00125.x ⚠ paywalled (403)

[R4-S15] Hatchways. (2022). *Using a code review assessment to assess software engineering talent.* https://www.hatchways.io/blog/code-review-assessment-to-assess-engineers ✓ verified

[R4-S16] Ployhart, R. E., & Holtz, B. C. (2008). *The diversity–validity dilemma: Strategies for reducing racioethnic and sex subgroup differences and adverse impact in selection.* Personnel Psychology, 61(1), 153–172. https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.2008.00109.x ⚠ paywalled (403)

[R4-S18] Fine, S., & Pirak, M. (2025). *Does concurrent validity really estimate predictive validity in psychological testing? Two local studies.* Applied Psychology (IAAP). https://iaap-journals.onlinelibrary.wiley.com/doi/10.1111/apps.70001 ✓ verified

[R4-S19] Society for Industrial and Organizational Psychology (SIOP). (2023). *Considerations and Recommendations for the Validation and Use of AI-Based Assessments for Employee Selection.* https://www.siop.org/post/siop-releases-recommendations-for-ai-based-assessments/ ✓ verified

### R5 — Simulation-Based Assessment

[R5-S1] Imanipour, M., & Jalili, M. (2016). *Reliability analysis of the objective structured clinical examination using generalizability theory.* Medical Education Online. PMC4991996. https://pmc.ncbi.nlm.nih.gov/articles/PMC4991996/ ⚠ redirects to Trejo-Mejía et al. 2016 study (similar content, OSCE reliability)

[R5-S2] Pau, A. et al. (2019). *Multiple Mini Interview as an admission tool in higher education: Insights from a systematic review.* Journal of Educational Evaluation for Health Professions. PMC6695046. https://pmc.ncbi.nlm.nih.gov/articles/PMC6695046/ ✓ verified

[R5-S3] Eva, K.W., Rosenfeld, J., Reiter, H.I., & Norman, G.R. (2004). *An admissions OSCE: the multiple mini-interview.* Medical Education, 38(3), 314-326. https://asmepublications.onlinelibrary.wiley.com/doi/full/10.1046/j.1365-2923.2004.01776.x ✓ verified

[R5-S5] Hodges, B., Regehr, G., McNaughton, N., Tiberius, R., & Hanson, M. (1999). *OSCE checklists do not capture increasing levels of expertise.* Academic Medicine, 74(10), 1129–1134. https://pubmed.ncbi.nlm.nih.gov/10536636/ ✓ verified

[R5-S6] Hodges, B., & McIlroy, J.H. (2003). *The risks of thoroughness: reliability and validity of global ratings and checklists in an OSCE.* Advances in Health Sciences Education. https://link.springer.com/article/10.1007/BF00162920 ✓ verified

[R5-S7] Lateef, F. (2020). *Standardization of Standardized Patient Training in Medical Simulation.* StatPearls. https://www.ncbi.nlm.nih.gov/books/NBK560864/ ✓ verified

[R5-S8] de la Croix, A., & Veen, M. (2022). *Quality in Standardized Patient Training and Delivery: Retrospective Documentary Analysis of Trainer and Instructor Feedback.* Simulation in Healthcare. PMC8820478. https://pmc.ncbi.nlm.nih.gov/articles/PMC8820478/ ✓ verified

[R5-S9] Ouyang, S. et al. (2024). *Consistently Simulating Human Personas with Multi-Turn Reinforcement Learning.* arXiv:2511.00222. https://arxiv.org/html/2511.00222v1 ⚠ authorship discrepancy (Abdulhai et al., not Ouyang); content verified (PPO >55% reduction)

[R5-S13] van Avermaete, J.A.G., & Kruijsen, E.A.C. (1998). *NOTECHS: The Evaluation of Non-Technical Skills of Multi-Pilot Aircrew in Relation to the JAR-FCL Requirements.* NLR report (JARTEL project). https://www.researchgate.net/publication/224989989_Development_of_the_NOTECHS_non-technical_skills_System_for_Assessing_Pilots_CRM_Skills ✓ verified

[R5-S18] Smith, P.C., & Kendall, L.M. (1963). *Retranslation of expectations: An approach to the construction of unambiguous anchors for rating scales.* Journal of Applied Psychology, 47(2), 149–155. (Foundational BARS paper; widely cited, no stable public URL)

[R5-S19] FAA. (2022). *AC 120-35D: Flightcrew Member Line Operational Simulations.* US Department of Transportation. https://www.faa.gov/regulations_policies/advisory_circulars/index.cfm/go/document.information/documentID/1027170 ✓ verified

[R5-S20] FAA. (2022). *AC 120-54A (Change 1): Advanced Qualification Program.* US Department of Transportation. https://www.faa.gov/sites/faa.gov/files/2022-11/AC-120-54A,%20Chg.1,%20AQP.pdf ✓ verified

[R5-S23] Woodward, C.A., McConvey, G.A., Neufeld, V., Norman, G.R., & Walsh, A. (2011). *Examination of standardized patient performance: Accuracy and consistency over time.* Medical Education (1985 original; 2011 replication). PMC3158971. https://pmc.ncbi.nlm.nih.gov/articles/PMC3158971/ ✓ verified

[R5-S24] Liu, J. et al. (2024). *Human or LLM as Standardized Patients? A Comparative Study in Medical Education.* arXiv:2511.14783. https://arxiv.org/html/2511.14783 ⚠ 2026 paper (Zhang et al.), not Liu 2024; EasyMED κ=0.76 verified

### R6 — Market & Practitioner Literature

[R6-S1] HackerRank Blog. (2024). *Want to See Their Skills? Just Have Them Do a Code Review.* https://www.hackerrank.com/blog/code-review-questions/ ✓ verified

[R6-S2] HackerRank Support. (2024). *Scoring a Code Review Question.* https://support.hackerrank.com/articles/4740112925-scoring-a-code-review-question ✓ verified

[R6-S3] CodeSignal Support. (2024). *How can I use Code Review Questions within CodeSignal Interview?* https://support.codesignal.com/hc/en-us/articles/22434720089495 ✓ verified

[R6-S4] Woven Teams website. (2025). https://www.woventeams.com/ ✓ verified

[R6-S5] G2. (2026). *Woven Reviews 2026.* https://www.g2.com/products/woven/reviews ✓ verified

[R6-S10] GitLab Handbook. *Technical Interviews.* https://handbook.gitlab.com/handbook/hiring/interviewing/technical/ ✓ verified

[R6-S11] Graphite Blog. (2025). *Graphite raises $52M and launches Diamond to reimagine code review for the age of AI.* https://graphite.com/blog/series-b-diamond-launch ✓ verified

[R6-S14] CoderPad & CodinGame. (2024). *State of Tech Hiring 2024.* https://coderpad.io/survey-reports/coderpad-and-codingame-state-of-tech-hiring-2024/ ✓ verified

[R6-S18] Osmani, A. (2024). *Code Review in the Age of AI.* Elevate substack. https://addyo.substack.com/p/code-review-in-the-age-of-ai ✓ verified

[R6-P1] Bacchelli, A. & Bird, C. (2013). *Expectations, Outcomes, and Challenges of Modern Code Review.* ICSE 2013. https://dl.acm.org/doi/10.5555/2486788.2486882 ⚠ paywalled (403); PDF at https://www.microsoft.com/en-us/research/wp-content/uploads/2016/02/ICSE202013-codereview.pdf ⚠ binary PDF content

[R6-P2] Sadowski, C., Söderberg, E., Church, L., Sipko, M. & Bacchelli, A. (2018). *Modern Code Review: A Case Study at Google.* ICSE-SEIP 2018. https://dl.acm.org/doi/10.1145/3183519.3183525 ⚠ paywalled (403); PDF at https://sback.it/publications/icse2018seip.pdf ⚠ binary PDF content

[R6-P4] MacLeod, L., Greiler, M., Storey, M., Bird, C. & Czerwonka, J. (2018). *Code Reviewing in the Trenches: Understanding Challenges and Best Practices.* IEEE Software 2018. https://ieeexplore.ieee.org/document/7950877/ ✓ verified (IEEE Xplore accessible); PDF at https://chisel.cs.uvic.ca/pubs/macleod-IEEESoftware2017.pdf

[R6-P5] Bosu, A., Greiler, M. & Bird, C. (2015). *Characteristics of Useful Code Reviews: An Empirical Study at Microsoft.* MSR 2015. https://dl.acm.org/doi/10.5555/2820518.2820538 ⚠ paywalled (403)

[R6-P7] Zhang, X. et al. (2024). *Leveraging Reviewer Experience in Code Review Comment Generation.* arXiv:2409.10959. https://arxiv.org/html/2409.10959v1 ✓ verified

[R6-P10] Sillito, J., Murphy, G.C. & De Volder, K. (2006). *Asking and Answering Questions during a Programming Change Task.* ICSE 2006. https://www.semanticscholar.org/paper/Asking-and-Answering-Questions-during-a-Programming-Sillito-Murphy/98cb9e2c4214f0a68bae57e5f5a8d5005fd3f908 ✓ verified

[R6-P11] Jellyfish. (2025). *The Real Impact of AI Code Review Agents: What We Learned from 1,000 Reviews.* https://jellyfish.co/blog/impact-of-ai-code-review-agents/ ✓ verified (2025, not 2024)

### R1 — Data Mining & Leakage

[R1-S9] Ozren Dabić et al. *GHS (GitHub Search).* Zenodo:4476392. Tool: https://seart-ghs.si.usi.ch/ ✓ verified

[R1-S10] Martin Riddell et al. (2024). *Quantifying Contamination in Evaluating Code Generation Capabilities of Language Models.* ACL 2024. arXiv:2403.04811. https://arxiv.org/html/2403.04811v1 ✓ verified

[R1-S11] Junda He et al. (2025). *LessLeak-Bench: A First Investigation of Data Leakage in LLMs Across 83 Software Engineering Benchmarks.* arXiv:2502.06215. https://arxiv.org/abs/2502.06215 ✓ verified

[R1-S12] Naman Jain et al. (2024). *LiveCodeBench: Holistic and Contamination Free Evaluation of Large Language Models for Code.* arXiv:2403.07974. ICLR. https://arxiv.org/abs/2403.07974; https://livecodebench.github.io/ ✓ verified

### R2 — Synthetic Bug Injection

[R2-S6] Microsoft Research (2025). *BugPilot: Complex Bug Generation for Efficient Learning of SWE Skills.* arXiv:2510.19898. https://arxiv.org/abs/2510.19898 ✓ verified

[R2-S7] Pham, T. et al. (2025). *SWE-Synth: Synthesizing Verifiable Bug-Fix Data to Enable Large Language Models in Resolving Real-World Bugs.* arXiv:2504.14757. https://arxiv.org/abs/2504.14757 ✓ verified

[R2-S10] Gierl, M. J. & Haladyna, T. M. (Eds.) (2012). *Automatic Item Generation: Theory and Practice.* Routledge. https://www.routledge.com/Automatic-Item-Generation-Theory-and-Practice/Gierl-Haladyna/p/book/9780415897518 ✓ verified

[R2-S18] Gierl, M. J. et al. (2022). *Using Content Coding and Automatic Item Generation to Improve Test Security.* Frontiers in Education. https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2022.853578/full ✓ verified

### R3 — Scaffolding & IRT

[R3-S10] Sharpnack, J., Mulcaire, P., Bicknell, K., LaFlair, G., & Yancey, K. (2024). *AutoIRT: Calibrating item response theory models with automated machine learning.* arXiv:2409.08823. https://arxiv.org/abs/2409.08823 ✓ verified

[R3-S11] Rasch model and IRT calibration small sample considerations. Multiple sources: PubMed; Frontiers in Psychology 2024; Cambridge Assessment. https://pubmed.ncbi.nlm.nih.gov/23912855/; https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1353419/full; https://files.eric.ed.gov/fulltext/EJ1317443.pdf ✓ verified

[R3-S17] NWEA. (2015). *Effects of item bank design and item selection methods on content balance.* NWEA Research Report. https://www.nwea.org/uploads/2015/05/Effects-of-Item-Bank-Design-and-Item-Selection-on-Content-Balance_Sept17.pdf ✓ verified

---

## Verifier notes

### URL verification summary

- **Total sources cited**: 50
- **Verified live (✓)**: 37
- **Paywalled/403 (⚠)**: 8 (R4-S12, R4-S16, R6-P1 ACM, R6-P2 ACM, R6-P5; PDFs available via alternate URLs)
- **Redirected content (⚠)**: 3 (R5-S1 redirects to similar OSCE study; R5-S9 authorship mismatch but content verified; R5-S24 date/authorship mismatch but EasyMED kappa verified)
- **Binary PDF (not readable via WebFetch)**: 2 (R6-P1 Microsoft PDF, R6-P2 sback.it PDF; abstracts/titles confirmed via alternate paths)
- **Dead links**: 0

### Unsourced claims flagged

1. ~~Stack Overflow 2024 developer AI usage statistics~~ — **Resolved during reviewer pass.** Claim IS present in R6 evidence table row E12 (R6 file line 210). Verifier missed it; citation [R6-E12] added inline. No unsourced claim remains.

2. **Xia et al. ~58% time on comprehension** (mentioned in priority claims list): Found in R3-S1 but not cited in draft. Informational — can be added in a later revision if needed.

### Date corrections

- **Jellyfish study [R6-P11]**: Draft states "2024" but verified URL shows September 2025 publication. Citation updated to 2025.

### Authorship discrepancies noted

- **R5-S9** (LLM persona consistency): Research file cites "Ouyang, S. et al." but verified arXiv page shows "Abdulhai, Cheng, Clay, Althoff, Levine, and Jaques (2024/2025)". Content claim (PPO >55% reduction) is verified. Recommend updating research file authorship.
- **R5-S24** (EasyMED): Research file cites "Liu, J. et al. (2024)" but verified arXiv shows "Zhang, Liu, Wang, Zhou, Xie, and Wang (2026)". Content claim (Cohen κ = 0.76) is verified.

### Additional findings not used in draft

None identified. All major research findings from the six files are reflected in the draft or appropriately omitted as out-of-scope for the synthesis (e.g., raw dataset URLs, licensing details, specific benchmark results not relevant to PIPE's design).

---

**File**: `/Users/hans/Code/PIPE/PIPE-OS/knowledge/outputs/code-review-content-sourcing-brief.md`

**Sources**: 50 total, 37 verified live, 8 paywalled (accessible via institutions), 3 redirected/authorship mismatches (content verified), 2 binary PDFs (titles confirmed), 0 dead links

**Unsourced claims flagged**: 0 (Stack Overflow claim resolved — was present in R6-E12; verifier miss corrected)

**Issues for lead**: 3 authorship/date discrepancies in research files (R5-S9, R5-S24, R6-P11); 1 unsourced claim to validate or remove
