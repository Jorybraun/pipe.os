> **STATUS: INTERMEDIATE (Lead draft, pre-citation)** · Created 2026-04-08 13:53
> **Research run:** `code-review-content-sourcing`
> **Role in run:** Lead-authored draft before verifier citation pass. Superseded by the final after verifier + reviewer corrections.
> **Use the final instead:** [`../code-review-content-sourcing.md`](../code-review-content-sourcing.md)
> **Kept for:** Audit trail of the pre-citation Lead synthesis.
> **Navigate:** [INDEX](../../INDEX.md)

---

# Designing a Code-Review Assessment That Crushes

**Synthesis of Rounds 1 & 2 research** · 2026-04-08 · Draft for founder review

> This document is the Lead-authored synthesis of six research files (R1 mining, R2 synthetic, R3 scaffolding, R4 work-sample validity, R5 simulation-based assessment, R6 market + practitioner). Sources will be cited in the verifier pass; claims here are traceable to the underlying research files.

---

## Executive summary

PIPE is aimed at a **real, specific gap in the market**: no developer-hiring platform ships interactive multi-turn code review with an implementer that responds, pushes back, and revises code. HackerRank and CodeSignal ship *static* diff-comment items. Woven ships human-graded PR review at ~10–20× the price of an ML-scored screen. GitLab does multi-turn review internally because their own engineers believe it's the highest-signal interview — they just don't have a scalable version. **That gap is PIPE's wedge.**

The research converges on a design that's buildable by a solo founder and defensible as a hiring instrument. The winning shape has five features:

1. **Multi-PR structure (3 minimum, 5 target)** — borrowed from MMI / OSCE context-specificity literature. A single PR is noise.
2. **Hybrid scoring: objective checklist + BARS-anchored global dimensions** — Hodges-finding-compliant, so you don't penalize the expert reviewer who triages instead of enumerating.
3. **Five scoring dimensions from the practitioner literature** — issue depth, reasoning quality, prioritization, question formation, and **revision evaluation** (the exclusive one).
4. **AI-direction as a first-class construct** — measurable via suggestion-acceptance patterns, entirely unmeasured by competitors, and aligned with what engineering managers now actually want to hire for.
5. **An agent quality chain that treats the implementer like a standardized patient** — consistency classifier, reactivity calibration, and gold-standard corpus replay. Without this, the whole format collapses on agent drift.

The biggest threats to validity are **not** content leakage (solvable with a rolling-freshness pipeline) or psychometric calibration (solvable with AutoIRT). They are:
- **Agent drift** (14–34% off-persona baseline for instruction-tuned LLMs) — engineering problem.
- **The criterion problem** (no study has ever validated a code-review assessment against on-the-job SWE performance) — bootstrap problem.

Both are tractable, and the rest of this document lays out how.

---

## Part 1 — The format is sound. Here's the evidence.

### 1.1 Validity ceiling

A turn-based code review is simultaneously a **high-fidelity work sample** and a **structured interview**. Post-Sackett (2022) corrected coefficients: structured interviews *r* = .42, work samples *r* = .33, the combination approaches the practical ceiling for standalone assessments. Huffcutt & Arthur's level model puts a "Level 3–4" structured assessment (standardized prompts + anchored rubrics + multi-rater scoring) at *r* = .51–.57 predictive validity.

PIPE's format sits in that ceiling *if* it hits all three structural features. All three are low-cost design decisions, not expensive engineering investments.

### 1.2 Fairness profile is favorable

The Roth et al. (2008) data is the critical one: knowledge-recall / in-basket work samples show Black–White applicant *d* ≈ .74–.76 (close to pure cognitive ability tests), but **interactive, oral, conversational formats show *d* ≈ .21–.22** — more than 3× smaller adverse-impact gap. A multi-turn code-review conversation that weights reasoning and communication over pattern-matching of known bugs is structurally in the favorable zone.

This is a marketing advantage as well as a legal one: hiring teams are actively searching for formats that reduce adverse impact without sacrificing validity, and most current technical assessments (algorithmic challenges, MCQ screens) are in the high-*d* zone.

### 1.3 Legal defensibility is a package, not a principle

Under EEOC Uniform Guidelines + Griggs + Ricci, the defensible pathway is **content validity**:

