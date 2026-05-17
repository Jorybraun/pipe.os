> **STATUS: RESEARCH FILE (R4)** · Created 2026-04-08 13:18
> **Research run:** `code-review-content-sourcing` — Round 2
> **Researcher:** R4 — Work-Sample & Structured-Interview Validity (Schmidt/Hunter/Sackett 2022 corrections, Roth, Huffcutt, EEOC, Griggs, Ricci)
> **Role in run:** Primary-source research on IO psychology validity coefficients, legal defensibility, fairness, criterion problem
> **Use for:** Looking up source citations when the final brief cites `[R4-S<n>]`
> **Navigate:** [INDEX](../INDEX.md) · [final brief](./code-review-content-sourcing.md)

---

# R4 — Work-Sample & Structured-Interview Validity for Code Review

> **Scope:** This document covers the industrial-organisational psychology literature on work-sample test validity, structured interview design, legal defensibility (EEOC + case law), subgroup differences, and the criterion problem for software engineers. It does NOT cover OSCE/simulation-based assessment (R5), competitive scanning of existing platforms (R6), or PR-mining / bug injection (Round 1).

---

## TL;DR

- **Work-sample tests are among the strongest hiring predictors**, but the oft-cited Schmidt & Hunter (1998) coefficient of *r* = .54 has been revised down to *r* = .33 by Roth et al. (2005) and *r* = .33 by Sackett et al. (2022) after correcting for range restriction overcorrection. This is still highly competitive; structured interviews now rank first at *r* = .42 [S1][S3][S4].
- **A turn-based human–AI code-review session is a high-fidelity work sample.** Code review is a daily job task for software engineers; assessments that directly replicate job tasks sit at the high-fidelity end of the simulation taxonomy and derive validity from minimal inferential distance between predictor and criterion [S5][S15].
- **Structural features are decisive for interviews.** Huffcutt & Arthur's four-level model shows validity rising from *r* ≈ .20 (unstructured) to *r* ≈ .57 (fully structured with anchored scales, panel format, and mechanical score combination). Standardised prompts, anchored rubrics, and multiple rater perspectives are the highest-leverage design choices [S6][S7][S8].
- **Legal defensibility requires a documented job analysis, a clear validity strategy, and adverse-impact monitoring.** Under the EEOC Uniform Guidelines and *Griggs v. Duke Power* (1971), any selection procedure causing adverse impact must be shown to be job-related and consistent with business necessity. Content validity is the most practical route for a code-review work sample. *Ricci v. DeStefano* (2009) adds that alternatives with less adverse impact and equal validity must be ruled out [S9][S10][S11].
- **Subgroup differences in work samples vary sharply by exercise type.** Applicant-sample Black–White *d* values are higher than incumbents (*d* ≈ .73 for applicants, .36 for incumbents in Roth et al. 2008). Role-play and oral-briefing exercises show *d* ≈ .21–.22, far lower than in-basket and technical exercises (*d* ≈ .74–.76), suggesting that interactive, conversational code-review formats may carry a more favourable adverse-impact profile than purely knowledge-test-style exercises [S12].
- **The criterion problem is acute for software engineers.** No single, agreed performance measure exists. The I/O literature typically uses supervisory ratings or promotion counts; for SWEs, empirical options include PR throughput, defect rates, and peer review quality ratings. A concurrent validity study using structured peer-performance ratings is a feasible bootstrap for PIPE within 12–18 months of beta [S13][S14].

---

## Evidence table

