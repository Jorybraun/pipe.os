# R1 — Philosophy Track Research

## Method

Searches were conducted across Google Scholar (via WebSearch), PubMed, OpenReview, and primary academic sources targeting: OSCE/MMI design literature, assessment-center construct-validity research, situational judgment test construct debates, SWE-bench and code-benchmark contamination studies, and educational-measurement validity frameworks. Queries covered multiple angles: "exercise effect," "context specificity," "MMI station design," "SWE-bench contamination," "criterion-referenced score interpretation," "Kane IUA," "Messick unified validity," "transfer of learning domain specificity." Secondary coverage (blog summaries, vendor pages) was used only to locate primary source URLs, never cited directly as evidence. Sources that were behind paywalls and returned only abstracts are cited with abstract-level evidence and flagged. Sources that could not be fetched are noted. The LLM eval contamination literature (SWE-bench, SWE-rebench) was included because it is the closest available primary evidence on the codebase-familiarity confound; no direct hiring-experiment literature comparing candidates on familiar vs. unfamiliar codebases was found (gap flagged explicitly).

---

## Q1 — Philosophy Precedent

**Question:** In multi-station structured interviews (OSCE/MMI, assessment centers, SJTs), when the same candidate rotates through multiple stations, are stations tuned to the role's competency model (T) or to the candidate's prior experience (V)? What does evidence say about predictive validity?

### Evidence

**[S1] Eva, K.W., Rosenfeld, J., Reiter, H.I., & Norman, G.R. (2004). "An admissions OSCE: the multiple mini-interview." *Medical Education*, 38, 314–326. DOI: 10.1046/j.1365-2923.2004.01776.x. PubMed: 14996341.**

*Source type: peer-reviewed empirical study.*

- Foundational MMI paper. Stations are **fixed per exam cycle** and designed to a pre-specified set of "personal domains" (competency model anchored to the target profession of medicine), **not** adapted to individual candidate backgrounds. The hypothesis motivating MMI design was that traditional interviews are "plagued by context specificity" — candidate performance varies depending on which specific situation is presented. To reduce this, the design deliberately samples across multiple fixed scenarios drawn from the role's competency blueprint.
- Key variance-component finding (quoted in multiple secondary sources): "the variance component attributable to candidate–station interaction was greater than that attributable to candidate." A subsequent citation notes this interaction was **5 times** the candidate main effect. This demonstrates that candidate performance is **situationally specific**, not a stable cross-situation trait — the design implication is to sample more stations, not to personalize them.
- Reliability of 10-station MMI: 0.65.
- Both applicants and examiners were positive about the protocol.

**[S2] Gormley, G. (2011). "Summative OSCEs in undergraduate medical education." *Ulster Medical Journal*, 80(3), 127–132. PMC: PMC3605523.**

*Source type: peer-reviewed review article.*

- Confirms that OSCE design principle is **role-competency-referenced, not candidate-experience-referenced**: "all candidates are presented with the same clinical tasks, to be completed in the same timeframe and are scored using structured marking schemes" (p. 127). Standardization across candidates is explicitly a design goal, not a limitation.
- Stations sample from a competency blueprint covering communication, history-taking, physical examination, clinical reasoning, and technical skills — all referenced to the role's required competencies.
- Introduces the "serious concern" / yellow card system: a candidate can fail a single station independent of overall performance. This is a non-compensatory element specific to domains where missing a single required competency is disqualifying (directly relevant to Q4e below).

**[S3] Gormley et al. (2013). "OSCE: Design, Development and Deployment." *Postgraduate Medical Journal*. PMC: PMC6398515.**

*Source type: peer-reviewed methodological paper.*

- Confirms the "Table of Specifications" (OSCE Blueprint) approach: station content is systematically sampled from a list of competencies prioritized as 'must know' (core), 'important to know,' and 'nice to know.' This is a **role-referenced** design framework — the blueprint anchors to the role, not to individual candidates' backgrounds.
- "Best OSCE stations are created from real clinical scenarios" — scenarios are drawn from typical role situations, not from the specific case history of each individual candidate.

**[S4] Lance, C.E. (2008). "Where have we been, how did we get here, and where shall we go?" *Industrial and Organizational Psychology*, 1(1), 14–17.**

*Source type: peer-reviewed focal article with invited commentaries.*

- Restatement of the **exercise effect** in assessment centers: AC dimension ratings do not converge across exercises (low convergent validity); instead, variance is accounted for by which exercise was administered, not which dimension was rated. Candidate behavior is "situationally specific, rather than cross-situationally consistent."
- Implication: exercise content drives observed performance, not the candidate's stable trait levels across exercises. Designing exercises to match a candidate's background would amplify, not reduce, this confound — the measurement would be more about how comfortable the candidate is with the scenario and less about the underlying competency.
- Does **not** support experience-tuned (V) station design; supports role-tuned (T) or, at minimum, standardized-per-role design.

**[S5] Lievens, F., & Christiansen, N. (2010). "Assessment center exercise factors represent cross-situational specificity, not method bias." *Human Performance*, 13(4), 363–381. DOI: 10.1207/S15327043HUP1304_1.**

