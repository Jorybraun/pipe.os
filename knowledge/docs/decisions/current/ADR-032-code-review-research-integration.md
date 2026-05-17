# ADR-032: Code Review Assessment — Research-Grounded Design Update

**Date:** 2026-04-08
**Status:** Accepted
**Deciders:** Hans (founder)
**Updates:** [ADR-024](ADR-024-multi-turn-agentic-code-review.md), [ADR-026](ADR-026-implementer-agent-improvements.md)
**Source of truth:** [`knowledge/outputs/code-review-content-sourcing.md`](../../knowledge/outputs/code-review-content-sourcing.md) (2026-04-08, 50 cited sources, 2 rounds, PASS WITH NOTES) and [`knowledge/STRATEGY.md`](../../knowledge/STRATEGY.md)

---

## Context

On 2026-04-08 a two-round deep research workflow was completed on **sustainable code-review content design**, synthesizing 50 peer-reviewed and industry sources into a final brief at `knowledge/outputs/code-review-content-sourcing.md`. The brief covers: PR-mining datasets and leakage resistance, synthetic bug injection (AIG), scaffolding and psychometric calibration, work-sample and structured-interview validity, simulation-based assessment prior art (OSCE/MMI/aviation), and a competitive market scan of hiring platforms.

The research postdates both [ADR-024](ADR-024-multi-turn-agentic-code-review.md) (2026-03-29, multi-turn agentic code review) and [ADR-026](ADR-026-implementer-agent-improvements.md) (2026-03-31, implementer improvements). Those ADRs established the current production architecture — multi-turn conversation + panel scoring + Mistral Devstral + `/calibrate` skill + research arena as training environment — and that architecture is **directionally correct**. The v19 arena calibration at 76.5% on 2026-03-30 is real empirical evidence that multi-turn + panel scoring works.

But the research brief identifies specific design gaps between the current implementation and the evidence-based target. This ADR documents those gaps and the plan to close them. It does **not** replace ADR-024 or ADR-026 — it extends them with research-grounded decisions they did not have access to.

### What the research validates about the current design

These ADR-024 / ADR-026 decisions are **confirmed** by the 2026-04-08 research:

- **Multi-turn conversation is the right format.** Work-sample validity literature (Schmidt & Hunter → Sackett 2022) places the structured-interview + work-sample hybrid at the validity ceiling (r ≈ .42–.57). A turn-based review with standardized prompts + anchored scoring dimensions sits in this zone.
- **Panel scoring outperforms single-prompt scoring.** Research brief Part 3.4 + multi-agent criterion decomposition literature (Huynh et al. 2025, QWK 0.621) confirms that specialized evaluator agents exceed single holistic LLM calls.
- **Implementer agent with persona is the right abstraction.** The simulation-based assessment literature (OSCE standardized patients, Hodges, van der Vleuten) treats the counterparty as a calibrated instrument. The junior/senior persona pattern in ADR-024 maps directly to the standardized-patient pattern.
- **Scoring at encounter level, not turn level.** OSCE/MMI/aviation LOE all score at the encounter level. Arena already does this via the scoring panel running once at verdict.
- **Separate scorer and implementer invocations with no shared context.** Research Part 3.4(b) confirms this is required to prevent scorer contamination. Current Worker architecture already enforces it.
- **Real code changes from implementer (ADR-026 Phase 2).** Supported by the research's revision-evaluation dimension — the reviewer must be able to verify whether a fix is complete.
- **Implementer metrics (cave rate, pushback quality — ADR-026 Phase 3).** Supported by research's reactivity-calibration framing (CR-27). The metrics feed into persona YAML calibration.
- **/calibrate skill using the live Worker pipeline.** "The app IS the harness" aligns with the research's emphasis on regression-testing changes against a real pipeline, not a synthetic harness.

### What the research identifies as gaps

These are the concrete gaps between the current design and the research-derived target. Each has a priority and phase.