1. Lightweight job analysis (SWE job postings + SME ratings of code-review task criticality — cheap).
2. CVR-rated mapping of each PR scenario to the task inventory.
3. Adverse-impact monitoring from day one (4/5ths rule compliance).
4. Documented validation file — job analysis, rubric, inter-rater reliability, subgroup analysis.

This is a compliance package a solo founder can ship. It is *not* optional — SIOP 2023 guidelines on AI-based assessments explicitly require the same validity and fairness standards as traditional tests, with auditable documentation.

### 1.4 The criterion problem is the real unfinished business

**No peer-reviewed study validates a code-review assessment against SWE job performance.** That is the gap. The bootstrap path:

- **Concurrent validity study at 90 days post-hire** (12–18 months after beta traffic): structured manager rating instrument with a "code-review quality" dimension, correlated against hire-time assessment scores.
- **Proxy criteria from GitHub/GitLab metadata**: comment acceptance rate, review turnaround, bug catch rate post-merge.
- **Expert-rater calibration as a construct-validity bridge**: senior engineers re-score the same candidate transcripts; use inter-rater agreement as interim evidence.

This is more runway than a founder wants, but the *framework* shipping on day one is what matters for defensibility. Even partial evidence beats none.

---

## Part 2 — The format design: make it crush

### 2.1 Multiple PRs, independently scored — not one deep PR

The single most important design decision. **Every simulation-based assessment domain independently converged on this finding:** context/case specificity accounts for ~25% of variance; a single encounter is unreliable as a standalone signal.

- OSCE: consensus 8–12 stations for G ≥ 0.80
- MMI: G = 0.70 with 8 stations, G = 0.80 requires 14
- Aviation LOE: multiple scenarios required for certification decisions

For PIPE, the practical numbers:

| Use case | PR count | Why |
|---|---|---|
| Top-of-funnel screen | 3 PRs | Usable signal, low candidate time cost |
| Mid-funnel assessment | 5 PRs | Approaching G ≥ 0.75 |
| Summative hiring decision | 8 PRs | G ≥ 0.80, MMI-equivalent |

Each PR must be **scored independently** — no cross-PR context in the scoring prompt, no halo from the previous PR's score. This is trivially achievable for LLM-as-judge scoring (separate invocations, clean prompts) and impossible in human-rater OSCE without expensive process control. That's a structural advantage PIPE should exploit.

**Design choice:** the "challenge type" in the pipeline isn't "CODE_REVIEW" — it's "CODE_REVIEW (3 PRs)". One PR = one station. Default the challenge to 3.

### 2.2 Hybrid checklist + BARS-anchored global rating

Hodges et al. (1999) is the finding that matters: **checklists penalize experts**. Board-certified physicians scored *lower* than clerks on binary checklists but *higher* on global rating scales. The expert skips redundant information-gathering; the checklist scores the skip as a miss.

Direct analog for PIPE: a checklist that awards points for "mentioned type safety", "mentioned error handling", "mentioned performance" will penalize the senior reviewer who targets two real bugs and skips cosmetic noise. **This is exactly the opposite of the signal you want.**

The fix is a hybrid scoring design:

| Layer | Purpose | Scoring mechanism |
|---|---|---|
| **Objective checklist** (per PR) | Did the candidate identify planted bug X? Did they propose fix Y? | Automated, binary, ground-truth comparison. Deterministic. |
| **BARS-anchored global dimensions** (per PR) | Reasoning depth, prioritization, communication, AI direction | LLM-judge scoring against behaviorally-anchored rubric levels 1–5 |

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

Converged from Bacchelli & Bird 2013, Sadowski 2018, Bosu 2015, Zhang 2024, Sillito 2006, MacLeod 2018 — the entire practitioner literature points the same direction:

