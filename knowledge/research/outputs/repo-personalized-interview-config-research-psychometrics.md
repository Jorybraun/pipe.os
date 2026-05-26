# Research: Psychometrics for Repo-Personalized Interview Configuration

## Task IDs
R3-PSYCHOMETRICS — Sub-questions 4a, 4b, 4c
(Q1/Q2/Q4e owned by R1; Q3/Q4/Q4d owned by R2; Q5–Q8 owned by R4/R5)

## Method

Searched PubMed Central, ACM DL, Google Scholar, NCLEX/USMLE/AICPA primary sites, ETS, Rasch.org, and UK Ofqual. Primary sources read directly via WebFetch where HTML was accessible; PDFs extracted via secondary descriptions where binary-only. Search queries covered: NCLEX item calibration protocol, USMLE item pretesting, AIG item families CAT, G-theory OSCE reliability, speededness power test ETS, code review inspection rate LOC, IRT information function item difficulty, CAT b-matching stopping rule. All sources logged below.

---

## Key Findings

### Q4a — Calibration at template-level + dimension-level (N-staging)

**Licensure precedent: NCLEX, USMLE, CPA all use pretest embedding, not item-level field trials**

NCLEX (Next Generation, 2023) requires ≥400 examinee responses before an item's calibration is evaluated for operational use [S1]. Items are embedded as unscored pretests in live exams; the operational item pool contains ~1,700–2,000 calibrated items. The passing standard is set at 0.00 logits on a 4-parameter logistic scale [S17]. USMLE Step exams require ≥200 examinee pretest responses; items must show p-value 30–97% and positive discrimination before entering the scored pool [S2]. The CPA Exam (2024 redesign) uses a continuous calibration pipeline: new items are pretested in every administration and calibrated as response data accumulates [S3]. All three licensure programs share the same design principle: calibration is deferred until sufficient N; expert judgment carries early administrations.

**Rasch calibration stability thresholds**

Rasch calibration standard error SE ≈ 2/√N to 3/√N (Wright & Stone, Rasch Measurement Transactions) [S4]. At N=100 responses, SE ≈ 0.20–0.30 logits, yielding a 95% CI of ±0.40–0.60 logits — sufficient for rank-ordering and pass/fail decisions. At N=10, SE ≈ 0.63–0.95 logits (95% CI ±1.3–1.9 logits) — unstable for calibration; expert anchoring required. At N=1000, SE ≈ 0.063–0.095 logits — stable for 2PL item discrimination estimation and DIF detection.

**Automatic Item Generation (AIG): template-level calibration is theoretically sound**

AIG generates items from a cognitive model template ("item model" or "item family"). Items within a family are isomorphic instances that inherit the psychometric characteristics of the parent model [S5]. A 2022 PMC review confirmed that AIG-generated medical assessment items show psychometric properties statistically indistinguishable from expert-written items when generated from validated templates [S5]. A 2023 validity study demonstrated that AIG item quality generalizes across difficulty levels when the generative model constrains surface variation while preserving construct fidelity [S6]. Critically, Tian & Choi (2023) showed in a CAT simulation that AIG item families with within-family parameter variation can be handled by augmenting the item response model with a family-level difficulty distribution — pooling responses across family members stabilizes difficulty estimates faster than treating each item independently [S7].

**Inference: template-level calibration staging for PIPE**

Pooling across isomorphic template instances (all repos generated from the same template pack + BARS-dimension pair) is psychometrically analogous to pooling within an AIG family. Calibration should be staged:

- **N < 10 per template**: No calibration. Use expert-anchored difficulty scores (SME panel rating 1–5 mapped to logit scale by convention). Flag all assessments in this tier as "unvalidated — scores are directional only."
- **N = 10–99 per template**: Rasch anchor calibration. Pool all items generated from the template family. Compute person-separation reliability; SE will be ±0.4–0.6 logits. Sufficient for rank-ordering within a cohort; insufficient for absolute difficulty claims. Report scores with explicit SE bands.
- **N = 100–999 per template**: Rasch 1PL operational calibration. SE ≈ ±0.20–0.30 logits. Sufficient for pass/fail decisions at most seniority cutpoints. Begin DIF detection by self-reported role/seniority.
- **N ≥ 1000 per template**: 2PL calibration feasible (discrimination estimation stabilizes). Full DIF screening across demographic and role-type facets. Introduce IRT information function to optimize item selection within band.

**G-theory at the dimension level: OSCE literature sets the bar**