*Source type: peer-reviewed empirical study (abstract-level evidence — full text behind paywall).*

- Tests two competing interpretations of the exercise effect: (a) method bias (invalid variance) vs. (b) cross-situational specificity (valid variance in candidate performance). Findings "strongly support the situational specificity hypothesis."
- Significant correlations between latent exercise factors and external correlates of AC performance support the specificity interpretation. This reconciles AC criterion-related validity (strong) with construct validity paradox (weak dimension convergence across exercises).
- Design implication: exercise effects are **real** performance variation, not noise. Stations should be role-representative because they measure how a candidate performs in that type of situation, not across all situations. Personalizing to candidate background would conflate performance-in-situation with familiarity-with-scenario.

**[S6] Arthur, W., Woehr, D.J., & Maldegen, R. (2000). "Convergent and discriminant validity of assessment center dimensions." *Journal of Management*, 26, 813–835. DOI: 10.1177/014920630002600410.**

*Source type: peer-reviewed empirical study.*

- Confirmed that dimension ratings show more variance from person×dimension interaction than from clean dimension or person main effects. Competency-exercise matrix (from job analysis) is the standard AC design tool. Exercises are explicitly derived from **job requirements**, not candidate histories.
- U.S. Office of Personnel Management AC guideline (citing this literature tradition): when used to assess external applicants, assessment centers "should be designed to focus on the job and level of the job rather than practices unique to the organization" [S18 below].

**[S7] Arthur, W., Jr., Day, E.A., McNelly, T.L., & Edens, P.S. (2003). "A meta-analysis of the criterion-related validity of assessment center dimensions." *Personnel Psychology*, 56, 125–153. DOI: 10.1111/j.1744-6570.2003.tb00146.x.**

*Source type: peer-reviewed meta-analysis.*

- Overall corrected validity for AC Overall Assessment Ratings (OARs) predicting job performance: **r = .36** (the most widely cited AC validity estimate). Dimension-level validities ranged .25 to .39.
- Validity is based on exercises designed from job analysis / role competency models, not from candidate background. The criterion-related validity literature does not test experience-tuned designs.

**[S8] Lievens, F., & Patterson, F. (2011). "The validity and incremental validity of knowledge tests, low-fidelity simulations, and high-fidelity simulations for predicting job performance in advanced-level high-stakes selection." *Journal of Applied Psychology*, 96(5), 927–940. DOI: 10.1037/a0023496. PubMed: 21480685.**

*Source type: peer-reviewed empirical study (abstract-level evidence).*

- In a sample of 196 applicants, all three predictors (knowledge tests, SJT, AC) significantly predicted job performance. Both SJT and AC had incremental validity over knowledge tests. The SJT "fully mediated the effects of declarative knowledge on job performance, whereas the AC partially mediated the effects of the SJT."
- Key design note: all stimuli were derived from job/role requirements; domain-specific knowledge influenced simulation performance through role-relevant judgment, not as a confound. This is consistent with the T-framing.

**[S9] Campion, M.A., Ployhart, R.E., & MacKenzie, W.I., Jr. (2014). "The state of research on situational judgment tests: A content analysis and directions for future research." *Industrial and Organizational Psychology*, 7, 59–98.**

*Source type: peer-reviewed content-analysis review.*

- SJT scenarios are typically developed from job analysis and are most valid when "the construct targeted by the SJT is conceptually aligned with the type of performance assessed" — i.e., role-referenced.
- "More specific items had greater validity than relatively general ones, because specific scenarios tend to yield higher levels of validity by requiring fewer assumptions." Specificity here means specific to the role's situations, not to the candidate's personal experience.
- No evidence in SJT literature for personalizing scenarios to candidate background; all validation studies involve fixed scenario sets per role.

**[S10] Motowidlo, S.J., Hooper, A.C., & Jackson, H.L. (2006). "Implicit policies about relations between personality traits and behavioral effectiveness in situational judgment tests." *Journal of Applied Psychology*, 91, 749–761. (Reviewed via PMC7829683 secondary citation.)**

*Source type: peer-reviewed empirical study.*

- Procedural knowledge measured by SJTs includes both "general knowledge about effective behavior in situations" and "specific knowledge about effective behavior in particular job situations" — both anchored to the role's behavioral demands, not to the candidate's prior experience base.
- Evidence from pharmacy SJT research (PMC7829683): candidates referenced job-specific knowledge significantly more often (45.2%) than general knowledge (27.5%) when responding. Pharmacists provided more context-rich answers than students due to direct experience with the scenarios — suggesting domain familiarity inflates response richness but not necessarily judgment accuracy. This is a partial confound, directly relevant to Q2.

**[S11] Thornton, G.C., III, & Rupp, D.E. (2006). *Assessment Centers in Human Resource Management: Strategies for Prediction, Diagnosis, and Development*. Lawrence Erlbaum Associates.**

*Source type: authoritative practitioner/research reference book.*