| # | Claim | Source | Strength | Year |
|---|---|---|---|---|
| E1 | Schmidt & Hunter meta-analysis placed work sample test operational validity at *r* = .54 (corrected) | S1 | Peer-reviewed meta-analysis (n = 85 yrs data) | 1998 |
| E2 | Roth, Bobko & McFarland re-analysis found mean observed *r* = .26, corrected *r* = .33 for work samples vs job performance | S4 | Peer-reviewed meta-analysis, k = large | 2005 |
| E3 | Sackett et al. corrected the range restriction overcorrection; revised hierarchy: structured interviews *r* = .42 > job knowledge *r* = .40 > biodata *r* = .38 > work samples *r* = .33 > GMA *r* = .31 | S3 | Peer-reviewed meta-analysis; methodological reanalysis | 2022 |
| E4 | Huffcutt & Arthur four-level structure model: Level 1 (none) *r* ≈ .20, Level 2 *r* ≈ .35, Level 3 *r* ≈ .51, Level 4 (fully structured) *r* ≈ .57 | S6 | Peer-reviewed meta-analysis | 1994 |
| E5 | McDaniel et al. meta-analysis: structured interviews *r* = .44, unstructured *r* = .33; situational interview specifically *r* = .50 | S8 | Peer-reviewed meta-analysis, N = 86,311 | 1994 |
| E6 | Levashina et al. comprehensive review confirms 6 structural features drive validity: job-analysis-based questions, same questions per applicant, behavioral/situational question types, per-answer ratings, anchored scales, trained raters | S7 | Peer-reviewed narrative + quantitative review | 2014 |
| E7 | Wingate et al. 2025 meta-analysis (k = 37, N = 30,646): structured interview criterion validity for task performance *r* = .30, contextual performance *r* = .28; construct-specific assessment exceeds general ratings | S2 | Peer-reviewed meta-analysis | 2025 |
| E8 | EEOC Uniform Guidelines: adverse impact defined as selection rate < 4/5 of highest-rate group; employers must show job-relatedness and business necessity | S9 | Federal regulation (29 CFR Part 1607) | 1978 |
| E9 | *Griggs v. Duke Power*: "The touchstone is business necessity. If an employment practice which operates to exclude Negroes cannot be shown to be related to job performance, the practice is prohibited." | S10 | US Supreme Court opinion (401 U.S. 424) | 1971 |
| E10 | *Ricci v. DeStefano*: employer who discards valid test to avoid adverse impact must show "strong basis in evidence" for disparate-impact liability; test that is job-related, consistent with business necessity, and without less-discriminatory equally-valid alternatives is legally protected | S11 | US Supreme Court opinion (557 U.S. 557) | 2009 |
| E11 | Content validity is most practical route for work samples: requires job analysis showing content match, not empirical correlation | S9 | Federal regulation | 1978 |
| E12 | Roth et al. 2008: applicant-sample Black–White *d* = .73 overall; in-basket and technical exercises *d* = .74–.76; role-plays and oral briefings *d* = .21–.22 | S12 | Peer-reviewed meta-analysis | 2008 |
| E13 | Ployhart & Holtz 2008 diversity-validity dilemma: simulations and work samples are one of five strategy clusters to reduce adverse impact while preserving validity; interactive formats show smaller subgroup differences than knowledge-heavy formats | S16 | Peer-reviewed review | 2008 |
| E14 | Gender differences in work samples: overall *d* = -0.22 (slight female advantage); technical skills *d* = .11 (not significant); spatial reasoning *d* = .42 (male advantage); verbal comprehension *d* = -.33 | S17 | Peer-reviewed study | 2014 |
| E15 | Criterion problem: no agreed single metric for SWE performance; I/O literature uses supervisor ratings, promotions, and turnover as proxies; SWE-specific candidates include PR throughput, defect density, peer review quality | S13 | Peer-reviewed chapter | 2005 |
| E16 | Concurrent validity designs are acceptable proxies for predictive validity; up to 80% of applied psychology validation studies use concurrent data; recent study found no significant magnitude difference between concurrent and predictive coefficients | S18 | Peer-reviewed study; secondary source | 2025 |
| E17 | SIOP 2023 AI assessment guidelines: AI-based assessments must meet same validity, reliability, and fairness standards as traditional tests; ongoing adverse-impact monitoring required; documentation must enable external auditing | S19 | Professional society guidelines (SIOP) | 2023 |
| E18 | High-fidelity work samples work best when job tasks are well-defined; code review is a structured, repeated SWE task suitable for work-sample format | S5 | Peer-reviewed reference article | 2012 |
| E19 | Structured interview notes at a large IT company (N = 7,650) predicted performance ratings, promotions, and turnover; technical roles showed strongest effect when focused assessment (depth > breadth) was used | S14 | Peer-reviewed empirical study | 2021 |
| E20 | Title VII §2000e-2: allows "professionally developed ability test" so long as not designed, intended or used to discriminate; burden shifts to employer once adverse impact is shown | S20 | Federal statute (42 U.S.C. § 2000e-2) | 1964/2009 |

---

## 1. Work-sample test validity

### 1.1 The landmark estimates and their revision

**Schmidt & Hunter (1998)** [S1] synthesised 85 years of selection research and placed work sample tests at *r* = .54 (corrected for range restriction and criterion unreliability), making them the top single predictor at the time. This figure originated from Hunter & Hunter (1984) and was widely cited. However, two subsequent re-analyses substantially revised it downward.

