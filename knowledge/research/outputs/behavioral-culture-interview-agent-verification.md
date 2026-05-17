> **STATUS: VERIFICATION REPORT** · Created 2026-04-07 11:18
> **Research run:** `behavioral-culture-interview-agent`
> **Role in run:** Reviewer evidence-integrity report — flags unsupported claims, logical gaps, overstated confidence
> **Verdict:** PASS WITH NOTES (2 FATAL + 5 MAJOR fixed in final, 6 MINOR accepted)
> **Navigate:** [INDEX](../INDEX.md) · [final brief](./behavioral-culture-interview-agent.md)

---

# Verification Report: behavioral-culture-interview-agent

*Verification date: 2026-04-07 | Verified against R1 (IO psych), R2 (AI/NLP), R3 (culture/platforms), R4 (agent/legal)*

---

## FATAL Issues (must fix before delivery)

### F1 — Executive Summary overstates QWK benchmark applicability

**Claim (exec summary):** *"multi-agent LLM frameworks with criterion-decomposed rubric scoring now achieve Quadratic Weighted Kappa (QWK) of ~0.62 on behavioral interview response scoring"*

**Problem:** The benchmark (Huynh et al. 2025, arXiv:2602.02360) was conducted on **Multiple Mini Interview (MMI) responses** — a healthcare medical-school admissions format with scenario-based ethical/empathy questions, not STAR-format behavioral job interviews. The draft's own Open Question #1 acknowledges this directly: *"Existing datasets (ASAP, MIT Interview, MMI) don't include STAR-format annotations."* R2 Gaps section: *"No public STAR-specific scoring dataset… STAR-specific research is thin."* Presenting QWK 0.62 as the figure for "behavioral interview response scoring" in the executive summary — the most-read section — is materially misleading about how far the state of the art extends to the actual use case.

**Fix:** Change to: *"…on open-ended soft-skill interview response scoring (Multiple Mini Interview format); no published STAR-format benchmark yet exists."* Add a parenthetical pointing to Open Question #1.

---

### F2 — Executive Summary and body contradict each other on Illinois AIVIA text-only coverage

**Claim (exec summary):** *"Illinois's 2025 AIVIA expansion covers text-based AI assessment"* — stated as established fact.