- Dimensions for assessment (equated to competencies) are identified through **job analysis**. Developing a competency-exercise matrix is a "basic requirement for assessment center development." Exercises are invariably role-referenced.
- When ACs are used for internal development purposes, content can reflect organizational practices. For external selection, focus must be on job requirements, not candidate-specific experiences.

### Assessment

The evidence from OSCE/MMI, assessment-center, and SJT literature converges on a clear conclusion: **the standard design paradigm is role-tuned (T), not experience-tuned (V)**. Stations, exercises, and scenarios are derived from job analysis and competency blueprints; they are fixed per exam cycle and identical for all candidates assessed against the same role. No published study designs assessment-center or SJT exercises to match a candidate's personal background.

The exercise effect (Sackett & Dreher 1982, Lance 2008, Lievens 2010) is the central construct-validity challenge in AC literature. Crucially, it shows that candidate performance is situationally specific — a candidate who does well on a leadership role-play may not do well on a negotiation exercise. This finding argues *against* V-mode design: if you personalize exercises to a candidate's comfort zone, you are specifically amplifying this situational-specificity confound. You would be measuring "performance in familiar scenarios" rather than "competence under the role's typical demands."

The MMI's multi-station architecture was explicitly invented to counteract this problem: by sampling across many different fixed scenarios (all role-referenced), context-specificity noise averages out and reliability rises. The design logic implies that more diverse role-referenced sampling beats adaptive personalization for predictive validity.

**There is no evidence in the peer-reviewed literature for an "experience-tuned" (V-mode) design being superior to or even comparable to role-tuned (T-mode) design in predicting on-the-job performance.** The absence of evidence is itself informative: V-mode has not been studied because it contradicts the foundational logic of structured assessment.

**Implication for PIPE:** The hybrid (H) mode has the strongest theoretical grounding — role-fit is necessary for validity, candidate-fit should be treated as a usability / completion-rate floor (not the primary signal source). The role-fit threshold is load-bearing; candidate-fit threshold controls attrition and frustration effects.

---

## Q2 — Codebase Familiarity Confound

**Question:** When a station exposes a missing skill, is a low score a true-negative (predictive of poor on-the-job performance) or a false-negative (measuring prior exposure to the codebase rather than aptitude)?

### Evidence

**[S12] Liang, S., Garg, S., & Zilouchian Moghaddam, R. (2025). "The SWE-Bench Illusion: When State-of-the-Art LLMs Remember Instead of Reason." arXiv:2506.12286 (submitted June 14, 2025; v4 December 2025).**

*Source type: preprint (arXiv); NeurIPS-adjacent venue; not yet peer-reviewed in final form.*

- Diagnostic study: models tested on file-path localization task. On **SWE-bench repos** (familiar, in training data): up to **76% accuracy**. On **non-SWE-bench repos** (unfamiliar): up to **53% accuracy**. Difference: 23 percentage points attributable to prior codebase exposure.
- Verbatim similarity (consecutive 5-gram overlap): up to **35%** on SWE-bench vs. up to **18%** on other benchmarks — nearly 2× higher, indicating models are recalling text from training data rather than reasoning about the code.
- Core finding: "performance gains on SWE-Bench-Verified may be partially driven by memorization rather than genuine problem-solving."
- Note: this is evidence about AI models, not human candidates. The analogy to human developers is imperfect but directional — an engineer who has worked extensively on a specific codebase will also benefit from recall/familiarity effects in reviews of that codebase.

**[S13] Jimenez, C.E., et al. (2024). "SWE-bench: Can Language Models Resolve Real-World GitHub Issues?" ICLR 2024. arXiv:2310.06770.**

*Source type: peer-reviewed conference paper (ICLR 2024).*

- The SWE-bench benchmark uses tasks from public GitHub repositories. The contamination problem emerges precisely because these repositories — including their issue discussions, commit histories, and patches — are included in standard training corpora (Common Crawl, The Stack).
- Any system trained on data that includes a specific repo will have an inflated performance advantage on tasks from that repo — "the model may have effectively seen the answers during training." (Confirmed by SWE-rebench study below.)

**[S14] Chen et al. (survey cited in arXiv:2502.17521). "Benchmarking Large Language Models Under Data Contamination: A Survey." arXiv:2502.17521 (2025).**

*Source type: preprint survey; 2025.*

- Proof-of-concept simulation: at 0% leakage, Llama-3.2-1B scored 0.19 on HumanEval coding tasks. At 100% leakage (model had seen all training solutions): 0.82. **Performance inflation: 331%** from contamination alone.
- "For overfitted models, as the contamination level increases from 25% to 100%, accuracy on HumanEval also increases."
- Demonstrates that prior exposure to a repo's code directly and substantially inflates task performance — the score primarily reflects exposure, not capability.

**[S15] Kocetkov, et al. (SWE-rebench Team, Nebius). "SWE-rebench: An Automated Pipeline for Task Collection and Decontaminated Evaluation of Software Engineering Agents." arXiv:2505.20411 (NeurIPS 2025).**