**Roth, Bobko & McFarland (2005)** [S4] incorporated studies published after 1984 and found a mean *observed* correlation of *r* = .26 and a corrected mean of *r* = .33 — approximately one-third less than the 1984 estimate. They noted that earlier studies suffered from range restriction artefacts and inclusion of tests that were not strictly work samples.

**Sackett et al. (2022)** [S3] identified a deeper methodological problem: prior meta-analyses, including Schmidt & Hunter (1998), applied range restriction corrections derived from predictive validation studies uniformly across *concurrent* validation studies as well, despite the fact that incumbent samples do not restrict range on the predictor the same way applicant samples do. After correcting for this overcorrection, the revised hierarchy for operational validity (corrected) is:

| Predictor | Sackett et al. (2022) *r* | Schmidt & Hunter (1998) *r* |
|---|---|---|
| Structured interviews | .42 | .51 |
| Job knowledge tests | .40 | .48 |
| Empirically keyed biodata | .38 | .35 |
| Work sample tests | .33 | .54 |
| General mental ability (GMA) | .31 | .51 |
| Unstructured interviews | — | .38 |

The practical implication is not that work samples are weak — *r* = .33 remains among the strongest available predictors — but that the former case for work samples over cognitive tests was overstated.

### 1.2 What makes a work sample valid

The fundamental mechanism is **minimal inferential distance**: when the predictor task directly replicates the criterion task, there is little need to infer from abstract ability to actual performance [S5]. The taxonomy of work samples runs from high-fidelity (exact task replication — flight simulators, programming tests, dental carving) to low-fidelity (paper-and-pencil analogs, situational judgment tests) [S5].

**Code review as a work sample.** Code review is a daily, structured, cognitively complex activity for software engineers at most seniority levels. A turn-based assessment in which a candidate reviews a pull request, writes inline comments, and responds to pushback from an AI-simulated author replicates the behavioral domain of the criterion with high fidelity. This places it squarely in the high-fidelity category (analogous to a programming test), justifying content validity claims (see Section 3).

A practical caveat from the literature [S5]: work samples perform best when job tasks are well-defined and relatively stable over time. Software engineering tasks change as codebases and technologies evolve; the assessment content library must be refreshed accordingly to preserve content validity.

### 1.3 Comparison with other predictors for complex cognitive jobs

For knowledge-intensive jobs, the evidence favours **structured interviews + work samples in combination** over either alone. Schmidt & Hunter (1998) [S1] estimated that GMA + work sample yields incremental *r* ≈ .63. Even with Sackett's corrections, the combination of structured interview and a domain-specific work sample is the practical ceiling for standalone assessments. Unstructured interviews (*r* ≈ .33 [S8]) and general algorithmic coding tests (not pure work samples — they test abstract problem-solving that may not reflect daily work) are weaker options.

---

## 2. Structured interview validity

### 2.1 Structure as the key lever

**Huffcutt & Arthur (1994)** [S6] classified interview structure into four levels based on question standardisation and evaluation standardisation:

- **Level 1** (no constraints, pure free-form): *r* ≈ .20
- **Level 2** (some consistent questions, no standard evaluation): *r* ≈ .35
- **Level 3** (standardised questions + some rating criteria): *r* ≈ .51
- **Level 4** (standardised questions + anchored scales + panel + mechanical combination): *r* ≈ .57

Validity increases monotonically with structure. Each increment of standardisation adds predictive power.

**McDaniel et al. (1994)** [S8] — covering 245 coefficients from N = 86,311 — found structured interviews (*r* = .44) substantially outperform unstructured ones (*r* = .33), and that *situational* interviews (asking candidates what they *would* do in a defined scenario) reach *r* = .50. For complex, higher-level positions, *behavioural description* interviews (asking what the candidate *did* in a past situation) may outperform situational formats, per Huffcutt et al. (2001) (single source — unverified for higher complexity roles specifically) [S21].

**Levashina et al. (2014)** [S7] identified the six highest-leverage structural features in a comprehensive narrative and quantitative review:

1. Questions derived from a formal job analysis
2. Same questions asked of every candidate
3. Behavioural or situational question types (not free-form biographical)
4. Per-question rating (not holistic global impression)
5. Anchored rating scales (behavioural anchoring — BARS)
6. Trained, calibrated raters

