> **STATUS: VERIFICATION REPORT** · Created 2026-04-08 14:16
> **Research run:** `code-review-content-sourcing`
> **Role in run:** Reviewer evidence-integrity report — flags unsupported claims, logical gaps, overstated confidence
> **Verdict:** PASS WITH NOTES (0 FATAL, 2 MAJOR fixed in final, 3 MINOR accepted)
> **Navigate:** [INDEX](../INDEX.md) · [final brief](./code-review-content-sourcing.md)

---

# Evidence Integrity Review — Code Review Content Sourcing Brief

**Draft reviewed:** `/Users/hans/Code/PIPE/PIPE-OS/knowledge/outputs/code-review-content-sourcing-brief.md`
**Verification date:** 2026-04-08
**Reviewer:** reviewer subagent (Claude)

---

## Verdict

**PASS WITH NOTES**

- FATAL: 0
- MAJOR: 2
- MINOR: 3

---

## Summary

The brief demonstrates strong evidence integrity. Quantitative claims (validity coefficients, drift percentages, adverse impact d-values, reliability G-coefficients) match the research sources accurately. The brief appropriately distinguishes between peer-reviewed findings, industry reports, and practitioner essays. Two MAJOR issues require attention before delivery: (1) the Woven pricing claim lacks quantitative support, and (2) the verifier incorrectly flagged a Stack Overflow data point as "unsourced" when it exists in R6. One MINOR authorship discrepancy was previously noted by the verifier and is already documented. No FATAL issues. Document is ready for delivery with the two MAJOR corrections applied.

---

## FATAL issues

None found.

---

## MAJOR issues

### M1. Woven pricing multiplier unsupported

- **Location:** Executive summary
- **Quote:** "Woven ships human-graded PR review at ~10–20× the price of an ML-scored screen [R6-S4][R6-S5]."
- **Problem:** The cited sources (R6-S4 Woven website, R6-S5 G2 reviews) confirm human scoring and that the cost is "prohibitive for high-volume screening," but neither provides the specific "10-20x" multiplier. The research file states only that Woven is "prohibitive for high-volume screening" without quantifying the price ratio. The "10-20x" figure is a Lead inference presented as a sourced fact.
- **Suggested action:** Remove the "~10–20×" quantification and state qualitatively that Woven's human-graded format is "at significantly higher per-assessment cost — prohibitive for top-of-funnel screening." Do not block delivery; note in Open Questions that precise pricing is unconfirmed.

### M2. Verifier error on Stack Overflow claim

- **Location:** Unsourced-claims section in the cited brief
- **Problem:** The verifier flagged "Stack Overflow 2024: 63% of developers use AI daily; only 43% trust accuracy" as not found. This is incorrect — the claim is present in `code-review-content-sourcing-research-market.md` line 210, citing evidence entry E12: "Stack Overflow Developer Survey 2024: 63% of professional developers use AI in development; only 43% express confidence in AI tool accuracy."
- **Suggested action:** Remove the unsourced-claims flag. Add citation [R6-E12] at the relevant point in the brief. This is a verifier correction, not a draft error.

---

## MINOR issues

- **Authorship discrepancy (R5-S9):** Research file cites "Ouyang, S. et al." but arXiv shows "Abdulhai, Cheng, Clay, Althoff, Levine, and Jaques." Content claim (PPO >55% reduction) is verified. Acceptable to ship; update research file post-delivery.
- **Date discrepancy (R5-S24):** Research file cites "Liu, J. et al. (2024)" but arXiv shows "Zhang et al. (2026)." Content claim (Cohen κ = 0.76) is verified. Acceptable to ship; update research file post-delivery.
- **Date framing (R6-P11):** Jellyfish study is September 2025, not 2024. Sources section correctly shows 2025; inline text stating "2024–2025 data" is acceptable framing for the general AI-code-review trend period.

---

## Spot checks performed

### R4 (Work Sample Validity)
- ✓ R4-S3 (Sackett 2022): structured interviews r = .42, work samples r = .33 — confirmed
- ✓ R4-S6 (Huffcutt & Arthur 1994): Level 3-4 r = .51-.57 — confirmed
- ✓ R4-S12 (Roth 2008): Black-White d = .74-.76 (in-basket), d = .21-.22 (oral/conversational) — confirmed
- ✓ Legal citations (Griggs, Ricci, EEOC Uniform Guidelines) — primary legal sources
- ✓ "No peer-reviewed study validates code-review against SWE job performance" — confirmed as accurate literature-review finding in R4

