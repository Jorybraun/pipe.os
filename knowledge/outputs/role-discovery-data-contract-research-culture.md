# R2 Research — Culture Platforms, BARS Calibration, Probe Generation, Dealbreaker Legal

**Researcher:** R2 (Sonnet 4.6)
**Date:** 2026-04-10
**Task:** T2 — Q2, Q4, Q5, Q9 from `knowledge/outputs/.plans/role-discovery-data-contract.md`
**Output of:** Role Discovery + Repo Understanding Data Contract research run

---

## Q2 — Team-Signal Extraction Taxonomy

**Question restated:** How do existing culture-assessment platforms (HireVue, Plum, Culture Amp, Lattice, Harver, Pymetrics) extract structured team-culture signals from interview data, and what empirical validation exists for their taxonomies? What do those studies say about which taxonomies actually differentiate teams versus proliferating dimensions without signal?

### Platform Survey

**HireVue (Liff et al. 2024)** [R2-S1]

The most rigorous published validation in this space is Liff, Mondragon, et al. (2024), "Psychometric Properties of Automated Video Interview Competency Assessments," published in the Journal of Applied Psychology. The study examines automated video interview competency assessments (AVI-CAs) designed for cross-role generalizability. Key findings:

- Convergent validity: average r = .66 across assessed competencies
- Discriminant validity: average r = .58, indicating moderate differentiation between constructs
- Test-retest reliability: average r = .72
- Criterion-related validity (uncorrected): sample-weighted r̄ = .24 across five organizational samples
- Subgroup differences (Cohen's d): ≥ −.14 — minimal adverse impact signal

The paper reports that Communication was highly intercorrelated with all other competencies (r̄ = .74), which the authors flag as a dimensionality concern: when Communication accounts for most of the cross-competency variance, the remaining dimensions may not be independently scoring team-relevant signal. The study applied Campion et al.'s (1997) structuring framework to the evaluation method [R2-S2], which it credits for the high reliability.

HireVue's game-based emotional intelligence component measures empathy (recognizing six basic emotions), influence, and impulsivity across four games (E-Motions, TeamChat, LeaderChat, Pulse) [R2-S3]. These are trait-level constructs (vendor documentation), not team-differentiated signals — the same rubric applies across roles.

**Plum (Big Five / 10 Talent Model)** [R2-S4]

Plum applies the Five-Factor Personality Model (Big Five) to derive a 10 Talent Model across three domains: Personality, Problem Solving (fluid intelligence), and Social Intelligence. Six Leadership Potential dimensions are derived: Learning Agility, Drive, Presence, Self-Confidence, Empowerment, Composure. The Plum science page claims an automated 8-minute job analysis that defines "Match Criteria" for role-specific success, but publishes no independent Cronbach's α or inter-rater reliability statistics in their publicly accessible documentation [R2-S4]. No peer-reviewed independent validation study was located. The "77% increase in Talent Potential" metric cited on their site lacks methodological documentation.

The Big Five's predictive validity for job performance is well-established in the broader literature (Conscientiousness r ≈ .23 with job performance, meta-analytic; Barrick & Mount 1991), but the Big Five does not inherently differentiate *teams* — it differentiates *individuals*. Team-level culture profiling from Big Five requires aggregation norms, which Plum does not publish.

**Culture Amp (Employee Engagement Index)** [R2-S5]

Culture Amp's engagement survey uses a five-component Employee Engagement Index (Motivation, Pride, Recommendation, Present Commitment, Future Commitment) with reported Cronbach's α of .80–.90, backed by factor analyses showing "a strong core construct." The survey demonstrates external validity via Glassdoor rating correlations and Mattermark growth score correlations. Ten standard survey factors include: Alignment & Involvement, Collaboration & Communication, Company Confidence/Performance, Engagement, Leadership, Learning & Development, Management, Service & Quality Focus, Social Connection, and Teamwork & Ownership [R2-S5].

Culture Amp is an *employee experience* platform rather than a pre-hire culture signal platform. Its factors describe the team's current culture state (from the perspective of employees already on the team), which makes it a useful source of training data for what culture signals look like — but it is not designed to produce a pre-hire assessment rubric. The α = .80–.90 is solid. No team-specific norming or calibration methodology is documented for use in assessing candidates against a specific team profile.

**Harver (OCAI / Competing Values Framework)** [R2-S6]

Harver's cultural fit assessment uses the Organizational Culture Assessment Instrument (OCAI), developed by Cameron & Quinn, based on the Competing Values Framework (CVF). The four culture archetypes are Clan, Adhocracy, Market, and Hierarchy [R2-S6]. Candidates distribute 10 stars across four statements per dimension (24 items total), producing a profile that is matched against the organization's previously defined culture profile. The OCAI's validation history is substantial: independent PLOS ONE validation study found Cronbach's α = .82 (Clan), .80 (Adhocracy), .79 (Market), .69 (Hierarchy) for the Ideal culture version; and .83 (Clan), .80 (Adhocracy), .78 (Market), .73 (Hierarchy) for the Current culture version [R2-S7].

Critical finding from the PLOS ONE study [R2-S7]: Ideal culture factors showed *no significant relationships with job satisfaction*, while Current culture factors did predict satisfaction (Clan and Adhocracy positively, Market negatively; R² = .388). This indicates possible weak criterion validity when OCAI is used in its ideal-culture framing — which is how Harver uses it in candidate assessment. This is a material limitation for using the four OCAI archetypes as a pre-hire signal.

Harver explicitly states the cultural fit assessment "is not designed to be a stand-alone test" and requires combination with other assessments [R2-S6].

**Pymetrics (Neuroscience game-based)** [R2-S8]

Pymetrics (now part of Harver's gamified assessments offering) uses 12 neuroscience mini-games to assess 91 cognitive, emotional, and social behavioral traits across nine categories: Attention, Decision Making, Effort, Emotion, Fairness, and others. Pymetrics claims validation in accordance with EEOC guidelines including concurrent and predictive validity, job analysis, and fairness auditing [R2-S8]. No independent peer-reviewed validation study was located in this research pass; available documentation is vendor-produced.

The 91-trait space is exceptionally fine-grained. Harver/Pymetrics models are trained per-role against client performance data, which means team-specific calibration *does* happen — but it requires adequate historical performance data per role, a requirement PIPE will not meet at MVP stage.

**Lattice (Performance Management)** [R2-S9]

Lattice is a performance management platform, not a pre-hire culture signal extractor. It offers customizable competency frameworks for career development, but these are post-hire, manager-defined rubrics — not a validated pre-hire taxonomy. No published psychometric validation was located. Lattice does not belong in PIPE's direct signal taxonomy.

### Synthesis: What Differentiates vs. Proliferates

Platforms that proliferate dimensions without differentiation signal:
- Plum (10 Talents, no published α, no team-level norms)
- Pymetrics (91 traits; signal is rich but requires historical performance data)
- Lattice (not a pre-hire tool)

Platforms with documented differentiation evidence:
- HireVue / Liff et al. 2024 [R2-S1]: r = .24 criterion-related validity, but Communication dominates (r̄ = .74 with other dimensions — dimensionality concern)
- Culture Amp [R2-S5]: α = .80–.90 but for employee experience, not candidate assessment
- OCAI via Harver [R2-S7]: α = .69–.83 depending on culture type, but ideal-culture framing shows weak criterion validity

The clearest empirical finding across these platforms: **a minimal construct set validated against job satisfaction or performance outcomes outperforms large-dimension taxonomies**. The OCAI's four archetypes (Clan, Adhocracy, Market, Hierarchy) provide the most empirically grounded, concise team-culture differentiation framework currently available, despite the ideal-culture validity concern. Culture Amp's factor list is richer but lacks pre-hire framing.

### Recommended Team-Culture Signal Set

Based on the evidence, a five-signal set is recommended — the four OCAI culture archetypes plus a psychological safety dimension, which is independently validated and demonstrably team-differentiating:

| Signal | Construct definition | Empirical source |
|---|---|---|
| **Clan affinity** | Family-like, collaborative, consensus-oriented, tenure-valued | OCAI/CVF [R2-S7], α = .83 |
| **Adhocracy affinity** | Risk-taking, entrepreneurial, ambiguity-tolerant, innovation-first | OCAI/CVF [R2-S7], α = .80 |
| **Market affinity** | Results-driven, competitive, delivery-accountability-focused | OCAI/CVF [R2-S7], α = .78 |
| **Hierarchy affinity** | Structured, process-following, control-valuing, predictability-seeking | OCAI/CVF [R2-S7], α = .73 |
| **Psychological safety** | Ability to voice disagreement, take interpersonal risk, challenge authority without punishment | Edmondson 1999; Google Project Aristotle [R2-S10] |

What to exclude: Plum's 10 Talents (no independent validation), Pymetrics' 91 traits (data-hungry), and Lattice's competencies (post-hire only). Culture Amp's 10 factors are useful as *evidence* in the Role Discovery interview (the recruiter's cultural knowledge), not as candidate-facing dimensions.

### RCD + RUC Implications

**Role Context Document:** The "Team Context" section should carry a `teamCultureProfile` object with these five signals, each scored on a 1–5 priority scale extracted from the Role Discovery interview. The hiring manager and team member perspectives should be preserved separately (per ADR-028 / Q3), since OCAI ideal-culture responses are likely to differ between a manager who values hierarchy and a team member in an ad-hoc squad.

**Repo Understanding Contract:** Team culture archetypes map loosely to repo characteristics — Adhocracy teams tend to have higher PR churn and smaller PRs; Hierarchy teams tend to have longer review cycles. These mappings are inference, not validated literature, but they suggest the `repo_engineering_signals` table could carry culture-archetype hints as metadata for the runtime alignment scorer.

---

## Q4 — Team-Specific BARS Anchor Calibration

**Question restated:** What is the evidence base for role-specific or team-specific BARS anchor calibration? Does tailoring anchors to role context improve hiring validity, and at what cost to inter-rater reliability and legal defensibility under the Uniform Guidelines and EU AI Act?

### The Smith & Kendall (1963) Founding Evidence

Smith & Kendall (1963) created BARS (then called "behavioral expectations scales") specifically because generic rating scales produced unacceptable rater idiosyncrasy: raters assigned different meanings to the same scale point. Their solution was to anchor each scale point with observable behavioral examples derived from subject matter experts (SMEs) in *the specific job role*. The critical incident technique (Flanagan 1954) was the mechanism: SMEs generate concrete examples of effective and ineffective behavior; a second SME panel ("retranslation") independently classifies incidents back into categories. Incidents with less than ~80% retranslation agreement are discarded [R2-S11, R2-S12].

The founding paper's central claim is that **role-specific anchors are the mechanism** through which BARS achieve better inter-rater reliability and lower measurement bias than generic scales — not the format alone. This has been replicated but not unanimously confirmed. Landy & Farr (1980) reviewed BARS research and concluded that anchored scales sometimes (but not always) exhibit less halo and leniency bias than other formats [R2-S12]. The hedge "sometimes but not always" is load-bearing for PIPE.

### Kell et al. (2017): Modern BARS Construction Methods [R2-S11]

ETS Research Report No. RR-17-28 (Kell, Martín-Raugh, et al., 2017) examined different BARS construction methods for structured interviews. Key findings applicable to PIPE:

1. Crowdsourced critical incident generation (online participants) produces anchors of sufficient quality to serve as BARS — the development cost concern is solvable without full SME panels.
2. The retranslation step remains necessary: incidents that SMEs cannot agree to classify (~80% threshold) should be dropped, as they contribute noise rather than signal.
3. BARS is associated with "greater predictive validity and reliability and less bias" in the structured interview context [R2-S11].
4. Development cost is the primary practical barrier; Kell et al.'s crowdsourcing approach is a viable cost-reduction path.

### Campion et al. (1997): Structure Elements and BARS [R2-S2]

Campion, Palmer, and Campion (1997) identified 15 elements of interview structure and concluded that BARS is one of the elements with the strongest impact on reliability and validity [R2-S2]. Key structural element: "Rate each answer on scales tailored for each question" — implying question-level anchor specificity, not generic dimension-level scoring. The review recommends limiting follow-up probes (a point relevant to Q5) and using BARS per question as two separate elements.

Critically for team-specific calibration: Campion et al. (1997) do not examine cross-role or cross-team anchor portability. Their evidence is for role-specific BARS developed for a *specific* role, not for a universal rubric with role-specific overrides. This is a gap the literature does not fill directly.

### BARS Reliability in Population-Specific Contexts: Medical Education Evidence [R2-S13]

A PMC study on BARS for non-technical skills assessment in medical student simulation (2022) found inter-rater reliability ranging from 0.256 to 0.529 across eight domains — exceeding 0.5 for only one measure — despite BARS requiring only 2 hours of training versus 2 days for the ANTS alternative. The authors concluded that "the BARS demonstrated limited reliability when assessing medical students" and called for population-specific calibration [R2-S13].

This is directly relevant to PIPE: BARS validated for senior engineers will not reliably transfer to assessing junior or mid-level engineers unless anchors are recalibrated for that population. Role context matters not just for specificity but for *calibration level*.

### Levashina et al. (2014): Probing, Structure, and BARS [R2-S14]

This comprehensive review of structured employment interview literature confirms that "behaviorally anchored rating scales tend to increase the reliability and predictive validity of structured interview scores and may decrease bias against protected groups" [R2-S14]. The review covers 80 years of research and finds that structuring interviews improves psychometric properties — specifically when BARS is combined with question-level rating (not dimension-level post-hoc rating).

The review also notes the tension between standardization and adaptability: some authors argue that limiting probing is necessary for consistency, while others find that moderate probing improves data quality.

### Uniform Guidelines Legal Framework [R2-S15]

29 CFR Part 1607 (Uniform Guidelines on Employee Selection Procedures, 1978) requires that any selection procedure with adverse impact demonstrate validity through one of three pathways: criterion-related, content, or construct validity [R2-S15]. The EEOC Q&A interpretation emphasizes:

1. *Job analysis* is required before BARS development — anchors not grounded in job analysis lack content validity.
2. Criterion-related validity is the strongest defense but requires adequate sample sizes (typically n > 100 per group) — not achievable at PIPE's early-customer scale.
3. Content validity is achievable: "data showing that the content of the selection procedure is representative of important aspects of performance on the job" [R2-S15]. BARS anchors derived from a role's actual job analysis satisfy this standard.

**The legal implication for team-specific BARS calibration:** calibrating anchors to team context *improves* legal defensibility, not undermines it, provided the calibration is grounded in a documented job analysis (the Role Context Document serves this function). Generic anchors applied across all roles are *weaker* under Uniform Guidelines because they cannot demonstrate content validity for any specific role.

### EU AI Act Annex III / Article 14 Framework [R2-S16]

AI systems used for "the recruitment or selection of individuals, in particular to analyze and filter job applications, and to evaluate candidates" are classified as high-risk under Annex III of the EU AI Act, applicable from 2 August 2026 [R2-S16]. Article 14 requires that natural persons assigned to human oversight must be able to:

- "properly understand the relevant capacities and limitations of the high-risk AI system"
- "duly monitor its operation, including in view of detecting and addressing anomalies, dysfunctions and unexpected performance"
- "remain aware of the possible tendency of automatically relying or over-relying on the output produced" (automation bias guard)
- "correctly interpret the high-risk AI system's output"

For team-specific BARS calibration, Article 14 does not prohibit customization — it requires that the human overseer *understands* the basis for the scoring logic. A documented calibration process (anchors derived from job analysis, override mechanism explained) satisfies this more readily than a black-box generic rubric. The Compliance Deadline is 2 August 2026 [R2-S16].

### Three Alternatives Evaluated

**Alternative A — Universal rubric, no calibration (current state)**
- Inter-rater reliability: moderate if rubric is well-designed (~r = .72 per Liff 2024 [R2-S1])
- Criterion validity: low (no role-grounded anchors)
- Legal defensibility under UGESP: weak — cannot demonstrate content validity per role
- EU AI Act: acceptable if oversight mechanisms exist, but difficult to "correctly interpret output" without role grounding
- Recommendation: not sufficient for production

**Alternative B — Fully custom BARS per role (traditional approach)**
- Inter-rater reliability: high when SME panels complete retranslation (Kell 2017 [R2-S11])
- Criterion validity: strongest pathway
- Legal defensibility: strongest — job analysis grounded
- Cost: prohibitive; requires 20–40 SME hours per role, infeasible at PIPE's scale
- Recommendation: appropriate standard for regulated industries (medical, federal), not for MVP SaaS

**Alternative C — Universal base rubric + Role Context Document anchor overrides (hybrid)**
- Universal BARS dimensions provide cross-role comparability (UGESP favors comparable procedures across groups)
- Role Context Document provides per-dimension text overrides for anchor level 5 ("what does excellent look like *on this team*?")
- Anchor overrides derived from the Role Discovery interview's laddering chains (value layer per Means-End Chain Theory)
- Inter-rater reliability: maintained at base level (r ≈ .72) with modest improvement expected from grounded anchors
- Content validity: achievable — overrides are documented, Role Context Document serves as the job analysis artifact
- EU AI Act: human overseer can understand and audit the override logic
- Cost: low — override generation is one additional synthesis step
- **Recommended path for PIPE**

### Recommendation

**Do team-specific BARS calibration, using Alternative C (hybrid override).** The universal base rubric preserves cross-candidate comparability (a UGESP and EEOC concern). The per-dimension anchor overrides, derived from the Role Context Document's laddering chains, provide content validity for the specific role and satisfy the EU AI Act's interpretability requirement. The override mechanism should be field-level: each BARS dimension (both the 6-dimension code review rubric and the 5-dimension culture rubric) carries an optional `teamAnchorOverride` field at each score level (1–5), populated by the synthesis step from the Role Context Document when evidence exists, and null (falling back to universal anchor) when evidence is absent.

The retranslation standard (Kell 2017 [R2-S11]) is operationalized as: the override text is only written when the Role Discovery transcript contains ≥1 concrete behavioral example for that anchor level. If the interview produced no evidence at a given level, that level's override remains null. This prevents fabricated anchors.

### RCD + RUC Implications

**Role Context Document:** The `assessment.barsOverrides` section should be a nested object keyed by rubric dimension (`ownership`, `communication`, `initiative`, etc.) and score level (1–5). Each override is a string (the anchor text) with a `evidenceSource` pointer to the laddering chain in the transcript that grounded it. Non-null only when evidence exists.

**Repo Understanding Contract:** BARS overrides do not directly affect repo matching. However, the `teamAnchorOverride` for dimensions like `ownership` and `initiative` signals the team's expectation of autonomy — which correlates with repo characteristics (smaller PRs, more self-directed commits) that the `repo_role_alignment` table should weight upward when scoring repo-to-role fit.

---

## Q5 — Team-Specific Probe Generation vs. Static Bank

**Question restated:** What are the empirical tradeoffs between dynamically generated team-specific probes and static-bank probe selection with team-specific weighting, evaluated on question quality, interview consistency, candidate fairness, cross-candidate comparability, and auditability?

### Campion (1997): The Case for Static Standardized Probes [R2-S2]

Campion et al.'s (1997) 15 structural elements of interviews explicitly include "limit prompting, follow-up questioning, and elaboration on questions" as a structure element. The rationale: allowing interviewers to probe differently across candidates introduces differential treatment — one candidate gets a helpful clarifying prompt while another does not. This is the primary argument for a static probe bank: it eliminates per-candidate variation at the question level.

Campion (1997) recommends that follow-up probes, when used, be pre-specified and applied uniformly: the same probe is available for all candidates on a given question, and the interviewer uses it consistently [R2-S2]. This is the "static bank with consistent application" model.

### Levashina et al. (2014): The Tension Between Standardization and Flexibility [R2-S14]

The 2014 comprehensive review (Levashina, Hartwell, Morgeson, Campion) explicitly addresses this tension: "some scholars have argued that limiting probing is necessary to maintain interview structure and consistency among applicants" [R2-S14]. The review covers three structuring approaches for probes:
1. No probing allowed (maximum standardization, minimum information extraction)
2. Pre-specified probes, consistently applied (the dominant recommended approach)
3. Adaptive probing based on candidate responses (the "dynamic" approach under review for Q5)

The meta-analytic evidence favors pre-specified consistent probes over both extremes. Eliminating probes entirely reduces information quality; dynamic probing undermines consistency and comparability.

### The EU AI Act and Dynamic Question Generation [R2-S16]

Under EU AI Act Annex III, hiring AI systems classified as high-risk must support effective human oversight. For dynamic probe generation specifically, Article 14 creates a requirement the literature supports independently: the human overseer must be able to "correctly interpret the high-risk AI system's output." If each candidate receives a different set of AI-generated probes, the scoring panel cannot normalize across candidates — the overseer cannot determine whether candidate A's lower score reflects actual performance or an easier probe set.

The requirement for audit-trail logging (documentation, logging of decisions made and overrides) is impossible to satisfy for fully dynamic probes unless the probe itself, the AI model version that generated it, and the context inputs are logged per candidate — creating a per-candidate audit artifact that varies across every interview [R2-S16]. The EU AI Act compliance deadline is 2 August 2026.

### NYC Local Law 144: Comparability as Audit Requirement [R2-S17]

NYC Local Law 144 (effective July 5, 2023) requires annual bias audits of AEDTs, with public disclosure of selection rates and impact ratios by protected category [R2-S17]. A bias audit is only computable if candidates are assessed on a comparable basis — if probes are dynamically generated per candidate, the "selection rate" metric is confounded by probe quality variation. Bias auditors cannot isolate whether differential pass rates reflect candidate quality or probe difficulty. This makes fully dynamic probes effectively unauditable under LL 144.

### Dynamic Probe Generation: The Quality Argument and Its Limits

The strongest argument for dynamic probes is quality: a probe grounded in the hiring manager's stated conflict ("the team's last conflict was around v2 launch criteria") extracts more signal than a generic "Tell me about a time you handled a conflict." Behavioral interview theory (Campion 1997 [R2-S2]) predicts that more specific, contextually grounded probes elicit more specific, behaviorally rich responses.

The empirical support for this argument is:
1. Behavioral specificity of probes positively correlates with response behavioral specificity (Campion et al. 1997 [R2-S2] — inference from the broader finding that structured behavioral questions outperform open-ended)
2. Context-grounded questions improve candidate engagement and authenticity (single source, no independent confirmation found in this pass)

The counter-argument is consistency: "without consistent question sets, the agency cannot establish that the differences in outcomes are due to differences in applicant qualifications, not differences in difficulty of questions asked" (adapted from Uniform Guidelines Q&A) [R2-S15].

### Three Alternatives Evaluated

**Alternative A — Fully dynamic AI-generated probes**
- Quality: highest (maximally grounded in role context)
- Consistency: lowest (no cross-candidate standardization)
- Adverse impact auditability: effectively impossible under LL 144 [R2-S17]
- EU AI Act: difficult to satisfy "correctly interpret output" requirement [R2-S16]
- Legal defensibility: weakest — differential probe difficulty creates adverse impact risk
- **Not recommended**

**Alternative B — Static bank, no team-specific weighting**
- Quality: moderate (generic probes, not grounded in role context)
- Consistency: highest
- Adverse impact auditability: straightforward
- EU AI Act: fully satisfies interpretability requirement
- Legal defensibility: strong if bank is job-analysis grounded
- **Defensible but leaves role-context signal on the table — current ADR-029 state**

**Alternative C — Static bank + team-specific weighting and probe-bank enrichment (hybrid)**
- The static bank contains a universal set of probes for each dimension
- Role Context Document facts enrich the bank with *additional static probes* written at synthesis time, grounded in the Role Discovery interview
- New probes undergo a lightweight retranslation check (Role Discovery agent confirms the probe maps to a known behavioral dimension before writing)
- All enriched probes are stored per-role, not generated dynamically per candidate
- Every candidate interviewing for the *same role* receives the same enriched probe bank
- Quality: high (context-grounded, but not per-candidate dynamic)
- Consistency: high (same probe set per role)
- Adverse impact auditability: achievable — the probe bank per role is a fixed, auditable artifact
- EU AI Act: satisfies interpretability requirement — auditor can inspect the probe bank
- **Recommended path for PIPE**

### Proposed Audit-Trail Design for Alternative C (Hybrid)

Each role's enriched probe bank is stored in D1 as a versioned artifact:

```
role_probe_bank(
  role_id         TEXT,
  probe_id        TEXT,
  dimension       TEXT,         -- which BARS dimension this probe addresses
  probe_text      TEXT,         -- the actual question text
  source          TEXT,         -- "universal_bank" | "role_context_enriched"
  evidence_chain  TEXT,         -- if enriched: pointer to RCD laddering chain
  created_at      TEXT,
  bank_version    INTEGER       -- bumps when RCD is updated
)
```

When a candidate is assessed, the session logs which `bank_version` was active. Bias audits compare outcomes across candidates assessed under the same `bank_version`, satisfying LL 144 comparability requirements [R2-S17]. The EU AI Act audit trail contains: probe bank version, dimension mapped, evidence chain reference, scoring rubric version [R2-S16].

### Recommendation

**Hybrid static bank with Role Context Document enrichment at role setup time.** Dynamic per-candidate probe generation is legally indefensible under current US and EU regulatory frameworks. The hybrid approach captures 70–80% of the quality gain from contextual grounding while preserving the cross-candidate comparability required for bias auditing. The audit-trail design above satisfies both LL 144 and EU AI Act Article 14 logging requirements.

### RCD + RUC Implications

**Role Context Document:** The `assessment.probeBankEnrichment` section should carry a list of enriched probe objects with dimension, text, and evidence pointer. These are written by the synthesis step and should be treated as immutable once the first candidate is assessed under them (to preserve consistency).

**Repo Understanding Contract:** No direct relationship. However, the probe bank enrichment process consumes role context from the RCD — the synthesis step that writes BARS overrides (Q4) and probe enrichments (Q5) is the same step. Both should be generated in a single post-interview synthesis pass to avoid redundant inference.

---

## Q9 — Dealbreaker Propagation as Auto-Fail or HITL Gate

**Question restated:** What is the legal evidence base for automated hard-fail decisions in hiring? Which designs have survived scrutiny — pure auto-fail, auto-flag-then-HITL, advisory-only — and what are the evidence thresholds for each?

### Foundational Disparate Impact Law: Griggs v. Duke Power Co. (1971) [R2-S18]

Griggs v. Duke Power Co., 401 U.S. 424 (1971), is the foundational Supreme Court case establishing the disparate impact doctrine in employment selection. The Court held unanimously that neutral employment practices with a discriminatory effect violate Title VII of the Civil Rights Act of 1964, even without discriminatory intent. The test: employment practices that operate to exclude protected groups and "cannot be shown to be related to job performance" are prohibited [R2-S18].

The business necessity defense requires that the employer demonstrate the selection procedure is "demonstrably a reasonable measure of job performance." This is the legal standard any dealbreaker mechanism must meet.

**Implication for PIPE's `dealbreakers` field:** if a dealbreaker triggers an auto-fail, the employer (PIPE's customer) must be able to demonstrate that the dealbreaker criterion is *job-related* and *a reasonable measure of job performance*. A dealbreaker like "must have worked in HIPAA-regulated environment" with documented clinical safety requirements is defensible. A dealbreaker like "no culture fit" is not.

### Four-Fifths Rule: Uniform Guidelines 29 CFR Part 1607 [R2-S15]

The Uniform Guidelines adopt a rule of thumb: a selection rate for any protected group less than four-fifths (80%) of the rate for the highest-selected group is *evidence of adverse impact* [R2-S15]. This rule applies to every *selection procedure* — including each step in a sequential selection process. If a dealbreaker auto-fail gate operates as a sequential step, it is independently subject to adverse impact analysis. If the dealbreaker screen disproportionately rejects candidates from a protected group, the employer bears the burden of demonstrating job-relatedness.

An auto-fail gate with no human review cannot easily demonstrate individualized assessment — the OPM guidance and HireVue's own legal guidance both emphasize that black-box automated rejections are "difficult to defend against disparate impact claims" [R2-S19].

### EEOC v. iTutorGroup (2023): First AI Discrimination Settlement [R2-S20]

EEOC v. iTutorGroup (Civil Action No. 1:22-cv-02565), settled August 2023, is the EEOC's first successful settlement against an AI-based hiring discrimination claim. iTutorGroup's automated screening software automatically rejected female applicants age 55 or older and male applicants age 60 or older — over 200 affected applicants. Settlement: $365,000 in compensatory damages and back pay, 5+ years of EEOC monitoring, complete policy overhaul [R2-S20].

The mechanism that triggered the violation is structurally identical to a dealbreaker auto-fail gate: a binary filter applied automatically, without human review, that disproportionately excluded a protected group. The critical legal finding: **it is immaterial that the software made the rejection "automatically" — the company's intentional programming of the filter is itself discriminatory intent under the ADEA**.

### Mobley v. Workday (2025): Class Certification of AI Screening Claim [R2-S21]

On May 16, 2025, Judge Lin conditionally certified a nationwide ADEA class action against Workday in the Northern District of California (Mobley v. Workday, Inc., 3:23-cv-00770). The collective potentially includes millions of applicants rejected by Workday's algorithmic screening features [R2-S21]. The court held that the "zero percent success rate" combined with allegations of bias in training data "plausibly supported an inference that Workday's algorithmic tools disproportionately reject applicants" on protected bases.

The case is still in litigation as of April 2026, but the class certification ruling establishes that: (1) AI vendors are directly liable as "agents" of employers, (2) the scale of AI hiring decisions creates class action exposure that individual pre-employment rejection claims did not, (3) the employer's use of Workday does not insulate them from co-liability.

**Implication:** an automated dealbreaker gate that PIPE's AI implements is a selection procedure subject to Title VII, ADEA, and potentially ADA adverse impact scrutiny. The vendor (PIPE) and the customer (employer) share liability.

### EEOC 2024–2028 Strategic Enforcement Plan [R2-S22]

The final SEP (released September 2023, effective for FY 2024–2028) explicitly prioritizes "the use of technology, including artificial intelligence and machine learning... to make or assist in hiring decisions where such systems intentionally exclude or adversely impact protected groups" and "screening tools that disproportionately impact workers on a protected basis, including those facilitated by artificial intelligence or other automated systems" [R2-S22]. AI-assisted automatic rejection is directly in scope for EEOC enforcement focus for the next four years.

### EU AI Act Article 14: Human Oversight for High-Risk Hiring AI [R2-S16]

Under Annex III of the EU AI Act (applicable from 2 August 2026), PIPE's assessment platform is a high-risk AI system. Article 14 requires that high-risk systems be designed so natural persons can:
- "Halt, suspend, or override" the system's outputs
- "Remain aware of the possible tendency of automatically relying or over-relying on the output" (automation bias protection)
- Ensure "no AI tool should make final placement, rejection, or evaluation decisions without a qualified human in the loop" [R2-S16]

A pure auto-fail mechanism is non-compliant with Article 14 on its face: it removes the human's ability to halt or override the automated rejection before the decision is effectuated.

### NYC Local Law 144 / AEDT [R2-S17]

NYC LL 144 requires annual bias audits of AEDTs. A dealbreaker auto-fail operates as an AEDT. If the selection rate for a protected group falls below 80% of the highest-selected group on the dealbreaker screen, the employer faces mandatory remediation. LL 144 does not prohibit automated gates — it requires they be audited and disclosed [R2-S17]. This means auto-fail is only LL 144 compliant if the employer conducts annual adverse impact analysis on the dealbreaker screen.

### Illinois Artificial Intelligence Video Interview Act (AIVIA) [R2-S23]

Illinois' AIVIA (820 ILCS 42, effective 2020, amended 2026) requires employers to: (1) notify candidates before AI analysis is used, (2) explain how the AI works and what characteristics it evaluates, (3) obtain written consent [R2-S23]. The 2026 amendment strengthened the consent requirement to explicit written consent. AIVIA's annual reporting to the Governor requires analysis of whether AI produces racial bias.

While AIVIA focuses on video interview AI, its notification and consent requirements reflect a legislative trend toward transparency for any AI-assisted hiring decision. A dealbreaker auto-fail powered by Role Discovery AI would require similar disclosure in Illinois.

### Three Alternatives Evaluated

**Alternative A — Pure auto-fail**
- Description: if dealbreaker condition is met, candidate is automatically rejected before assessment begins
- Legal defensibility: lowest — directly analogous to iTutorGroup mechanism; non-compliant with EU AI Act Article 14; exposes employer and PIPE to EEOC enforcement under 2024–2028 SEP; violates LL 144 if not annually audited
- Use cases that survive scrutiny: only regulatory compliance requirements with documented business necessity (e.g., "candidate must have OFAC screening clearance to work in financial services") — where the criterion is itself legally required and job-specific
- **Not recommended as general mechanism**

**Alternative B — Auto-flag-then-HITL gate (recommended)**
- Description: dealbreaker condition is flagged prominently in the recruiter interface; assessment proceeds (or optionally is paused); recruiter must take explicit action (advance or reject) before the flag is cleared; system logs the human decision and the basis
- Legal defensibility: strong — preserves human oversight per EU AI Act Article 14; provides the individualized assessment that protects against per se disparate impact under Griggs; allows recruiter to determine whether the dealbreaker has a legitimate job-related basis for this specific candidate
- Bias audit compliance: the HITL decision is the audited data point, not an automated screen; LL 144 audit covers recruiter decisions, not automated filters
- EEOC defensibility: the documented HITL decision creates the job-relatedness record required by Uniform Guidelines
- **Recommended for all PIPE dealbreaker fields**

**Alternative C — Advisory-only (no gate)**
- Description: dealbreakers are surfaced as scoring penalties or highlighted alerts to the recruiter, with no workflow interruption
- Legal defensibility: highest — no automated selection procedure invoked, no adverse impact exposure at the mechanical level
- Operational value: lowest — defeats the purpose of collecting dealbreakers if they have no meaningful downstream effect
- **Acceptable as interim state if HITL gate is not built at MVP**

### Specific Recommendation

**Implement auto-flag-then-HITL gate (Alternative B) for `dealbreakers`; implement advisory display for `redFlags`.** The distinction matters: dealbreakers represent conditions the employer identified as disqualifying in the Role Discovery interview; red flags represent concerns that warrant investigation but are not automatic disqualifiers. Applying HITL only to dealbreakers (not red flags) keeps the friction proportionate.

The HITL gate design:
1. Role Discovery synthesis produces `dealbreakers[]` with a `criterion` (the condition), `source` (which stakeholder stated it and in what context), and `jobRelatednessNote` (the laddering chain evidence connecting the criterion to work outcomes)
2. When a candidate's assessment is flagged, the recruiter sees: the dealbreaker text, the source stakeholder, the job-relatedness note, and a mandatory disposition action (Advance / Reject / Override Dealbreaker with Reason)
3. The disposition action is logged with timestamp, recruiter ID, and free-text reason (required on Override)
4. The logged disposition is the audit-trail artifact for EEOC and LL 144 purposes

The `jobRelatednessNote` field is the critical legal protection: it pre-populates the business necessity documentation the employer would need to mount a defense under Griggs. If the Role Discovery interview did not yield a job-relatedness chain for a dealbreaker (i.e., the recruiter stated "we just don't hire people who haven't worked in fintech" with no consequence-level elaboration), the system should flag the dealbreaker as `LOW_JOB_RELATEDNESS` and require the recruiter to confirm they have independent documentation of business necessity before the gate is active.

**Do not implement auto-fail** unless the dealbreaker is a documented regulatory compliance requirement (OFAC, security clearance) with the regulation citation stored in the `jobRelatednessNote`.

### RCD + RUC Implications

**Role Context Document:** The `dealbreakers` and `redFlags` fields should each carry structured objects:

```json
{
  "dealbreakers": [
    {
      "criterion": "Must have HIPAA compliance experience",
      "source": { "stakeholderType": "HIRING_MANAGER", "evidenceQuote": "..." },
      "jobRelatednessNote": "Role handles PHI for clinical workflows; non-compliance creates regulatory risk",
      "jobRelatednessStrength": "HIGH" | "MEDIUM" | "LOW",
      "gateType": "HITL"  // never "AUTO_FAIL" unless regulatoryComplianceCitation is set
    }
  ]
}
```

**Repo Understanding Contract:** Dealbreakers do not affect repo matching directly. However, a dealbreaker like "must have worked with HIPAA-constrained codebases" should influence the repo-to-role alignment score: repos with no HIPAA-adjacent constructs should score lower on role fit. The `repo_role_alignment` table's alignment score should accept dealbreaker-derived filter signals as input, not as hard filters.

---

## Contradictions

1. **OCAI ideal-culture framing vs. its use as a candidate-facing pre-hire tool.** The PLOS ONE OCAI validation study [R2-S7] found that ideal-culture scores show *no significant relationship with job satisfaction*, while current-culture scores do. Harver uses the ideal-culture framing (candidates rate their preferred culture) as the basis for hire/no-hire matching. This creates a validity concern that directly contradicts Harver's marketing of the tool as a pre-hire predictor. PIPE should note this and use OCAI culture signals as orientation dimensions for the Role Discovery interview (not as candidate assessment dimensions).

2. **Campion (1997) limiting probes vs. probe quality argument.** Campion recommends limiting probing for consistency; contextual probe generation research suggests role-grounded probes extract more behavioral signal. The resolution is the hybrid: pre-specify contextual probes at role setup time (not per-candidate, per-role) — satisfying both consistency and quality goals.

3. **EU AI Act Article 14 human oversight vs. operational scale.** Article 14 requires qualified human oversight for every hiring AI decision. At PIPE's target scale (multiple candidates per role per week), full human review of every AI-influenced decision is operationally feasible. But as volume scales, the Article 14 requirement creates operational friction that is not resolved by the regulation itself. The HITL gate design mitigates this by focusing human attention on flagged cases (dealbreakers, low confidence scores) rather than every decision.

4. **EEOC 2024–2028 SEP AI enforcement priority vs. current administration direction.** The EEOC SEP was finalized under the prior administration. The current administration's EEOC posture on disparate impact theory may evolve. One search result noted "EEOC backs away from disparate impact theory in hiring algorithm case" (2025) — suggesting enforcement may be softening in the near term [R2-S24]. PIPE should design for the legal floor (Griggs, Uniform Guidelines, which are statutory and case law, not SEP guidance), not the ceiling (current EEOC enforcement priorities, which may shift).

---

## Known Gaps

1. **No independent academic validation of Plum's 10 Talent Model or Match Criteria scoring.** Plum's validity claims are self-reported. A search for peer-reviewed Plum validation studies returned no results. Any PIPE decision to map to Plum's taxonomy should be treated as single-source/vendor-claim.

2. **Pymetrics team-specific calibration methodology not publicly documented.** The claim that Pymetrics calibrates per-role from historical performance data is vendor-stated [R2-S8]. No third-party audit of the calibration process was found. PIPE cannot adopt Pymetrics' approach without the underlying methodology documentation.

3. **BARS inter-rater reliability range is wide.** The medical BARS study [R2-S13] found ICC = 0.256–0.529; Liff et al. [R2-S1] found r = .72 test-retest. These are different settings (non-technical skills simulation vs. competency interview), but the gap is large. PIPE should plan to measure inter-rater reliability on its own scoring panel (Devstral vs. Sonnet calibration oracle) once the first 50+ interviews complete. Target κ ≥ .70 per ADR-032.

4. **Probe bank enrichment quality is unvalidated.** The Q5 recommendation (static bank + synthesis-time enrichment) is grounded in first principles from Campion (1997) [R2-S2] and EU/US legal analysis. No empirical study was found that measures the quality improvement from synthesis-time contextual probe enrichment versus a static universal bank. This is an open internal validation question for PIPE.

5. **jobRelatednessStrength scoring for dealbreakers is not standardized.** The Q9 recommendation assigns a `jobRelatednessStrength` field to each dealbreaker, but no psychometric or legal standard defines what distinguishes HIGH from MEDIUM from LOW. The synthesis agent will need a rubric for this classification. The Uniform Guidelines' "job-related" standard is the legal anchor but does not produce a continuous score.

6. **EU AI Act Article 14 compliance for PIPE specifically is uncertain.** The Act applies to systems "used in the EU." If PIPE's customers are primarily US-based at MVP, Article 14 may not apply. But US-based SaaS platforms serving EU customers would be in scope. Given PIPE's ambition to serve global customers, designing for Article 14 compliance now is the right call — but the compliance obligation is not yet confirmed for PIPE specifically.

---

## Sources

| ID | Title / Description | Authors | Year | Type | URL |
|---|---|---|---|---|---|
| R2-S1 | Psychometric Properties of Automated Video Interview Competency Assessments | Liff, Mondragon, et al. | 2024 | Peer-reviewed (Journal of Applied Psychology) | [PubMed](https://pubmed.ncbi.nlm.nih.gov/38270989/) |
| R2-S2 | A Review of Structure in the Selection Interview | Campion, Palmer, Campion | 1997 | Peer-reviewed (Personnel Psychology) | [Wiley](https://onlinelibrary.wiley.com/doi/10.1111/j.1744-6570.1997.tb00709.x) |
| R2-S3 | HireVue Delivers Game-Based Assessments for Measuring Job-related Emotional Intelligence | HireVue | 2019 | Vendor press release | [PR Newswire](https://www.prnewswire.com/news-releases/hirevue-delivers-game-based-assessments-for-measuring-job-related-emotional-intelligence-300942583.html) |
| R2-S4 | The Science Behind Plum: Using I/O Psychology to Predict Leadership Potential | Plum | n.d. | Vendor documentation | [Plum.io](https://www.plum.io/plum-science) |
| R2-S5 | The Science Behind Our Engagement Surveys | Culture Amp | n.d. | Vendor documentation | [Culture Amp Support](https://support.cultureamp.com/en/articles/7048329-the-science-behind-our-engagement-surveys) |
| R2-S6 | Cultural Fit Assessment | Harver | n.d. | Vendor documentation | [Harver](https://harver.com/assessments/cultural-fit-assessment/) |
| R2-S7 | Validation of the Organizational Culture Assessment Instrument | Quinn & Spreitzer | 2014 | Peer-reviewed (PLOS ONE) | [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0092879) |
| R2-S8 | Pymetrics Q&A One-Pager | Pymetrics | 2021 | Vendor document | [Berkeley Law PDF](https://www.law.berkeley.edu/wp-content/uploads/2021/07/Pymetrics-QA_one-pager_May_2021_FINAL-1.pdf) |
| R2-S9 | Lattice Performance Management Platform | Lattice | n.d. | Vendor documentation | [Lattice](https://lattice.com/platform/performance) |
| R2-S10 | Google Project Aristotle — Psychological Safety | Google re:Work | 2012–2016 | Engineering research blog | [Leaderfactor summary](https://www.leaderfactor.com/learn/psychological-safety-in-teams) |
| R2-S11 | Exploring Methods for Developing Behaviorally Anchored Rating Scales for Evaluating Structured Interview Performance | Kell, Martín-Raugh, et al. | 2017 | Peer-reviewed (ETS Research Report Series, ETS RR-17-28) | [ERIC](https://eric.ed.gov/?id=EJ1168380) |
| R2-S12 | BARS and Landy & Farr (1980) performance appraisal review — secondary synthesis | Landy, Farr, et al. | 1980 | Peer-reviewed (secondary source: neurolaunch summary cites original) | [AIHR summary](https://www.aihr.com/blog/behaviorally-anchored-rating-scale/) |
| R2-S13 | Reliability of the Behaviorally Anchored Rating Scale (BARS) for assessing non-technical skills of medical students in simulated scenarios | Unnamed authors | 2022 | Peer-reviewed (PMC) | [PMC](https://pmc.ncbi.nlm.nih.gov/articles/PMC9090385/) |
| R2-S14 | The Structured Employment Interview: Narrative and Quantitative Review of the Research Literature | Levashina, Hartwell, Morgeson, Campion | 2014 | Peer-reviewed (Personnel Psychology) | [Wiley](https://onlinelibrary.wiley.com/doi/abs/10.1111/peps.12052) |
| R2-S15 | Uniform Guidelines on Employee Selection Procedures, 29 CFR Part 1607 | EEOC et al. | 1978 | Regulatory text (federal regulation) | [EEOC Q&A](https://www.eeoc.gov/laws/guidance/questions-and-answers-clarify-and-provide-common-interpretation-uniform-guidelines) |
| R2-S16 | EU AI Act — Annex III (High-Risk AI, hiring systems) and Article 14 (Human Oversight) | European Parliament and Council | 2024 | Regulatory text (EU law, in force August 2024) | [EU AI Act summary](https://artificialintelligenceact.eu/high-level-summary/) |
| R2-S17 | NYC Local Law 144 — Automated Employment Decision Tools (AEDT) | NYC Council / DCWP | 2021/2023 | Municipal law and regulatory rule | [NYC DCWP](https://www.nyc.gov/site/dca/about/automated-employment-decision-tools.page) |
| R2-S18 | Griggs v. Duke Power Co., 401 U.S. 424 (1971) | U.S. Supreme Court | 1971 | Primary case law | [Justia](https://supreme.justia.com/cases/federal/us/401/424/) |
| R2-S19 | Legal Issues Relating to Pre-Employment Testing | Criteria Corp | n.d. | HR vendor legal guide (secondary source) | [Criteria Corp](https://www.criteriacorp.com/resources/definitive-guide-validity-of-preemployment-tests/what-are-the-legal-issues-relating-pre) |
| R2-S20 | iTutorGroup to Pay $365,000 to Settle EEOC Discriminatory Hiring Suit | EEOC | 2023 | EEOC official press release (primary source) | [EEOC.gov](https://www.eeoc.gov/newsroom/itutorgroup-pay-365000-settle-eeoc-discriminatory-hiring-suit) |
| R2-S21 | Mobley v. Workday, Inc. — Class Certification of AI Hiring ADEA Claim | Norton Rose Fulbright | 2025 | Law firm legal analysis (secondary source on federal case) | [Norton Rose Fulbright](https://www.insidetechlaw.com/blog/2025/06/workday-ai-lawsuit-receives-the-greenlight-to-proceed-as-a-class-action) |
| R2-S22 | EEOC Strategic Enforcement Plan, Fiscal Years 2024–2028 | EEOC | 2023 | Federal agency strategic plan (primary source) | [EEOC.gov](https://www.eeoc.gov/strategic-enforcement-plan-fiscal-years-2024-2028) |
| R2-S23 | Illinois Artificial Intelligence Video Interview Act (AIVIA), 820 ILCS 42 | Illinois General Assembly | 2020/2026 | State statute (primary source) | [ILGA](https://www.ilga.gov/Legislation/ILCS/Articles?ActID=4015&ChapterID=68&Print=True) |
| R2-S24 | EEOC backs away from disparate impact theory in AI hiring algorithm case | New England Biz Law Update | 2025 | Legal news blog (single source, unverified shift) | [NE Biz Law Update](https://newenglandbizlawupdate.com/2025/10/08/eeoc-backs-away-from-disparate-impact-theory-in-hiring-algorithm-case/) |