**Wingate, Bourdage & Steel (2025)** [S2] — the most recent meta-analysis (k = 37, N = 30,646) — found that structured interview evaluations predicting task performance (*r* = .30) and contextual performance (*r* = .28) showed "above-chance discriminant validity" when matched to the targeted criterion construct. Contextual performance (collaboration, communication, attitude) particularly benefits from anchored scoring — relevant for a code-review assessment that explicitly scores communication quality.

### 2.2 Translation to a human–AI code-review conversation

A turn-based code-review session is a hybrid: it has work-sample properties (direct task replication) and structured-interview properties (standardised prompts, scored responses). The structural features that most directly translate are:

- **Standardised PR scenarios** (same questions / same stimulus per candidate)
- **Per-dimension anchored scoring rubric** (bugs found, comment quality, tone/clarity, depth of reasoning)
- **Multiple rater perspectives** — in a human–AI system, the AI author's pushback and a calibrated human scorer together approximate a panel
- **Note-taking and verbatim records** — the conversation log is a full verbatim record, which Levashina et al. identify as a validity enhancer over recall-based interviewer notes

Applying Huffcutt & Arthur's levels: a PIPE code-review assessment with standardised PRs, anchored rubric dimensions, and human + AI scoring would map to Level 3–4, targeting validity in the *r* = .42–.57 range.

---

## 3. Legal defensibility (EEOC + case law)

### 3.1 Statutory framework

**Title VII of the Civil Rights Act of 1964** (42 U.S.C. § 2000e-2) [S20] prohibits employment discrimination on the basis of race, colour, religion, sex, or national origin. It permits "professionally developed ability tests" so long as they are not designed or used to discriminate. Congress's phrase "measuring the person *for the job*" (not the person in the abstract) has been the interpretive anchor.

**EEOC Uniform Guidelines on Employee Selection Procedures (1978)** (29 CFR Part 1607) [S9] apply to any measure used as a basis for any employment decision. Key provisions:

- **Adverse impact (the 4/5ths rule):** A selection rate for a protected group less than 80% of the highest-rate group constitutes evidence of adverse impact. Where adverse impact is found, the employer must demonstrate validity.
- **Three validity pathways:** (a) criterion-related (empirical correlation between predictor and performance criterion); (b) content validity (the selection procedure is a representative sample of job content); (c) construct validity (the procedure measures constructs identified as critical by job analysis, supported by criterion-related evidence).
- **Documentation requirements:** Employers must maintain annual records of selection rates by race and sex, and — when adverse impact exists — validity evidence for the procedure.
- **Content validity constraints:** Cannot be used to validate tests of "intelligence, personality, or judgment" in the abstract; the procedure must closely approximate observable work behaviours or job products. A code-review task that mirrors the actual work product is well-suited for content validity.

### 3.2 Landmark cases

**Griggs v. Duke Power Co. (401 U.S. 424, 1971)** [S10]: The Supreme Court unanimously established the *disparate impact* doctrine. Key language: "The touchstone is business necessity. If an employment practice which operates to exclude Negroes cannot be shown to be related to job performance, the practice is prohibited." The Court rejected intent as a defence: neutral-on-their-face tests that function as "built-in headwinds" for minorities are prohibited unless demonstrably related to job performance. This case created the affirmative burden on employers to validate.

**Ricci v. DeStefano (557 U.S. 557, 2009)** [S11]: Added a constraint in the other direction — an employer *cannot* simply discard a valid test because of adverse impact unless it has a "strong basis in evidence" that it would face disparate-impact liability (i.e., that the test fails business necessity/job-relatedness, OR that an equally valid, less discriminatory alternative exists). The holding confirms that a test which is (a) job-related, (b) consistent with business necessity, and (c) not replaceable by an equally valid alternative with less adverse impact is legally protected.

### 3.3 Which validity route is viable for PIPE

For an early-stage platform, **content validity** is the most practical route:

1. Commission a formal job analysis of the software engineer role (task inventory, KSA linkage, SME ratings of task criticality and frequency)
2. Document that code review is a critical, frequent task — abundant empirical evidence exists in the SE literature (PR throughput studies, time-on-code-review analyses)
3. Show that each assessment PR scenario maps to the job analysis task inventory
4. Apply Lawshe's Content Validity Ratio (CVR ≥ .78 threshold from a panel of SMEs)

Criterion-related validity is the gold standard but requires a follow-up study: hire candidates, track performance, run the correlation. A concurrent validity study using structured peer/manager performance ratings 90–180 days post-hire is feasible within 12–18 months of beta volume (see Section 5).

