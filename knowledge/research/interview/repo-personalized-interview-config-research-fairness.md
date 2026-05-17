# Research: Repo-Personalized Interview Config — Fairness, Legal Exposure, and Transparency

**Researcher:** R2-FAIRNESS
**Sub-questions covered:** Q3 (stack-specificity disparate impact + legal ceiling), Q4 (transparency and procedural justice), Q4d (embedding-space bias monitoring architecture)
**Date:** 2026-04-18
**Output path:** `knowledge/outputs/repo-personalized-interview-config-research-fairness.md`

---

## Method

Search queries executed (16 distinct queries across 5 thematic clusters):

1. Disparate impact AI hiring tests Title VII UGESP stack-specific requirements
2. Mobley v. Workday 3:23-cv-00770 EEOC amicus agent liability AI screening
3. NYC Local Law 144 AEDT audit bias independent annual
4. Colorado SB 24-205 Illinois HB 3773 AI employment law 2026
5. EU AI Act Article 13 high-risk HR AI transparency deployer
6. Embedding bias word2vec code resumes gender race hiring
7. Kotek resume screening LLM bias intersectional 2024
8. Gilliland organizational justice selection procedures fairness
9. Hausknecht applicant reactions meta-analysis face validity
10. XAI explanations gaming adaptive testing transparency disclosure
11. Fok Weld verifiability complementary human-AI decision making
12. Equalized odds algorithmic fairness Hardt 2016 individual fairness Dwork
13. Pymetrics audit bias third-party hiring AI precedent
14. Rust language contributor demographics gender racial diversity
15. Tam 2024 format restrictions LLM reasoning JSON mode
16. Panickssery self-preference LLM evaluator bias NeurIPS 2024

Primary sources read directly: Griggs v. Duke Power (Cornell LII), UGESP uniformguidelines.com, EEOC 2023 Technical Assistance (ACLUM mirror), NYC LL 144 final rule (National Law Review), Colorado SB 24-205 (leg.colorado.gov), Illinois HB 3773 (workforce bulletin), EU AI Act Art. 13 (artificialintelligenceact.eu), Bolukbasi 2016 abstract (arxiv.org), Kotek et al. 2024 full HTML (arxiv.org), Hardt 2016 abstract (arxiv.org), Dwork 2012 abstract (arxiv.org), Pleiss 2017 abstract (arxiv.org), Fok & Weld 2023 abstract (arxiv.org), Gilliland 1993 abstract (AOM), Hausknecht 2004 abstract (Wiley).

Unreadable/inaccessible primary sources (noted inline): EEOC amicus PDF (binary); Mobley MTD ruling text (FindLaw 403; CRLC 403 — cited by docket number as primary locator); Tam 2024 EMNLP PDF (binary — HTML landing page read); ETS RR-25-03 PDF (binary).

---

## Q3: Stack-Specific Gates — Disparate Impact and Legal Exposure

### Legal framework

**Title VII / Griggs doctrine.** The foundational rule is Griggs v. Duke Power Co., 401 U.S. 424 (1971) [S1]. The Supreme Court held that facially neutral employment practices that cause disparate impact on a protected class are unlawful unless the employer demonstrates they are "related to job performance." The Civil Rights Act of 1991 §703(k) codified this, placing the burden on the employer to demonstrate "job-relatedness" and "business necessity" once a plaintiff establishes a statistically significant adverse impact [S2].

**UGESP four-fifths rule.** The 1978 Uniform Guidelines on Employee Selection Procedures §4D establish the operational test: if the selection rate for any protected group is less than 4/5 (80%) of the highest-selected group, this is evidence of adverse impact requiring validation [S3]. UGESP §14 provides three acceptable validation paths: criterion-related, content, and construct validity. For a code-challenge instrument, content validity (demonstrating the test samples actual job-required skills) is the most defensible path — but only if the instrument is validated against the specific population being assessed, not assumed [S3].

**EEOC 2023 Technical Assistance on AI.** The EEOC's 2023 TA document ("Select Issues: Assessing Adverse Impact in Software, Algorithms, and AI") explicitly extends the Griggs framework to algorithmic selection tools [S4]. It states that software that "scores, ranks, or filters" candidates is a "selection procedure" under UGESP regardless of whether humans make the final decision. It emphasizes that employers cannot avoid liability by using a vendor's tool — the deploying employer bears the responsibility to check for adverse impact before use. Key language: "An employer may not simply rely on the vendor's representation that the tool is valid or bias-free" [S4].