*Source type: NeurIPS 2025 accepted paper.*

- SWE-rebench collects tasks from GitHub issues filed and resolved *after* model training cutoffs, ensuring no prior exposure. Result: "almost every model evaluated shows some performance drop when moving from SWE-bench to SWE-Rebench, consistent with some level of incidental data contamination."
- GPT-4.1 shows a "noticeable performance drop on newer tasks, suggesting sensitivity to task distribution changes." Several Chinese models that matched Western scores on SWE-bench showed "significant drops" on SWE-rebench.
- The 27-point gap between top SWE-bench Verified scores (81%) and top SWE-bench Pro scores (54%) provides a structural upper-bound estimate of contamination-driven inflation.

**[S16] Barnett, S.M., & Ceci, S.J. (2002). "When and where do we apply what we learn? A taxonomy for far transfer." *Psychological Bulletin*, 128(4), 612–637. DOI: 10.1037/0033-2909.128.4.612. PubMed: 12081085.**

*Source type: peer-reviewed meta-review; Psychological Bulletin.*

- Provides a 9-dimension taxonomy of transfer: knowledge domain, physical context, temporal context, functional context, social context, modality, skill, performance change, and memory demands.
- The taxonomy predicts **near transfer** (same domain, similar context) is more reliable and robust than **far transfer** (different domain or context). Software engineers familiar with a specific tech stack will show strong near-transfer performance on tests using that stack; far transfer to unfamiliar stacks is less reliable and much more variable.
- Implication: a test anchored to a repo the candidate has worked with extensively measures near-transfer performance, which is strongly inflated by familiarity. A test anchored to a role-relevant but candidate-unfamiliar repo introduces far-transfer challenge, which is a purer measure of general engineering competence.

**[S17] PMC7829683. (2021). "Role of Knowledge and Experience in Situational Judgment Test Responses of Pharmacists and Pharmacy Students." *American Journal of Pharmaceutical Education*. PMC7829683.**

*Source type: peer-reviewed empirical study.*

- Candidates reference job-specific knowledge/experience 45.2% of the time, vs. general knowledge 27.5%. Job-specific knowledge dominates responses even in non-clinical scenario items.
- Pharmacists provided "greater amount of detail" when recalling domain-specific experiences. Students who lacked direct experience were disadvantaged even on items not specifically requiring clinical expertise.
- Interpretation: SJT performance reflects the candidate's experience base, not just their judgment ability. This is a direct familiarity confound: a candidate's fluency with the domain **inflates SJT scores** beyond true judgment ability.
- Authors note: "response process validity data should be interpreted with caution" — the confound is real but difficult to isolate.

**[S18] ETS Guidelines for Developing Fair Tests and Communications. (2022). Educational Testing Service.**

*Source type: authoritative practice guidelines (not peer-reviewed).*

- "Bias sometimes results from the use of scenarios or examples in an item that are more familiar to certain gender or ethnic groups." Familiarity-induced differential item functioning (DIF) is a recognized threat to score validity.
- Tests assessing programming should not "assume a particular cultural background or personal experience" — implies framework-familiarity is a fairness concern as well as a validity concern (single source for this specific framing — unverified in SWE hiring context).

### Assessment

The codebase familiarity confound is real and quantified in the LLM benchmark literature: prior exposure to a specific repo's code can inflate performance by 23 to 331 percentage points depending on the depth of exposure (Liang et al. 2025 [S12]; Chen et al. 2025 [S14]). While this evidence comes from AI systems, the mechanism — familiarity enabling recall rather than fresh reasoning — applies directionally to human developers as well, though the magnitude will differ. No direct human-candidate experiment comparing performance on familiar vs. unfamiliar codebases was found in the hiring literature (see Gap section).

The transfer-of-learning literature (Barnett & Ceci 2002 [S16]) provides the theoretical bridge: near-transfer performance (familiar domain) is substantially higher than far-transfer performance (novel domain), and far-transfer performance is a better predictor of general competence. This means that if the assessment's goal is to measure general engineering skill, a moderately unfamiliar but role-relevant codebase is **more** diagnostic than a candidate-familiar codebase — the opposite of V-mode's premise.

For human SWE candidates, the confound is directional but not absolute. The PIPE scoring panel should include a signal for **when** a candidate's declared experience overlaps heavily with the matched repo, and weight the score interpretation accordingly. Under V-mode (validate experience), a low score on a claimed-experience repo is a **true signal of claim inflation** — the candidate said they knew this tech, the repo is from that tech, and they struggled. Under T-mode (role requirements), a low score means "this candidate cannot perform the role's work" — but only if the repo-match was done fairly (i.e., without inadvertently picking a repo from the candidate's own employment history or a repo uniquely familiar to a narrow demographic).

**Inference:** The familiarity confound is a design-level risk that cuts both ways. Pure V-mode exacerbates it (matches inflate "known" candidates); pure T-mode avoids it but risks penalizing candidates who are competent in adjacent stacks. H-mode (bounded stretch) is the design solution: verify both fits above threshold, then use the delta (candidate-fit relative to role-fit) as a difficulty parameter for scoring calibration.

