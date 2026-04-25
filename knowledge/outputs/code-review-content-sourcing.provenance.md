> **STATUS: PROVENANCE RECORD** · Created 2026-04-08 14:17
> **Research run:** `code-review-content-sourcing`
> **Role in run:** Workflow audit trail — rounds, researchers, sources, verification outcome
> **Navigate:** [INDEX](../INDEX.md) · [final brief](./code-review-content-sourcing.md)

---

# Provenance: Code Review Content Sourcing

- **Topic:** Sustainable content design strategy for PIPE's turn-based human–AI code-review assessment
- **Date:** 2026-04-08
- **Rounds:** 2 (Round 1 = production / content-sourcing; Round 2 = interview-value / validity)
- **Researcher model:** Claude Sonnet 4.6 (Lead user override; default researcher model insufficient for primary-source synthesis)
- **Lead model:** Claude Opus 4.6 (1M context)
- **Verifier model:** Claude Sonnet (verifier subagent)
- **Reviewer model:** Claude Sonnet (reviewer subagent)

## Workflow

| Phase | Artifact | Status |
|---|---|---|
| Plan | `knowledge/outputs/.plans/code-review-content-sourcing.md` | Complete |
| R1 research — PR-mining datasets & leakage | `knowledge/outputs/code-review-content-sourcing-research-mining.md` | Complete (~23 KB) |
| R2 research — Synthetic PR generation | `knowledge/outputs/code-review-content-sourcing-research-synthetic.md` | Complete (~20 KB) |
| R3 research — Scaffolding & calibration | `knowledge/outputs/code-review-content-sourcing-research-scaffolding.md` | Complete (~39 KB) |
| R4 research — Work-sample & structured-interview validity | `knowledge/outputs/code-review-content-sourcing-research-worksample.md` | Complete |
| R5 research — Simulation-based assessment prior art (OSCE/MMI/aviation) | `knowledge/outputs/code-review-content-sourcing-research-simulation.md` | Complete |
| R6 research — Market scan + practitioner literature | `knowledge/outputs/code-review-content-sourcing-research-market.md` | Complete |
| Lead draft | `knowledge/outputs/.drafts/code-review-content-sourcing-draft.md` | Complete |
| Verifier citation pass | `knowledge/outputs/code-review-content-sourcing-brief.md` | Complete |
| Reviewer evidence integrity | `knowledge/outputs/code-review-content-sourcing-verification.md` | PASS WITH NOTES (0 FATAL, 2 MAJOR, 3 MINOR — all fixed or accepted) |
| Final deliverable | `knowledge/outputs/code-review-content-sourcing.md` | Delivered |

## Sources

- **Total cited:** 50 across six research files (R1–R6)
- **URL verification:** 37 live ✓, 8 paywalled (DOI resolvable via institutions), 3 redirect/authorship mismatches (content verified), 2 binary PDFs (titles confirmed via alternate paths), 0 dead links
- **Peer-reviewed sources:** ~35 (meta-analyses, primary empirical studies, foundational methodology papers)
- **Primary legal/regulatory sources:** 4 (EEOC Uniform Guidelines, Griggs v. Duke Power, Ricci v. DeStefano, Title VII)
- **Primary regulatory sources (aviation):** 2 (FAA AC 120-54A, AC 120-35D)
- **Industry reports / practitioner essays:** ~11 (Jellyfish, GitClear, CoderPad survey, Pragmatic Engineer, Addy Osmani, Woven, HackerRank)

## Verification

- **Verdict:** PASS WITH NOTES
- **FATAL issues:** 0
- **MAJOR issues:** 2 — both fixed in final deliverable:
  1. Woven "~10–20×" pricing multiplier removed (inference presented as sourced fact); replaced with qualitative "prohibitive for high-volume screening" framing supported by the underlying sources.
  2. Stack Overflow 2024 AI usage stat was incorrectly flagged by verifier as unsourced — claim IS present in R6 evidence table row E12; citation [R6-E12] added inline.
- **MINOR issues:** 3 — accepted as-is:
  1. R5-S9 authorship discrepancy in research file (content verified; update post-delivery)
  2. R5-S24 authorship/date discrepancy in research file (content verified; update post-delivery)
  3. R6-P11 Jellyfish publication is September 2025, not 2024; "2024–2025 data" framing in brief is acceptable

## Key genuine gaps (disclosed in brief's Open Questions)

1. **No peer-reviewed criterion-validity study** exists for a code-review assessment against on-the-job SWE performance. Bootstrap path (concurrent-validity study at 90 days post-hire) disclosed as the primary empirical gap.
2. **Turn-level vs. encounter-level scoring trade-off** is unvalidated empirically for this format.
3. **Reactivity calibration ground truth** has no prior art; requires original calibration study.
4. **AI-direction BARS rubric** is inferred from operational metrics (Jellyfish, Graphite Diamond), not derived from validated psychometric work.
5. **Content-freshness decay curve** for leakage resistance is a guess (quarterly gate advance); actual decay rate unknown.

## Deliverable scope

- **In scope:** Content sourcing strategy, format design, agent engineering, model routing, unit economics, validity framework, fairness/legal defensibility, build sequence.
- **Out of scope (deferred from parent plan):** Scoring framework details (already locked in existing PIPE arena work), simulation-design detail beyond content shaping, industry-practice survey beyond hiring-tool competitive scan.
- **Not derived from research (Lead synthesis / product design):** Model routing recommendations, unit economics calculations, ship sequence, persona YAML schema, BARS rubric examples, agent architecture diagrams. These are marked as product/engineering decisions in the brief and explicitly excluded from the reviewer's evidence-integrity scope.

## Notes for future rounds

- If Round 3 is needed, the highest-ROI follow-up is a **criterion-validity study design** for code-review assessment (the brief's biggest remaining empirical gap) — specifically, what's the minimum viable concurrent-validity protocol, and what has been done for other technical assessments (programming tests, algorithmic challenges) that PIPE could adapt.
- A second candidate Round 3 topic is a **controlled empirical study on architectural-summary scaffolding for experienced engineers** — R3 flagged this as a genuine research gap that affects the scaffolding boundary decision.
- Neither is blocking for MVP ship. Both should be revisited after the first real paying customer asks for a validation file.