| # | Gap | Current state | Research target | Priority |
|---|---|---|---|---|
| D1 | Scoring decomposition | 4 dimensions (Technical 40% / Conversation 25% / Practice 35% / Effectiveness 15% — deterministic) | **6 dimensions** (Issue depth / Reasoning / Prioritization / Question formation / Revision evaluation / AI direction) | HIGH |
| D2 | PRs per session | 1 PR per session | **3 PRs minimum**, 5 target, 8 summative (context-specificity sampling per OSCE/MMI literature) | HIGH |
| D3 | BARS anchoring | Partial — arena prompts have some anchors but not Hodges-compliant | **Concrete behavioral anchors at every level of every dimension** (the Hodges 1999 finding is load-bearing: checklists penalize experts, global rating scales with BARS do not) | HIGH |
| D4 | Consistency classifier | Does not exist | **Gemma 4 12B classifier on every implementer turn**, 4-axis JSON (bug-disclosure / tone / knowledge boundary / pushback deviation) with regenerate-or-flag logic | **HIGH — #1 engineering risk per research** |
| D5 | Persona reactivity as parameters | Hardcoded in `workers/api/src/lib/prompts.ts` | **Versioned YAML** with `pushback_probability`, `fix_acceptance_threshold`, `information_volunteering_rate`, `error_introduction_rate` | MEDIUM |
| D6 | AI direction as a construct | Not modeled | **Sixth scoring dimension** — measures candidate's skill directing and evaluating the implementer agent (the emerging construct, unmeasured by competitors) | HIGH |
| D7 | Revision evaluation as a construct | Partially modeled — conversation scoring looks at back-and-forth but does not explicitly score "did the reviewer verify the implementer's fix is complete" | **Dimension 5** — scorer assesses whether reviewer caught incomplete fixes / new bugs introduced by the fix | HIGH |
| D8 | Content pipeline | Hand-crafted golden cases in `research/code-review-arena/golden/cases.ts` | **Rolling-freshness AIG pipeline**: GitHub scrape post-2024-07-01 + bug templates × variants + execution-based ground truth + quarterly gate advance | HIGH (deferred to P3) |
| D9 | Validation file | Does not exist | **`docs/validation/` directory** with job analysis + CVR-rated scenario mapping + rubric + inter-rater reliability + subgroup analysis | HIGH (deferred to P4) |
| D10 | Criterion validity bootstrap | No plan | **90-day concurrent validity study** protocol ready for first paying customer (structured post-hire performance rating instrument) | HIGH (deferred to P4) |
| D11 | Model routing for implementer | Single tier (Qwen 2.5-Coder 32B) | **Tiered**: Qwen for junior/mid, Qwen3-Coder (when available) or Claude Sonnet 4.6 premium fallback for senior persona | MEDIUM |
| D12 | Gold-standard oracle scorer | Does not exist | **Claude Sonnet 4.6 offline oracle** for Cohen κ measurement against production Devstral scoring; escalate on κ < 0.70 | MEDIUM (P2) |

---

## Decision

Close the 12 gaps above in 4 phases, using `/calibrate` as the measurement harness. Every change is regression-tested against the v19 baseline (76.5% calibration accuracy) — no commit keeps if calibration drops below 70% without justification.

### Phase 1 — Format & rubric alignment (weeks 1–4)

**Goal:** Bring the live Worker scoring panel from 4 dimensions to 6, with Hodges-compliant BARS anchors. Introduce multi-PR challenge type. Productize persona reactivity as YAML.

**Deliverables:**

1. **New file: `workers/api/src/lib/scorerRubric.yaml`** — 6-dimension BARS rubric. Each dimension has 5 levels with concrete behavioral anchors (example in research brief Part 2.3). Loaded at Worker boot, versioned in git, diff-able in code review.
   - Dimension 1: Issue identification depth (functional defects > design > tests > readability > style)
   - Dimension 2: Reasoning/explanation quality (mechanism specified, constraint referenced, tradeoffs)
   - Dimension 3: Prioritization accuracy (blockers vs. nitpicks)
   - Dimension 4: Question formation (Sillito 44-category comprehension questions)
   - Dimension 5: **Revision evaluation** — does the candidate correctly assess whether the implementer's fix is complete, incomplete, or introduces new issues
   - Dimension 6: **AI direction** — does the candidate direct, evaluate, push back on implementer output effectively

