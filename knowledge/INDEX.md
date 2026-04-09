# Knowledge Base Index

Last updated: 2026-04-08 (added culture agent full code audit, §2.3)

Navigation index for `knowledge/`. Covers the canonical plan, deep-research outputs, operational question banks, and raw sources. See `knowledge/README.md` for the LLM-wiki philosophy this is built on.

> **Read order for new sessions (don't skip):**
> 1. **`knowledge/STRATEGY.md`** — canonical plan. Every research finding mapped to a concrete action.
> 2. **`PIPE-OS/CLAUDE.md`** — project instructions, guardrail rule, model routing.
> 3. **`docs/decisions/ADR-032`** (code review research integration) and **`ADR-033`** (research integration strategy + guardrails).
> 4. The two final research briefs — only after (1)–(3). The briefs are source material; STRATEGY.md is where decisions live.

---

## 1. Canonical plan (`knowledge/STRATEGY.md`)

**This is the source of truth.** Enumerates 78 research findings (33 code review `CR-*`, 45 behavioral/culture `BC-*`) and 12 open questions (`OQ-*`), each mapped to a phase and a concrete action. Contains:

- Mission statement and guardrail rule
- Finding → action tables for both research runs
- Phased roadmap (P1 format/rubric alignment → P4 validity & compliance)
- Deferred items and explicit non-goals
- Locked-in load-bearing decisions ("do not trade away")
- Current drift vs. plan
- **Decision Log** at the bottom — where every plan override lives

Guardrail rule (from `CLAUDE.md`, enforced by ADR-033): if a user request contradicts a finding in STRATEGY.md, do not silently comply. Surface the contradiction, name the risk, ask for explicit override, record it in the Decision Log.

---

## 2. Deep research outputs (`knowledge/outputs/`)

Two completed research runs on disk. Each follows the same pipeline: **plan → parallel researchers → draft → verifier (citations) → reviewer (evidence integrity) → final + provenance.** Both are the input material for STRATEGY.md — read the plan first, dip into the briefs when you need the evidence behind a specific finding.

### 2.1 Behavioral & Culture-Fit Interview Agent — 2026-04-07

Research brief for building PIPE's culture interview agent. Covers IO psychology, AI/NLP scoring, commercial culture platforms, agent architecture, and legal/ethics.

- **Final:** [`outputs/behavioral-culture-interview-agent.md`](outputs/behavioral-culture-interview-agent.md) · ~57 KB
- **Plan:** [`outputs/.plans/behavioral-culture-interview-agent.md`](outputs/.plans/behavioral-culture-interview-agent.md)
- **Provenance:** [`outputs/behavioral-culture-interview-agent.provenance.md`](outputs/behavioral-culture-interview-agent.provenance.md)
- **Verification report:** [`outputs/behavioral-culture-interview-agent-verification.md`](outputs/behavioral-culture-interview-agent-verification.md)
- **Draft (archive):** [`outputs/.drafts/behavioral-culture-interview-agent-draft.md`](outputs/.drafts/behavioral-culture-interview-agent-draft.md)
- **Cited brief (archive):** [`outputs/behavioral-culture-interview-agent-brief.md`](outputs/behavioral-culture-interview-agent-brief.md)
- **Research files (4 parallel researchers):**
  - [`outputs/behavioral-culture-interview-agent-research-io-psych.md`](outputs/behavioral-culture-interview-agent-research-io-psych.md) — R1: Structured interview validity, STAR/BARS, P-O fit construct
  - [`outputs/behavioral-culture-interview-agent-research-ai-nlp.md`](outputs/behavioral-culture-interview-agent-research-ai-nlp.md) — R2: LLM scoring, QWK benchmarks, follow-up generation
  - [`outputs/behavioral-culture-interview-agent-research-culture-platforms.md`](outputs/behavioral-culture-interview-agent-research-culture-platforms.md) — R3: HireVue, Paradox, culture science, company practices
  - [`outputs/behavioral-culture-interview-agent-research-agent-legal.md`](outputs/behavioral-culture-interview-agent-research-agent-legal.md) — R4: Agent architecture, Illinois AIVIA, EEOC compliance

**Status:** Delivered (PASS WITH NOTES; 2 FATAL + 5 MAJOR fixed before delivery). 48 cited sources. Maps to `BC-1`–`BC-45` in STRATEGY.md. Codified by ADR-029/030/031.

**Key load-bearing findings (full list in STRATEGY.md):**
- Structured behavioral interviews predict job performance at r ≈ .42 (Sackett 2022 corrected) — validates the format.
- P-O fit correlates with job performance only at ρ ≈ .15 — culture scores are attitudinal, never performance predictions (`BC-21`).
- No public STAR-specific LLM scoring benchmark exists; MMI QWK 0.62 is the closest proxy (`BC-44`).
- Illinois AIVIA (HB 3773, 2025) + EU AI Act (2026-08-02 hard deadline) require disclosure + conformity (`BC-30`).

### 2.2 Code-Review Content Sourcing — 2026-04-08

Research brief for building PIPE's turn-based human-AI code review assessment. Covers content sourcing, synthetic generation, scaffolding, work-sample validity, simulation-based assessment prior art, and competitive market scan.

- **Final:** [`outputs/code-review-content-sourcing.md`](outputs/code-review-content-sourcing.md) · ~51 KB
- **Plan:** [`outputs/.plans/code-review-content-sourcing.md`](outputs/.plans/code-review-content-sourcing.md)
- **Provenance:** [`outputs/code-review-content-sourcing.provenance.md`](outputs/code-review-content-sourcing.provenance.md)
- **Verification report:** [`outputs/code-review-content-sourcing-verification.md`](outputs/code-review-content-sourcing-verification.md)
- **Draft (archive):** [`outputs/.drafts/code-review-content-sourcing-draft.md`](outputs/.drafts/code-review-content-sourcing-draft.md)
- **Cited brief (archive):** [`outputs/code-review-content-sourcing-brief.md`](outputs/code-review-content-sourcing-brief.md)
- **Research files (6 across 2 rounds):**
  - **Round 1 — production / content sourcing:**
    - [`outputs/code-review-content-sourcing-research-mining.md`](outputs/code-review-content-sourcing-research-mining.md) — R1: PR-mining datasets, leakage, licensing
    - [`outputs/code-review-content-sourcing-research-synthetic.md`](outputs/code-review-content-sourcing-research-synthetic.md) — R2: Bug injection, mutation testing, BugPilot, AIG psychometrics
    - [`outputs/code-review-content-sourcing-research-scaffolding.md`](outputs/code-review-content-sourcing-research-scaffolding.md) — R3: Context budget, IRT calibration, persona-to-content mapping
  - **Round 2 — interview value / validity:**
    - [`outputs/code-review-content-sourcing-research-worksample.md`](outputs/code-review-content-sourcing-research-worksample.md) — R4: Schmidt/Hunter/Sackett, EEOC, Griggs, Ricci, Roth
    - [`outputs/code-review-content-sourcing-research-simulation.md`](outputs/code-review-content-sourcing-research-simulation.md) — R5: OSCE, MMI, SP drift, NOTECHS, van der Vleuten
    - [`outputs/code-review-content-sourcing-research-market.md`](outputs/code-review-content-sourcing-research-market.md) — R6: HackerRank/CodeSignal/Woven scan, Bacchelli, Sadowski, MacLeod, Jellyfish

**Status:** Delivered (PASS WITH NOTES; 0 FATAL, 2 MAJOR fixed, 3 MINOR accepted). 50 cited sources. Maps to `CR-1`–`CR-33` in STRATEGY.md. Codified by ADR-032 (updates ADR-024 and ADR-026).

**Key load-bearing findings (full list in STRATEGY.md):**
- Multi-PR structure (3 min, 5 target) is non-negotiable — OSCE/MMI context-specificity (`CR-1`).
- LLM agent drift (14–34% off-persona baseline) is the #1 engineering risk → Gemma 4 12B consistency classifier (`CR-5`).
- Six scoring dimensions, two of them exclusive moat: **revision evaluation** and **AI direction** (`CR-4`).
- Rolling-freshness content gate — post-2024-07-01, quarterly advance, execution-based ground truth (`CR-16`, `CR-28`).
- Unit economics: ~$0.05/assessment MVP tier, ~$0.16 summative tier. Margin ≥99% at any realistic price point.

---

## 2.3 Code audits

### Culture Agent Code Audit — 2026-04-08

Full-read audit of every culture-specific TypeScript module (~3,938 lines), the calibration harness, the HTTP route surface, and the D1 migrations. Triggered after the Exponent layer removal, specifically to answer "what actually exists, what's ADR-promised but missing, what's dead code, what could fail silently."

- **Audit:** [`docs/audits/culture-agent-audit-2026-04-08.md`](../docs/audits/culture-agent-audit-2026-04-08.md)

**Key findings:**

1. **Correction to prior-session claim.** The "live landmine" framing for the Exponent removal was wrong — the scorer is dimension-level, not question-level, and would have graded Exponent turns fine. The cleanup is still defensible on narrower grounds (low-signal Haiku tagging, over-engineered selector) but the CHANGELOG entry overstates the risk.

2. **Calibration has never been run.** The QWK harness, 10 hand-authored fixtures with expert ground-truth scores, and the `POST /api/v1/screening/culture/calibration/run` endpoint all exist. The run has never been executed. Everything downstream of the scorer is built on an unverified "Gemma hits 0.55" assumption.

3. **ADR-031 compliance gaps.** Deletion path, non-AI alternative, HITL friction (viewed_at + scroll gate), Flag review decision — all promised by ADR-031, none implemented. Compliance-critical for Illinois HB 3773 (already in effect) and EU AI Act (2026-08-02).

4. **Wiki-to-code wiring drift.** The per-question BARS rubrics in `knowledge/culture/questions/{dim}/q-*.md` are decorative — the runtime scorer uses dimension-level rubrics hardcoded in `cultureScorer.ts`. The TODO comments promising a wiki-sync script are stale.

5. **Dead code after Exponent cleanup.** The theme-resonance bonus and the role-overlay preferredTags/deprioritizedTags both degrade to zero signal because no curated question sets `probe_patterns` and none uses the overlay tag vocabulary.

6. **Fire-and-forget scoring.** `ctx.waitUntil(runScoringJob)` with no retry and no dead-letter. A transient Gemma failure leaves sessions stuck in `state='scoring'`.

Full file list, end-to-end flow, ADR-by-ADR delta, subtle failure modes, and a 17-item recommendation list (ordered by urgency) are in the audit file. Read it before acting on any of the issues above.

---

## 2.4 Planned / not yet executed research

### Culture Agent Scoring Architecture (PIPE-fit) — **TODO**

**Status:** Plan written 2026-04-08, not yet executed. Supersedes the scope gaps in the deleted `culture-bars-anchoring` R3/R4 loop.

- **Plan:** [`outputs/.plans/culture-agent-scoring-architecture.md`](outputs/.plans/culture-agent-scoring-architecture.md)
- **Execution mode:** 4 sequential researchers on Sonnet 4.6 (context-conservation directive)
- **Supporting inputs retained from prior loop:** `culture-bars-anchoring-research-methodology.md` (R1 — anchor-writing rules, verbosity audit, Maurer 2002), `culture-bars-anchoring-research-competencies.md` (R2 — competency anchor raw material)

**What this loop must answer:**
1. Can Gemma 4 26B on Workers AI actually hit QWK ≥ 0.55/0.60 on behavioral BARS? (The previous loop drifted into citing Llama 4 Maverick ≈400B as a proxy — this loop's hard rule is that no >30B benchmark is a PIPE target without an explicit non-transfer label.)
2. Scoring architecture at ≤30B scale: decomposed 5×5 vs single-pass vs panel vs CoT-then-score.
3. Empirical calibration when no ceiling is known: gold fixtures, human-agreement bound, drift gate.
4. Sub-30B failure modes with mitigations validated at that scale (not just at GPT-4).
5. Per-turn belief state (BC-6/7/15) vs end-of-session stateless scoring (ADR-029 §6) — **contradiction to resolve.**
6. QWK target reconciliation: **ADR-029 says 0.55; STRATEGY BC-19 says 0.60.** One must bind.
7. EU AI Act / ADR-031 compatibility matrix against each scoring pattern.

**Blocks:** BARS rubric drafting (BC-2, BC-38), calibration protocol (BC-5, BC-19, BC-41), scoring pipeline build-out (BC-40), ADR-029 §6 ratification/rewrite.

**When to run:** after founder rest + context-budget reset. Run R1 first (small-model empirics), review before R2.

---

## 3. Superseded / archived research (`knowledge/outputs/_superseded/`)

These plans and drafts were absorbed into the two delivered briefs. They are kept for provenance but should not drive decisions. Each file has a SUPERSEDED header pointing to its replacement.

| File | Superseded by |
|---|---|
| [`_superseded/cultural-fit-interview-strategies-plan.md`](outputs/_superseded/cultural-fit-interview-strategies-plan.md) | `behavioral-culture-interview-agent.md` |
| [`_superseded/culture-interview-agent-plan.md`](outputs/_superseded/culture-interview-agent-plan.md) | `behavioral-culture-interview-agent.md` |
| [`_superseded/culture-interview-agent-early-draft.md`](outputs/_superseded/culture-interview-agent-early-draft.md) | `behavioral-culture-interview-agent.md` |
| [`_superseded/code-review-content-design-plan.md`](outputs/_superseded/code-review-content-design-plan.md) | `code-review-content-sourcing.md` (narrowed, then expanded Round 2) |

Do not restart these plans. Their intent lives in the delivered briefs and in STRATEGY.md.

---

## 4. Operational content (runtime-consumed by PIPE workers)

Not research artifacts — these are **question banks and content libraries consumed by PIPE code at runtime** via sync scripts in `workers/api/scripts/`.

### 4.1 Culture interview content (`knowledge/culture/`)

- **`culture/README.md`** — scope + conventions for the culture question bank
- **`culture/dimensions/`** — 5 culture dimensions (ownership, collaboration, learning-orientation, conflict-handling, self-awareness)
- **`culture/culture-profile/`** — 5 culture-profile axes (autonomy, risk-tolerance, work-pace, collaboration-style, feedback-orientation)
- **`culture/questions/`** — 15 hand-authored BARS questions (3 × 5 dimensions), each with full rubric + L/M/H calibration + probe library
- **`culture/probes/star-slot-probes.md`** — STAR-slot fallback probe library
- **`culture/probe-patterns.md`** + **`workers/api/src/lib/cultureProbePatterns.ts`** — closed vocabulary for the live agent's `runningThemes` tracker
- **`culture/role-overlays/`** — role-specific question overlays (senior-ic, manager)
- **`culture/.raw/`** + **`culture/.research/`** — raw source material + internal research notes

The 15 curated questions are hand-mirrored into `workers/api/src/lib/cultureQuestionBank.ts` as the `CURATED_BANK` const (Workers can't read the filesystem at runtime). Wiki markdown and TS const must be kept in sync by hand. An earlier `sync-culture-wiki.ts` generator was removed on 2026-04-08 along with the Exponent layer — see that day's CHANGELOG entry for context.

### 4.2 Behavioral question bank (`knowledge/behavioural/`)

- **`behavioural/question-repo/README.md`** — scope
- **`behavioural/question-repo/{Entry,Mid,Senior,Staff,Lead,Architect,Manager,Executive}/*-ai-mock.md`** — AI-generated mock interview transcripts per seniority tier, for rubric calibration and persona training data

### 4.3 Technical content (`knowledge/technical/`)

Raw technical reference material. Early-stage; not yet integrated into a research or question bank.

### 4.4 Top-level files

- **`knowledge/README.md`** — the LLM-wiki philosophy (Vannevar Bush / Memex)
- **`knowledge/Behavioral interviews for Software Engineers How to prepare.md`** — single-article raw source. Unfiled.

---

## 5. How to read a research run

Each completed run produces ~9 files. Not all nine have equal value.

### The 3 files that matter

1. **The final brief** (`<slug>.md`) — Lead-authored synthesis with inline citations. **Read first.** Decisions live here.
2. **The provenance record** (`<slug>.provenance.md`) — what was verified, what's load-bearing vs. inference, what gaps remain. Read this before trusting any specific claim.
3. **The verification report** (`<slug>-verification.md`) — reviewer's evidence-integrity pass. Tells you what NOT to bet on.

### The supporting files (read when digging)

4. **The plan** (`.plans/<slug>.md`) — research decomposition. Useful for scope decisions and deliberate exclusions.
5. **The research files** (`<slug>-research-<dimension>.md`) — raw sub-agent outputs. Each has an Evidence Table and numbered Sources list. Read these when the brief cites `[R4-S3]` and you need the quoted passage + URL.

### The intermediate files (archive; ignore)

6. **The draft** (`.drafts/<slug>-draft.md`) — pre-citation Lead draft. Superseded by the final.
7. **The cited brief** (`<slug>-brief.md`) — verifier pass output. Superseded by the final.

### Signals that a claim is strong

- Cited with multiple independent source IDs (e.g., `[R4-S3][R4-S4][R4-S6]`)
- Appears in an Evidence Table row marked "Peer-reviewed meta-analysis" or "Peer-reviewed primary study"
- Confirmed across research files (R4 *and* R5 arriving at the same conclusion independently)

### Signals that a claim is thin

- Single source ID
- "Preprint", "Industry report", or "Vendor blog" as strength rating
- Lead synthesis inferences without source citations
- Anything the verification report flagged as MAJOR or FATAL

### What NOT to treat as research findings

These sections of any brief are **Lead-authored product/engineering decisions**, grounded in research but not derived from it. The reviewer pass explicitly marks them out of scope for evidence integrity:

- Model routing recommendations
- Unit economics / pricing tables
- Ship sequences / roadmaps
- Agent architecture diagrams
- Persona YAML / BARS rubric examples
- "What to not compromise on" lists

These are starting points for discussion, not settled conclusions. Many of them are ratified in STRATEGY.md and the ADRs — if there's a conflict, the ADR wins.

---

## 6. Where decisions actually live (quick lookup)

**For behavioral / culture interview agent:**
- Canonical action plan → `knowledge/STRATEGY.md` Part BC
- Architecture → ADR-029
- Culture profile operationalization → ADR-030
- AI hiring compliance → ADR-031
- Evidence root → `outputs/behavioral-culture-interview-agent.md`

**For code-review content sourcing:**
- Canonical action plan → `knowledge/STRATEGY.md` Part CR
- Research integration + migration plan → ADR-032
- Research integration strategy + guardrails (meta) → ADR-033
- Multi-turn flow (directional, updated by ADR-032) → ADR-024
- Implementer improvements (directional, updated by ADR-032) → ADR-026
- Evidence root → `outputs/code-review-content-sourcing.md`

---

## 7. Arena integration — the knowledge graph (future work)

**The big picture:** research is not meant to be read once and filed. It's meant to feed the **code review calibration loop**. Today, two systems exist:

- **`/calibrate` skill** (`PIPE-OS/.claude/commands/calibrate.md`) — "The app IS the harness." Chrome + real Worker + Devstral scoring. Go-forward system. Claude Code plays candidate personas; scoring is Devstral in the Worker, never Claude.
- **Arena** (`research/code-review-arena/`) — standalone synthetic harness, last touched 2026-03-30 at 76.5% calibration (v19, mistral-medium-latest). Legacy training ground, useful for fast scorer-only iteration without Chrome.

Both loops need the research to be **machine-readable**, not just prose. STRATEGY.md is the first step (each finding has a row ID: `CR-1`, `BC-45`, `OQ-7`). The next step is lifting those rows into node files like:

```yaml
---
id: CR-1
claim: "Minimum 3 PRs per code review session — context-specificity sampling"
type: format
strength: strong
evidence:
  - ref: R5-S2  # OSCE G ≥ 0.80 requires 8–12 stations
  - ref: R5-S3  # MMI 12 stations achieves r = 0.73
  - ref: R5-C2  # Context specificity ~25% of variance
applies_to:
  - workers/api/src/routes/reviewSessions.ts
  - workers/api/src/lib/sessionAggregator.ts  # new
predicts:
  metric: calibration_accuracy
  direction: increase
related: [CR-4, CR-9]
open_question: OQ-3  # optimal PR count vs. training budget
---
```

Each node lives as one markdown file in a new directory like `knowledge/graph/` (Obsidian already configured — `.obsidian/` in place). The calibration loop's hypothesis agent reads the graph when deciding what to mutate.

**Node types to extract:**

| Type | Description | Example findings |
|---|---|---|
| `format` | Structural decisions about the assessment | Multi-PR count, turn-based, encounter-level scoring |
| `rubric` | Scoring-dimension decisions | 6 dimensions, BARS anchors, checklist vs. global |
| `agent` | Implementer/scorer behavior | Reactivity YAML, drift guardrails, pushback probability |
| `model` | Model selection | Qwen implementer, Gemma classifier, Devstral scorer, Sonnet oracle |
| `content` | Content sourcing & generation | Rolling-freshness gate, AIG templates, execution ground truth |
| `validity` | Psychometric / fairness / legal | Content validity route, Roth 2008 adverse impact, EU AI Act |
| `metric` | What to measure | Cohen κ ≥ 0.76, G-coefficient ≥ 0.75 |
| `risk` | Known failure modes | Agent drift 14–34%, halo effects, LLM-judge bias |

**Not in the graph:**
- Lead product/engineering synthesis (model routing, ship sequence) → these are decisions, they live in ADRs.
- Unit economics tables → calculations, live in the brief as reference.
- Narrative exposition → the graph stores the *claim*, not the paragraph.

Graph construction is deferred — STRATEGY.md row IDs are the interim structure. Build the graph when the calibration loop is ready to consume it.

---

## 8. How the pieces fit together

```
┌─ CANONICAL PLAN ─────────────────────────────────────────┐
│  knowledge/STRATEGY.md     ← source of truth             │
│  docs/decisions/ADR-032    ← code review integration     │
│  docs/decisions/ADR-033    ← guardrails (meta)           │
│  PIPE-OS/CLAUDE.md         ← project instructions        │
└──────────────────────────────────────────────────────────┘
                         ↑
                         │ ratifies / overrides
                         │
┌─ DEEP RESEARCH OUTPUTS (design-time, drives decisions) ──┐
│  outputs/behavioral-culture-interview-agent.md           │
│     → BC-1..BC-45 in STRATEGY.md                         │
│     → ADR-029/030/031                                    │
│                                                           │
│  outputs/code-review-content-sourcing.md                 │
│     → CR-1..CR-33 in STRATEGY.md                         │
│     → ADR-032 (updates ADR-024, ADR-026)                 │
└──────────────────────────────────────────────────────────┘
                         ↑
                         │ informs
                         │
┌─ OPERATIONAL CONTENT (runtime-consumed by Workers) ──────┐
│  knowledge/culture/       → mirrored by hand into        │
│                             cultureQuestionBank.ts       │
│  knowledge/behavioural/   → (future sync script)         │
│  knowledge/technical/     → (not yet synced)             │
└──────────────────────────────────────────────────────────┘
```

Research outputs are **design-time** — they inform what you build. Operational content is **runtime** — it's bundled into the Worker and consumed during live interviews. STRATEGY.md sits above both, translating findings into actions the codebase can execute.