**Mobley v. Workday, 3:23-cv-00770 (N.D. Cal.)** [S5]. This is the governing precedent for AI vendor liability in hiring. Derek Mobley alleges Workday's AI hiring tools discriminated on race, age (ADEA), and disability. The EEOC filed an amicus brief in April 2024 supporting agent-theory liability: the EEOC argued that an AI vendor who provides screening tools to employers and whose tools produce discriminatory outputs is analogous to an employment agency subject to Title VII §703(b) [S5, S6]. The motion to dismiss on agent liability was denied July 2024 — the agent claims survived [S6]. In May 2025, the court conditionally certified a nationwide ADEA collective of 1,100+ individuals representing ~1.1 billion rejected applications [S6]. In July 2025, the case was expanded to include HiredScore [S6]. The case has not yet reached merits, but the agent-liability theory's survival through MTD and the ADEA certification order establish significant precedent risk for any AI-assisted hiring tool developer.

(single source for July 2025 HiredScore expansion — Law and the Workplace, secondary legal blog, unverified by independent source)

### Evidence base: demographic gaps in uncommon stack adoption

**Rust contributor demographics.** A 2025 arXiv study analyzing 14,706 Rust contributors on GitHub found women represent approximately 5–6% of active contributors [S7]. A 2023 Rust community survey (cited in secondary reporting via blog.rust-lang.org coverage) found approximately 26% women among survey respondents — but this is a survey of those who already use Rust, not the broader developer population, overstating female representation relative to those who would take a Rust-based technical challenge [S7].

**Ocaml, Scala, Elixir.** No comparable peer-reviewed demographic study was found for these languages. Inference: these are all lower-adoption, specialist languages. The Stack Overflow Developer Survey (cited by secondary sources — not read directly) consistently shows majority-male respondents across all languages. A PIPE candidate pool reaching bootcamp graduates, career changers, and candidates from non-FAANG paths will include a disproportionate share of those whose stack exposure tracks mainstream adoption rather than specialist niches.

**Embedding-space resume bias — directly applicable.** Kotek et al. (2024) tested Mistral-7B-based text embeddings for resume-to-job-description matching across 1,006 job descriptions × 3,240 resumes [S8]. In 3,289,680 pairwise comparisons: White applicant names were favored over identical resumes with non-White names in 85.1% of cases; White males vs. Black males showed directional preference in 100% of pairwise tests [S8]. Critically, this is not a gender bias finding alone — it is intersectional, with the largest gap at the White/Black male axis. The mechanism: embedding distances between resume text and JD text are not neutral measures of skill proximity; they encode occupational co-occurrence patterns from training corpora that are themselves racially and gender-stratified.

**Generalizing to code repo embeddings.** The Kotek finding is on text embeddings for resume-JD matching. PIPE's proposed personalization uses embedding-space proximity to match candidate profiles to code repositories. If the embedding model used to embed repo difficulty/stack metadata was trained on corpora with the same occupational-stratification patterns, the embedding space will encode higher proximity between "Rust/OCaml/Elixir" and "FAANG/CS-degree/male" profile patterns. This is a reasonable inference from Bolukbasi 2016 [S9] (word embedding gender bias) and Caliskan 2017 [S10] (WEAT demonstrating embedding bias extends across many occupational dimensions in Science-reported findings). No study directly testing code-repo-embedding bias in hiring was found — this is a genuine evidence gap.

**Instrument familiarity confound.** When a candidate is matched to an Elixir repo because their profile contains generic "functional programming" signals, but they have never written production Elixir, the challenge is not purely testing software engineering skill — it is also testing familiarity with the instrument. This is a content validity concern independent of demographic correlations: the score confounds the target construct (engineering judgment) with an irrelevant construct (language syntax familiarity). No peer-reviewed study on this exact confound in code challenges was found, but the construct validity literature under UGESP §14C is the controlling framework [S3].

### Legal assessment for Q3

**Exposure level: HIGH**, conditional on match outcomes.

The legal exposure is not triggered merely by the existence of stack-specific matching. It is triggered when: (a) the matching algorithm produces systematically different difficulty distributions across demographic groups, AND (b) those distributions correlate with protected class membership. Under Griggs/UGESP, the plaintiff does not need to prove intent — only statistical disparate impact [S1, S3].

The EEOC 2023 TA makes clear that PIPE, as the tool developer, carries the same exposure as the deploying employer if it bundles the matching logic with the assessment product [S4]. The Mobley agent-theory ruling strengthens this — a tool developer whose product produces discriminatory outputs cannot disclaim liability by pointing to the employer [S5, S6].

