# Verification Report: Repo-Personalized Interview Config

**Draft:** `knowledge/interview/repo-personalized-interview-config.md`
**Verification date:** 2026-04-18
**Overall status:** PASS WITH NOTES

## Summary

The brief's evidence base is generally solid and its most important interpretive leaps are correctly labeled as novel inferences, engineering priors, or analogical extensions. The three research files contain sufficient primary-source grounding for the core arguments. Three issues required action before the brief is used to author ADR-039: one FATAL (the "23–331 percentage-point" framing mixes absolute and relative increases) — **corrected in body**; one MAJOR (Gilliland 2003 wrong PMID) — **tracked in Open Questions**; one MAJOR (Appendix Lance 2000 vestigial citation) — **corrected in Appendix**; two additional MAJOR items on single-source critical claims — **tracked in Open Questions**.

---

## FATAL issues (resolved)

### F1. "23–331 percentage-point score inflation" — absolute/relative conflation

- **Location:** §3.1 (Philosophy), codebase-familiarity paragraph.
- **Problem:** The 331% figure from Chen et al. is a *relative* increase (0.19 → 0.82, ~332% relative), not a 331 *percentage-point* absolute increase. Presenting it as "331 percentage-point" inflation alongside "23 percentage-point" inflation (a genuine absolute figure from Liang et al.) was a category error that inflated the claimed confound magnitude.
- **Resolution:** Body text corrected to distinguish the two figures — "23 percentage-point absolute score inflation (Liang et al., SWE-Bench Illusion [S12])" and "up to ~332% relative score inflation at 100% contamination (Chen et al. 2025 [S14])". Note added referencing the correction.

---

## MAJOR issues

### M1. Gilliland 2003 field-study citation has wrong PMID

- **Location:** §3.3 (Transparency), referencing [S41].
- **Problem:** PMID 12558210 resolves to Truxillo et al. 2002, not Gilliland 2003. The three-point timely/specific/reasonable claim for fairness explanations is attributed solely to this unverified source.
- **Tracked:** Added as Open Question 8 in brief §7. Recommendation: locate correct DOI/PMID before ADR-039 cites the three-point list, or fall back to verified Gilliland 1993 + Hausknecht 2004.

### M2. NCLEX 400-response pretest threshold — partially inaccessible primary source

- **Location:** §3.4 Psychometrics.
- **Problem:** Single-source reference; the public NCLEX FAQ does not explicitly describe the 400-response threshold; the claim derives from NCSBN technical documentation not publicly accessible.
- **Tracked:** Added as Open Question 9 in brief §7. Noted that the Rasch SE formula and USMLE's verified 200-response precedent carry the N=100 gate independently.

### M3. Appendix "Lance et al. 2000" — unsourced vestige (resolved)

- **Location:** §8 Appendix source reference.
- **Problem:** Phantom citation not present in R1 source table.
- **Resolution:** Appendix corrected to list "Sackett & Dreher 1982 (foundational exercise-effect); Lance 2008."

### M4. Qualified.io per-candidate variation — unverifiable from public sources

- **Location:** §4.1 Competitor scan; §7 Open Question 2.
- **Problem:** Differentiation claim rests on the assertion that Qualified.io does not vary challenges per candidate. Public sources (product page, help docs) are inaccessible or silent.
- **Tracked:** Already flagged in §7 Open Question 2 in the brief. Recommendation: product trial or vendor contact required before the differentiation claim appears in customer-facing materials.

---

## MINOR issues (accepted)

- R2 Legal Risk Summary table still lists Colorado SB 24-205 date as "June 30, 2026." Main brief body corrected to 2026-02-01. R2 source file table to be corrected as a separate housekeeping item.
- Author misattributions in R1/R3 source tables (Gormley vs. Onwudiegwu [S3]; Rezigalla vs. Trejo-Mejía [S46]; Haines vs. Wolcott [S17]; Alowais vs. Falcão [S50]) are documented in Verifier Notes §A–§I. These are correction-required in the source files but do not affect substantive claims — the actual papers' content matches the draft's assertions.
- Dead-link count (19 URLs) is high but fully documented in the Sources section. Most are paywalled journal pages (403), not missing papers. Underlying sources are identifiable by DOI/PMID.
- Barnett & Ceci [S16] cited as near-transfer theoretical bridge — draft correctly labels the human-developer magnitude as unknown. No overstatement.
- IRT ±1 band rule — mapping of seniority bands to ~1 logit is explicitly labeled "engineering convention, medium confidence." Correctly hedged.

---

## Spot-check log

- R1 [S1] Eva et al. 2004 MMI — verified: 10-station reliability 0.65, station-by-candidate variance.
- R1 [S4] Lance 2008 — verified: exercise-effect claim confirmed.
- R1 [S12/S15] SWE-Bench Illusion / SWE-rebench — verified: 23 pp figure (S12), NeurIPS 2025 accepted (S15).
- R1 [S14] Chen et al. 2025 — verified: 0.19 → 0.82 on HumanEval; the 332% is relative, not percentage-point.
- R2 [S32] Wilson & Caliskan 2024 — verified: 85.1% White preference; author-correction confirmed.
- R2 [S35] Colorado SB 24-205 — verified: 2026-02-01 per Colorado General Assembly page.
- R3 [S4] Rasch Measurement Transactions — verified: 2/√N formula and N=100 ±0.5 logit claim.
- R3 [S8/S46] Trejo-Mejía 2016 — verified; author mismatch confirmed; G=0.93 at 18 stations; student×station 51%.
- R3 [S9/S47] Peeters 2021 — verified: 4 stations → G=0.70; 7 stations → G=0.81.
- R3 [S14/S52] SmartBear/Cisco — verified: 300 LOC/hour, 60–90 min session confirmed.
- Gilliland 2003 [S41] PMID — confirmed wrong (resolves to Truxillo 2002).
- NCLEX 400-response threshold [S43] — public FAQ does not contain the figure.

---

## Overall assessment

The brief is substantively well-grounded. The core arguments — asymmetric T/V/H reframing, 3-station G-coefficient verdict, novel UGESP application, embedding-bias analogy, N≥100 calibration gate, time-budget coefficient labeling — are all correctly hedged relative to their evidence base. The FATAL figure-framing issue has been corrected in the body. Remaining MAJOR issues are tracked in brief §7 Open Questions (items 2, 7, 8, 9) so they do not get lost when ADR-039 is authored.

**Verdict:** PASS WITH NOTES. Ready for use as the research base for ADR-039.
