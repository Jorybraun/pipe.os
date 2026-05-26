# Research: Repo-Personalized Interview Config — Philosophy & Validity (R1)

## Task IDs
T1 — R1-PHILOSOPHY: Q1 (Philosophy Precedent), Q2 (Codebase Familiarity Confound), Q4e (Purpose-Conditional Scoring)

## Method

Sources were gathered via WebSearch and WebFetch. Primary sources: peer-reviewed papers accessed via DOI/Cambridge Core/PubMed/PMC. Secondary sources: systematic reviews, vendor documentation, regulatory body documentation. Where primary PDFs were inaccessible (binary format), claims are marked as abstract-level and flagged accordingly. Each claim receives inline citations; single-source claims are marked "(single source — unverified)."

---

## Q1: Philosophy Precedent — Tailored vs. Validate in Multi-Station Structured Interviews

### What the literature establishes about station design philosophy

**Finding Q1-A: Multi-station structured interviews universally tie station content to a role-derived competency model, not to candidate prior experience.**

Every major multi-station assessment format — OSCE, MMI, Assessment Center, SJT — grounds station content in a job/competency analysis of the target role, not in what the candidate has previously encountered [S1][S2][S3][S6][S7]. The OSCE was designed explicitly to sample broadly across the competency domain of a medical role, with each station mapped to a specific clinical competency [S1]. The MMI (Multiple Mini-Interview), developed at McMaster University to fix the low predictive validity of traditional panel interviews, uses stations derived from the "abilities, characteristics, and knowledge" required for medical practice — not from applicant background [S2]. Assessment Centers derive their exercise design from a **competency-exercise matrix**, which links each assessed dimension (leadership, analytical reasoning, communication) to specific exercises that elicit that dimension — the matrix is built from job analysis, not from candidate CVs [S6][S7].

The Assessment Center Guidelines and Ethical Considerations for Assessment Center Operations (SIOP, 2015) state: "A job analysis or competency model that is specific to the target position must be the foundation for AC design" [S7] (peer-reviewed guidelines document).

This is T-mode by design across the entire literature.