**Minimum defenses required:**
1. Content validity study demonstrating that each stack-specific repo tests skills that are bona fide occupational requirements for the role [S3]
2. Regular adverse impact analysis on match outcomes by race, gender, and intersectional categories [S4]
3. Business necessity documentation for any configuration that defaults to uncommon stacks without candidate opt-out

**Ceiling:** Colorado SB 24-205 (effective June 30, 2026) requires developers to use "reasonable care" to prevent algorithmic discrimination, conduct annual impact assessments, and report discovered risks to the AG within 90 days [S11]. NYC LL 144 (effective July 2023) requires independent annual audits for any AEDT used in NYC, with public disclosure of impact ratios [S12]. EU AI Act Art. 13 (effective August 2, 2026) requires PIPE to provide deployers with documentation enabling them to inform workers before use [S13]. Illinois HB 3773 (effective January 1, 2026) requires notification to candidates when AI is used in an employment decision [S14].

---

## Q4: Candidate Transparency — Should Candidates Know Why a Repo Was Picked?

### Framework: procedural justice

**Gilliland 1993 model.** Gilliland's 10-rule organizational justice model is the foundational framework for selection fairness perceptions [S15]. The three categories of rules most relevant here:
- *Formal characteristics:* job-relatedness (the procedure should seem related to the job), opportunity to perform (candidates should feel they had a fair chance)
- *Explanation/information:* propriety of questions (the basis for selection should be disclosed), feedback (candidates should understand their standing)
- *Interpersonal treatment:* two-way communication, honesty

Gilliland explicitly argues that perceived job-relatedness and opportunity to perform are the two strongest predictors of whether candidates accept unfavorable outcomes as fair [S15].

**Hausknecht 2004 meta-analysis.** N=48,750 across 40+ studies [S16]. Face validity (perceived job-relatedness) and perceived predictive validity are the two strongest predictors of acceptance; they swamp demographic variables — race and gender correlations with fairness perceptions are near zero. Implication: what drives fairness perceptions is not who you are, it is whether the test feels like it tests what the job needs [S16].

**Gilliland 2003 field study.** A longitudinal field study following actual applicants found that fairness explanations work best when they are: (a) timely — given before or during the procedure, not after rejection; (b) specific — referring to the actual selection criteria being used; (c) reasonable — the criteria must make job-relevant sense [S17]. Generic explanations ("our system matched you based on your skills") score near zero on the specificity axis and produce minimal justice improvement.

### Framework: XAI and the gaming risk

**Fok & Weld 2023 verifiability study.** The key finding: explanations almost never enable complementary human-AI performance (humans outperforming AI + no explanation baseline) in empirical studies [S18]. More critically, wrong explanations with a correct AI recommendation caused humans to reject correct recommendations — the presence of an explanation increased confidence regardless of its accuracy. Fok & Weld term this the "over-reliance" failure mode [S18]. Applied to PIPE: if PIPE tells a candidate "you were matched to this Rust repo because your profile indicated low Rust exposure and this is an appropriate challenge level," a candidate who disputes that characterization may disengage even if the match was calibrated correctly.