### R5 (Simulation-Based Assessment)
- ✓ R5-S2, R5-S3 (OSCE/MMI station counts): 8-12 stations for G ≥ 0.80 — confirmed
- ✓ R5-S5, R5-S6 (Hodges finding): checklists penalize experts — confirmed
- ✓ R5-S9 (LLM persona drift): 14-34% off-persona (0.657-0.863 consistency) — confirmed (math: 1-0.863=13.7%, 1-0.657=34.3%)
- ⚠ R5-S9 authorship: flagged (Ouyang vs. Abdulhai) — content verified
- ✓ NOTECHS 83-84% inter-rater accuracy — confirmed
- ✓ van der Vleuten utility equation — confirmed

### R6 (Market & Practitioner)
- ✓ R6-S1, R6-S2, R6-S3 (HackerRank/CodeSignal static format) — confirmed
- ✓ R6-S10 (GitLab 72-hour async MR review) — confirmed
- ✓ R6-P11 (Jellyfish 18% acceptance rate, 1000 PRs, 400 companies) — confirmed
- ✓ R6-E12 (Stack Overflow 63% use AI, 43% trust) — confirmed in R6 line 210 (verifier error)
- ⚠ R6-S4, R6-S5 (Woven pricing): "prohibitive" confirmed, "10-20x" NOT quantified in source
- ✓ Bacchelli & Bird, Sadowski, Bosu, MacLeod, Sillito, Zhang — confirmed

### R3 (Scaffolding)
- ✓ R3-S10 (AutoIRT) — confirmed
- ✓ R3-S11 (n ≥ 100 per item for IRT) — confirmed
- ✓ R3-S17 (225-item minimum bank: 3×5×3×5) — confirmed

### R1 & R2 (Mining & Synthetic)
- ✓ R1-S12 (LiveCodeBench rolling-freshness strategy) — confirmed
- ✓ R2-S6, R2-S7 (BugPilot execution-based ground truth) — confirmed
- ✓ AIG templates × variants (Gierl & Haladyna) — confirmed

### Out of scope (not verified)
- Unit economics calculations (Part 5.4) — arithmetic based on token pricing assumptions, not empirical claims
- BARS rubric level examples — product design artifacts
- Model routing table — PIPE-internal architecture
- Ship sequence — product roadmap

---

## Confidence assessment

The brief's confidence level matches the underlying evidence strength. Specifically:

- **Appropriate hedging:** "The combination approaches the practical ceiling" and "If PIPE hits all three structural features" are conditional. The "No peer-reviewed study validates code-review against SWE job performance" claim is correctly framed as a negative literature-review finding.
- **Agent drift "14-34%"** matches R5 source data exactly.
- **Open Questions** section explicitly flags genuine unknowns (criterion validity, turn-level scoring, reactivity calibration, AI-direction BARS anchors) rather than papering over them.
- **Overstated claims:** The Woven "10-20x" multiplier (M1) is the one place where an inference is presented as a sourced fact. Does not invalidate the core argument (that Woven is cost-prohibitive for high-volume screening, which IS supported).
- **Single-source reliance:** The "no criterion validity study for code review" claim rests on R4's literature-review finding — acceptable because it's a negative claim (absence of evidence in a systematic search), not a positive empirical claim requiring replication. Brief appropriately frames this as "the key empirical gap."
- **Tiered source treatment:** The brief correctly distinguishes peer-reviewed meta-analyses (Sackett, Roth, Huffcutt) from industry reports (Jellyfish, CoderPad survey) from practitioner essays (Osmani) and weights them accordingly. The "AI-direction as sixth dimension" is labeled as "emerging construct" and cites Osmani/Jellyfish/Graphite operational metrics, not peer-reviewed validity studies — appropriately hedged.

**Risk of overcorrection (Schmidt-Hunter):** The brief uses the Sackett 2022 corrected estimate (r = .33 for work samples) rather than the legacy Schmidt-Hunter 1998 figure (r = .54). This is appropriate — the Sackett correction is the current best estimate, and the brief explicitly notes the historical revision.

**Overall:** Confidence is well-calibrated to evidence strength. One MAJOR issue (Woven pricing) needs correction; otherwise ready to ship.

---

## Recommendation

**Ship with the two MAJOR corrections applied:**
1. Remove the "~10–20×" Woven pricing quantification; replace with qualitative framing.
2. Remove the verifier's erroneous Stack Overflow unsourced-claims flag; add citation [R6-E12].
3. Update R5-S9 and R5-S24 authorship in the research files post-delivery (MINOR, informational only).

The document meets the evidence integrity standard for delivery.