**Contradiction (Open Question #5 of the same draft):** *"Whether a text-only interview scoring system constitutes an 'AI skills assessment' under HB 3773 requires consultation with Illinois employment counsel."*

**Source (R4):** *"A text-based behavioral interview agent that generates scores or rankings used in hiring decisions in Illinois **almost certainly** falls under HB 3773."* The research source explicitly hedges; the exec summary drops the hedge entirely.

**Fix:** Align the executive summary with the source's phrasing ("almost certainly") and add a parenthetical reference to Open Question #5.

---

## MAJOR Issues (note in Open Questions or qualify in body)

### M1 — Executive Summary buries the Schmidt & Oh 2016 convergence caveat

**Claim (exec summary):** *"ρ = .44–.64 for structured behavioral interviews vs. ρ = .33–.38 for unstructured ones"* — presented as the current consensus on the validity differential.

**Omitted qualification:** R1 explicitly flags Schmidt & Oh 2016 with a "⚠️ Methodological note": the more accurate indirect range restriction correction **equalises** structured and unstructured at ρ = .58 each. The practical argument for structure survives via incremental validity over GMA (+18% vs. +13%), but the differential itself collapses under the latest correction. This caveat appears correctly in Section 1.1 of the body but is absent from the executive summary, which uses the older, larger differential. Readers who stop at the summary receive an outdated picture.

**Fix:** Add one sentence to the exec summary: *"Note: Schmidt & Oh 2016's improved range-restriction correction narrows this gap significantly (both converge near ρ = .58); the case for structure rests primarily on incremental validity over GMA."*

---

### M2 — Verquer, Beehr & Wagner 2003 missing from sources table

**Cited in body (Section 3.1):** *"The Verquer, Beehr & Wagner 2003 meta-analysis (Journal of Vocational Behavior) found similar patterns: job satisfaction ρ = .31, commitment ρ = .28, intent-to-quit ρ = −.20."*

**Problem:** This citation is absent from the numbered sources table at the end of the document. The values are confirmed in R3 (S4: *Journal of Vocational Behavior* 63(3)).

**Fix:** Add entry to sources table: *Verquer, Beehr & Wagner, "A Meta-Analysis of Relations Between Person-Organization Fit and Work Attitudes," 2003, Journal of Vocational Behavior 63(3).*

---

### M3 — Loconte et al. 2025 missing from sources table

**Cited in body (Section 2.7):** *"Reality Monitoring (RM) signals (from Loconte et al. 2025, Journal of Language and Social Psychology)"*

**Problem:** This paper does not appear in the numbered sources table. It is confirmed in R3 (S34: DOI:10.1177/0261927X251316883).

**Fix:** Add entry to sources table: *Loconte et al., "Detecting Deception Through Linguistic Cues: From Reality Monitoring to NLP," 2025, Journal of Language and Social Psychology.*

---

### M4 — ACL 2025 follow-up question generation paper missing from sources table

**Cited in body (Section 2.4):** *"The ACL 2025 industrial paper on follow-up question generation (using Bloom's Taxonomy and Grice's Maxims) provides a taxonomy of 5 trigger types"*

**Problem:** This paper (confirmed in R4, S2: aclanthology.org/2025.acl-industry.93.pdf) does not appear in the numbered sources table. The draft's existing sources #14 (arXiv:2205.10977) and #18 (arXiv:2309.05007) are different papers.

**Fix:** Add entry to sources table: *"Generating Follow-Up Questions Using Bloom's Taxonomy and Grice's Maxims," ACL 2025 Industry Track, aclanthology.org/2025.acl-industry.93.pdf.*

---

### M5 — Seitz et al. 2025 misattributed to cognitive load / unexpected follow-ups

**Claim (Section 2.7):** *"Cognitive load via unexpected follow-ups (Vrij et al.; Seitz et al. 2025)"*

**Problem:** R3 (S35) identifies Seitz et al. 2025 as: *"What If Applicants Fake Their Responses?: Modeling Faking in High-Stakes Assessments, Educational and Psychological Measurement 85(4):747–782"* — an IRT-based faking-detection modeling paper, not a cognitive load study. The cognitive load / unexpected-follow-up paper is the separate unnamed Springer 2025 study (R3, S20: *Journal of Business and Psychology* DOI:10.1007/s10869-025-10042-7). The draft lumps them together under the same claim.

**Fix:** Separate the citations: attribute cognitive load disruption of scripted answers to the S20 Springer 2025 paper; cite Seitz et al. 2025 separately in the context of faking detection modeling (~70% sensitivity at 80% specificity).

---

## MINOR Issues (accepted)

### m1 — "Walking toward" vs "moving toward" (Huynh et al. paraphrase)
Section 2.1 renders the SBERT example as *"walking toward a grieving friend / walking away from a grieving friend."* R2 (S1) uses *"moving toward / moving away."* Negligible paraphrase difference; no factual error.

### m2 — "Platt scaling" not sourced
Section 6.4 recommends *"post-hoc calibration with Platt scaling per demographic group."* The concept of post-hoc calibration is grounded in R2 (score overestimation mitigation), but the specific technique name "Platt scaling" does not appear in any research file. Acceptable as a reasonable implementation suggestion, but should be flagged as practitioner judgment, not research-derived.

### m3 — GMA + integrity test excluded without explanation
Section 1.1: *"Combined GMA + structured interview: ρ = .76 — the highest validity combination achievable with widely-available methods."* R1 (Schmidt & Oh 2016) notes GMA + integrity test reaches ρ = .78, which is higher. The qualifier "widely-available" is doing unstated work. Either define "widely-available" (e.g., "legal in most jurisdictions") or remove the superlative.

### m4 — Cost-efficient model superiority overgeneralised
Section 6.1: *"The Llama 4 Maverick result (QWK 0.621) shows that cost-efficient models outperform expensive models (GPT-5 at 0.432) on behavioral scoring when prompting architecture is optimized."* R2 (S1) is more specific: GPT-5 specifically *"underperforms on soft-skill behavioral scenarios"* on the MMI dataset. The broader claim that cost-efficient models generally outperform expensive ones with good prompting is not established by a single benchmark on one format.

### m5 — Mistral competitiveness claim lacks direct source support
Section 6.1: *"Mistral (per PIPE's existing stack) is competitive with frontier models for structured rubric scoring when multi-agent prompting is applied."* No Mistral performance data appears in any research file. The claim is immediately (and correctly) qualified in the next sentence, but the initial assertion is still an unsupported extrapolation. Rephrase as: *"Mistral's competitiveness on structured rubric scoring is untested in the literature…"*

### m6 — Source #16 listed but not cited in body
The draft's sources table entry #16 ("Listening to the Unspoken: 365 Aspects of Multimodal Interview Assessment," arXiv:2507.22676) does not appear to be cited anywhere in the document body. Either cite it in the multimodal comparison discussion or remove from the sources table.

---

## Verdict: PASS WITH NOTES

The draft's core claims — structured interview validity coefficients, BARS improvement, P-O fit effect sizes, LLM scoring architecture, regulatory landscape — are well-grounded in the four research files and accurately reported. IO psychology data is faithfully transcribed; legal obligations are correctly characterised (with the F2 exception).

**Required before delivery:** Fix F1 (QWK benchmark scope) and F2 (AIVIA text-only coverage certainty). These are in the executive summary — the most-read part — and create materially incorrect impressions.

**Recommended before delivery:** Add three missing source citations (M2, M3, M4) and fix the Seitz et al. misattribution (M5). The Schmidt & Oh 2016 convergence caveat (M1) should be surfaced in the executive summary for intellectual honesty.

**Minor items** can be accepted as-is or addressed in a light editorial pass.