Construct validity is the most complex to establish and less advisable as a primary strategy; it requires a full nomological network linking the assessment's underlying constructs to job performance through criterion-related evidence — essentially a superset of the work content and criterion approaches.

---

## 4. Subgroup differences & fairness

### 4.1 Work samples vs. cognitive tests

The common assumption that work samples "solve" adverse impact is overstated. **Roth et al. (2008)** [S12] found:

- Applicant-sample Black–White *d* = .73 overall for work sample tests
- Incumbent-sample *d* = .36 (smaller, likely due to range restriction and job experience effects)
- By exercise type: in-basket and technical exercises *d* ≈ .74–.76; role-plays and oral briefings *d* ≈ .21–.22

The exercise-type variation is the critical finding for PIPE's design. Exercises that are heavily **information-processing and knowledge-recall** (in-basket, technical quizzes) carry adverse impact close to pure cognitive ability tests. Exercises that are **interactive and communicative** (oral briefings, role-plays) carry much smaller differences. A turn-based code-review conversation — which weights written communication, code quality reasoning, and interpersonal tone — is closer to the interactive end.

For comparison, cognitive ability (GMA) tests typically show Black–White *d* ≈ 1.0 and Hispanic–White *d* ≈ .7–.8 in the US population. Work samples still show reduced (but non-trivial) subgroup differences.

**Gender differences** in work samples [S17]: overall *d* = -0.22 (slight female advantage). Technical skills specifically showed *d* = .11 (not statistically significant), suggesting a code-review assessment is unlikely to produce material gender-based adverse impact. Spatial tasks (*d* = .42) and verbal comprehension (*d* = -.33) show larger differences, but these are not the primary dimensions in code review.

### 4.2 The diversity-validity dilemma and mitigation strategies

**Ployhart & Holtz (2008)** [S16] reviewed 16 strategies across five clusters for reducing adverse impact without sacrificing validity. The most evidence-supported strategies for a platform like PIPE:

1. **Use interactive/simulation-based formats** over knowledge-recall formats (largest effect on reducing subgroup differences while preserving validity)
2. **Reduce criterion-irrelevant variance** — e.g., remove cultural or idiomatic references from PR code that disadvantage non-native English speakers
3. **Remove items with differential item functioning (DIF)** — statistical analysis of whether score patterns for protected groups diverge from the majority group on specific items after ability is controlled
4. **Frame assessments as job-relevant** — "opportunity to demonstrate skill" framing reduces stereotype threat effects (small but real)
5. **Avoid ranking-only decisions** — banding or multiple hurdle approaches reduce the selection-rate impact while preserving minimum competency standards

Under the EEOC's 4/5ths rule, PIPE must monitor selection rates by race and gender as soon as sufficient data exists. The SIOP (2023) guidelines [S19] add that AI-assisted scoring systems need the same adverse impact analysis as traditional tests, with ongoing monitoring.

---

## 5. The criterion problem for SWEs

### 5.1 The general criterion problem

The "criterion problem" (Austin & Villanova, 1992) describes the persistent gap between the *ultimate criterion* (true long-run job value) and any *operational criterion* (what we can actually measure) [S13]. Operational criteria suffer from:

- **Deficiency** — failing to capture all relevant aspects of the ultimate criterion
- **Contamination** — influenced by factors outside individual performance (team context, codebase quality, project priority)
- **Unreliability** — supervisory ratings show inter-rater reliability of *r* ≈ .52 on average

For the I/O literature, the dominant operational criteria are supervisor performance ratings, promotion count, training success, and turnover. These are used because they are available and legally defensible — not because they are ideal.

### 5.2 Operationalising SWE performance

For software engineers, the literature and practitioner evidence suggest the following operational criteria, in roughly ascending order of criterion relevance to code-review skill:

| Criterion | Validity | Practical issues |
|---|---|---|
| Supervisor ratings (general) | Standard benchmark; widely used in validation research | Halo effects; manager technical depth required |
| Promotion count / tenure | Available; used in predictive validity studies (e.g., [S14]) | Confounded by org politics; slow signal |
| Training performance | Available early; frequently used in criterion studies | May not predict max performance on complex tasks |
| PR throughput (volume) | Quantifiable; fast feedback | Does not distinguish quality; high performers may do fewer, deeper reviews |
| Defect density / bug-introduction rate | Directly relevant to code quality | Noisy; depends on complexity of tasks assigned |
| Peer code review quality ratings | Directly maps to the assessment construct | Requires structured peer rating instrument; available in orgs with review culture |

