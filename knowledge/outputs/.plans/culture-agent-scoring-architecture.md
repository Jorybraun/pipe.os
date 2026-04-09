# Research Plan: Culture Agent Scoring Architecture (PIPE-fit)

**Slug:** `culture-agent-scoring-architecture`
**Date:** 2026-04-08
**Status:** TODO — not yet executed
**Lead:** TBD (Claude Opus 4.6 1M)
**Researcher model:** Sonnet 4.6
**Execution mode:** **Sequential** — 1 researcher at a time (context-conservation directive, 2026-04-08)
**Supersedes scope gaps in:** `culture-bars-anchoring` loop (R3/R4 deleted 2026-04-08 for drift; R1/R2 retained as supporting inputs)
**Parent plan:** `knowledge/STRATEGY.md` — BC-2, BC-5, BC-6, BC-7, BC-11, BC-13, BC-15, BC-19, BC-20, BC-38, BC-40, BC-41 + ADR-029 §6, ADR-031
**Related review:** Review of ADR-029 + STRATEGY BC-rows + R1/R2 (2026-04-08 in-session) — identifies 6 structural gaps and 2 contradictions that motivate this loop.

---

## Why this plan exists

The existing culture agent architecture (ADR-029) specifies an 11-call multi-agent scoring pipeline on Gemma 4 26B, but leaves six load-bearing questions unanswered and carries two unresolved internal contradictions:

**Unanswered:**
1. Can a sub-30B open model (Gemma 4 26B specifically) actually hit the QWK target on behavioral BARS scoring? The previous loop's R4 drifted into citing Llama 4 Maverick (≈400B MoE) as a proxy — this is the drift the founder caught.
2. What composition pattern works at small-model scale — 5-call decomposition vs. single-pass vs. panel-of-small-judges vs. CoT-then-score?
3. What BARS granularity does a 26B judge actually discriminate? 5-point? 3-point L/M/H? Binary-per-anchor?
4. When the ceiling is unknown, what's the empirical calibration protocol? Gold fixture construction, minimum size, human-agreement ceiling measurement, drift gate.
5. Which small-model failure modes (length bias, position bias, persona bleed, anchor collapse) have mitigations *validated at ≤30B scale* rather than just at GPT-4-class?
6. Which scoring patterns are compatible with EU AI Act / ADR-031 audit + explainability requirements?

**Contradictions to resolve:**
- QWK target: ADR-029 §Verification says **≥ 0.55**; STRATEGY BC-19 says **≥ 0.60**. Both cannot bind.
- Scoring topology: ADR-029 §6 does **stateless end-of-session scoring**; research brief §2.2 + STRATEGY BC-6/BC-7/BC-15 require **per-turn belief-state tracking** with a Previous Belief Aware (PBA) judge. These are architecturally incompatible.

---

## Core question

**How will scoring actually work for PIPE's culture/behavioral interview agent, end-to-end, given its real constraints** — Gemma 4 26B judge on Workers AI, ~11 calls per interview, real-time latency budget, no sign-in candidate flow, EU AI Act compliance requirements (effective 2026-08-02) — **and what empirical QWK/κ can we realistically target, given that published benchmarks on sub-30B open models for rubric/behavioral scoring are scarce?**

This is the scoring-architecture question, not the anchor-writing question. Anchors are one input; the deliverable is a buildable scoring blueprint: what gets called, in what order, how outputs compose into a final rating, how calibration is measured, and what happens when the judge drifts.

---

## Sub-questions (disjoint, PIPE-fit)

**SQ1 — Small-model judge reliability (empirical).**
What κ/QWK/Pearson/accuracy has actually been measured on **sub-30B open models** (Gemma any version, Llama 3 ≤8B, Qwen ≤32B, Mistral ≤24B, Phi, DeepSeek ≤16B) for rubric-style scoring tasks (behavioral/STAR/SJT, essay scoring, OSCE, workplace sim, code review rubrics, LLM-as-judge)? If no direct behavioral BARS evidence exists, triangulate from adjacent tasks — and flag every extrapolation. **Hard rule: any cited number from a model >30B must be labeled `[NON-TRANSFER — ceiling reference only, not a PIPE target]`.** If evidence is absent, say "unknown — must be measured on PIPE fixtures" rather than proxying from a frontier model.