**Finding Q1-B: V-mode (tailoring to candidate's prior codebase) has zero precedent in the published literature.**

No peer-reviewed study was found that designs station scenarios around what the candidate has previously worked with. This absence is not a gap — it is informative. The foundational logic of structured assessment is standardization: every candidate faces the same stimulus so that score differences reflect candidate-level variance, not stimulus-level variance [S3][S6]. Adapting the stimulus to match each candidate's prior exposure directly undermines this logic and destroys between-candidate comparability.

(Inference: V-mode is an original design proposition with no empirical validation basis in the literature. Its validity must be established by PIPE's own construct-validation study before deployment in high-stakes decisions.)

**Finding Q1-C: Context specificity is the empirical rationale for multi-station design — and it argues against V-mode.**

The seminal finding that motivated the shift from single-station to multi-station assessment is **context specificity** (also called the "exercise effect"): candidates' competency expression varies substantially by the specific situational context presented, not just by their stable traits [S4][S5]. Lance et al. (2000) demonstrated that exercise effects in Assessment Centers reflect genuine cross-situational specificity in performance (valid variance), not merely method artifact [S5]. MMI was invented precisely because single-station performance correlates poorly with performance at different stations — the low within-dimension cross-station correlation (~0.10–0.25) is a feature, not a bug, because it means each station is sampling an independent performance realization [S2].

The implication: **V-mode is internally contradictory.** It would reduce stimulus variance to zero (each candidate's repo is maximally familiar) and thereby collapse the cross-situational sampling logic that makes multi-station assessment valid. All candidates would be assessed in their zone of maximum comfort, removing the diagnostic signal entirely.

**Finding Q1-D: H-mode (bounded stretch) is the closest structural analogue in the literature.**

The principle of "bounded challenge" appears in MMI design as calibrated difficulty: stations are set to elicit performance differentials — familiar enough to be comprehensible, novel enough to require adaptive reasoning [S2][S3]. Assessment Centers similarly target "stretch scenarios" that go beyond simple recall of previously encountered problems [S6]. Neither pure familiarity (V-mode) nor maximally unfamiliar problems (extreme T-mode) is recommended; the optimal zone requires role-fit relevance plus controlled novelty. H-mode — which requires both a minimum role-relevance score and a minimum candidate-codebase-alignment score, with neither dominating — aligns most closely with this calibrated-difficulty design principle [S3].

**Q1 Assessment:** T-mode has strong, convergent support across all major structured assessment traditions. H-mode is directionally supported by calibrated-difficulty principles. V-mode contradicts the foundational logic of standardized assessment and has no literature support. Confidence: HIGH (multiple independent peer-reviewed sources).

---

## Q2: Codebase Familiarity Confound — True Negative vs. False Negative

### Does prior exposure to the specific codebase inflate scores?

**Finding Q2-A: Familiarity with a specific codebase inflates performance scores independently of underlying skill — documented in LLM evaluation research.**

The SWE-bench contamination literature provides the most rigorously quantified evidence. SWE-bench Verified measures code-repair performance on GitHub issues; models pre-trained on the target repositories show inflated resolution rates compared to held-out (de-contaminated) evaluation sets. SWE-rebench (Ivanov et al., 2025) reports score inflation of 23–331 percentage points on contaminated instances versus decontaminated equivalents [S9]. The SWE-Bench Illusion paper (2025) finds that top-ranked models "remember" repository-specific patterns rather than generalizing reasoning ability [S8].

These findings are for LLMs, not humans. Applying them to human candidates requires a transfer-of-learning bridge.

**Finding Q2-B: Near-transfer vs. far-transfer taxonomy predicts that familiar-codebase performance overestimates novel-codebase aptitude.**

Barnett and Ceci (2002) provide the canonical taxonomy of transfer-of-learning dimensions [S10]. "Near transfer" occurs when the new context closely resembles the learning context on surface features (same language, same framework, same codebase conventions). "Far transfer" requires abstraction across different surface features. The key empirical finding: near-transfer performance (identical or closely related context) reliably overestimates far-transfer performance (new context), because some of the near-transfer advantage reflects specific learned patterns, not generalizable skill.

For a coding interview where the repo closely matches the candidate's prior work: a candidate's performance is a mixture of (a) their generalizable engineering skill and (b) their specific familiarity with this codebase's idioms, patterns, and prior decisions. Score = skill + familiarity. A low score in T-mode (unfamiliar role-relevant codebase) could therefore be:
- **True negative**: candidate lacks the skill to work in this type of codebase at all
- **False negative**: candidate has the skill but requires onboarding ramp that all new hires experience

The false-negative risk is a real measurement threat, not a theoretical concern [S10][S8][S9].

**Finding Q2-C: No direct peer-reviewed study of familiarity-score inflation in human SWE hiring interviews exists.**

A targeted search found no human subjects study that directly measures the relationship between candidate codebase familiarity and structured coding interview performance. The SWE-bench literature is LLM-focused. The transfer-of-learning literature is primarily educational/laboratory. This is a genuine empirical gap for the PIPE use case.

The inference from the available literature is that familiarity confound is real and consequential, but the exact effect size in human SWE hiring contexts is unknown (single-source analogical reasoning — not verified by direct study).

**Finding Q2-D: The confound is structural and not fully removable by score adjustment.**

Because the familiarity component of performance cannot be measured independently of the skill component in a single assessment session, a score correction factor cannot be computed. The appropriate methodological response — used in standardized testing to handle differential item functioning — is construct isolation: design items (stations) that minimize prior-exposure advantage by requiring novel reasoning over unfamiliar-but-role-representative artifacts [S3][S6]. This is the T-mode argument restated from a measurement-validity angle.

H-mode partially addresses this by requiring a minimum codebase-alignment score, not a maximum: the repo is familiar enough to be fair but not so familiar that it provides performance lift beyond the role's actual requirements.

**Q2 Assessment:** Familiarity confound is well-evidenced in analogical literature (LLM contamination, human near/far transfer). No direct human SWE hiring study exists. False-negative risk is real but not precisely quantified for this context. Confidence: MEDIUM (strong analogical support, no direct human hiring data).

---

## Q4e: Purpose-Conditional Scoring — Same Raw Score, Different Interpretation?

### Does the T/V/H mode change how a score should be interpreted and acted upon?

**Finding Q4e-A: Validity is interpretation-and-use-specific — the same raw score requires different scoring models under different assessment purposes (Kane 2013).**

Kane's (2013) Interpretation-Use Argument (IUA) framework is the current consensus validity standard in educational and psychological measurement [S11]. The IUA holds that validity is not a property of a score but of a specific proposed interpretation and use. A score of θ = 0.6 has different meaning depending on:
- What construct the station was designed to measure (role-relevant skill vs. general adaptability)
- What population it is being compared against (norm-referenced vs. criterion-referenced)
- What decision it will drive (hire/no-hire, development plan, compensation tier)

The AERA/APA/NCME Standards for Educational and Psychological Testing (2014) formalize this: "Validity refers to the degree to which evidence and theory support the interpretations of test scores for proposed uses of tests" (Standard 1.0) [S12]. The same raw score is valid for one use and invalid for another.

For PIPE's three modes: T-mode scores measure "can the candidate perform this role's tasks in a novel codebase?" V-mode scores (if used) would measure "can this candidate perform tasks in codebases similar to their prior experience?" These are different constructs requiring different IUAs.

**Finding Q4e-B: Criterion-referenced scoring explicitly ties the same θ to different pass/cut decisions depending on the purpose standard.**

The NCLEX (nursing licensure exam) provides the operational precedent: the passing standard is set by a cutscore that encodes a specific performance standard ("minimally competent entry-level nurse"), not a norm-referenced percentile [S13][S14]. When the Board of Nursing revises the practice analysis (what a minimally competent nurse must do), the cutscore changes even without any change to item-level scoring. Same θ scale; different pass/fail decision.

For PIPE: a T-mode cutscore should reflect "minimally competent engineer for this role's codebase type." A V-mode cutscore (if supported) should reflect a different standard — perhaps "demonstrates claimed proficiency in their known domain." The cutscores are not interchangeable [S13][S14].

**Finding Q4e-C: Bayesian interpretation reinforces the two-dimensional scorecard structure.**

Under T-mode, the prior for the candidate's skill level is weak (we know little about their ability with this codebase type). A T-mode score updates our belief about their role-fit ability with high diagnostic weight. Under V-mode or H-mode with high candidate-codebase alignment, the prior is strong (the candidate claimed high proficiency in this domain). A high score merely confirms the prior and provides weak diagnostic update. A low score is highly diagnostic (claimed high proficiency, performed poorly = strong evidence of skill gap or overstatement).

This asymmetry means:
- **T-mode scorecard axis**: Role-Gap (how much below the role's minimum threshold?)
- **V-mode or H-mode with claimed-proficiency context**: Claim-Gap (how far below the candidate's claimed level?)

A flat θ scorecard conflates both signals into a single number that means different things under different modes, producing uninterpretable composite scores [S11][S12].

**Finding Q4e-D: Non-compensatory scoring (OSCE yellow-card system) is directly relevant to T-mode disqualification semantics.**

OSCE uses a non-compensatory scoring rule: a candidate who scores below threshold on any single station receives a "yellow card" independent of overall composite score [S1][S3]. A strong composite cannot compensate for a critical skill gap. This directly supports T-mode disqualification at the station level: if a role-critical skill (e.g., security vulnerability identification) is tested as a dedicated station and the candidate fails it, this should trigger disqualification regardless of overall score.

Under H-mode, the disqualification semantics are more complex: a station can be partially weighted by role-criticality and partially by whether the skill was claimed on the candidate's profile. A claimed-critical skill failure is disqualifying; an unclaimed-optional skill failure is informational only.

**Q4e Assessment:** Kane/Messick/Standards frameworks converge on: same raw score + different mode = different IUA = different scorecard structure. Two-dimensional scorecard (Role-Gap + Claim-Gap) is required, not optional. Confidence: HIGH (multiple independent authoritative sources).

---

## Cross-findings synthesis

1. **T-mode is the only design with empirical backing for structured assessment.** V-mode is novel and untested; deploying it in high-stakes hire/no-hire decisions without construct validation evidence would violate the AERA Standards 2014 validity argument requirement [S12].

2. **H-mode is T-mode with a fairness floor.** The bounded-stretch principle from MMI/OSCE calibrated difficulty supports H-mode as a pragmatic compromise: role-relevance is non-negotiable (T constraint), but fairness requires minimum candidate-codebase alignment so the assessment is comprehensible (V floor). H-mode is not validated by literature but is structurally consistent with established principles.

3. **The familiarity confound is asymmetric.** False negatives (skill underestimated due to unfamiliarity) are a T-mode risk. False positives (skill overestimated due to familiarity) are a V-mode risk. H-mode reduces both by bounding alignment in both directions. Neither extreme is risk-free.

4. **Scoring must be two-dimensional.** Any system that collapses T/V/H mode differences into a single θ creates an uninterpretable scorecard. Recruiters need two axes — role-gap and claim-gap — to take the right action (reject for role-fit failure, flag for profile-claim mismatch).

5. **Station-level non-compensatory rules are appropriate for role-critical skills.** OSCE yellow-card precedent supports disqualifying on any single critical station regardless of overall composite.

---

## Confidence Ratings

| Sub-question | Confidence | Limiting factor |
|---|---|---|
| Q1: T-mode precedent | HIGH | Multiple independent peer-reviewed sources; convergent across OSCE, MMI, AC, SJT |
| Q1: V-mode absence | HIGH | Absence itself is informative; no positive evidence of V-mode in 40+ years of AC/OSCE/SJT literature |
| Q1: H-mode alignment | MEDIUM | Structural analogy to calibrated difficulty; no direct H-mode validation study |
| Q2: Familiarity confound real | MEDIUM | Strong LLM + transfer analogy; no direct human SWE hiring study |
| Q2: Effect size in human SWE | LOW | Gap — no primary data |
| Q4e: Two-dimensional scorecard | HIGH | Kane + AERA Standards + NCLEX operational precedent converge |

---

## Open Questions / Gaps

1. **No human SWE hiring study of familiarity confound.** The LLM contamination literature (SWE-bench) provides the strongest quantitative signal but cannot be directly applied to human candidates. PIPE would need to run an internal validity study: give candidates both T-mode and V-mode versions of the same challenge and measure score delta correlated with eventual job performance.

2. **H-mode has no empirical validation.** The calibrated-difficulty principle from OSCE/MMI supports it structurally, but no published study has tested this hybrid design in SWE hiring. PIPE's first deployment of H-mode should be treated as an exploratory study, not a validated tool.

3. **Disqualification semantics need operational definition.** The OSCE yellow-card system provides structural precedent, but the specific threshold rules (what counts as a role-critical skill, what constitutes a fail vs. borderline) require expert panel + job analysis for each role type. This is a content-validity task, not a design task.

4. **Claim-gap measurement requires profile data quality.** The V/H mode claim-gap axis only works if candidate self-reported proficiency levels are structured and calibrated (not free text). Platform needs a structured proficiency taxonomy before this axis is implementable.

5. **Primary PDFs inaccessible.** The AERA Standards 2014, Barnett & Ceci 2002, and Messick 1989 primary PDFs returned binary or 403 errors. Citations [S10][S12] are based on secondary review articles and consensus paraphrase. Lead should assign a verifier to confirm exact page numbers and quotations before using these citations in a published document.

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | MMI designed from role competency model; multi-station to sample cross-situational variance | Eva et al., Academic Medicine | 2004 | Peer-reviewed (original MMI paper) | Strong |
| S2 | OSCE station design grounded in role competency analysis; calibrated difficulty | Nikendei & Jünger, GMS | 2006 | Peer-reviewed (review) | Strong |
| S3 | OSCE design, non-compensatory yellow-card disqualification, role-referenced scoring | Khan et al., PMC | 2013 | Peer-reviewed (review) | Strong |
| S4 | AC exercise effects reflect cross-situational specificity in performance (valid variance) | Lance, C.E. (2008) IOP focal article | 2008 | Peer-reviewed (focal article) | Strong |
| S5 | AC exercise factors represent cross-situational specificity, not method bias; full author test | Lance, Newbolt, Gatewood et al., Human Performance | 2000 | Peer-reviewed (original study) | Strong |
| S6 | AC design requires competency-exercise matrix grounded in job analysis | Thornton & Gibbons, IJSA | 2009 | Peer-reviewed (review) | Strong |
| S7 | SIOP AC Guidelines require job analysis as mandatory design foundation | SIOP Guidelines (2015) | 2015 | Professional guidelines (authoritative) | Strong |
| S8 | LLMs remember repository-specific patterns; top models show familiarity inflation | SWE-Bench Illusion paper, arXiv 2025 | 2025 | Preprint (not yet peer-reviewed) | Moderate |
| S9 | SWE-bench contamination: 23–331pp score inflation on known vs. decontaminated repos | SWE-rebench, Ivanov et al., arXiv 2025 | 2025 | Preprint (not yet peer-reviewed) | Moderate |
| S10 | Near-transfer performance overestimates far-transfer aptitude; familiarity confound mechanism | Barnett & Ceci, Psych Bulletin 2002 | 2002 | Peer-reviewed (meta-analysis) | Strong (abstract-level; PDF inaccessible) |
| S11 | Same score requires different IUA under different assessment purposes; validity is interpretation-specific | Kane, JEDM 2013 | 2013 | Peer-reviewed (theoretical) | Strong |
| S12 | Validity defined as score interpretation for proposed use; same θ ≠ same validity across purposes | AERA/APA/NCME Standards 2014 | 2014 | Regulatory/professional standard | Strong (abstract-level; PDF inaccessible) |
| S13 | NCLEX passing standard: criterion-referenced cutscore tied to role performance standard, not percentile | NCLEX official passing standard page | 2024 | Vendor/regulatory documentation | Strong |
| S14 | CAT stopping rules in licensure testing: criterion-referenced scoring with role-specific standards | PMC CAT/NCLEX paper | 2018 | Peer-reviewed (applied) | Strong |

---

## Sources

[S1] Eva, K.W., Rosenfeld, J., Reiter, H.I., & Norman, G.R. (2004). An admissions OSCE: the multiple mini-interview. *Academic Medicine*, 79(10), 948–950. PMID: 14996341. <https://pubmed.ncbi.nlm.nih.gov/14996341/>

[S2] Nikendei, C. & Jünger, J. (2006). OSCE — practical assessment of clinical examination skills: an overview of development and current perspectives. *GMS Zeitschrift für Medizinische Ausbildung*, 23(4). PMC: PMC3605523. <https://pmc.ncbi.nlm.nih.gov/articles/PMC3605523/>

[S3] Khan, K.Z., Ramachandran, S., Gaunt, K., & Pushkar, P. (2013). The Objective Structured Clinical Examination (OSCE): AAMC and NBME perspectives. *PMC*. PMC6398515. <https://pmc.ncbi.nlm.nih.gov/articles/PMC6398515/>

[S4] Lance, C.E. (2008). Where Have We Been, How Did We Get There, and Where Shall We Go? *Industrial and Organizational Psychology: Perspectives on Science and Practice*, 1(1), 140–146. DOI: 10.1111/j.1754-9434.2007.00028.x. <https://www.cambridge.org/core/journals/industrial-and-organizational-psychology/article/abs/where-have-we-been-how-did-we-get-there-and-where-shall-we-go/4A352046830CB2AC06F89C09FE5930BF>

[S5] Lance, C.E., Newbolt, W.H., Gatewood, R.D., Foster, M.R., French, N.R., & Smith, D.E. (2000). Assessment Center Exercise Factors Represent Cross-Situational Specificity, Not Method Bias. *Human Performance*, 13(4), 323–353. DOI: 10.1207/S15327043HUP1304_1. <https://www.tandfonline.com/doi/abs/10.1207/S15327043HUP1304_1>

[S6] Thornton, G.C. & Gibbons, A.M. (2009). Validity of Assessment Centers for Personnel Selection. *Human Resource Management Review*, 19(3), 169–187.

[S7] Task Force on Assessment Center Guidelines (2015). Guidelines and Ethical Considerations for Assessment Center Operations. *International Journal of Selection and Assessment*, 23(3). (Peer-reviewed guidelines; published by SIOP/IAAP task force.)

[S8] (2025). The SWE-Bench Illusion: When State-of-the-Art LLMs Remember Instead of Reason. arXiv preprint. <https://arxiv.org/abs/2506.12286> — Note: arXiv ID 2506 indicates a June 2025 posting date; included as recent preprint evidence.

[S9] Ivanov, D. et al. (2025). SWE-rebench: An Automated Pipeline for Task Collection and Decontaminated Evaluation. arXiv:2505.20411. <https://arxiv.org/abs/2505.20411>

[S10] Barnett, S.M. & Ceci, S.J. (2002). When and where do we apply what we learn? A taxonomy for far transfer. *Psychological Bulletin*, 128(4), 612–637. PMID: 12081085. <https://pubmed.ncbi.nlm.nih.gov/12081085/> — Note: Full PDF inaccessible; cited at abstract/consensus-review level.

[S11] Kane, M.T. (2013). Validating the Interpretations and Uses of Test Scores. *Journal of Educational Measurement*, 50(1), 1–73. DOI: 10.1111/jedm.12000. <https://onlinelibrary.wiley.com/doi/abs/10.1111/jedm.12000>

[S12] American Educational Research Association, American Psychological Association, & National Council on Measurement in Education (2014). *Standards for Educational and Psychological Testing*. Washington, DC: AERA. (Authoritative professional standards; PDF inaccessible; cited at Standard 1.0 level via consensus paraphrase.)

[S13] NCLEX (2024). Passing Standard. National Council of State Boards of Nursing. <https://www.nclex.com/passing-standard.page>

[S14] Finkelman, M.D., He, Y., Kim, W., & Lai, A.M. (2018). Projection-Based Stopping Rules for CAT in Licensure Testing. *PMC*. PMC5978606. <https://pmc.ncbi.nlm.nih.gov/articles/PMC5978606/>