2. **Modify: `workers/api/src/lib/scorerPrompts.ts`** — replace current 4-dimension prompts (Communication / Technical / Practice) with 6 dimension prompts. Each prompt loads its section of the rubric YAML and enforces JSON output with score + evidence quotes + confidence.

3. **Modify: `workers/api/src/lib/scorerAgent.ts`** — update the panel orchestrator to call 6 specialists in parallel instead of 3. Keep the deterministic Effectiveness scoring as a floor anchor but rename to "Coverage" and reduce its aggregation weight (effective weights TBD via `/calibrate` tuning).

4. **New file: `workers/api/src/lib/personas/junior.yaml`, `mid.yaml`, `senior.yaml`** — versioned reactivity parameter files:
   ```yaml
   name: junior
   pushback_probability: 0.40    # research memory: junior pushes back naively 40% of time
   fix_acceptance_threshold: 0.3  # low — easy to convince
   information_volunteering_rate: 0.2
   error_introduction_rate: 0.05  # sometimes the "fix" introduces a new subtle bug (for revision-evaluation scoring)
   ```

5. **Modify: `workers/api/src/lib/prompts.ts`** — implementer prompts read persona YAML at runtime instead of hardcoded constants. The prompt builder interpolates `pushback_probability` etc. into the system prompt.

6. **New: multi-PR challenge type.** A CODE_REVIEW challenge's `server_config` can now specify `pr_bundle: string[]` — a list of 3 PR IDs. The Worker serves them sequentially, scores each independently (no cross-PR context in scoring prompt), and aggregates to a session-level score. Default for MVP: 3 PRs.

7. **New migration: D1** — extend `challenge_submissions` or `review_sessions` to store per-PR scores in addition to session-aggregate score.

**Exit criteria:**
- `/calibrate --auto` runs the new 6-dimension rubric against the existing 6 golden cases and reports a new calibration baseline.
- The new baseline is compared to v19 (76.5%). Target: hold or improve. Minimum acceptable: 70% (otherwise rollback and iterate prompts).
- Multi-PR challenge type lands in one e2e test showing 3-PR session aggregation.

### Phase 2 — Agent quality chain (weeks 5–8)