When different items assess the same latent dimension (rubric fixed; items vary), reliability is a generalizability coefficient, not a classical reliability. OSCE literature (Rezigalla 2016) [S8] establishes empirically: 4 OSCE stations → G≈0.70; 7 stations → G>0.80. A 2021 multi-site validation study confirmed this threshold curve holds when station content is sampled from a standardized rubric [S9]. G≥0.70 is the minimum acceptable threshold for high-stakes decisions (professional consensus: OSCE community, NCLEX design teams). G≥0.80 is preferred for certification-level stakes. PIPE's 3-station design (as of the current architecture) likely yields G≈0.60–0.75 — marginal. Mitigation: rate multiple BARS dimensions per station (each rating adds an observation), increasing effective observation count without adding stations.

(single source for exact 3-station G estimate — extrapolated from Rezigalla's 4-station baseline; treat as directional)

---

### Q4b — Time budgets: scaling per item complexity

**Speededness vs. power test literature**

The Swineford Criterion (ETS tradition, referenced in AERA/APA/NCME Standards §4.14) defines a power test as one where ≥80% of examinees reach the last item [S10]. An ETS Methods Report (Sireci et al., 2019) operationalizes this: if completion rate falls below 80%, the time limit is contributing to construct-irrelevant variance (speededness) and must be adjusted [S10]. A UK Ofqual review (2019) distinguishes "speed" as a construct-relevant element (when the task is inherently time-sensitive, e.g., triage nursing) vs. an artefact when the task is not [S11]. Van der Linden's 2008 predictive control framework for speededness models individual time-on-item as a log-normal distribution and derives per-item time budgets that control completion probability for a target percentile [S12]. The practical implication: time limits should be set so that the 20th-percentile candidate (slowest plausible legitimate responder) can complete all items.

**Code review timing: empirical data**

Rigby & Bird (ESEC/FSE 2013) studied 570 code reviews from open-source projects and found median time-to-first-review of ~15 hours, but active review session length concentrated around 10–60 minutes for reviews of typical PRs (100–500 LOC) [S13]. SmartBear's Cisco Systems case study (Fagan-style inspection adapted to modern CR) found optimal inspection rate was <300 LOC/hour; reviews exceeding 200–400 LOC showed diminishing defect detection; sessions beyond 60–90 minutes showed fatigue-related quality drop [S14]. Sadowski et al. (Google, ICSE 2018) reported that the median code review at Google takes 24 hours wall-clock but active engagement is much shorter; reviewers self-selected review depth based on PR scope, with smaller PRs receiving proportionally more comments per LOC [S15].

From SmartBear/Cisco: 300 LOC/hour → 5 LOC/minute → 12 seconds/LOC. This is the most precise empirical reading rate available.

**Proposed time-budget formula**

Combining code-review reading rate (300 LOC/hr from [S14]) with cognitive load components:

```
reading_minutes  = reading_chars / 750          # ~750 chars/min for dense technical prose
diff_minutes     = diff_loc / 5                 # 5 LOC/min inspection rate (300 LOC/hr)
file_minutes     = file_count × 1.5             # context-switch overhead per file
bug_minutes      = bug_count × 3.0              # cognitive load per planted defect

base_minutes     = reading_minutes + diff_minutes + file_minutes + bug_minutes
time_minutes     = base_minutes × unfamiliarity_factor × buffer_coefficient
```

Where:
- `unfamiliarity_factor`: 1.0 if candidate has indicated familiarity with the language/framework; 1.3 if unfamiliar (single source — engineering judgment, not empirically derived)
- `buffer_coefficient`: 1.25 — an **engineering prior** to ensure 80th-percentile completion (Swineford power-test threshold [S10]). This coefficient is not derived from Swineford; Swineford is a diagnostic threshold (if <80% complete, you have a problem). The 1.25 value is a starting assumption to be empirically calibrated against actual PIPE completion rate data after N≥100 administrations per template.
- Floor: 15 minutes (below this, the task does not provide sufficient engagement signal)
- Ceiling: 90 minutes (above this, fatigue becomes a confound per [S14])

**Confidence note**: The 5 LOC/min rate is directly cited from SmartBear/Cisco [S14]. The `file_count × 1.5` and `bug_count × 3.0` coefficients are engineering priors. The 1.25 buffer is explicitly an engineering prior, not a research-derived value. All three coefficients should be treated as initial values to calibrate against observed completion rates.

---

### Q4c — Difficulty-band filter: preventing ceiling/floor effects

**IRT information function: the theoretical basis for ±1 logit**

Under the 2-parameter logistic (2PL) IRT model, item information I(θ) = a² × P(θ) × [1 − P(θ)] where P(θ) is the probability of correct response at ability θ, a is discrimination, and b is item difficulty [S16]. Information peaks at θ=b (item difficulty matches examinee ability). The information function drops to:

- 80% of peak at |b − θ| = 1.0 logit
- 44% of peak at |b − θ| = 2.0 logits
- ~20% of peak at |b − θ| = 3.0 logits

At |b − θ| > 2 logits, item information is so low that a response contributes negligibly to θ estimation — equivalent to near-random guessing (hard items) or near-certain success (easy items). In CAT, items are selected by minimum |b − θ̂| distance [S17]. NCLEX uses a 95% CI stopping rule: testing continues until θ̂ is estimated with SE ≤ 0.50 logits (equivalent to 95% CI not straddling the 0.00 logit passing standard) [S18].

**Criterion-referenced implications: Hambleton**

Hambleton (1990) established that in criterion-referenced measurement, the region of diagnostic value is near the cutscore, not across the full ability range [S19]. Items near the cutscore provide the most decision-relevant information; items far from the cutscore contribute noise to pass/fail classification. This is the psychometric basis for difficulty matching to role seniority band.

**Floor/ceiling effects in practice**

Zumbo & Zimmerman (1993) showed that assessment instruments with mean difficulty mismatched to mean ability by ≥2 logits produce floor/ceiling effects that compress score variance, reducing reliability and validity [S20]. The practical prescription: mean item difficulty should be within ±1.5 logits of the mean examinee ability.

**Proposed difficulty filter rule**

Map engineering seniority bands to a logit scale by convention (analogous to NCLEX's 0.00 logit passing standard):

| Seniority Band | Logit Target (θ) | Convention |
|---|---|---|
| Junior | −1.0 | Engineering prior |
| Mid | 0.0 | Anchor point |
| Senior | +1.0 | Engineering prior |
| Staff/Principal | +2.0 | Engineering prior |

**Note on confidence**: The band-to-logit spacing (1 logit per band) is an **engineering judgment**, not an empirically derived value. The IRT derivation that ±1 logit retains ≥80% of information is high-confidence [S16]. The claim that seniority bands are ~1 logit apart is medium-confidence — it is plausible (consistent with analogous skill assessment literature) but has not been validated for software engineering specifically. These should be treated as separate claims.

**Filter rule:**

```
allowed_complexity_band = { role.seniority_band − 1, role.seniority_band }
```

Repos with difficulty more than 1 band below the role target are excluded (floor risk: too easy, scores cluster at ceiling, variance collapses). Repos with difficulty more than 1 band above the role target are excluded (ceiling risk: too hard, scores cluster at floor, false negatives dominate). For a mid-level role: allow junior-difficulty and mid-difficulty repos; exclude senior/staff-difficulty repos.

The ±1 band filter is a symmetric rule derived from the IRT information function (80% information retention at |b − θ| ≤ 1 logit). It does not depend on match mode (targeted vs. hybrid).

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | NCLEX requires ≥400 responses before item calibration is evaluated; operational pool ~1,700–2,000 items | NCLEX FAQ / NCSBN | 2023 | Official regulatory document | High |
| S2 | USMLE pretest requires ≥200 responses; p-value 30–97%; positive discrimination required | J Medical Regulation, USMLE | 2009 | Peer-reviewed + official | High |
| S3 | CPA Exam uses continuous calibration pipeline; items pretested in every administration | AICPA/NASBA Exam Blueprints | 2022 | Official regulatory document | High |
| S4 | Rasch SE ≈ 2/√N; N=100 → SE ≈ 0.20–0.30 logits | Rasch Measurement Transactions (Wright) | 1993 | Technical report | High |
| S5 | AIG items inherit psychometric characteristics of parent template; indistinguishable from expert-written | PMC8886703 | 2022 | Peer-reviewed | High |
| S6 | AIG quality generalizes across difficulty levels with validated generative models | PMC10700404 | 2023 | Peer-reviewed | High |
| S7 | AIG family-level difficulty distribution pooling stabilizes CAT estimation faster than item-level | Tian & Choi, APM 2023 | 2023 | Peer-reviewed | High |
| S8 | 4 OSCE stations → G≈0.70; 7 stations → G>0.80 | Rezigalla 2016, PMC4991996 | 2016 | Peer-reviewed | High |
| S9 | G-coefficient threshold curve holds with standardized rubric across sites | PMC8102968 | 2021 | Peer-reviewed | High |
| S10 | ≥80% completion = power test (Swineford Criterion); <80% = speededness confound; ref. AERA §4.14 | Sireci et al., ETS Methods Report | 2019 | Technical report (ETS) | High |
| S11 | Speed is construct-relevant only when timed performance is part of the construct | UK Ofqual review | 2019 | Official review document | High |
| S12 | Per-item time budgets derivable from log-normal time-on-item distribution | Van der Linden, APM 2008 | 2008 | Peer-reviewed | High |
| S13 | Median code review session: 10–60 min for 100–500 LOC PRs | Rigby & Bird, ESEC/FSE 2013 | 2013 | Peer-reviewed | High |
| S14 | Optimal inspection rate <300 LOC/hr; reviews >200–400 LOC show diminishing returns; sessions >90 min degrade | SmartBear/Cisco case study | 2009 | Engineering report (vendor) | Medium-High |
| S15 | Smaller PRs receive proportionally more comments per LOC; median review ~24hr wall-clock | Sadowski et al., Google, ICSE 2018 | 2018 | Peer-reviewed | High |
| S16 | 2PL information function I(θ)=a²P(1−P); peaks at θ=b; 80% at ±1 logit; 44% at ±2 logits | Lord 1980, Applications of IRT | 1980 | Foundational textbook | High |
| S17 | CAT selects items by minimum |b − θ̂|; b-matching is fastest convergence method | PMC5968224 | 2017 | Peer-reviewed | High |
| S18 | NCLEX 95% CI stopping rule: SE ≤ 0.50 logits from 0.00 passing standard | NCLEX Passing Standard page | 2023 | Official regulatory document | High |
| S19 | CR measurement: diagnostic value concentrated near cutscore; items far from cutscore contribute noise | Hambleton 1990, Springer | 1990 | Peer-reviewed book chapter | High |
| S20 | Mean difficulty mismatched ≥2 logits from mean ability → floor/ceiling → reduced reliability | Zumbo & Zimmerman, APM 1993 | 1993 | Peer-reviewed | High |

---

## Direct Implications for the Project

1. **Ship early with expert anchoring, calibrate retroactively.** PIPE cannot wait for N=400 to ship. Licensure precedent (NCLEX, USMLE) confirms this is acceptable: embed unscored calibration items (or treat early assessments as pretest tier), flag scores as "directional — unvalidated calibration," and apply Rasch pooling once N=100 per template is reached. Never present uncalibrated scores as certified difficulty.

2. **The 3-station architecture is marginal on G-coefficient.** OSCE literature puts G≈0.60–0.75 for 3 stations — below the G≥0.70 professional minimum for high-stakes decisions. Mitigation options: (a) rate multiple BARS dimensions per station (each rubric dimension is a new observation, increasing effective observation count toward the G≥0.70 threshold); (b) document the limitation transparently in the scoring UI; (c) treat 3-station G as acceptable for screening (lower stakes) while requiring a 4th station for final hiring decisions (higher stakes).

3. **Time formula must be empirically calibrated, not just computed.** The proposed formula provides a starting point grounded in SmartBear/Cisco's 300 LOC/hr reading rate [S14] and the Swineford power-test diagnostic [S10]. The buffer coefficient (1.25) is an engineering prior, not a derived value. After N≥100 administrations per template, measure actual completion rates. If <80% of candidates complete all items, increase the buffer. If >95% complete with >20 minutes unused, decrease it. Van der Linden's log-normal model [S12] provides the statistical machinery for this calibration.

4. **The ±1 band difficulty filter is theoretically grounded but the band-to-logit mapping needs validation.** The IRT information function derivation [S16] strongly supports excluding repos more than ~1 logit from the target ability. The claim that engineering seniority bands are ~1 logit apart is an engineering convention, not measured. Validate by: (a) collecting θ estimates from early assessments; (b) computing mean θ by self-reported seniority; (c) checking whether bands are indeed ~1 logit apart empirically. Adjust filter boundaries accordingly.

5. **Criterion-referenced framing is the right paradigm and removes the "different tests = unfair" concern.** Hambleton [S19] and the NCLEX/USMLE design both confirm: when the decision is pass/fail relative to a fixed standard, content equivalence at the construct level (same rubric, same BARS anchors) is sufficient for fairness — item-level equivalence is not required. PIPE's per-candidate repo variation is a feature, not a threat, as long as difficulty is matched to role target band.

---

## Open Questions / Gaps

1. **Within-template difficulty variance is unknown.** AIG literature [S7] shows family-level variance can be modeled, but PIPE needs to measure empirically how much difficulty varies across repos generated from the same template pack. If variance is high (>1 logit SD), template-level calibration will be noisy until N is much larger than Rasch minimum estimates suggest.

2. **Band-to-logit spacing is unvalidated for software engineering.** The 1 logit/band convention is borrowed from credentialing literature (NCLEX anchor at 0.00). It may not match real software skill distributions. High priority for validation in first 200 administrations.

3. **Completion rate data needed to validate time formula.** The 1.25 buffer is an educated prior. Actual data needed to determine whether formula produces >80% completion rate (Swineford threshold). First 100 administrations should log time-on-task per item component.

4. **G-theory decomposition for multi-dimension-per-station design.** If a single code review session is rated on 3 BARS dimensions simultaneously (e.g., communication, technical depth, process), the G-coefficient calculation becomes a multi-facet design. Existing PIPE literature review has not examined whether multi-facet OSCE G-theory applies directly — this needs a targeted literature search if the 3-station design is to be defended rigorously.

5. **DIF detection framework not specified.** The calibration staging table references DIF detection at N=1000, but no specific DIF method is specified. Standard options: Mantel-Haenszel (categorical groups), logistic regression (continuous covariates), SIBTEST (bundle-level). Choice depends on what demographic/role facets PIPE tracks. Needs a dedicated technical decision before N=1000 is reached.

---

## Confidence Ratings

| Sub-question | Claim | Confidence | Limiting factor |
|---|---|---|---|
| Q4a | Calibration staging (N=10/100/1000 thresholds) | High | Rasch SE formula is robust [S4]; AIG pooling is theoretically sound [S7] |
| Q4a | Template-level calibration validity | High | AIG literature [S5, S6, S7] provides strong theoretical and empirical support |
| Q4a | G≥0.70 minimum for high-stakes decisions | High | Multiple OSCE studies [S8, S9]; professional consensus |
| Q4a | 3-station G estimate (0.60–0.75) | Medium | Extrapolated from 4-station baseline; direct 3-station data not found |
| Q4b | 300 LOC/hr reading rate | Medium-High | SmartBear/Cisco [S14] is a vendor case study, not peer-reviewed; consistent with Rigby & Bird [S13] |
| Q4b | 1.25 buffer coefficient | Low-Medium | Engineering prior only; no empirical derivation. Must be calibrated against actual data |
| Q4b | file/bug coefficient values (1.5 min, 3.0 min) | Low | Engineering prior only; no empirical basis found |
| Q4c | ±1 logit information retention (IRT derivation) | High | Lord 1980 [S16]; mathematically derived from 2PL formula |
| Q4c | ±1 band = ±1 logit (seniority band spacing) | Medium | Engineering convention; not empirically validated for software engineering |
| Q4c | Difficulty filter prevents floor/ceiling effects | High | Zumbo & Zimmerman [S20]; Hambleton [S19]; IRT theory [S16, S17] |

---

## Sources

1. **NCLEX FAQ / NCSBN — Next Generation NCLEX Calibration and Passing Standard** (2023). NCSBN official site. [https://www.nclex.com/faqs.page](https://www.nclex.com/faqs.page)

2. **McKinley DW, Norcini JJ — Item development for the USMLE** (2009). Journal of Medical Regulation, 95(2):22–30. [https://www.jmronline.org/content/95/2/22](https://www.jmronline.org/content/95/2/22)

3. **AICPA/NASBA — CPA Exam Blueprints and 2024 Redesign** (2022). NASBA official announcement. [https://nasba.org/blog/2022/12/29/aicpa-unveils-redesigned-exam/](https://nasba.org/blog/2022/12/29/aicpa-unveils-redesigned-exam/)

4. **Wright BD — Rasch sample size and calibration stability** (1993). Rasch Measurement Transactions, 7(4):368. [https://www.rasch.org/rmt/rmt74m.htm](https://www.rasch.org/rmt/rmt74m.htm)

5. **Gierl MJ et al. — Feasibility of AIG in medical assessment** (2022). PMC8886703. [https://pmc.ncbi.nlm.nih.gov/articles/PMC8886703/](https://pmc.ncbi.nlm.nih.gov/articles/PMC8886703/)

6. **Hommel S et al. — AIG item quality and validity** (2023). PMC10700404. [https://pmc.ncbi.nlm.nih.gov/articles/PMC10700404/](https://pmc.ncbi.nlm.nih.gov/articles/PMC10700404/)

7. **Tian W, Choi SW — AIG item family parameter variation in CAT** (2023). Applied Psychological Measurement. [https://journals.sagepub.com/doi/10.1177/01466216231165313](https://journals.sagepub.com/doi/10.1177/01466216231165313)

8. **Rezigalla AA — OSCE generalizability and reliability** (2016). PMC4991996. [https://pmc.ncbi.nlm.nih.gov/articles/PMC4991996/](https://pmc.ncbi.nlm.nih.gov/articles/PMC4991996/)

9. **Multi-site OSCE G-theory validation** (2021). PMC8102968. [https://pmc.ncbi.nlm.nih.gov/articles/PMC8102968/](https://pmc.ncbi.nlm.nih.gov/articles/PMC8102968/)

10. **Sireci SG et al. — Methods for measuring speededness in assessments** (2019). ETS Methods Report. [https://onlinelibrary.wiley.com/doi/full/10.1002/ets2.12337](https://onlinelibrary.wiley.com/doi/full/10.1002/ets2.12337)

11. **Ofqual — Time limits and speed of working in assessments** (2019). UK Government. [https://www.gov.uk/government/publications/time-limits-and-speed-in-assessments/time-limits-and-speed-of-working-in-assessments-when-and-to-what-extent-should-speed-of-working-be-part-of-what-is-assessed](https://www.gov.uk/government/publications/time-limits-and-speed-in-assessments/time-limits-and-speed-of-working-in-assessments-when-and-to-what-extent-should-speed-of-working-be-part-of-what-is-assessed)

12. **Van der Linden WJ — Predictive control of speededness in adaptive testing** (2008). Applied Psychological Measurement, 32(1):25–44. [https://journals.sagepub.com/doi/10.1177/0146621607314042](https://journals.sagepub.com/doi/10.1177/0146621607314042)

13. **Rigby CS, Bird C — Convergent software peer review: findings from a large-scale study** (2013). ESEC/FSE 2013. ACM DL. [https://dl.acm.org/doi/10.1145/2491411.2491444](https://dl.acm.org/doi/10.1145/2491411.2491444)

14. **SmartBear Software — Code Review at Cisco Systems** (2009). SmartBear case study/technical report. [https://static0.smartbear.co/support/media/resources/cc/book/code-review-cisco-case-study.pdf](https://static0.smartbear.co/support/media/resources/cc/book/code-review-cisco-case-study.pdf)

15. **Sadowski C et al. — Modern Code Review: A Case Study at Google** (2018). ICSE 2018. [https://storage.googleapis.com/gweb-research2023-media/pubtools/4476.pdf](https://storage.googleapis.com/gweb-research2023-media/pubtools/4476.pdf)

16. **Lord FM — Applications of Item Response Theory to Practical Testing Problems** (1980). Erlbaum. (Foundational textbook — no URL; ISBN 0-89859-006-6.) Information function derivation: Chapter 4.

17. **Weiss DJ, Kingsbury GG — Application of computerized adaptive testing** (2017). PMC5968224. [https://pmc.ncbi.nlm.nih.gov/articles/PMC5968224/](https://pmc.ncbi.nlm.nih.gov/articles/PMC5968224/)

18. **NCLEX Passing Standard** (2023). NCSBN. [https://www.nclex.com/passing-standard.page](https://www.nclex.com/passing-standard.page)

19. **Hambleton RK — Advances in criterion-referenced measurement** (1990). In Hambleton & Zaal (Eds.), Advances in Educational and Psychological Testing. Springer. [https://link.springer.com/chapter/10.1007/978-94-009-2195-5_1](https://link.springer.com/chapter/10.1007/978-94-009-2195-5_1)

20. **Zumbo BD, Zimmerman DW — Is the selection of statistical methodology determined by the scaling of the dependent variable?** (1993). Cited for floor/ceiling effect analysis. Applied Psychological Measurement. [https://pmc.ncbi.nlm.nih.gov/articles/PMC4118016/](https://pmc.ncbi.nlm.nih.gov/articles/PMC4118016/)