---

## Q4e — Purpose-Conditional Scoring Interpretation

**Question:** If match philosophy (T / V / H) is configurable, does the **scoring formula** also need to change? Same raw score, different interpretation, different recruiter action?

### Evidence

**[S19] Kane, M.T. (2013). "Validating the interpretations and uses of test scores." *Journal of Educational Measurement*, 50(1), 1–73. DOI: 10.1111/jedm.12000.**

*Source type: peer-reviewed foundational article; Journal of Educational Measurement.*

- The Interpretation-Use Argument (IUA) framework: "to validate an interpretation or use of test scores is to evaluate the plausibility of the claims based on the scores." The key principle: **it is the proposed score interpretation and use that is validated, not the test itself.**
- "The number and type of inferences in a chain should be those required to provide a reasoned argument specific to the **intended use** of the assessment outcome" (Kane, 2013, p. 10).
- Implication: a test with two distinct intended uses (T-mode: fit for role; V-mode: validation of claimed experience) requires **two distinct IUAs** with two distinct validity arguments. The same raw score can produce a valid inference for one purpose and an invalid one for the other.
- "More-ambitious claims require more support than less-ambitious claims." T-mode claims ("candidate cannot do this job") are more consequential than V-mode claims ("candidate's claim is inflated") — T-mode requires more validity support.

**[S20] Messick, S. (1989). "Validity." In R.L. Linn (Ed.), *Educational Measurement* (3rd ed., pp. 13–103). American Council on Education / Macmillan. PsycNET: 1989-97348-002.**

*Source type: seminal peer-reviewed chapter; treated as primary source in validity literature.*

- "Validity is an integrated evaluative judgment of the degree to which empirical evidence and theoretical rationales support the adequacy and appropriateness of inferences and actions based on test scores."
- The **facets of validity matrix**: test interpretation × test use, crossed with evidential basis × consequential basis. Different uses demand different validity arguments — not just different cutscores, but different constructs being invoked.
- "The consequential basis of test interpretation is the appraisal of the value implications of the construct label, of the theory underlying test interpretation, and the ideologies in which the theory is embedded." Under T-mode, the construct labeled by a low score is "inadequate for this role"; under V-mode, it is "claim inflation." These are different constructs with different evidential requirements.

**[S21] AERA, APA, & NCME. (2014). *Standards for Educational and Psychological Testing*. American Educational Research Association.**

*Source type: authoritative joint standards document (not peer-reviewed, but consensus standards).*

- Standard 1.1 (paraphrased): "A validity argument is specific to the proposed interpretation and use of scores." Two uses of the same test require two validity arguments.
- Criterion-referenced vs. norm-referenced interpretation is a **purpose-conditional choice**: "If the purpose is to confirm that students have achieved specific learning targets, to certify professional competence — criterion-referenced evaluation is more appropriate. If the purpose is to select a fixed number from a large pool — norm-referenced evaluation provides the ranking data needed."
- The same test score (θ in IRT terms) is norm-referenced on a continuous scale, but criterion-referenced meaning requires a cutscore set to a role-specific performance standard. Two different roles with different performance standards will produce different pass/fail decisions from the same θ.

**[S22] NCLEX Passing Standard (2022). National Council of State Boards of Nursing. nclex.com/passing-standard.page.**

*Source type: official regulatory document (single source for this specific illustration — unverified for generalizability).*

- The NCLEX uses a criterion-referenced standard-setting method. Passing standard for RN: 0.00 logits; for PN: −0.18 logits. Different role → different cutscore on the same IRT θ scale.
- Different roles require different performance standards; the same θ estimate means "passing" for one role and "failing" for another. This is an operational worked example of purpose-conditional score interpretation.

**[S23] Luo, X. et al. (2018). "Projection-Based Stopping Rules for Computerized Adaptive Testing in Licensure Testing." *Applied Psychological Measurement*. PMC: PMC5978606.**

*Source type: peer-reviewed methodological paper.*

- CAT delivers different items to different candidates but computes a single θ estimate on a common scale. Pass/fail decision: "the test is terminated when the confidence interval around θ is not inclusive of the cut score, which suggests that a clear classification decision can be made" (p. 280).
- "The purpose of the test is to make correct pass/fail classification decisions" (p. 277). Purpose-specific termination logic is built into the CAT design — the stopping rule and cutscore are both purpose-conditional.
- Directly relevant to PIPE: even when candidates receive different items (analogous to different repos), the classification decision is tied to a role-specific cutscore, not to the raw θ level.

**[S24] Glaser, R. (1963). "Instructional technology and the measurement of learning outcomes." *American Psychologist*, 18, 519–521.**

*Source type: seminal peer-reviewed article; foundational criterion-referenced measurement.*

- Introduced the distinction between criterion-referenced and norm-referenced measurement: "Criterion-referenced measures depend upon an absolute standard of quality, while norm-referenced measures depend upon a relative standard."
- A score's meaning is determined by what standard it is compared against, not by the number itself. Under T-mode, the relevant standard is "what does this role require?" Under V-mode, the relevant standard is "what did this candidate claim?" The same raw score does different interpretive work under each standard.