**Goal:** Build the consistency classifier (#1 risk per research), establish the Sonnet oracle for calibration verification, and seed the gold-standard conversation corpus.

**Deliverables:**

1. **New file: `workers/api/src/lib/consistencyClassifier.ts`** — Gemma 4 12B on Workers AI. Runs on every implementer response before delivery to the candidate. Input: persona YAML + implementer response + recent turn history. Output: 4-axis JSON:
   ```typescript
   {
     bug_disclosure_violation: boolean,   // did the implementer leak a planted bug?
     tone_drift: number,                   // 0-1, how far from persona tone
     knowledge_boundary_violation: boolean, // did the implementer "know" something outside its scope?
     pushback_deviation: number            // 0-1, how far from target pushback rate
   }
   ```
   Regenerate on violation (max 2 retries). Flag for scoring discount if still violating after retries.

2. **New file: `workers/api/scripts/sonnet-oracle.ts`** — offline script (uses Claude Code Agent tool with Sonnet 4.6) that scores a set of transcripts from the gold corpus. Outputs Cohen κ vs. the Devstral production scorer. Target κ ≥ 0.75 (EasyMED baseline is 0.76). Runs on-demand or in CI on rubric changes.

3. **Gold corpus seeding.** New D1 table `gold_standard_transcripts` or a subdirectory in `data/gold/`. Initial contents: 10 transcripts hand-rated by the founder against the 6-dimension rubric. Grows over time via `/calibrate --score-only` on real sessions.

4. **Reactivity calibration measurement via `/calibrate`.** Add a pass to the /calibrate analysis step that computes cave rate, code change rate, and pushback-with-reasoning rate per persona, compared to the YAML targets. Flag drift.

**Exit criteria:**
- Consistency classifier is in the production path and runs on every implementer turn.
- Sonnet oracle reports κ ≥ 0.75 on the initial gold corpus.
- `/calibrate --auto` reaches calibration_accuracy ≥ 80% on the 6-dimension rubric (hits the target defined in the /calibrate skill).

### Phase 3 — Content pipeline (weeks 9–12)

**Goal:** Replace hand-crafted golden cases with an AIG pipeline that produces leak-resistant items at near-zero marginal cost.

**Deliverables:**

1. **New: `scripts/scrape-github-prs.mjs`** — rolling-freshness scraper using SEART GHS for repo discovery and GitHub API for PR contents. Filter: permissive licenses only (MIT/Apache/BSD), PR merged after 2024-07-01, non-trivial complexity. Strip PII.

2. **New: `scripts/bug-templates/`** — 10 initial bug templates (off-by-one, TOCTOU race, stale cache, unvalidated input, type confusion, dangling reference, SQL injection, CORS misconfig, N+1 query, missing null check). Each template is a YAML file with injection rules.

3. **New: `scripts/generate-variants.mjs`** — Claude Sonnet 4.6 via Agent tool (offline, batch). Takes a template + a scraped real skeleton + variant parameters. Outputs a planted-bug PR that preserves compilability.

4. **New: `scripts/verify-planted-bugs.mjs`** — CI sandbox that runs the repo's own test suite. Keeps only items where the planted bug actually fails a test. Discards the rest. This is the execution-based ground truth from the research brief.

5. **New: `scripts/tag-items.mjs`** — Claude Haiku 4.5 via Agent tool (offline, bulk). Tags each verified item on 4 dimensions: difficulty × tech-stack × skill × archetype.

6. **New: item bank storage schema in D1.** Tagged items replace or supplement `golden/cases.ts`. Selection query is `WHERE difficulty = ? AND tech_stack = ? AND skill IN (...)`.

7. **Seed the initial bank with 15 items.** 3 difficulty levels × 5 skills × 1 stack (TypeScript/React). This unblocks MVP production use.

**Exit criteria:**
- 15 execution-verified items in the bank, all tagged.
- Quarterly refresh cron documented and running.
- One end-to-end demo: founder scrapes a new repo, runs the pipeline, gets a new verified item in <10 minutes of manual work.

### Phase 4 — Validity framework & compliance (ongoing, hard deadline 2026-08-02)

**Goal:** Ship the legal defensibility package. This is parallel to Phases 1–3.

**Deliverables:**

1. **New: `docs/validation/` directory** — becomes the validation file. Contents:
   - `job-analysis.md` — lightweight SWE job analysis using SWE job postings + SME task criticality ratings
   - `cvr-mapping.md` — Content Validity Ratio (Lawshe) mapping each item to the job task inventory
   - `rubric.md` — the current 6-dimension BARS rubric (or link to `scorerRubric.yaml`)
   - `inter-rater-reliability.md` — Sonnet oracle κ measurements over time
   - `subgroup-analysis.md` — adverse impact monitoring (4/5ths rule + statistical significance) from day one
   - `concurrent-validity-study.md` — protocol for 90-day post-hire rating study (runs with first paying customer)

2. **New: adverse-impact monitoring dashboard** (internal, recruiter-facing). Queries D1 for selection rates by subgroup. Triggers alerts at 4/5ths threshold.

3. **Compliance UI integration.** The consent/HITL/deletion gates from [ADR-031](ADR-031-ai-hiring-compliance-architecture.md) already cover the culture agent. Extend the same gates to code review assessments.

**Exit criteria:**
- Validation file is live in git with at least skeleton contents at launch.
- Adverse-impact monitoring is running on first 100 candidate sessions.
- EU AI Act conformity assessment checklist complete before 2026-08-02.

---

## Alternatives Considered

### A — Extend ADR-024's 4 dimensions rather than replace

**Rejected.** The research decomposition is grounded in practitioner literature (Bacchelli & Bird 2013, Sadowski et al. 2018, Bosu et al. 2015, Zhang et al. 2024, Sillito et al. 2006, MacLeod et al. 2018) — empirical studies of what real code reviewers actually do, with samples ranging from 911 developers to 1.5M comments. The ADR-024 decomposition (Communication / Technical / Practice / Effectiveness) was the arena's first attempt and has been empirically calibrated to 76.5% on the arena's synthetic cases. The research decomposition is the stronger foundation and gives PIPE the two exclusive moat dimensions (revision evaluation, AI direction) that no competitor can replicate without rebuilding their runtime.

The empirical tuning from arena v19 is not lost — the anchored language in the Communication prompt migrates into Reasoning and Question Formation prompts; the Technical prompt's bug-matching logic migrates into Issue Identification Depth and Revision Evaluation. Arena calibration data is carried forward as the regression baseline.

### B — Add consistency classifier only, defer 6-dimension rubric

**Rejected.** The consistency classifier is the #1 engineering risk and must be built (Phase 2). But it is orthogonal to the scoring decomposition — they solve different problems. The 6-dimension rubric is what the product is actually measuring, and leaving it wrong means every future calibration run is tuning against the wrong target. Fix both.

### C — Skip multi-PR, keep single-PR sessions

**Rejected.** Every simulation-based assessment domain (OSCE, MMI, aviation LOE) independently converged on multi-encounter sampling because context-specificity accounts for ~25% of score variance. A single PR is measurably noisy. The research's concrete finding: G ≥ 0.80 requires 8–12 encounters; 3 PRs is the floor for usable signal, 5 is the target. Single-PR sessions ship a product that fails basic reliability theory.

### D — Ship the rolling-freshness content pipeline before the rubric changes

**Rejected.** The rubric defines what "good" looks like; the content pipeline defines what "good" is scored against. If you tune the pipeline before the rubric is final, you'll produce items that fit the wrong rubric. Rubric first (Phase 1), pipeline third (Phase 3), after the scoring target is measured.

### E — Build everything in one phase

**Rejected.** Each phase has measurable exit criteria. Mixing phases means no clear regression baseline. The arena's 76.5% calibration is the anchor; every phase must be measured against it.

---

## Consequences

### Positive

- **Six-dimension scoring is grounded in 30 years of empirical code-review literature**, not just arena iteration. Every dimension traces to a cited finding.
- **Two exclusive moat dimensions** (revision evaluation, AI direction) that no other hiring platform can replicate without rebuilding their runtime. This is the product's competitive wedge.
- **Consistency classifier eliminates the #1 engineering risk** (agent drift 14–34% off-persona at baseline). Without this, scoring comparability collapses.
- **Multi-PR structure moves reliability from single-encounter (noisy) to multi-encounter (defensible)**. Matches OSCE/MMI/aviation decades of evidence.
- **Rolling-freshness content pipeline** means the founder can maintain a growing bank without growing headcount. Leakage defense is operational discipline, not technology.
- **Validation file from day one** makes legal defensibility non-retrofittable. The content validity route (EEOC/Griggs/Ricci) is achievable for a solo founder with lightweight job analysis + CVR mapping.

### Negative / Trade-offs

- **Significant implementation work.** Phase 1 alone touches 6+ Worker files and requires re-calibration. Not a weekend.
- **Loses ADR-024's empirical 76.5% baseline temporarily.** New rubric must be re-calibrated. Expect 1–2 weeks of `/calibrate` iterations before hitting ≥80% on the new decomposition.
- **Consistency classifier adds per-turn latency.** Every implementer response goes through an additional LLM call before delivery. Budgeted in the unit economics (Gemma 4 12B at ~$0.006/assessment).
- **Multi-PR sessions triple the per-assessment duration.** Offset by the reliability gain; also an opportunity to price as a higher tier.
- **Content pipeline is operational discipline-heavy.** Quarterly scrape + variant generation + execution verification requires founder attention. Automated where possible.

### Risks

- **6-dimension calibration fails to reach 70% on first attempt.** Mitigation: `/calibrate` iteration cycles; keep the arena v19 anchors as a fallback; escalate to Sonnet as scorer if Devstral can't hit target.
- **Consistency classifier produces too many false positives and blocks legitimate responses.** Mitigation: run in "flag only" mode for first N sessions before enabling regenerate-or-reject; tune thresholds on real data.
- **Multi-PR sessions have higher dropout.** Mitigation: measure empirically; default to 3 PRs not 5 for top-of-funnel.
- **Content pipeline produces items that are too easy or too hard.** Mitigation: execution-based ground truth + IRT calibration (deferred past MVP per STRATEGY.md CR-32); manual review on first 20 items.

---

## What this updates

This ADR **does not supersede** ADR-024 or ADR-026 — the core directional decisions in both remain correct. It updates specific sections:

**ADR-024 updates:**
- Scoring panel: 3 panelists (Communication 25% / Technical 40% / Practice 35%) + Synthesizer → **6 panelists** (Issue depth / Reasoning / Prioritization / Question formation / Revision evaluation / AI direction) + Synthesizer. Weights TBD via `/calibrate` tuning.
- Single-PR challenge shape → **multi-PR bundled challenge** (3 PRs default)
- Implementer persona file layout: hardcoded prompts → **versioned YAML with reactivity parameters**
- **New: consistency classifier** in the implementer response path

**ADR-026 updates:**
- Implementer metrics (ADR-026 Phase 3) remain as specified. New: feed metrics back into persona YAML reactivity calibration via `/calibrate`.
- Phase 5 "Calibration Integration" is where the consistency classifier integration test lives.
- ADR-026's `updated_code` work (Phase 2) is the prerequisite for Dimension 5 (Revision Evaluation) — the reviewer must be able to see the updated code to evaluate the fix.

**Nothing in ADR-021's deprecation changes** — it remains superseded.

---

## Verification

**Phase 1 (alignment):**
1. `npx tsc --noEmit` passes
2. New `scorerRubric.yaml` loads at Worker boot without errors
3. Vitest unit tests for rubric loading and dimension-specific prompt builders
4. `/calibrate --auto` on 6 golden cases reports new baseline ≥ 70%
5. One Playwright e2e test for 3-PR session aggregation

**Phase 2 (agent quality chain):**
1. Consistency classifier integration test (fixture implementer responses, expected JSON axes)
2. Sonnet oracle runs against 10 gold transcripts, reports κ ≥ 0.75
3. `/calibrate --auto` reaches ≥80% calibration_accuracy

**Phase 3 (content pipeline):**
1. One end-to-end dry run: scrape → inject → verify → tag → add-to-bank
2. 15 items in the bank, all execution-verified
3. `scripts/verify-planted-bugs.mjs` runs in CI on bank changes

**Phase 4 (validity framework):**
1. `docs/validation/` directory exists with skeleton contents
2. Adverse-impact query returns results on synthetic candidate data
3. EU AI Act conformity checklist complete before 2026-08-02

---

## Follow-ups

1. ADR-033: Research Brief Integration Strategy & Plan Guardrails (meta ADR for research→code pipeline)
2. Update `research/code-review-arena/program.md` — the arena's training loop should reference the 6-dimension rubric target
3. Update `workers/api/src/lib/scorerPrompts.ts` — rewrite for 6 dimensions
4. Update `.claude/commands/calibrate.md` — diagnosis table should include all 6 dimensions and the consistency classifier metrics
5. Update `migration/phase-3c-implementer-agent.md` — add Phase 6 for consistency classifier
6. Update `CLAUDE.md` — add Gemma 4 12B classifier to model routing table
7. Schedule the Sonnet oracle run as a monthly cron for ongoing drift monitoring