**What prior studies used:** The Chinese IT company study (N = 7,650) [S14] used a five-point supervisor rating scale, promotion count, and turnover as criteria. The predictive validity for technical staff was highest for focused, construct-matched interview dimensions.

### 5.3 Bootstrapping ground truth for PIPE

A practical path for PIPE to establish criterion-related validity without waiting years:

1. **Concurrent validity with hired candidates (12–18 months):** Have hiring managers rate new hires on a structured, multi-dimensional performance rating instrument specifically including a "code review quality" dimension. Correlate hire-time assessment scores against 90-day ratings. This is a concurrent-validity design and, per recent evidence, produces validity estimates of similar magnitude to predictive designs [S18] (single source — but well-established in the concurrent vs. predictive validity literature).

2. **Proxy criterion via PR metadata:** Integrate with GitHub/GitLab to collect structured review metrics — comment acceptance rate, review turnaround time, bug catch rate post-merge — for hired candidates as supplementary criteria.

3. **Expert rater calibration as a construct validity bridge:** Have senior engineers rate the same assessment responses that candidates gave; use the inter-rater agreement and correlation with assessment scores as construct validity evidence while waiting for longitudinal criterion data.

4. **Transparency and documentation:** Maintain a validation file from day one. The EEOC Uniform Guidelines require documentation that can be produced in response to a challenge. Even partial evidence (job analysis, content validity documentation, initial concurrent correlations) is substantially better than none.

---

## Implications for PIPE's turn-based human–AI code review

1. **Design for Level 3–4 structure from the start.** Standardised PR scenarios, per-dimension anchored scoring rubrics (bugs found, comment quality, tone/clarity, reasoning depth), and a calibrated scoring layer (human scorer or calibrated AI) are the three highest-ROI design choices. Each of these maps directly to the Huffcutt-Arthur validity increments and is explicitly listed in Levashina et al.'s evidence-based structural features.

2. **Pursue content validity as the primary legal strategy, with a concurrent validity study as the near-term goal.** Commission a job task analysis (even a lightweight one using online SWE job postings + SME rating) before launch. Document code review as a critical, frequent SWE task. Apply CVR to each PR scenario in the library. Build in a data collection pipeline for post-hire performance data from day one.

3. **Design the scoring dimensions and interactive format to minimise cognitive-load and knowledge-recall demands.** The adverse impact data (Roth et al. 2008) [S12] shows that interactive/oral formats (*d* ≈ .21) have dramatically smaller subgroup differences than knowledge-recall formats (*d* ≈ .74). A conversation-based code-review assessment that weights reasoning and communication over pure pattern-matching of known bug types is structurally more equitable. Monitor 4/5ths rule compliance as beta data accumulates.

4. **Treat the AI scoring component as a SIOP-2023-governed selection tool.** The SIOP guidelines [S19] are clear: AI-based assessments must meet the same validity, reliability, and fairness standards as traditional tests, with ongoing monitoring and auditable documentation. This means: inter-rater reliability between the AI scorer and human calibration raters must be reported; adverse impact analysis must be run on AI-assigned scores by subgroup; and the scoring model must be periodically re-evaluated as the job and tech stack evolve.

---

## Sources