| # | Dimension | What it measures | Seniority signal? |
|---|---|---|---|
| 1 | **Issue identification depth** | Functional defects + security > design > tests > docs > readability > style | Strong (Bosu, Zhang) |
| 2 | **Reasoning/explanation quality** | Does the candidate explain *why* an issue matters, not just *that* it exists? | Strong (Bosu) |
| 3 | **Prioritization accuracy** | Distinguishes blockers from nitpicks; doesn't conflate | Strong (MacLeod) |
| 4 | **Question formation** | Asks questions that elicit rationale, history, design intent (Sillito's 44-question taxonomy) | Strong (Sillito, Bacchelli) |
| 5 | **Revision evaluation** | After implementer responds, correctly assesses whether fix is complete / incomplete / introduces new issues | **PIPE-exclusive** |

Dimension 5 is the moat. No other platform can score it because no other platform has an interactive implementer. Every scoring rubric should weight this dimension *heavily* — it's the reason PIPE exists as a separate product.

### 2.4 AI-direction as a sixth dimension (the emerging construct)

The 2024–2025 data is unambiguous: "can direct, evaluate, push back on AI code" has become a core engineering skill, and nobody in hiring measures it.

- Jellyfish 2024: only 18% of AI code-review suggestions result in code changes. Developer *judgment* on which 18% to accept is the skill.
- Graphite Diamond operationalizes "acceptance rate" as a product metric.
- CoderPad 2024 survey: only 8% of recruiters openly allow AI in assessments, but 48% want to know how candidates use AI — the demand is there, the instrument isn't.
- Stack Overflow 2024: 63% of developers use AI daily; only 43% trust accuracy.

**How PIPE measures it without forcing a second format:** the implementer agent itself is the AI under direction. The candidate directs the implementer, evaluates its responses, and decides whether to push back or accept. Every turn produces observable data on AI-direction quality:

- When the implementer proposes a flawed fix, does the candidate catch it?
- When the implementer pushes back with a superficially plausible but wrong argument, does the candidate hold the line?
- When the implementer offers a cleaner alternative, does the candidate evaluate it on merits or defer?
- Does the candidate escalate when they sense the agent is stuck, or persist unproductively?

This maps the Addy Osmani "judgment over acceptance" framing directly into measurable turn-level behaviors. Add it as the sixth BARS dimension. It should be weighted heavily for senior personas and lightly for junior personas.

---

## Part 3 — Making the implementer agent crush

This is the technical core. Everything above is design; this section is engineering.

### 3.1 The drift problem is real and it's the #1 risk

LLM agents playing a role drift off-persona on **14–34% of turns** at baseline (Llama-8B / Gemma-2B / Mistral-7B). PPO fine-tuning reduces this by >55%; supervised fine-tuning produces smaller and less stable gains; prompt engineering alone is insufficient.

**If the implementer drifts, the whole assessment breaks:**
- If the agent volunteers the planted bug, the candidate gets credit for detection they didn't earn.
- If the agent abandons its pushback persona, reactivity calibration collapses.
- If the agent adopts the candidate's framing uncritically, there's nothing to direct.
- If the agent varies its behavior between sessions, comparative scoring becomes invalid.

**Treat the implementer like a standardized patient.** The SP literature has a 40-year head start on this exact problem. Their solutions translate directly:

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

**The consistency classifier is non-negotiable.** Prompt engineering alone will not hold Qwen to persona across 15+ turns; the literature is unambiguous on this. Build it from day one.

### 3.3 Reactivity calibration — the genuinely novel part

The SP literature documents the consistency-reactivity tradeoff but offers no calibration protocol for setting the *right level* of reactivity. For PIPE's junior-vs-senior implementer personas, this must be determined empirically. A concrete protocol:

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

**(a) Score at the PR/encounter level, not the turn level.** Turn-level scoring is architecturally tempting but dangerous: individual turns are noisy, and aggregating 15 turn-level scores may amplify noise rather than reduce it. OSCE / MMI / aviation LOE all score at the encounter level. Turn data is *evidence* for the encounter score, not independent data points.

**(b) Separate the scoring invocation from the implementer invocation.** The implementer is Qwen 2.5-Coder; the scorer is Devstral (per existing PIPE architecture). Do not reuse context. The scorer reads the full transcript from scratch, applies the BARS rubric, and outputs per-dimension scores with justification. Cohen κ target: 0.76 (the EasyMED LLM-judge baseline in a clinical SP context — closest available prior art).

### 3.5 The gold-standard conversation corpus

This is the asset you build once and leverage forever. Over time, as real candidate sessions run:

1. Sample transcripts across the score distribution.
2. Have senior engineer raters score them manually on the BARS rubric.
3. Lock the gold-standard subset (e.g., 100 transcripts) as a regression test.
4. Every rubric version change must be re-validated against the gold corpus — does the new scorer produce scores correlated with expert ratings on the gold set?
5. Every implementer-agent model upgrade must pass drift-regression against the gold corpus too.

This is the AQP "periodic recalibration" discipline from aviation, adapted to a Worker-scale product. It's what transforms the assessment from a one-off into a living, defensible instrument.

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

2. **Always keep a ceiling model distinct from production scoring.** Devstral Small runs live scoring cheaply; Claude Sonnet 4.6 runs gold-standard calibration offline as the reference oracle. Target Cohen κ ≥ 0.75 between them (EasyMED LLM-judge baseline in clinical SP context is 0.76). When Devstral κ drops below 0.70 on any dimension, retune or escalate that dimension to Sonnet live.

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

1. Source real open-source PRs from GitHub after a rolling freshness cutoff (currently 2024-07-01, advanced quarterly). Filter via SEART GHS for permissive licenses, non-trivial complexity, clean history.
2. Strip PII and repo-identifying strings.
3. Apply automatic item generation: use a bug template (e.g., off-by-one in loop index) × a variant generator to plant a bug into the real code skeleton. BugPilot-style semantic injection is the SOTA — generates bugs that are both plausible and detectable by runtime tests.
4. Execute against the repo's own test suite to confirm the planted bug actually fails a test. **Execution-based ground truth > LLM-judge ground truth** (R2 is unambiguous here).
5. Tag the generated item on four dimensions: difficulty, tech-stack, skill tested, archetype. This is how persona selection works without a combinatorial explosion of personas.

### 4.2 The rolling-freshness gate is the leakage defense

Every pre-2024 dataset is HIGH-to-VERY-HIGH contamination risk — frontier LLMs have seen them all. The defense is not "find uncontaminated data"; it's **"continuously produce new items from source material post-dating the last training cutoff."** LiveCodeBench uses this strategy for coding benchmarks; it's directly portable. Advance the gate quarterly; retire old items.

### 4.3 Minimum viable bank size

From R3: ~225 items is the floor for a persona-discriminating bank (3 archetypes × 5 difficulty levels × 5 skill dimensions × 3 tech stacks). In practice, you can ship with ~50 items and grow the bank as candidate volume accumulates — IRT calibration needs n ≥ 100 attempts per item for stable parameter estimation, so the early bank is intentionally under-calibrated and gets tightened over time.

### 4.4 Production cost budget

A solo founder can maintain this pipeline with:
- Quarterly GitHub scrape + filter (automated, ~2 hours human review)
- AIG template library (~20 bug templates, written once, versioned in repo)
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

- **IRT calibration.** Need n ≥ 100 attempts/item; ship uncalibrated, tighten with volume.
- **AutoIRT with LLM-simulated students.** Good idea, but not critical-path. Revisit after 3 months of real candidate data.
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
4. **AI-direction scoring rubric.** This dimension is genuinely novel. The BARS anchors above are inferred from Osmani / Jellyfish / Graphite operational metrics but have not been empirically validated. Needs a critical-incident study with expert reviewers to derive proper anchors.
5. **Content-freshness decay curve.** How quickly does a given cohort of generated items leak as LLMs update? Quarterly advance is a guess; the actual decay rate is unknown and affects the pipeline cost model.

## Needs internal product decision (not research)

- **Scoring output shape to customers.** Score only? Score + narrative report? Transcript + annotations? (Buyer-voice research suggests hiring managers want the transcript more than the score, but this is product packaging not validity.)
- **Candidate-facing framing of the AI implementer.** Explicitly labeled as AI? Framed as "the author"? This affects face validity and candidate experience but not construct validity.
- **Pricing tier tied to PR count.** 3 PRs = screen tier, 5 PRs = assessment tier, 8 PRs = summative tier? This is a packaging call, not a research call.
- **Who gets the gold-standard rater role.** Founder? Hired senior consultants? Advisory board? Affects corpus trust but is a product/ops decision.

---

## What's next

1. **Verifier pass** — add inline citations from the 6 research files, verify all URLs.
2. **Reviewer pass** — evidence-integrity check on cited claims.
3. **Final delivery** — `knowledge/outputs/code-review-content-sourcing.md` + provenance record.

The research phase is complete. The path from here is execution.