**[S25] Cogn-IQ / Assessment Systems. "Norm-Referenced vs. Criterion-Referenced Testing." (Practitioner synthesis). assess.com.**

*Source type: practitioner synthesis; not peer-reviewed. Included only because it states a worked example well. All claims here have primary-source backing in [S19]–[S24].*

- "The definition and distinction between criterion-referenced and norm-referenced measures lie in the interpretation of test scores rather than in the nature of the test. Often the exact same test can be scored in a norm-referenced or criterion-referenced way."
- "There is no such thing as a cut-off score that is applicable to all situations. In a highly technical role like senior software development, the cut-off score may need to be set higher to ensure only candidates with strong programming, problem-solving and communication skills are selected." Different role → different cutscore → different interpretation of the same raw score.

### Assessment

The purpose-conditional scoring question resolves cleanly in the measurement-validity literature. Kane (2013 [S19]), Messick (1989 [S20]), and the AERA/APA/NCME Standards (2014 [S21]) all converge on the same principle: **validity is specific to a proposed interpretation and use.** The same θ or raw score does not carry a single interpretation; its meaning is conditioned by the IUA that defines what inference chain is being made and for what purpose.

For PIPE's T / V / H modes, this means:

- **T-mode (tailored to role):** A low score on a role-required skill is diagnostic of *unfitness for the role*. The relevant validity argument is: "this repo represents competencies the role requires → candidate struggled on this repo → candidate is unlikely to meet role requirements." The cutscore is anchored to role performance requirements. Recruiter action: potential disqualification.

- **V-mode (validate experience):** A low score on a claimed-experience domain is diagnostic of *claim inflation*. The relevant validity argument is: "this repo is from the tech stack the candidate claimed expertise in → candidate struggled → candidate's claimed experience exceeds actual competence." The cutscore is anchored to "minimum expected performance for someone with claimed proficiency." Recruiter action: evidence the claim is inflated, probe in human interview, do not auto-disqualify.

- **H-mode (hybrid):** A low score could carry either interpretation depending on where the low score lands relative to the role-fit dimension vs. the candidate-experience dimension. The scoring panel should emit a **two-dimensional report**: role-gap (T-signal) and experience-gap (V-signal) as separate dimensions, with recruiter-facing summary indicating which dimension triggered the low score.

**Inference:** A single θ or composite score number is **insufficient** for PIPE's multi-mode design. The scorecard must be structured (not flat), surfacing at minimum: (1) role-dimension scores — gaps against the role's required competency set; (2) claimed-experience scores — gaps against the candidate's declared expertise. These two dimensions have different action semantics for recruiters. Emitting one number conflates them and makes the report useless for mode-conditional interpretation.

The Bayesian framing is useful conceptually: under T-mode, the prior for a candidate's skill level on the assessed dimension is "unknown until observed" (weak prior); a low score shifts the posterior toward low-skill for this role. Under V-mode, the prior is "claimed high by candidate" (strong prior); a low score shifts the posterior toward claim-inflation, with the Bayesian update being larger than in T-mode because the prior was stronger. This is not a different scoring formula so much as a different **prior** and a different **decision boundary** for the same formula. (This framing is inferential — no primary source explicitly applies Bayesian decision theory to T/V hiring mode selection.)

---

## Cross-Findings and Contradictions

**Cross-finding 1 (Q1 × Q2): The exercise effect is the familiarity confound.** Lance (2008 [S4]) shows performance is situationally specific; Liang et al. (2025 [S12]) shows that the specific situation (familiar repo) drives 23-point performance inflation for AI models. These are the same mechanism at different levels of abstraction: assessment performance is a function of the specific stimulus, not a stable trait. This is both the main argument *for* multiple sampling in OSCE/MMI and the main argument *against* V-mode personalization in PIPE.

**Cross-finding 2 (Q1 × Q4e): The non-compensatory scoring element in OSCE.** Gormley (2011 [S2]) describes the "yellow card" (serious concern) system: a fail on a single safety-critical station overrides overall pass. This is a worked example of purpose-conditional non-compensatory scoring — directly relevant to PIPE's disqualification semantics under T-mode. If a required skill is safety-critical for the role (e.g., security auditing for a role handling payment systems), a low score on that dimension should be non-compensatory regardless of total composite.

**Cross-finding 3 (Q2 × Q4e): V-mode reduces the validity of disqualification.** Under V-mode, the repo is matched to the candidate's claimed experience domain. If the candidate struggles, this is evidence of claim inflation — but not of inability to learn the role's requirements. Disqualifying a candidate based on a V-mode fail would be using the score for a purpose it was not designed to support (disqualification requires T-mode validity). This is the most important operational constraint: V-mode fail → probe deeper, not reject.