S1. Schmidt, F. L., & Hunter, J. E. (1998). *The validity and utility of selection methods in personnel psychology: Practical and theoretical implications of 85 years of research findings.* Psychological Bulletin, 124(2), 262–274. [https://psycnet.apa.org/record/1998-10661-006](https://psycnet.apa.org/record/1998-10661-006)

S2. Wingate, T., Bourdage, J. S., & Steel, P. (2025). *Evaluating interview criterion-related validity for distinct constructs: A meta-analysis.* International Journal of Selection and Assessment. [https://onlinelibrary.wiley.com/doi/10.1111/ijsa.12494](https://onlinelibrary.wiley.com/doi/10.1111/ijsa.12494)

S3. Sackett, P. R., Zhang, C., Berry, C. M., & Lievens, F. (2022). *Revisiting meta-analytic estimates of validity in personnel selection: Addressing systematic overcorrection for restriction of range.* Journal of Applied Psychology, 107(11), 2040–2068. [https://www.semanticscholar.org/paper/Revisiting-meta-analytic-estimates-of-validity-in-Sackett-Zhang/3d97bb723b4ec316b23105126b78b71a855de79e](https://www.semanticscholar.org/paper/Revisiting-meta-analytic-estimates-of-validity-in-Sackett-Zhang/3d97bb723b4ec316b23105126b78b71a855de79e); summary at [https://www.siop.org/tip-article/is-cognitive-ability-the-best-predictor-of-job-performance-new-research-says-its-time-to-think-again/](https://www.siop.org/tip-article/is-cognitive-ability-the-best-predictor-of-job-performance-new-research-says-its-time-to-think-again/)

S4. Roth, P. L., Bobko, P., & McFarland, L. A. (2005). *A meta-analysis of work sample test validity: Updating and integrating some classic literature.* Personnel Psychology, 58(4), 1009–1037. [https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2005.00714.x](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2005.00714.x)

S5. Work Samples entry, IResearchNet Industrial-Organizational Psychology (citing Callinan & Robertson, 2000). [https://psychology.iresearchnet.com/industrial-organizational-psychology/individual-differences/work-samples/](https://psychology.iresearchnet.com/industrial-organizational-psychology/individual-differences/work-samples/)

S6. Huffcutt, A. I., & Arthur, W. Jr. (1994). *Hunter and Hunter (1984) revisited: Interview validity for entry-level jobs.* Journal of Applied Psychology, 79(2), 184–190. Meta-analytic source for four-level structure model. [https://psycnet.apa.org/record/1994-31607-001](https://psycnet.apa.org/record/1994-31607-001)

S7. Levashina, J., Hartwell, C. J., Morgeson, F. P., & Campion, M. A. (2014). *The structured employment interview: Narrative and quantitative review of the research literature.* Personnel Psychology, 67(1), 241–293. [https://onlinelibrary.wiley.com/doi/abs/10.1111/peps.12052](https://onlinelibrary.wiley.com/doi/abs/10.1111/peps.12052)

S8. McDaniel, M. A., Whetzel, D. L., Schmidt, F. L., & Maurer, S. D. (1994). *The validity of employment interviews: A comprehensive review and meta-analysis.* Journal of Applied Psychology, 79(4), 599–616. [https://home.ubalt.edu/tmitch/645/articles/McDanieletal1994CriterionValidityInterviewsMeta.pdf](https://home.ubalt.edu/tmitch/645/articles/McDanieletal1994CriterionValidityInterviewsMeta.pdf)

S9. Equal Employment Opportunity Commission et al. (1978). *Uniform Guidelines on Employee Selection Procedures.* 29 CFR Part 1607. [https://www.uniformguidelines.com/uniformguidelines.html](https://www.uniformguidelines.com/uniformguidelines.html)

S10. Griggs v. Duke Power Co., 401 U.S. 424 (1971). Supreme Court opinion. [https://www.law.cornell.edu/supremecourt/text/401/424](https://www.law.cornell.edu/supremecourt/text/401/424)

S11. Ricci v. DeStefano, 557 U.S. 557 (2009). Supreme Court opinion. [https://supreme.justia.com/cases/federal/us/557/557/](https://supreme.justia.com/cases/federal/us/557/557/)

S12. Roth, P. L., Bobko, P., McFarland, L. A., & Buster, M. (2008). *Work sample tests in personnel selection: A meta-analysis of Black–White differences in overall and exercise scores.* Personnel Psychology, 61(3), 637–662. [https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2008.00125.x](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2008.00125.x)

S13. Viswesvaran, C. (2005). *Job performance: Assessment issues in personnel selection.* In A. Evers, N. Anderson, & O. Voskuijl (Eds.), The Blackwell Handbook of Personnel Selection. Chapter 16. [https://gwern.net/doc/iq/2005-viswesvaran.pdf](https://gwern.net/doc/iq/2005-viswesvaran.pdf)

S14. Guo, W., Luo, S., Sun, X., & Chen, C. (2021). *Predictive validity of interviewer post-interview notes on candidates' job outcomes: Evidence using text data from a leading Chinese IT company.* Frontiers in Psychology, 11, 522830. [https://pmc.ncbi.nlm.nih.gov/articles/PMC7817537/](https://pmc.ncbi.nlm.nih.gov/articles/PMC7817537/)

S15. Hatchways. (2022). *Using a code review assessment to assess software engineering talent.* [Engineering blog / practitioner source — not peer-reviewed; flagged accordingly.] [https://www.hatchways.io/blog/code-review-assessment-to-assess-engineers](https://www.hatchways.io/blog/code-review-assessment-to-assess-engineers)

S16. Ployhart, R. E., & Holtz, B. C. (2008). *The diversity–validity dilemma: Strategies for reducing racioethnic and sex subgroup differences and adverse impact in selection.* Personnel Psychology, 61(1), 153–172. [https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.2008.00109.x](https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.2008.00109.x)

S17. Rodríguez, A. D., García-Izquierdo, A. L., & Ramos-Villagrasa, P. J. (2014). *Gender differences in work sample assessments: Not all tests are created equal.* Revista de Psicología del Trabajo y de las Organizaciones, 30(1). [https://www.elsevier.es/en-revista-revista-psicologia-del-trabajo-organizaciones-370-articulo-gender-differences-in-work-sample-X1576596214840189](https://www.elsevier.es/en-revista-revista-psicologia-del-trabajo-organizaciones-370-articulo-gender-differences-in-work-sample-X1576596214840189)

S18. Fine, S., & Pirak, M. (2025). *Does concurrent validity really estimate predictive validity in psychological testing? Two local studies.* Applied Psychology (IAAP). [https://iaap-journals.onlinelibrary.wiley.com/doi/10.1111/apps.70001](https://iaap-journals.onlinelibrary.wiley.com/doi/10.1111/apps.70001)

S19. Society for Industrial and Organizational Psychology (SIOP). (2023). *Considerations and Recommendations for the Validation and Use of AI-Based Assessments for Employee Selection.* [Professional society guidelines — not peer-reviewed; flagged accordingly.] [https://www.siop.org/post/siop-releases-recommendations-for-ai-based-assessments/](https://www.siop.org/post/siop-releases-recommendations-for-ai-based-assessments/)

S20. 42 U.S.C. § 2000e-2. *Unlawful Employment Practices, Title VII, Civil Rights Act of 1964.* [https://www.law.cornell.edu/uscode/text/42/2000e-2](https://www.law.cornell.edu/uscode/text/42/2000e-2)

S21. Huffcutt, A. I., et al. (2001). *Comparison of situational and behavior description interview questions for higher-level positions.* Personnel Psychology, 54(3), 619–644. [https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2001.tb00225.x](https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2001.tb00225.x) (single source — unverified for complexity moderation claim)

---

## Confidence & gaps

### High confidence

- The validity coefficient landscape (Schmidt & Hunter → Roth et al. → Sackett et al.) is well-replicated and the trend is stable. The Sackett 2022 reanalysis figures are the current best estimates.
- The Huffcutt-Arthur structure model and the six Levashina et al. structural features have survived 30 years of replication and are the consensus design guidance.
- The EEOC Uniform Guidelines, *Griggs*, and *Ricci* are primary legal sources directly consulted.
- The Roth et al. (2008) subgroup difference findings are the most rigorous available for work sample adverse impact and are well-cited.

### Moderate confidence (requires follow-up)

- The claim that interactive/conversational work sample formats carry substantially lower adverse impact (*d* ≈ .21–.22) than knowledge-recall formats (*d* ≈ .74–.76) is from Roth et al. (2008) and plausible by mechanism, but the effect may be confounded with the cognitive loading of the specific role-plays studied (clerical/supervisory, not SWE).
- The concurrent vs. predictive validity equivalence claim rests partly on Fine & Pirak (2025) — a very recent paper (single source flagged); the broader I/O field has long accepted this equivalence but formal comparisons are limited.
- Wingate et al. (2025) is very new (k = 37 only); its construct-specific findings are consistent with prior theory but the study has not yet been widely replicated.

### Gaps not filled

- No peer-reviewed study specifically validating a code-review work sample against SWE job performance outcomes was found. The Hatchways source [S15] describes a practitioner implementation with reasonable construct logic but no criterion data. **This is the key empirical gap for PIPE** — the platform would be producing the first such study if it runs a concurrent validity design.
- The adverse impact data for *SWE-specific* work samples (as opposed to general work samples) is not available. Roth et al. (2008) data covers diverse occupations; the SWE-specific *d* distribution is unknown and could differ.
- No data was found on adverse impact by race/ethnicity specifically for *interactive AI-assisted* technical assessments. SIOP (2023) recommends monitoring this explicitly; no baseline exists in the literature yet.
- The Sackett et al. (2022) paper's full table of validity coefficients was not extractable from the PDF versions found; the figures cited in this document come from reliable secondary summaries (SIOP TIP article, Master HR) and cross-referenced against abstract data. The Semantic Scholar abstract confirms the general ranking.