**SQ2 — Scoring architecture patterns for LLM judges.**
What composition patterns exist — single-pass rubric, dimension-decomposed (PIPE's current 5×5 + synthesis), panel-of-judges, self-consistency voting, anchor-conditioned scoring, chain-of-thought-then-score, rubric-as-classifier? Which survive at sub-30B scale? Which are proven to *hurt* at small scale (e.g., CoT on weak models)? For each pattern, label: `[validated ≤30B]` / `[validated frontier only]` / `[unvalidated]`.

**SQ3 — Empirical calibration protocols when the ceiling is unknown.**
How do IO psych / educational-measurement / LLM-judge literatures bootstrap a reliability target when no prior benchmark exists on your exact judge? Gold-fixture construction, human-rater agreement as upper bound, bootstrap CIs on κ, minimum fixture size, drift-detection triggers. **Specifically: does the literature support mirroring the code-review CR-10 pattern — offline oracle (Claude Sonnet 4.6 via Agent tool) + live judge (Gemma 4 26B) with κ drift gate — for behavioral scoring?**

**SQ4 — Failure modes + mitigations validated at ≤30B scale.**
Length bias, position bias, verbosity/sycophancy, persona bleed from the interviewer agent into the scorer, anchor collapse (3-point flattening to L/H only), exemplar anchoring effect, self-enhancement bias. For each: is the mitigation proven *on small open models* or only on GPT-4-class? Mitigations that don't transfer get flagged explicitly.

**SQ5 — Architectural decisions the draft must take a position on.**
Concrete choices the final brief will recommend (with "empirical decision — calibrate and choose" as an acceptable verdict):

- **SQ5a** — Decomposed 5×5 + synthesis (ADR-029 current) vs single-pass 25-cell rubric: which is more reliable at Gemma scale?
- **SQ5b** — Rating scale granularity: 5-point BARS vs 3-point (L/M/H) vs binary-per-anchor. Do small models collapse mid-points?
- **SQ5c** — Anchor injection strategy: full BARS in prompt every call vs embedding-retrieved anchors vs fine-tuned judge. Which fits the Workers AI runtime + ~10k/day Gemma quota?
- **SQ5d** — Offline oracle + live judge topology: is the CR-10 pattern right for culture, or does behavioral scoring need a different shape (e.g., panel-of-small-judges)?
- **SQ5e** — **Per-turn belief state (BC-6/7/15) vs end-of-session stateless scoring (ADR-029 §6)** — which wins, and why? This is the ADR-029 contradiction that must be resolved.
- **SQ5f** — **QWK target reconciliation: 0.55 (ADR-029) vs 0.60 (STRATEGY BC-19).** Which is the release gate, which is the aspirational target?

**SQ6 — Compliance-binding constraints on the scoring architecture.**
EU AI Act (effective 2026-08-02) / ADR-031 requires audit trails, explainability, demographic fairness monitoring on the scorer. Which architectural patterns from SQ2 are compatible with those constraints, and which (e.g., opaque fine-tuned classifier, embedding-similarity scoring without per-dimension rationale) are not? Compatibility matrix: pattern × compliance constraint.

---

## Strategy

**Execution:** 4 sequential researchers on Sonnet 4.6. One at a time. Lead reads each output file before spawning the next so gaps in round 1 inform round 2.

Rationale for sequential (not parallel): founder directive 2026-04-08 — context was at ~40%, and running researchers sequentially lets the Lead curate the file outputs without a context explosion at the review step. Wall-clock cost is acceptable because this is design-time research, not time-sensitive.

| ID | Owner | Dimension (disjoint) | Scope |
|---|---|---|---|
| R1 | researcher (Sonnet) | **Small-model judge empirics** | Empirical κ/QWK on ≤30B open models for any rubric/scoring task. Behavioral, essay, OSCE, workplace sim, clinical, code review. Hard rule on flagging frontier extrapolation. Resolves SQ1. **Boundary:** do not cover architecture patterns or failure-mode mitigations. |
| R2 | researcher (Sonnet) | **LLM-judge scoring architectures** | Composition patterns, decomposition strategies, panel methods, self-consistency, anchor-conditioned scoring, CoT-vs-direct. Explicitly note which are validated at ≤30B. Resolves SQ2 + SQ5a–c. **Boundary:** do not cover empirical benchmarks or calibration protocols. |
| R3 | researcher (Sonnet) | **Calibration + oracle topologies** | Bootstrapping reliability targets with no prior benchmark; gold fixtures; drift detection; offline-oracle patterns; IO psych + educational-measurement literature on rater calibration. Resolves SQ3 + SQ5d. **Boundary:** do not cover failure modes or architecture composition. |
| R4 | researcher (Sonnet) | **Small-model failure modes + compliance fit** | Length/position/verbosity/sycophancy/persona-bleed/anchor-collapse — with mitigations proven on ≤30B. Plus: which scoring patterns are EU AI Act / ADR-031 audit-compatible. Resolves SQ4 + SQ6 + SQ5e. **Boundary:** do not cover reliability benchmarks or calibration protocols. |

**Hard rule for every researcher (direct response to the 2026-04-08 R4 drift):** if the evidence doesn't exist at sub-30B scale, say "unknown — must be empirically calibrated on PIPE fixtures" rather than citing a frontier-model proxy.

**Supporting inputs (read by Lead during synthesis, not by researchers):**
- `knowledge/outputs/culture-bars-anchoring-research-methodology.md` (R1 from prior loop — §§4–6 usable: anchor-writing failure modes, verbosity audit, Maurer 2002 resolution)
- `knowledge/outputs/culture-bars-anchoring-research-competencies.md` (R2 from prior loop — usable as anchor raw material, requires R1's three-question test before any anchor is accepted)
- `knowledge/outputs/behavioral-culture-interview-agent.md` (parent brief — treat as background, not authoritative on scoring architecture)
- `docs/decisions/ADR-029-culture-interview-agent-architecture.md` (the architecture under review)
- `knowledge/STRATEGY.md` BC-section (plan ledger)

---

## Acceptance criteria

- [ ] SQ1 has either real sub-30B numbers with source, or an explicit "unknown, must be measured" with documented search effort (named queries, databases consulted)
- [ ] Every architecture pattern in SQ2 is labeled `[validated ≤30B]` / `[validated frontier only]` / `[unvalidated]`
- [ ] SQ3 produces a concrete calibration protocol with: minimum fixture size, human-agreement ceiling methodology, bootstrap CI calculation, drift-gate thresholds
- [ ] SQ5a–f each get a defensible recommendation with cited support *or* an "empirical decision — calibrate and choose" verdict
- [ ] SQ5e (per-turn vs end-of-session) produces an explicit architectural recommendation that either ratifies or rewrites ADR-029 §6
- [ ] SQ5f (QWK target reconciliation) names the binding number
- [ ] SQ6 produces a compatibility matrix (pattern × compliance constraint)
- [ ] No claim about Gemma 4 26B performance rests on a >70B model benchmark without explicit non-transfer label
- [ ] Every critical claim has ≥ 2 independent sources OR is flagged as single-source
- [ ] All URLs verified during verifier pass

## Task ledger

| ID | Owner | Task | Status | Output |
|---|---|---|---|---|
| T1 | R1 | Small-model judge empirics (SQ1) | todo | `culture-agent-scoring-architecture-research-empirics.md` |
| T2 | Lead | Review T1, decide if SQ1 is adequately answered or needs re-spawn | todo | ledger update |
| T3 | R2 | Scoring architecture patterns (SQ2 + SQ5a–c) | todo | `culture-agent-scoring-architecture-research-patterns.md` |
| T4 | Lead | Review T3, decide if SQ2/SQ5a–c are adequate | todo | ledger update |
| T5 | R3 | Calibration + oracle topologies (SQ3 + SQ5d) | todo | `culture-agent-scoring-architecture-research-calibration.md` |
| T6 | Lead | Review T5 | todo | ledger update |
| T7 | R4 | Failure modes + compliance fit (SQ4 + SQ5e + SQ6) | todo | `culture-agent-scoring-architecture-research-failure-modes.md` |
| T8 | Lead | Full PIPE-fit review of R1–R4; spawn targeted round 2 if any SQ is still unanswered | todo | ledger update |
| T9 | Lead | Synthesize architecture blueprint | todo | `.drafts/culture-agent-scoring-architecture-draft.md` |
| T10 | verifier | Cite + verify URLs | todo | `culture-agent-scoring-architecture.md` (cited) |
| T11 | reviewer | Evidence integrity + PIPE-fit claim audit | todo | `culture-agent-scoring-architecture-verification.md` |
| T12 | Lead | Deliver + provenance + STRATEGY.md update | todo | `culture-agent-scoring-architecture.provenance.md` + STRATEGY BC-row updates |

## Verification log

| Item | Method | Status | Evidence |
|---|---|---|---|
| No frontier-model benchmark treated as PIPE target | Lead review each R file against hard rule | pending | — |
| QWK 0.55 vs 0.60 reconciled | Lead decision after R1 + R3 | pending | — |
| ADR-029 §6 per-turn vs end-of-session resolved | Lead decision after R2 + R4 | pending | — |
| All URLs resolve | verifier pass | pending | — |
| No single-source critical claims | reviewer pass | pending | — |

## Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-04-08 | New slug, not continuation of `culture-bars-anchoring` | Scope reframe too large to patch; old R1/R2 kept as inputs, R3/R4 deleted for drift |
| 2026-04-08 | Hard rule: no frontier-model benchmark is a PIPE target | Direct response to R4 drift in previous loop (Llama 4 Maverick 0.621 cited as proxy for Gemma 26B) |
| 2026-04-08 | All researchers on Sonnet 4.6, sequential (not parallel) | Founder directive — context conservation |
| 2026-04-08 | R1/R2 of prior loop retained as supporting inputs, not re-audited | R1 §§4–6 (anchor-writing rules, verbosity audit, Maurer) and R2 (competency anchor raw material) have standalone value; no drift detected |
| 2026-04-08 | R3/R4 of prior loop deleted | R3 psychometric instrument inventory had no bearing on Gemma judge; R4 silently proxied frontier numbers to PIPE target |

## Out of scope (explicit)

- Writing the actual BARS YAML (separate execution step downstream of this research)
- Redefining the 5 culture + 5 behavioral dimensions (locked per ADR-029 §2; would reopen BC-39)
- Interviewer agent FSM design (ADR-029 §§3–4, separate track)
- Probe generator design (BC-11/12/13, separate track — but this research may inform it via SQ5e)
- The `culture-bars-anchoring-research-methodology.md` and `culture-bars-anchoring-research-competencies.md` files — they remain available as inputs to the draft, but this loop does not re-audit them
- EU AI Act conformity assessment drafting (BC-28/30 compliance work, separate track — but SQ6 produces the compatibility constraints that work will need)

## Deliverable shape (what the final brief will look like)

1. **Executive summary** — recommended scoring architecture for the culture agent, one page
2. **Realistic reliability target** — what QWK/κ PIPE should target pre-calibration, with explicit "unknown → measure" framing where evidence doesn't exist. Resolves QWK 0.55 vs 0.60.
3. **Recommended composition** — call graph: what runs when, inputs/outputs per call, total budget against Gemma quota. Resolves per-turn vs end-of-session (SQ5e).
4. **Calibration protocol** — how to empirically establish the ceiling on PIPE fixtures; offline oracle pattern; drift-detection rules.
5. **Failure-mode mitigation checklist** — validated at ≤30B scale.
6. **Compliance compatibility matrix** — which patterns survive ADR-031 audit requirements.
7. **Open questions + empirical decisions** — explicit list of "must be measured, not researched" items.
8. **Relationship to old `culture-bars-anchoring` research** — what to keep, what to supersede.
9. **STRATEGY.md delta** — exact BC-row updates the Lead will apply after delivery.

---

## Known prerequisites before spawning R1

- [ ] Founder confirms the plan scope (this file)
- [ ] Founder confirms sequential execution model
- [ ] Founder confirms Sonnet 4.6 as researcher model
- [ ] Context budget for the Lead at spawn time (aim for ≥60% free)