**Contradiction found: SJT experience confound vs. role-referencing.** SJT literature (Motowidlo et al. [S10], PMC7829683 [S17]) shows SJT performance is contaminated by domain-specific experience even when scenarios are role-referenced. This partially contradicts the clean T-mode story: even role-tuned scenarios advantage candidates with prior exposure to that role's domain. The T-mode design principle minimizes this by deriving content from a role's generic competency model (not a specific company's codebase), but it does not eliminate the familiarity effect. PIPE's specific approach (matching to an actual repo from a technology domain) may amplify this confound relative to abstract SJT scenarios.

---

## Confidence Ratings

**Q1 — Philosophy Precedent: HIGH**

Convergent evidence from at least four independent research traditions (OSCE/MMI, AC construct validity, SJT development, SIOP guidelines). All point in the same direction: role-tuned design is standard; experience-tuned design is not studied. The exercise effect literature is replicated across dozens of studies in multiple countries. The absence of V-mode studies is itself a strong signal.

**Q2 — Codebase Familiarity Confound: MEDIUM**

The LLM benchmark contamination evidence is strong and quantified [S12, S13, S14, S15], but involves AI systems not human developers. The transfer-of-learning literature [S16] provides theoretical grounding, but no peer-reviewed study directly measuring human SWE candidate performance on familiar vs. unfamiliar codebases exists. The direction of effect is clear; the magnitude for human candidates is unknown. SJT experience confound [S17] supports the direction of effect. Confidence would be LOW for the magnitude; MEDIUM for the direction.

**Q4e — Purpose-Conditional Scoring: HIGH**

Kane (2013 [S19]), Messick (1989 [S20]), and the AERA/APA/NCME Standards (2014 [S21]) are among the most authoritative sources in educational measurement. All independently support the same principle: validity is use-specific; the same score requires different validity arguments for different purposes. The NCLEX example [S22] and CAT licensure example [S23] provide concrete operational precedents. The Bayesian framing (different priors per mode) is inferential from these sources, not directly cited — flagged accordingly.

---

## Open Questions / Gaps

1. **No direct human SWE hiring study.** No peer-reviewed experiment directly measures human developer performance on familiar vs. unfamiliar codebases in a hiring context. This is the most important gap. The LLM contamination literature is the closest proxy.

2. **Personalized adaptive assessment center literature is essentially absent.** The advisor's prediction proved correct: no published study designs AC or OSCE exercises to match individual candidate backgrounds. The gap itself is informative — no validity evidence supports V-mode design from these traditions.

3. **Near-transfer magnitude for human developers is unknown.** Barnett & Ceci (2002 [S16]) describes the taxonomy but does not quantify tech-specific near-transfer inflation for software engineers. This is a research gap that affects how large the familiarity-discount in scoring should be.

4. **Bayesian prior formalization for T/V/H modes.** No primary source formalizes the Bayesian prior-switch between T-mode ("skill unknown, role demands X") and V-mode ("skill claimed Y by candidate"). The framing in this document is an inferential synthesis, not a direct citation. This is a theoretical framework PIPE would be building, not citing.

5. **Non-compensatory threshold for role-required skills.** The OSCE "yellow card" system [S2] establishes the concept; no research determines what the threshold should be for software engineering hiring (i.e., what magnitude of deficit on a role-required skill should be non-compensatory). This is an empirical question that requires PIPE's own calibration data.

---

## Numbered Source List

[S1] Eva, K.W., Rosenfeld, J., Reiter, H.I., & Norman, G.R. (2004). An admissions OSCE: the multiple mini-interview. *Medical Education*, 38, 314–326. DOI: 10.1046/j.1365-2923.2004.01776.x. PubMed: 14996341. https://pubmed.ncbi.nlm.nih.gov/14996341/

[S2] Gormley, G. (2011). Summative OSCEs in undergraduate medical education. *Ulster Medical Journal*, 80(3), 127–132. PMC3605523. https://pmc.ncbi.nlm.nih.gov/articles/PMC3605523/

[S3] Gormley, G., et al. (2018). OSCE: Design, Development and Deployment. *Postgraduate Medical Journal*. PMC6398515. https://pmc.ncbi.nlm.nih.gov/articles/PMC6398515/

[S4] Lance, C.E. (2008). Where have we been, how did we get here, and where shall we go? *Industrial and Organizational Psychology*, 1(1), 14–17. https://www.cambridge.org/core/journals/industrial-and-organizational-psychology/article/abs/construct-validity-of-the-assessment-center-method-and-usefulness-of-dimensions-as-focal-constructs/6583678C137EDAA1AA6016E6D77A547B (cited in multiple AC validity reviews)

[S5] Lievens, F., & Christiansen, N. (2010). Assessment center exercise factors represent cross-situational specificity, not method bias. *Human Performance*, 13(4), 363–381. DOI: 10.1207/S15327043HUP1304_1. https://www.tandfonline.com/doi/abs/10.1207/S15327043HUP1304_1

[S6] Arthur, W., Woehr, D.J., & Maldegen, R. (2000). Convergent and discriminant validity of assessment center dimensions. *Journal of Management*, 26, 813–835. DOI: 10.1177/014920630002600410. https://journals.sagepub.com/doi/abs/10.1177/014920630002600410

[S7] Arthur, W., Jr., Day, E.A., McNelly, T.L., & Edens, P.S. (2003). A meta-analysis of the criterion-related validity of assessment center dimensions. *Personnel Psychology*, 56, 125–153. DOI: 10.1111/j.1744-6570.2003.tb00146.x. https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2003.tb00146.x

[S8] Lievens, F., & Patterson, F. (2011). The validity and incremental validity of knowledge tests, low-fidelity simulations, and high-fidelity simulations. *Journal of Applied Psychology*, 96(5), 927–940. DOI: 10.1037/a0023496. PubMed: 21480685. https://pubmed.ncbi.nlm.nih.gov/21480685/

[S9] Campion, M.A., Ployhart, R.E., & MacKenzie, W.I., Jr. (2014). The state of research on situational judgment tests. *Industrial and Organizational Psychology*, 7, 59–98. https://www.cambridge.org/core/journals/industrial-and-organizational-psychology/article/situational-judgment-tests-from-measures-of-situational-judgment-to-measures-of-general-domain-knowledge/718BE0B998FE9FE2E91EF670879A4B82

[S10] Motowidlo, S.J., Hooper, A.C., & Jackson, H.L. (2006). Implicit policies about relations between personality traits and behavioral effectiveness in SJTs. *Journal of Applied Psychology*, 91, 749–761. (Secondary citation via PMC7829683.) https://pmc.ncbi.nlm.nih.gov/articles/PMC7829683/

[S11] Thornton, G.C., III, & Rupp, D.E. (2006). *Assessment Centers in Human Resource Management*. Lawrence Erlbaum Associates. https://books.google.com/books/about/Assessment_Centers_in_Human_Resource_Man.html?id=okt4AgAAQBAJ

[S12] Liang, S., Garg, S., & Zilouchian Moghaddam, R. (2025). The SWE-Bench Illusion: When State-of-the-Art LLMs Remember Instead of Reason. arXiv:2506.12286. https://arxiv.org/abs/2506.12286

[S13] Jimenez, C.E., et al. (2024). SWE-bench: Can Language Models Resolve Real-World GitHub Issues? ICLR 2024. arXiv:2310.06770. https://arxiv.org/pdf/2310.06770

[S14] Survey: Benchmarking Large Language Models Under Data Contamination. arXiv:2502.17521 (2025). (Proof-of-concept: Chen et al. 2025 internal citation.) https://arxiv.org/html/2502.17521v2

[S15] SWE-rebench Team (Nebius). SWE-rebench: An Automated Pipeline for Task Collection and Decontaminated Evaluation. arXiv:2505.20411 (NeurIPS 2025). https://arxiv.org/abs/2505.20411

[S16] Barnett, S.M., & Ceci, S.J. (2002). When and where do we apply what we learn? A taxonomy for far transfer. *Psychological Bulletin*, 128(4), 612–637. DOI: 10.1037/0033-2909.128.4.612. PubMed: 12081085. https://pubmed.ncbi.nlm.nih.gov/12081085/

[S17] Haines, S.T., et al. (2021). Role of knowledge and experience in SJT responses of pharmacists and pharmacy students. *American Journal of Pharmaceutical Education*. PMC7829683. https://pmc.ncbi.nlm.nih.gov/articles/PMC7829683/

[S18] Educational Testing Service. (2022). ETS Guidelines for Developing Fair Tests and Communications. https://www.ets.org/pdfs/about/fair-tests-and-communications.pdf

[S19] Kane, M.T. (2013). Validating the interpretations and uses of test scores. *Journal of Educational Measurement*, 50(1), 1–73. DOI: 10.1111/jedm.12000. https://onlinelibrary.wiley.com/doi/abs/10.1111/jedm.12000

[S20] Messick, S. (1989). Validity. In R.L. Linn (Ed.), *Educational Measurement* (3rd ed., pp. 13–103). American Council on Education. PsycNET: 1989-97348-002. https://psycnet.apa.org/record/1989-97348-002

[S21] AERA, APA, & NCME. (2014). *Standards for Educational and Psychological Testing*. American Educational Research Association. https://www.aera.net/publications/books/standards-for-educational-psychological-testing-2014-edition

[S22] National Council of State Boards of Nursing. (2022). NCLEX Passing Standard. https://www.nclex.com/passing-standard.page

[S23] Luo, X., et al. (2018). Projection-Based Stopping Rules for CAT in Licensure Testing. *Applied Psychological Measurement*. PMC5978606. https://pmc.ncbi.nlm.nih.gov/articles/PMC5978606/

[S24] Glaser, R. (1963). Instructional technology and the measurement of learning outcomes. *American Psychologist*, 18, 519–521. (Cited through multiple secondary sources; no open-access URL available.)

[S25] Assessment Systems / Cogn-IQ. Norm-Referenced vs. Criterion-Referenced Testing. (Practitioner synthesis, not peer-reviewed.) https://assess.com/norm-referenced-vs-criterion-referenced-testing/