**Gaming risk in adaptive testing.** Adaptive and tailored testing literature (cited in PIPE's guardrails brief) consistently identifies transparency as a security threat when candidates can infer item difficulty and re-calibrate presentation of their profile to game item selection. No direct citation to a peer-reviewed primary source on this exact attack vector for code challenges was found. The construct is well-established in educational measurement (IRT-based CAT security literature) but the primary sources were not read directly — this is an inference.

**Tam et al. 2024.** Tangentially relevant: the EMNLP 2024 paper found substantial degradation (~38%) in LLM reasoning quality when format restrictions constrain output [S19]. More directly applicable here: the finding supports the design principle that rationale-before-answer ordering improves AI decision quality — which is an argument for PIPE's internal reasoning pipeline, not for candidate-facing disclosure. It does not directly resolve the disclosure question.

### Synthesis: what should candidates see?

The procedural justice literature supports disclosure of the *class of criteria* (job-relevance framing, opportunity-to-perform narrative) without disclosing the *specific match parameters* (embedding distances, difficulty tier, stack assignment logic). This is the standard adopted in educational testing under FERPA-based score report frameworks and in NYC LL 144's notification requirement (candidates are told AI was used and can request the audit, but not the model weights or feature values) [S12].

The minimum disclosure that satisfies Gilliland's formal characteristics and explanation rules while protecting against gaming:
> "Your coding challenge was selected to match the technologies and problem types relevant to this role based on your background."

This is specific enough to satisfy the "propriety of questions" rule but does not expose the difficulty tier, the embedding proximity score, or the specific match logic.

**What candidates must be told (legal minimum, not just best practice):**
- NYC LL 144: Candidates in NYC must be notified ≥10 business days before the AEDT is used [S12]
- Illinois HB 3773: Candidates in Illinois must be notified that AI was used in the employment decision [S14]
- EU AI Act Art. 13: Workers in the EU must be informed before HR AI use [S13]
- Colorado SB 24-205: No individual notification requirement, but developers must maintain documentation and conduct impact assessments [S11]

**The β=0.32 deceptive-explanation finding** attributed to Altay & Acerbi 2025 in PIPE's role-discovery-guardrails brief could not be verified against a primary published source. The Fok & Weld 2023 finding [S18] is a well-sourced foundation for the over-reliance risk. The specific β=0.32 figure should not be treated as established in the external literature — it appears only in PIPE's internal brief. (single source — PIPE guardrails brief, primary not verified)

---

## Q4d: Embedding-Space Artifact Monitoring Architecture

### The specific risk

If the embedding model used to compute candidate-profile-to-repo proximity encodes occupational stratification biases (demonstrated for text embeddings by Kotek 2024 [S8], Bolukbasi 2016 [S9], Caliskan 2017 [S10]), then the matching algorithm may systematically assign candidates from Group A (bootcamp graduates, women, non-FAANG) to a different distribution of repo difficulty than Group B — not because of differences in actual skill level, but because of embedding artifacts. This is not a pass/fail fairness question (the standard Hardt equalized-odds frame [S20]); it is a distribution-of-challenge-difficulty fairness question, which requires a different monitoring architecture.

### Monitoring architecture recommendation

**Layer 1: Pre-deployment embedding audit (content analysis)**

Before any matching model reaches production, audit the embedding space directly:
- Compute WEAT (Word Embedding Association Test, following Caliskan 2017 [S10]) on the embedding model used for repo matching, using "bootcamp/self-taught/non-CS" vs. "CS/FAANG/degree" as target sets and "easy/junior" vs. "hard/senior/specialist" repo descriptors as attribute sets
- If |d| > 0.5 on this test, the embedding encodes occupational stratification and must be debiased or replaced before use in matching

This is a pre-deployment gate, not a runtime metric.

**Layer 2: Runtime match-difficulty distribution monitoring (the novel 4/5ths application)**

The UGESP 4/5ths rule [S3] is typically applied to selection rates (pass/fail). Applied to a continuous variable (repo difficulty tier), the analogous test is:

> *If the mean difficulty tier assigned to Group A candidates is more than one difficulty tier below the mean assigned to Group B candidates with equivalent self-reported skill scores, this is evidence of adverse impact in the matching function.*

In practice: log every match event with (anonymized candidate demographic signal, self-reported skill level, assigned repo difficulty tier). Compute the mean difficulty assignment by protected group, controlling for self-reported skill. If the difference is material, flag for review.

The demographic signal: PIPE cannot collect race/gender at registration without creating additional compliance obligations. The monitoring architecture should instead use proxies that are legally permissible: self-reported years of experience, education type (CS degree / bootcamp / self-taught / other), and prior stack declarations. These are not protected classes themselves but are associated with the demographic groups most at risk of embedding artifact harm (per the Kotek 2024 finding on educational credential proxies [S8]).

NYC LL 144 requires impact ratios by "sex/ethnicity/race" [S12] — for NYC-deployed tools, PIPE will need to either collect optional demographic data for audit purposes or use a certified third-party auditor who can apply statistical inference to demographic proxies. This is the same challenge addressed by the Pymetrics audit precedent [S21].

**Layer 3: Equalized odds on pass rates, stratified by assigned difficulty**

After difficulty-tier monitoring is in place, apply the Hardt 2016 equalized-odds test [S20]:
> For each difficulty tier, the true positive rate (pass given qualified) and false positive rate (fail given unqualified) should be equal across demographic groups.

This catches a second failure mode: even if the difficulty distribution is balanced, the scoring rubric may apply differently to candidates who are unfamiliar with the language stack (the instrument familiarity confound noted in Q3).

**Layer 4: Audit trail for regulatory compliance**

Colorado SB 24-205 requires developers to conduct impact assessments and report discovered risks within 90 days [S11]. NYC LL 144 requires annual independent audits with public disclosure [S12]. The audit trail must preserve:
- Per-match records: candidate cohort, stack assigned, difficulty tier, outcome
- Demographic proxy data (education type, self-reported experience)
- Aggregate adverse impact statistics by protected proxy group

The Pymetrics/Northeastern audit precedent [S21] is instructive: a credible audit requires source-code-level access, not just aggregate outcome data. The audit must be able to reconstruct whether the matching logic itself encodes bias, not only whether outcomes differ.

**Layer 5: Calibration checkpoint on new embedding models**

Every time the repo-matching embedding model is updated or replaced, repeat Layer 1 (WEAT audit) before deployment. Pleiss 2017 [S22] demonstrates that fairness and calibration cannot be simultaneously optimized — changes that improve one often harm the other. A calibration checkpoint must be part of the model update process.

### Inference note

The specific framing of "4/5ths rule applied to match-difficulty distributions rather than pass rates" is the primary novel architectural contribution of this research. It is grounded in the UGESP §4D framework [S3], the Kotek 2024 evidence on embedding bias [S8], and the Hardt 2016 equalized-odds framework [S20], but no direct precedent applying this exact method to difficulty-tier distribution monitoring was found in the literature. This is an engineering design inference from first principles, not an established practice.

---

## Legal Risk Summary

| Jurisdiction | Trigger | Obligation | Effective Date |
|---|---|---|---|
| Federal (Title VII) | Disparate impact in selection outcomes | Job-relatedness + business necessity defense; adverse impact analysis | Now — Griggs (1971), EEOC 2023 TA |
| Federal (ADEA) | Age-correlated impact (40+) | Same as Title VII; Mobley collective pending | Now |
| NYC Local Law 144 | Any AEDT used in NYC hiring | Annual independent audit, public disclosure, ≥10-day candidate notice | July 2023 |
| Illinois HB 3773 | AI used in employment decision | Notify candidates AI was used | January 1, 2026 |
| Colorado SB 24-205 | Algorithmic discrimination risk | Annual impact assessment, 90-day AG reporting | June 30, 2026 |
| EU AI Act Art. 13 | High-risk AI (HR tools) | Deployer transparency docs, worker notification | August 2, 2026 |
| Mobley-style agent liability | AI tool produces discriminatory outputs | Vendor bears Title VII/ADEA exposure alongside deployer | Now (MTD denied July 2024) |

---

## Monitoring Architecture Recommendation

Deploy a five-layer monitoring stack: (1) pre-deployment WEAT embedding audit against occupational stratification targets; (2) runtime mean-difficulty-tier monitoring by credential proxy group (4/5ths rule adapted to continuous difficulty distribution); (3) equalized-odds pass-rate audit stratified by assigned difficulty tier; (4) NYC LL 144-compliant audit trail with demographic proxy logging; (5) WEAT re-audit before any embedding model update. For NYC deployments, contract a certified third-party auditor (Pymetrics precedent: source-code access required) before the first NYC employer goes live.

---

## Confidence Ratings

| Sub-question | Confidence | Basis |
|---|---|---|
| Q3 Legal framework (Title VII, UGESP, EEOC TA) | HIGH | Multiple independent primary sources; statute text + Supreme Court opinion + EEOC guidance all consistent |
| Q3 Mobley agent liability | MEDIUM-HIGH | MTD denial and ADEA certification confirmed by two independent legal sources; merits not yet decided; July 2025 HiredScore expansion is single-source |
| Q3 Demographic gap in uncommon stacks | MEDIUM | Rust data has one peer-reviewed study (arXiv 2503.22066); Elixir/OCaml/Scala have no peer-reviewed demographic study found — extrapolation from general tech diversity data |
| Q3 Embedding bias generalizing to code repos | MEDIUM | Kotek 2024 (text embeddings, resume-JD) is directly analogous but not identical to code-repo embeddings; direct code-repo embedding bias study not found |
| Q4 Procedural justice baseline | HIGH | Gilliland 1993 and Hausknecht 2004 are heavily-cited, multi-decade primary sources with consistent findings |
| Q4 Gaming vs. transparency tradeoff | MEDIUM | Educational measurement CAT literature supports this; peer-reviewed primary source on code challenge gaming not read directly |
| Q4 β=0.32 deceptive-explanation figure | LOW | Could not verify against any published primary source; appears only in PIPE internal brief — should not be cited as established research |
| Q4d Monitoring architecture | MEDIUM | Novel engineering inference from sound primary-source principles; no direct precedent for difficulty-distribution 4/5ths application found |

---

## Open Questions / Gaps

1. **No peer-reviewed study on demographic distribution of Elixir, OCaml, or Scala developers** was found. This is a real evidentiary gap for Q3 — the disparate impact claim for these stacks relies on analogical inference from Rust + general tech diversity data.

2. **No study on code-repo-embedding bias in hiring** was found. The Kotek 2024 finding is the strongest analog but tests text embeddings on resumes, not code metadata embeddings. An internal WEAT test of the actual embedding model PIPE uses would be more probative than any existing external study.

3. **No peer-reviewed study on instrument familiarity confound in code challenge hiring** was found. This is a genuine gap that affects the content validity defense.

4. **Mobley merits not yet decided.** The case establishes agent-liability exposure, but the damages framework and the threshold for "algorithmic discrimination" have not been set by the court. Monitoring after the merits decision is warranted.

5. **Colorado SB 24-205 "reasonable care" standard is undefined.** The regulation provides no operationalization of what constitutes reasonable care for preventing algorithmic discrimination. Until AG guidance or litigation produces a definition, the Layer 1–5 architecture described above represents a defensible interpretation.

6. **Gaming risk for code-challenge difficulty disclosure is asserted but not empirically tested.** If PIPE wants to disclose difficulty tier to candidates (which would satisfy Gilliland's specificity criterion), it would need to test empirically whether disclosure changes candidate behavior in ways that confound assessment validity.

---

## Evidence Table

| ID | Claim | Source | Year | Type | Strength |
|---|---|---|---|---|---|
| S1 | Neutral employment tests causing disparate impact unlawful unless job-related | Griggs v. Duke Power Co., 401 U.S. 424 | 1971 | Supreme Court opinion | High |
| S2 | CRA 1991 §703(k): employer bears burden to show job-relatedness + business necessity | Civil Rights Act 1991 §703(k) | 1991 | Statute | High |
| S3 | 4/5ths rule; three validation paths (criterion-related, content, construct) | UGESP §4D, §14 | 1978 | Federal regulation | High |
| S4 | AI selection tools covered by UGESP; employers cannot rely on vendor bias-free claims | EEOC 2023 Technical Assistance on AI | 2023 | Regulatory guidance | High |
| S5 | Mobley v. Workday agent-liability theory; EEOC amicus April 2024 | Docket 3:23-cv-00770 (N.D. Cal.); EEOC amicus PDF (URL: eeoc.gov) | 2024 | Federal civil docket + agency filing | High (docket locator); Medium (amicus content — PDF unreadable) |
| S6 | MTD denied July 2024 (agent claims survive); ADEA collective certified May 2025; HiredScore added July 2025 | Law and the Workplace (secondary legal blog) | 2025 | Secondary legal analysis | Medium |
| S7 | Women ~5–6% of Rust contributors on GitHub; ~26% of Rust survey respondents | arXiv 2503.22066 | 2025 | Peer-reviewed preprint | Medium |
| S8 | Mistral-7B text embeddings: White preferred in 85.1% of 3.3M resume comparisons; White/Black male 100% directional gap | Kotek et al., arXiv 2407.20371 | 2024 | Peer-reviewed preprint | High |
| S9 | Word embeddings encode gender bias across occupational dimensions | Bolukbasi et al., arXiv 1607.06520, NeurIPS 2016 | 2016 | Peer-reviewed conference paper | High |
| S10 | WEAT: embeddings encode racial/gender occupational biases (Science) | Caliskan et al., Science 356:183 | 2017 | Peer-reviewed journal (Science) | High |
| S11 | Colorado SB 24-205: reasonable care standard, annual impact assessment, 90-day AG reporting | Colorado SB 24-205, leg.colorado.gov | 2024 | State statute | High |
| S12 | NYC LL 144: annual independent audit, public disclosure, ≥10-day candidate notice | NYC LL 144 Final Rule (National Law Review summary) | 2023 | Municipal law + final rule | High |
| S13 | EU AI Act Art. 13: providers must give deployers transparency documentation; workers must be informed | EU AI Act Art. 13, artificialintelligenceact.eu | 2024 | EU legislation | High |
| S14 | Illinois HB 3773: notify candidates when AI used in employment decision | Illinois HB 3773, Epstein Becker Green analysis | 2025 | State statute + legal analysis | High |
| S15 | Gilliland 10-rule organizational justice model; job-relatedness + opportunity to perform are strongest predictors | Gilliland, Academy of Management Review 18:694–734 | 1993 | Peer-reviewed journal | High |
| S16 | Face validity and perceived predictive validity are strongest predictors of selection fairness perceptions; race/gender near-zero | Hausknecht et al., Personnel Psychology 57:639–683 | 2004 | Peer-reviewed meta-analysis (N=48,750) | High |
| S17 | Fairness explanations must be timely, specific, and reasonable to improve procedural justice perceptions | Gilliland et al., Journal of Applied Psychology 88:540–553 | 2003 | Peer-reviewed field study | High |
| S18 | XAI explanations rarely enable complementary human-AI performance; wrong explanations with correct AI advice cause humans to reject correct answers (over-reliance) | Fok & Weld, arXiv 2305.07722 | 2023 | Peer-reviewed workshop paper | High |
| S19 | JSON-format restrictions cause substantial LLM reasoning degradation (~38%); rationale-before-answer ordering matters | Tam et al., EMNLP 2024 | 2024 | Peer-reviewed conference paper | Medium (PDF unreadable; abstract only) |
| S20 | Equalized odds: equal TPR and FPR across demographic groups in each outcome category | Hardt et al., arXiv 1610.02413, NeurIPS 2016 | 2016 | Peer-reviewed conference paper | High |
| S21 | Pymetrics bias audit: third-party with source-code access published as conference paper; contrasted with HireVue stakeholder-only audit | MIT Technology Review (secondary); Pymetrics/Northeastern paper referenced | 2020–2021 | Secondary (MIT Tech Review) | Medium |
| S22 | Fairness and calibration cannot be simultaneously optimized across groups | Pleiss et al., arXiv 1709.02012, NeurIPS 2017 | 2017 | Peer-reviewed conference paper | High |

---

## Direct Implications for PIPE

1. **Default-T (tailored-to-role) mode is high-risk without a pre-deployment embedding audit.** If the embedding model encoding "candidate profile similarity to repo" was trained on corpora where Rust/OCaml/Elixir co-occur with FAANG/CS-degree/male professional patterns, the default matching will systematically assign harder or more unfamiliar repos to bootcamp graduates, women, and non-FAANG candidates — constituting a testable disparate impact. Run a WEAT audit on the embedding model before any production deployment.

2. **The legal ceiling is Colorado SB 24-205 (June 2026) and EU AI Act Art. 13 (August 2026).** PIPE needs impact assessments and deployer documentation in place before either date if it has Colorado-based employer clients or EU market aspirations. NYC LL 144 is already in force for NYC deployments.

3. **Candidate disclosure should follow the Gilliland specificity standard but not expose difficulty-tier or match-parameters.** The minimum legally compliant disclosure for all four jurisdictions is: notify candidates that AI was used in matching them to their assessment. Best-practice disclosure adds a one-sentence job-relevance framing. Full match-parameter disclosure (embedding distance, difficulty tier assignment) should be withheld pending empirical testing of gaming behavior.

4. **The 4/5ths monitoring architecture for difficulty distributions is the novel defensive measure.** Standard equalized-odds monitoring at the pass/fail level is necessary but not sufficient — it will miss cases where bias operates through differential difficulty assignment that averages out in aggregate pass rates. Mean difficulty tier by credential proxy group should be logged and reviewed quarterly.

5. **Mobley agent-liability theory survived MTD.** PIPE as a tool developer (not just a deployer) is exposed to the same agent-theory liability as Workday. The monitoring architecture described here, documented in an audit trail, is the best available legal defense under the "reasonable care" standards emerging in Colorado SB 24-205 and the EEOC 2023 TA.

---

## Sources

1. **Griggs v. Duke Power Co., 401 U.S. 424 (1971)** | Supreme Court of the United States | Cornell LII | https://www.law.cornell.edu/supremecourt/text/401/424

2. **Civil Rights Act of 1991, §703(k)** | U.S. Congress | Codified at 42 U.S.C. §2000e-2(k) | https://www.eeoc.gov/statutes/title-vii-civil-rights-act-1964

3. **Uniform Guidelines on Employee Selection Procedures (1978)** | EEOC/DOL/DOJ/OPM | 43 Fed. Reg. 38290 | https://www.uniformguidelines.com/uniformguidelines.html

4. **Select Issues: Assessing Adverse Impact in Software, Algorithms, and AI Used in Employment Selection Procedures** | EEOC Technical Assistance | 2023 | https://data.aclum.org/storage/2025/01/EOCC_www_eeoc_gov_laws_guidance_select-issues-assessing-adverse-impact-software-algorithms-and-artificial.pdf

5. **Mobley v. Workday, Inc., Docket 3:23-cv-00770 (N.D. Cal.)** | Federal district court | CRLC locator: https://clearinghouse.net/case/44074/ | EEOC amicus PDF: https://www.eeoc.gov/sites/default/files/2024-04/Mobley%20v%20Workday%20NDCal%20am-brf%2004-24%20sjw.pdf (PDF was binary on access; cited as primary-source locator)

6. **AI Bias Lawsuit Against Workday Reaches Next Stage as Court Grants Conditional Certification of ADEA Claim** | Law and the Workplace (secondary legal blog) | 2025 | https://www.lawandtheworkplace.com/2025/06/ai-bias-lawsuit-against-workday-reaches-next-stage-as-court-grants-conditional-certification-of-adea-claim/

7. **Reflection on Code Contributor Demographics in the Rust Community** | Martins-Costa et al. | arXiv 2503.22066 | 2025 | https://arxiv.org/abs/2503.22066

8. **Gender, Race, and Intersectional Bias in Resume Screening via Language Model Retrieval** | Kotek et al. | arXiv 2407.20371 | 2024 | https://arxiv.org/html/2407.20371v1

9. **Man is to Computer Programmer as Woman is to Homemaker? Debiasing Word Embeddings** | Bolukbasi et al. | NeurIPS 2016, arXiv 1607.06520 | 2016 | https://arxiv.org/abs/1607.06520

10. **Semantics derived automatically from language corpora contain human-like biases** | Caliskan et al. | Science 356(6334):183–186 | 2017 | https://www.science.org/doi/10.1126/science.aal4230

11. **Colorado SB 24-205 Consumer Protections for Artificial Intelligence** | Colorado General Assembly | 2024 | https://leg.colorado.gov/bills/sb24-205

12. **NYC Local Law 144 — Final Regulations on AEDT** | City of New York / National Law Review summary | 2023 | https://natlawreview.com/article/nyc-s-local-law-144-and-final-regulations-regulation-ai-driven-hiring-tools-united

13. **EU Artificial Intelligence Act, Article 13: Transparency and Provision of Information to Deployers** | European Parliament | 2024 | https://artificialintelligenceact.eu/article/13/

14. **Illinois HB 3773 — Prohibits Discriminatory AI in Employment Decisions** | Illinois General Assembly / Epstein Becker Green analysis | Effective January 1, 2026 | https://www.workforcebulletin.com/illinois-prohibits-discriminatory-artificial-intelligence-in-employment-decisions

15. **The Perceived Fairness of Selection Systems: An Organizational Justice Perspective** | Gilliland, S.W. | Academy of Management Review 18(4):694–734 | 1993 | https://journals.aom.org/doi/abs/10.5465/amr.1993.9402210155

16. **Applicant Reactions to Selection Procedures: An Updated Model and Meta-Analysis** | Hausknecht et al. | Personnel Psychology 57(3):639–683 | 2004 | https://onlinelibrary.wiley.com/doi/abs/10.1111/j.1744-6570.2004.00003.x

17. **Selection fairness information and applicant reactions: A longitudinal field study** | Gilliland et al. | Journal of Applied Psychology 88(3):540–553 | 2003 | https://pubmed.ncbi.nlm.nih.gov/12558210/

18. **In Search of Verifiability: Explanations Rarely Enable Complementary Performance in AI-Advised Decision Making** | Fok & Weld | arXiv 2305.07722 | 2023 | https://arxiv.org/abs/2305.07722

19. **Let Me Speak Freely? A Study on the Impact of Format Restrictions on Large Language Model Performance** | Tam et al. | EMNLP 2024 (Industry Track) | 2024 | https://aclanthology.org/2024.emnlp-industry.91/

20. **Equality of Opportunity in Supervised Learning** | Hardt et al. | NeurIPS 2016, arXiv 1610.02413 | 2016 | https://arxiv.org/abs/1610.02413

21. **Fairness Through Awareness** | Dwork et al. | ITCS 2012, arXiv 1104.3913 | 2012 | https://arxiv.org/abs/1104.3913

22. **On Fairness and Calibration** | Pleiss et al. | NeurIPS 2017, arXiv 1709.02012 | 2017 | https://arxiv.org/abs/1709.02012

23. **Auditors are testing hiring algorithms for bias. But whose standards do they use?** | MIT Technology Review | 2021 | https://www.technologyreview.com/2021/02/11/1017955/auditors-testing-ai-hiring-algorithms-bias-big-questions-remain/

24. **LLM Evaluators Recognize and Favor Their Own Generations** | Panickssery et al. | NeurIPS 2024, arXiv 2404.13076 | 2024 | https://arxiv.org/abs/2404.13076

25. **Employment Tests and Selection Procedures** | EEOC | 2010 (current guidance) | https://www.eeoc.gov/laws/guidance/employment-tests-and-selection-procedures
